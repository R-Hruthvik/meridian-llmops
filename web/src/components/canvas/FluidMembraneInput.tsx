'use client';

import { useCallback, useEffect, useRef } from 'react';
import { Search, ArrowUpRight } from 'lucide-react';
import { MERIDIAN_SPRING } from '../../constants/springs';
import { parseColorRgb } from './colorRgb';

export interface FluidMembraneInputProps {
  /** Extra classes applied to the outer wrapper. */
  className?: string;
  /** When true the dock sits at the vertical center of the viewport; when false
   *  it sits at the bottom dock. A critically-damped spring glides between them. */
  isCenter?: boolean;
  /** RGB triplet for the membrane stroke, e.g. "37 99 235". */
  colorRgb?: string;
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  /** Fired when the user submits (Enter or send button). */
  onSubmit?: () => void;
  /** Optional ref forwarded to the underlying input element. */
  inputRef?: React.Ref<HTMLInputElement>;
  /** Accessible name for the input. */
  ariaLabel?: string;
}

/** High-craft single capsule input dock with a closed-loop fluid membrane canvas
 *  framing its boundary and a true critically-damped spring gliding it between
 *  hero center and bottom dock. One instance only — RagWorkspace mounts it once. */
export function FluidMembraneInput({
  className = '',
  isCenter = false,
  colorRgb = '37 99 235',
  placeholder,
  value,
  onChange,
  onSubmit,
  inputRef: inputRefForward,
  ariaLabel = 'Ask Meridian RAG',
}: FluidMembraneInputProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const rafRef = useRef(0);
  const rafActive = useRef(false);

  // Capsule vertical position state.
  const y = useRef(0);
  const targetY = useRef(0);
  const vy = useRef(0); // capsule vertical velocity, px/s — preserved across target changes

  // Critically-damped spring (§MERIDIAN_SPRING: k=100, c=20, m=1, ζ=1.0).
  const SPRING_K = MERIDIAN_SPRING.stiffness;
  const SPRING_C = MERIDIAN_SPRING.damping;
  const SPRING_M = MERIDIAN_SPRING.mass;
  const SPRING_DT = 1 / 60; // fixed semi-implicit Euler step

  // Membrane sample points around the capsule perimeter, plus cursor/ripple state.
  const points = useRef<Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    s: number;
    nx: number;
    ny: number;
  }>>([]);
  const cursor = useRef({ x: 0, y: 0 });
  const ripples = useRef<Array<{ x: number; y: number; age: number }>>([]);

  const initialized = useRef(false);

  // Kill switches (§4.1): reduced motion, hidden tab, battery-saver / low power.
  const reduced = useRef(false);
  const hidden = useRef(false);
  const lowPower = useRef(false);
  const killed = () => reduced.current || hidden.current || lowPower.current;

  const EPSILON = 0.1; // px — spring arrival tolerance

  // Membrane constants (§4.2–4.4, §6).
  const BLEED = 32; // px — canvas = capsule bounds + 32 px on all sides
  const SEGMENTS = 120; // contour samples around the capsule perimeter
  const A1 = 2.5; // px — primary octave amplitude
  const A2 = 1.2; // px — secondary octave amplitude
  const W1 = 1.0; // rad/s — primary travel speed
  const W2 = -1.6; // rad/s — secondary travels opposite direction
  const P1 = 0.4; // primary phase
  const P2 = 2.1; // secondary phase
  const MAGNET_R = 64; // px — magnetic cursor pull radius
  const RIPPLE_TAU = 0.350; // s — typing ripple decay
  const RIPPLE_SPEED = 60; // px/s — ripple speed along the perimeter
  const VISCOUS_DECAY = 0.88; // per-frame membrane damping
  const CONTOUR_STIFFNESS = 0.3; // per-frame contour blending

  const sizeCanvas = useCallback(() => {
    const capsule = capsuleRef.current;
    const c = canvasRef.current;
    if (!capsule || !c) return;
    const rect = capsule.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Canvas = capsule bounds + 32 px bleed on all sides (§4.5).
    c.width = Math.max(1, rect.width + 2 * BLEED) * dpr;
    c.height = Math.max(1, rect.height + 2 * BLEED) * dpr;
    const ctx = c.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  useEffect(() => {
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);
    return () => window.removeEventListener('resize', sizeCanvas);
  }, [sizeCanvas]);

  const setTarget = useCallback(() => {
    const vpH = window.innerHeight;
    const capH = 52; // capsule height
    if (isCenter) {
      targetY.current = vpH * 0.42 - capH / 2;
    } else {
      targetY.current = vpH - 76 - capH / 2; // bottom dock (~bottom-8-ish)
    }
  }, [isCenter]);

  // Sample the capsule perimeter at equal arc-length intervals.
  // Returns { x, y, nx, ny, s } per sample (unit normal + arc length from start).
  const buildSamples = useCallback(
    (cx: number, cy: number, rx: number, ry: number) => {
      const samples: Array<{ x: number; y: number; nx: number; ny: number; s: number }> = [];
      let s = 0;
      let prev: { x: number; y: number } | null = null;
      for (let i = 0; i <= SEGMENTS; i++) {
        const tt = (i / SEGMENTS) * 2 * Math.PI;
        const corner = ry - 2;
        let x: number, yy: number;
        if (tt < Math.PI / 2) {
          x = cx + rx - corner + corner * Math.cos(tt);
          yy = cy + ry - corner + corner * Math.sin(tt);
        } else if (tt < Math.PI) {
          x = cx - rx + corner - corner * Math.cos(tt);
          yy = cy + ry - corner + corner * Math.sin(tt);
        } else if (tt < 1.5 * Math.PI) {
          x = cx - rx + corner - corner * Math.cos(tt);
          yy = cy - ry + corner + corner * Math.sin(tt);
        } else {
          x = cx + rx - corner + corner * Math.cos(tt);
          yy = cy - ry + corner + corner * Math.sin(tt);
        }
        const dx = x - cx;
        const dy = yy - cy;
        const len = Math.hypot(dx, dy) || 1;
        if (prev) s += Math.hypot(x - prev.x, yy - prev.y);
        samples.push({ x, y: yy, nx: dx / len, ny: dy / len, s });
        prev = { x, y: yy };
      }
      return samples;
    },
    [SEGMENTS],
  );

  const renderFrame = useCallback(
    (t: number) => {
      const c = canvasRef.current;
      const ctx = c ? c.getContext('2d') : null;
      if (!ctx) return;
      const capsule = capsuleRef.current;
      if (!capsule) return;

      const rect = capsule.getBoundingClientRect();
      const cssW = Math.max(1, rect.width + 2 * BLEED);
      const cssH = Math.max(1, rect.height + 2 * BLEED);
      const cx = cssW / 2;
      const cy = cssH / 2;
      const rx = Math.max(4, cssW / 2 - 2);
      const ry = Math.max(4, cssH / 2 - 2);

      const samples = buildSamples(cx, cy, rx, ry);
      const L = samples[samples.length - 1]?.s || 1;
      const k1 = (4 * Math.PI) / L;
      const k2 = 2 * k1;

      // (Re)initialise membrane points when the sample count changes.
      if (points.current.length !== samples.length) {
        points.current = samples.map((smp) => ({
          x: smp.x,
          y: smp.y,
          vx: 0,
          vy: 0,
          s: smp.s,
          nx: smp.nx,
          ny: smp.ny,
        }));
      }

      // Dual-octave arc-length sine contour (§4.2):
      // r(s,t) = R + A1·sin(k1·s − w1·t + p1) + A2·sin(k2·s − w2·t + p2)
      for (let i = 0; i < samples.length; i++) {
        const smp = samples[i];
        const pt = points.current[i];
        pt.s = smp.s;
        pt.nx = smp.nx;
        pt.ny = smp.ny;

        const distort =
          A1 * Math.sin(k1 * smp.s - W1 * t + P1) +
          A2 * Math.sin(k2 * smp.s - W2 * t + P2);

        // Magnetic cursor pull (§4.4): quadratic falloff within 64 px.
        let pullX = 0;
        let pullY = 0;
        const d = Math.hypot(pt.x - cursor.current.x, pt.y - cursor.current.y);
        if (d > 0 && d < MAGNET_R) {
          const fall = (1 - d / MAGNET_R) ** 2;
          pullX = ((cursor.current.x - pt.x) / d) * fall * 1.6;
          pullY = ((cursor.current.y - pt.y) / d) * fall * 1.6;
        }

        // Blend point toward the distorted contour, apply pull, damp velocity.
        const targetX = smp.x + distort * smp.nx + pullX;
        const targetY = smp.y + distort * smp.ny + pullY;
        pt.vx += (targetX - pt.x) * CONTOUR_STIFFNESS;
        pt.vy += (targetY - pt.y) * CONTOUR_STIFFNESS;
        pt.vx *= VISCOUS_DECAY;
        pt.vy *= VISCOUS_DECAY;
        pt.x += pt.vx;
        pt.y += pt.vy;
      }

      ctx.clearRect(0, 0, cssW, cssH);

      // Capsule outline path; membrane waves are clipped to it (§4.5).
      const capsulePath = new Path2D();
      capsulePath.roundRect(BLEED, BLEED, rect.width, rect.height, ry);

      ctx.save();
      ctx.clip(capsulePath);

      ctx.beginPath();
      ctx.strokeStyle = `rgba(${parseColorRgb(colorRgb)}, 0.35)`; // §5.1: 1 px stroke
      ctx.lineWidth = 1;
      for (let i = 0; i < points.current.length; i++) {
        const pt = points.current[i];
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.restore();

      // Bilateral acoustic typing ripples (§4.3): radiate both directions along
      // the perimeter from the stroke point; B ≈ 1.5 px, τ ≈ 350 ms, v ≈ 60 px/s.
      for (let i = ripples.current.length - 1; i >= 0; i--) {
        const rip = ripples.current[i];
        rip.age += 1 / 60;
        if (rip.age > RIPPLE_TAU) {
          ripples.current.splice(i, 1);
          continue;
        }
        const radius = RIPPLE_SPEED * rip.age;
        const alpha = Math.exp(-rip.age / RIPPLE_TAU);
        ctx.beginPath();
        ctx.arc(rip.x, rip.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${parseColorRgb(colorRgb)}, ${alpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
    [
      colorRgb,
      buildSamples,
      BLEED,
      SEGMENTS,
      A1,
      A2,
      W1,
      W2,
      P1,
      P2,
      MAGNET_R,
      RIPPLE_TAU,
      RIPPLE_SPEED,
      VISCOUS_DECAY,
      CONTOUR_STIFFNESS,
    ],
  );

  const loop = useCallback(() => {
    rafActive.current = false;
    if (killed()) return;

    // Drive the capsule spring toward its target; the loop does NOT stop on
    // arrival — it persists until a kill switch engages (§4.1).
    const wrap = wrapRef.current;
    if (wrap) {
      const dy = targetY.current - y.current;
      // Semi-implicit Euler: v += a·dt, y += v·dt; velocity survives target
      // changes so interrupts glide smoothly without restart-from-zero jank.
      vy.current += ((-SPRING_C * vy.current - SPRING_K * (y.current - targetY.current)) / SPRING_M) * SPRING_DT;
      y.current += vy.current * SPRING_DT;
      if (Math.abs(dy) < EPSILON && Math.abs(vy.current) < EPSILON) {
        y.current = targetY.current;
        vy.current = 0;
      }
      const capH = 54;
      const minY = 20;
      const maxY = Math.max(minY, window.innerHeight - 76 - capH / 2);
      y.current = Math.max(minY, Math.min(maxY, y.current));
      wrap.style.transform = `translate3d(-50%, ${y.current}px, 0)`;
    }

    renderFrame(performance.now() / 1000);

    rafActive.current = true;
    rafRef.current = requestAnimationFrame(loop);
  }, [renderFrame]);

  const schedule = useCallback(() => {
    if (killed() || rafActive.current) return;
    rafActive.current = true;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop]);

  // Track cursor in screen coords; converted to canvas space inside renderFrame.
  const onMove = useCallback((e: PointerEvent) => {
    cursor.current.x = e.clientX;
    cursor.current.y = e.clientY;
  }, []);

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [onMove]);

  // Kill switches: reduced motion, page visibility, battery-saver (§4.1, §7).
  useEffect(() => {
    let media: MediaQueryList | null = null;
    const onMedia = () => {
      if (!media) return;
      reduced.current = media.matches;
      if (media.matches) {
        rafActive.current = false;
        cancelAnimationFrame(rafRef.current);
        const c = canvasRef.current;
        const ctx = c ? c.getContext('2d') : null;
        if (ctx) renderFrame(0);
      } else {
        schedule();
      }
    };
    if (typeof window.matchMedia === 'function') {
      media = window.matchMedia('(prefers-reduced-motion: reduce)');
      onMedia();
      media.addEventListener('change', onMedia);
    }

    const onVisibility = () => {
      hidden.current = document.hidden;
      if (document.hidden) {
        rafActive.current = false;
        cancelAnimationFrame(rafRef.current);
      } else {
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    type Battery = {
      charging: boolean;
      level: number;
      addEventListener: (type: string, listener: () => void) => void;
      removeEventListener: (type: string, listener: () => void) => void;
    };
    let battery: Battery | null = null;
    const onBattery = () => {
      if (!battery) return;
      lowPower.current = !battery.charging && battery.level < 0.2;
      if (lowPower.current) {
        rafActive.current = false;
        cancelAnimationFrame(rafRef.current);
      } else {
        schedule();
      }
    };
    const getBattery = (navigator as {
      getBattery?: () => Promise<Battery>;
    }).getBattery;
    if (typeof getBattery === 'function') {
      void getBattery().then((b) => {
        battery = b;
        b.addEventListener('chargingchange', onBattery);
        b.addEventListener('levelchange', onBattery);
        onBattery();
      }).catch(() => {
        // Battery API unavailable — treat as not low power.
      });
    }

    if (!media?.matches && !document.hidden) schedule();

    return () => {
      if (media) media.removeEventListener('change', onMedia);
      document.removeEventListener('visibilitychange', onVisibility);
      if (battery) {
        battery.removeEventListener('chargingchange', onBattery);
        battery.removeEventListener('levelchange', onBattery);
      }
      rafActive.current = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [schedule, renderFrame]);

  useEffect(() => {
    setTarget();
    if (!initialized.current) {
      y.current = targetY.current;
      initialized.current = true;
    }
    // Restart the glide when the target moves while at rest.
    if (Math.abs(targetY.current - y.current) > EPSILON) {
      schedule();
    }
  }, [isCenter, setTarget, schedule]);

  const submit = useCallback(() => {
    onSubmit?.();
  }, [onSubmit]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const onChangeWrap = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(e.currentTarget.value);
      // Keystroke ripple at a perimeter stroke point (§4.3), radiates both
      // directions along the capsule boundary.
      const c = canvasRef.current;
      const capsule = capsuleRef.current;
      if (!c || !capsule) return;
      const rect = capsule.getBoundingClientRect();
      ripples.current.push({
        x: BLEED + rect.width,
        y: BLEED + rect.height / 2,
        age: 0,
      });
    },
    [onChange],
  );

  // Forward the optional input ref to the underlying <input> element.
  useEffect(() => {
    if (!inputRefForward) return;
    const node = inputRef.current;
    if (typeof inputRefForward === 'function') {
      inputRefForward(node);
      return;
    }
    inputRefForward.current = node;
  }, [inputRefForward]);

  const hasText = Boolean(value && value.trim().length > 0);

  return (
    <div
      ref={wrapRef}
      className={[
        'fixed left-1/2 z-30 flex items-center justify-center pointer-events-auto',
        'selection:bg-accent-wash',
        'w-[520px] max-w-[calc(100vw-48px)]',
        className,
      ].join(' ')}
      style={{
        position: 'fixed',
        left: '50%',
        top: 0,
        display: 'block',
      }}
    >
      <div
        className={[
          'relative w-full h-full min-h-[300px] flex items-center justify-center',
          'bg-[radial-gradient(ellipse_600px_300px_at_50%_40%,rgba(var(--accent)/0.06),transparent)]',
        ].join(' ')}
      >
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: -BLEED,
            top: -BLEED,
            width: 'calc(100% + 64px)',
            height: 'calc(100% + 64px)',
            display: 'block',
            pointerEvents: 'none',
          }}
        />
        {/* Capsule dock container — fills the wrapper so the canvas frames it. */}
        <div
          ref={capsuleRef}
        className={[
          'flex w-full h-full items-center gap-1.5 rounded-full border border-hairline bg-surface-raised px-3 py-1.5 transition-colors duration-200',
          hasText ? 'border-accent' : '',
          'focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-surface',
        ].join(' ')}
      >
        {/* Left: subtle search icon. */}
        <div className="flex size-8 items-center justify-center shrink-0">
          <Search className="size-4 text-muted" aria-hidden="true" />
        </div>

        {/* Center: the input element. */}
        <input
          ref={inputRefForward}
          type="text"
          placeholder={placeholder}
          value={value ?? ''}
          onChange={onChangeWrap}
          onKeyDown={onKeyDown}
          aria-label={ariaLabel}
          className="flex-1 bg-transparent border-0 outline-none text-ink text-sm sm:text-base placeholder:text-muted px-1 font-normal min-w-0"
          disabled={false}
        />

        {/* Right: keyboard shortcut badge + send button. */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="font-mono text-[10px] text-muted px-1.5 py-0.5 rounded border border-hairline">
            {hasText ? '↵' : 'Cmd+Enter'}
          </span>
          <button
            ref={sendRef}
            type="button"
            onClick={submit}
            aria-label="Send message"
            disabled={!hasText}
            className={[
              'flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors duration-200',
              hasText
                ? 'border-accent bg-accent text-white hover:bg-accent-ink'
                : 'border-hairline text-muted hover:bg-surface-sunken',
            ].join(' ')}
          >
            <ArrowUpRight className="size-3 text-accent-ink" aria-hidden="true" />
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

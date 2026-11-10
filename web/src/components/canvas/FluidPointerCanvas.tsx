'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseColorRgb } from './colorRgb';

export interface FluidPointerCanvasProps {
  className?: string;
  /** RGB triplet, e.g. "37 99 235". Alpha is animated per particle. */
  colorRgb?: string;
}

/** Ambient pointer field: N particles advected through a divergence-free curl
 *  field with a quadratic cursor influence (R = 64 px) and viscous decay.
 *  The rAF loop stops when idle (motionless pointer, settled particles). */
export function FluidPointerCanvas({
  className = '',
  colorRgb = '37 99 235',
}: FluidPointerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const active = useRef(false);
  const particles = useRef<Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    alpha: number;
  }>>([]);
  const pointer = useRef({ x: 0, y: 0 });
  const previous = useRef({ x: 0, y: 0, t: 0, initialized: false });
  const [reduced, setReduced] = useState(false);
  const color = useMemo(() => parseColorRgb(colorRgb), [colorRgb]);

  // §6 / §3.3: N = 100 desktop, N = 40 mobile.
  const INFLUENCE_RADIUS = 64; // px — cursor influence radius
  const VISCOUS_DECAY = 0.92; // per frame
  const ALPHA_MIN = 0.15;
  const ALPHA_MAX = 0.22;
  const FIELD_SPEED = 30; // px per frame advected through the curl field
  const MAGNET_STRENGTH = 0.6;

  const particleCount = () => (window.innerWidth < 768 ? 40 : 100);

  const initParticles = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const n = particleCount();
    particles.current = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      alpha: ALPHA_MIN + Math.random() * (ALPHA_MAX - ALPHA_MIN),
    }));
  }, []);

  const resize = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(1, c.clientWidth) * dpr;
    c.height = Math.max(1, c.clientHeight) * dpr;
    const ctx = c.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    initParticles();
  }, [initParticles]);

  // Divergence-free curl field from a two-octave stream function ψ scrolling
  // in opposite directions: v = ∇ × ψ = (∂ψ/∂y, −∂ψ/∂x).
  const curl = (x: number, y: number, t: number) => {
    const eps = 0.5;
    const psi = (px: number, py: number, tt: number) => {
      const k1 = 0.010;
      const k2 = 0.018;
      const w1 = 0.50;
      const w2 = 0.70;
      return (
        Math.sin(k1 * px + w1 * tt) * Math.cos(k1 * py) +
        0.5 * Math.sin(k2 * px - w2 * tt) * Math.cos(k2 * py)
      );
    };
    const vx = (psi(x, y + eps, t) - psi(x, y - eps, t)) / (2 * eps); // ∂ψ/∂y
    const vy = -(psi(x + eps, y, t) - psi(x - eps, y, t)) / (2 * eps); // −∂ψ/∂x
    return { vx, vy };
  };

  const clearCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
  }, []);

  // §3.3: loop reschedules itself only while the pointer moves or the field
  // is still settling — never unconditionally.
  const loop = useCallback(() => {
    const c = canvasRef.current;
    if (!c) {
      active.current = false;
      return;
    }
    const ctx = c.getContext('2d');
    if (!ctx) {
      active.current = false;
      return;
    }

    // Reduced motion: single static frame, then stop (§7).
    if (reduced) {
      ctx.clearRect(0, 0, c.clientWidth, c.clientHeight);
      active.current = false;
      return;
    }

    const now = performance.now();

    // First-frame dt fix: initialise previous.t on the first frame so the
    // first delta is zero instead of a near-infinite velocity.
    let dt: number;
    if (!previous.current.initialized) {
      previous.current = { x: pointer.current.x, y: pointer.current.y, t: now, initialized: true };
      dt = 0;
    } else {
      dt = (now - previous.current.t) / 1000;
      previous.current.t = now;
    }
    dt = Math.min(Math.max(dt, 0), 0.1);

    const w = c.clientWidth;
    const h = c.clientHeight;
    const t = now / 1000;

    // Pointer velocity (px/s).
    let pVx = 0;
    let pVy = 0;
    if (dt > 0) {
      pVx = (pointer.current.x - previous.current.x) / dt;
      pVy = (pointer.current.y - previous.current.y) / dt;
    }
    previous.current.x = pointer.current.x;
    previous.current.y = pointer.current.y;
    const pointerMoving = Math.hypot(pVx, pVy) > 2;

    // Clear the full backing store (dpr-scaled dims via setTransform).
    ctx.clearRect(0, 0, w, h);

    let fieldMoving = false;
    for (const p of particles.current) {
      let { vx: fx, vy: fy } = curl(p.x, p.y, t);

      // Cursor influence: quadratic falloff (1 − d/R)² within R = 64 px (§3.3).
      const dx = p.x - pointer.current.x;
      const dy = p.y - pointer.current.y;
      const d = Math.hypot(dx, dy);
      if (d > 0 && d < INFLUENCE_RADIUS) {
        const fall = (1 - d / INFLUENCE_RADIUS) ** 2;
        fx += (dx / d) * fall * MAGNET_STRENGTH;
        fy += (dy / d) * fall * MAGNET_STRENGTH;
      }

      // Advect through the curl field, then viscous decay (§3.3).
      p.vx = (p.vx + fx * FIELD_SPEED) * VISCOUS_DECAY;
      p.vy = (p.vy + fy * FIELD_SPEED) * VISCOUS_DECAY;
      p.x += p.vx;
      p.y += p.vy;

      // Wrap around the edges so the field never empties.
      if (p.x < 0) p.x += w;
      else if (p.x > w) p.x -= w;
      if (p.y < 0) p.y += h;
      else if (p.y > h) p.y -= h;

      if (Math.hypot(p.vx, p.vy) > 0.05) fieldMoving = true;
    }

    // Draw particles at alpha 0.15–0.22, soft additive composite.
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles.current) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.25, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${color}, ${p.alpha})`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Cancel the rAF when idle: no pointer motion and the field has settled.
    active.current = false;
    if (pointerMoving || fieldMoving) {
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [color, INFLUENCE_RADIUS, VISCOUS_DECAY, FIELD_SPEED, MAGNET_STRENGTH]);

  const schedule = useCallback(() => {
    if (reduced || active.current) return;
    active.current = true;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop, reduced]);

  const onMove = useCallback((e: PointerEvent) => {
    pointer.current.x = e.clientX;
    pointer.current.y = e.clientY;
    if (!reduced && !active.current) schedule();
  }, [schedule, reduced]);

  useEffect(() => {
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [resize]);

  useEffect(() => {
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [onMove]);

  useEffect(() => {
    if (!reduced) schedule();
    return () => {
      active.current = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [schedule, reduced]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMedia = () => {
      setReduced(media.matches);
      if (media.matches) {
        active.current = false;
        cancelAnimationFrame(rafRef.current);
        clearCanvas();
      } else {
        schedule();
      }
    };
    media.addEventListener('change', onMedia);
    return () => media.removeEventListener('change', onMedia);
  }, [schedule, clearCanvas]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        display: 'block',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}

/**
 * Meridian — StudioShell
 *
 * The spatial frame every view renders inside: ambient studio backdrop, a
 * compact top-right status cluster (live `/health` pulse, tenant, theme,
 * ⌘K trigger), a centred viewport, and the floating glass Pill Dock.
 *
 * No sidebar. Navigation is a single morphing pill (`layoutId`) plus the
 * command palette — both keyboard reachable.
 */
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  Command,
  Gauge,
  KeyRound,
  LibraryBig,
  MessagesSquare,
  Moon,
  Search,
  Settings2,
  Sparkles,
  Sun,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

import { ApiError, apiFetch } from '../../core/api';
import { useAuth } from '../../core/auth';
import {
  SCRIM_FADE,
  SPRING_GENTLE,
  SPRING_SNAPPY,
  STAGGER_CONTAINER,
  STAGGER_ITEM,
} from '../../core/motion';
import { StatusBadge, type StatusTone } from './StatusBadge';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type NavView = 'ask' | 'vault' | 'ops' | 'settings';

export interface StudioShellProps {
  activeView: NavView;
  onNavigate: (view: NavView) => void;
  children: ReactNode;
}

export interface NavItem {
  id: NavView;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'ask', label: 'Ask', hint: 'Ask the corpus — agentic retrieval', icon: MessagesSquare },
  { id: 'vault', label: 'Vault', hint: 'Documents, chunks & entities', icon: LibraryBig },
  { id: 'ops', label: 'Ops', hint: 'Traces, evals & backend health', icon: Gauge },
  { id: 'settings', label: 'Settings', hint: 'Providers, keys & tenancy', icon: Settings2 },
] as const;

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* -------------------------------------------------------------------------- */
/* Health polling                                                             */
/* -------------------------------------------------------------------------- */

export type HealthState = 'checking' | 'ok' | 'warn' | 'fail';

export interface HealthPayload {
  status?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface HealthSnapshot {
  state: HealthState;
  latencyMs: number | null;
  checkedAt: number | null;
  detail: string | null;
}

export interface UseHealthPollResult extends HealthSnapshot {
  refresh: () => void;
}

/** Map an arbitrary `/health` body onto a tri-state signal. */
export function interpretHealth(payload: HealthPayload | null): HealthState {
  const status = typeof payload?.status === 'string' ? payload.status.toLowerCase() : '';
  if (!status) return 'ok';
  if (/(down|fail|error|unhealthy|unreachable|dead)/.test(status)) return 'fail';
  if (/(degrad|warn|partial|start|recover|init)/.test(status)) return 'warn';
  if (/(ok|healthy|up|ready|pass|alive)/.test(status)) return 'ok';
  return 'ok';
}

const HEALTH_POLL_INTERVAL_MS = 30_000;

/**
 * Poll `GET /health` every `intervalMs` (default 30s) and expose the latest
 * snapshot plus a manual `refresh`. Pauses while the tab is hidden, cancels
 * in-flight requests on unmount.
 */
export function useHealthPoll(intervalMs: number = HEALTH_POLL_INTERVAL_MS): UseHealthPollResult {
  const [snapshot, setSnapshot] = useState<HealthSnapshot>({
    state: 'checking',
    latencyMs: null,
    checkedAt: null,
    detail: null,
  });

  const mounted = useRef(true);
  const inFlight = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const startedAt = Date.now();

    try {
      const payload = await apiFetch<HealthPayload>('/health', { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      setSnapshot({
        state: interpretHealth(payload),
        latencyMs: Date.now() - startedAt,
        checkedAt: Date.now(),
        detail: typeof payload?.detail === 'string' ? payload.detail : null,
      });
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      let detail = 'Unreachable';
      if (error instanceof ApiError) {
        detail = error.detailMessage ?? `HTTP ${error.status}`;
      } else if (error instanceof Error) {
        detail = error.message;
      }
      setSnapshot({ state: 'fail', latencyMs: null, checkedAt: Date.now(), detail });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void check();

    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void check();
    }, intervalMs);

    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      inFlight.current?.abort();
    };
  }, [check, intervalMs]);

  return { ...snapshot, refresh: check };
}

/* -------------------------------------------------------------------------- */
/* Ambient backdrop                                                           */
/* -------------------------------------------------------------------------- */

const BLOB_BASE: CSSProperties = {
  position: 'absolute',
  borderRadius: '50%',
  filter: 'blur(80px)',
};

/** Soft light pools + a faint drafting grid. Purely decorative. */
export function AmbientBackdrop() {
  return (
    <div className="studio-backdrop" aria-hidden="true">
      <div className="studio-backdrop__grid" />
      <div
        className="animate-drift-a"
        style={{
          ...BLOB_BASE,
          top: '-24rem',
          left: '-14rem',
          width: '56rem',
          height: '56rem',
          background: 'radial-gradient(circle at 50% 50%, var(--ambient-1), transparent 66%)',
        }}
      />
      <div
        className="animate-drift-b"
        style={{
          ...BLOB_BASE,
          top: '-18rem',
          right: '-16rem',
          width: '48rem',
          height: '48rem',
          background: 'radial-gradient(circle at 50% 50%, var(--ambient-2), transparent 64%)',
        }}
      />
      <div
        className="animate-drift-a"
        style={{
          ...BLOB_BASE,
          bottom: '-26rem',
          left: '38%',
          width: '44rem',
          height: '44rem',
          background: 'radial-gradient(circle at 50% 50%, var(--ambient-3), transparent 62%)',
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Top-right cluster                                                          */
/* -------------------------------------------------------------------------- */

function formatClock(ts: number | null): string | null {
  if (ts === null) return null;
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return null;
  }
}

function HealthPill({
  health,
  onRefresh,
}: {
  health: UseHealthPollResult;
  onRefresh: () => void;
}) {
  const tone: StatusTone = health.state === 'checking' ? 'neutral' : health.state;
  const label =
    health.state === 'checking'
      ? 'Checking'
      : health.state === 'ok'
        ? 'Healthy'
        : health.state === 'warn'
          ? 'Degraded'
          : 'Offline';

  const clock = formatClock(health.checkedAt);
  const title = [
    health.detail ?? 'Meridian API',
    clock ? `last checked ${clock}` : null,
    'click to re-check',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={onRefresh}
      title={title}
      aria-label={`Backend status: ${label}. ${title}`}
      className="relative shrink-0 rounded-pill transition-opacity before:absolute before:-inset-1 before:content-[''] hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <StatusBadge
        tone={tone}
        size="md"
        pulse={health.state !== 'fail'}
        label={
          <span className="flex items-center gap-1">
            <span className="whitespace-nowrap">{label}</span>
            {health.latencyMs !== null ? (
              <span
                aria-hidden="true"
                className="tabular hidden text-[10px] font-normal opacity-60 sm:inline"
              >
                {health.latencyMs}ms
              </span>
            ) : null}
          </span>
        }
      />
    </button>
  );
}

function TenantChip({
  tenantId,
  onOpen,
}: {
  tenantId: string;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Tenant scope: ${tenantId}`}
      className="group relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-pill border border-hairline bg-elevated/70 px-2.5 text-xs font-medium text-ink-muted shadow-hairline backdrop-blur-xl transition-colors before:absolute before:-inset-1 before:content-[''] hover:border-accent/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <Building2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
      <span className="hidden max-w-[8.5rem] truncate font-mono text-[11px] tracking-tight sm:block">
        {tenantId}
      </span>
      <ChevronDown
        className="hidden h-3 w-3 shrink-0 opacity-40 transition-opacity group-hover:opacity-80 sm:block"
        strokeWidth={2.2}
      />
    </button>
  );
}

function ThemeToggle() {
  const { theme, toggleTheme } = useAuth();
  const isDark = theme === 'dark';
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="relative grid h-8 w-8 shrink-0 place-items-center rounded-pill border border-hairline bg-elevated/70 text-ink-muted shadow-hairline backdrop-blur-xl transition-colors before:absolute before:-inset-1 before:content-[''] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ opacity: 0, rotate: -70, scale: 0.55 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 70, scale: 0.55 }}
          transition={SPRING_SNAPPY}
          className="grid place-items-center"
        >
          <Icon className="h-[15px] w-[15px]" strokeWidth={1.9} />
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function PaletteTrigger({
  isMac,
  onOpen,
}: {
  isMac: boolean;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-keyshortcuts="Meta+K Control+K"
      title="Open command palette"
      className="group relative inline-flex h-8 shrink-0 items-center gap-2 rounded-pill border border-hairline bg-elevated/70 pl-2.5 pr-1.5 text-xs font-medium text-ink-muted shadow-hairline backdrop-blur-xl transition-colors before:absolute before:-inset-1 before:content-[''] hover:border-accent/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
      <span className="hidden sm:inline">Search</span>
      <kbd className="ml-0.5 hidden h-5 items-center rounded-[6px] border border-hairline bg-subtle px-1.5 font-sans text-[10px] font-semibold tabular text-ink-muted sm:inline-flex">
        {isMac ? '⌘' : 'Ctrl'} K
      </kbd>
    </button>
  );
}

function useIsMac(): boolean {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const haystack = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
    setIsMac(/mac|iphone|ipad|ipod/i.test(haystack));
  }, []);
  return isMac;
}

/* -------------------------------------------------------------------------- */
/* Floating Pill Dock                                                         */
/* -------------------------------------------------------------------------- */

export interface FloatingDockProps {
  activeView: NavView;
  onNavigate: (view: NavView) => void;
}

export function FloatingDock({ activeView, onNavigate }: FloatingDockProps) {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 sm:bottom-6"
    >
      <motion.div
        initial={{ y: 64, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...SPRING_GENTLE, delay: 0.12 }}
        className="glass-panel relative flex items-center gap-0.5 rounded-pill border border-[color:var(--glass-border)] p-1.5 shadow-dock backdrop-blur-xl"
      >
        {/* glass sheen */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/25"
        />

        {NAV_ITEMS.map((item) => {
          const isActive = item.id === activeView;
          const Icon = item.icon;
          return (
            <motion.button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              whileTap={{ scale: 0.955 }}
              transition={SPRING_SNAPPY}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              title={item.hint}
              className={cx(
                'group relative flex h-11 items-center rounded-pill px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:px-4',
                isActive ? 'text-accent' : 'text-ink-muted hover:text-ink',
              )}
            >
              {isActive ? (
                <motion.span
                  layoutId="dock-active-pill"
                  transition={SPRING_SNAPPY}
                  className="absolute inset-0 rounded-pill border border-accent/25 bg-accent-soft"
                  style={{ boxShadow: 'inset 0 1px 0 0 rgb(255 255 255 / 0.4)' }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 rounded-pill bg-transparent transition-colors group-hover:bg-subtle/70"
                />
              )}

              <span className="relative z-10 flex items-center gap-2">
                <Icon
                  className="h-[17px] w-[17px] shrink-0 transition-transform duration-200 group-hover:-translate-y-px"
                  strokeWidth={isActive ? 2.1 : 1.75}
                />
                <span className="hidden sm:inline">{item.label}</span>
              </span>
            </motion.button>
          );
        })}
      </motion.div>
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Command Palette                                                            */
/* -------------------------------------------------------------------------- */

export type PaletteMode = 'root' | 'tenant' | 'apikey';

export type PaletteGroup = 'Navigate' | 'Workspace' | 'Appearance';

export interface PaletteCommand {
  id: string;
  label: string;
  group: PaletteGroup;
  icon: LucideIcon;
  keywords: string;
  hint?: string;
  keepOpen?: boolean;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  activeView: NavView;
  onNavigate: (view: NavView) => void;
  initialMode?: PaletteMode;
  /** Element that opened the palette — focus returns to it when it closes. */
  opener?: HTMLElement | null;
}

const GROUP_ORDER: readonly PaletteGroup[] = ['Navigate', 'Workspace', 'Appearance'];

/** Stable DOM id for an option (command ids contain `:` which is unsafe in ids). */
function paletteOptionId(commandId: string): string {
  return `palette-item-${commandId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function CommandPalette({
  open,
  onClose,
  activeView,
  onNavigate,
  initialMode = 'root',
  opener = null,
}: CommandPaletteProps) {
  const { theme, toggleTheme, tenantId, setTenantId, apiKey, setApiKey } = useAuth();
  const [mode, setMode] = useState<PaletteMode>(initialMode);
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const wasOpen = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const focusFrameRef = useRef<number | null>(null);

  /* Reset + focus on open — only on the closed → open transition, so a
     background tenant change can never clobber what the operator is typing.
     The opener is remembered so focus can be handed back on close. */
  useEffect(() => {
    if (!open) {
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
      if (wasOpen.current) {
        wasOpen.current = false;
        const previous = openerRef.current;
        openerRef.current = null;
        if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
          previous.focus();
        }
      }
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    openerRef.current =
      opener ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setMode(initialMode);
    setCursor(0);
    setValue(initialMode === 'tenant' ? tenantId : '');
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, initialMode, tenantId, opener]);

  /* Lock scroll behind the palette */
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(() => {
    const navigate: PaletteCommand[] = NAV_ITEMS.map((item) => ({
      id: `nav:${item.id}`,
      label: `Go to ${item.label}`,
      group: 'Navigate',
      icon: item.icon,
      keywords: `${item.id} ${item.hint} jump open`,
      hint: activeView === item.id ? 'Current' : undefined,
      run: () => onNavigate(item.id),
    }));

    const workspace: PaletteCommand[] = [
      {
        id: 'workspace:tenant',
        label: 'Switch tenant…',
        group: 'Workspace',
        icon: Building2,
        keywords: 'tenant workspace scope organisation org switch',
        hint: tenantId,
        keepOpen: true,
        run: () => {
          setMode('tenant');
          setValue(tenantId);
        },
      },
      {
        id: 'workspace:apikey',
        label: apiKey ? 'Replace API key…' : 'Set API key…',
        group: 'Workspace',
        icon: KeyRound,
        keywords: 'api key token auth override credential secret',
        hint: apiKey ? 'override active' : 'server default',
        keepOpen: true,
        run: () => {
          setMode('apikey');
          setValue('');
        },
      },
    ];

    if (apiKey) {
      workspace.push({
        id: 'workspace:apikey-clear',
        label: 'Clear API key override',
        group: 'Workspace',
        icon: WifiOff,
        keywords: 'api key token auth reset clear remove',
        hint: 'revert',
        run: () => setApiKey(null),
      });
    }

    const appearance: PaletteCommand[] = [
      {
        id: 'appearance:theme',
        label: 'Toggle Theme',
        group: 'Appearance',
        icon: theme === 'dark' ? Sun : Moon,
        keywords: 'theme dark light mode appearance toggle',
        hint: theme,
        run: toggleTheme,
      },
    ];

    return [...navigate, ...workspace, ...appearance];
  }, [activeView, apiKey, onNavigate, setApiKey, theme, tenantId, toggleTheme]);

  const ordered = useMemo<PaletteCommand[]>(() => {
    const query = value.trim().toLowerCase();
    const matches = query
      ? commands.filter((command) =>
          `${command.label} ${command.group} ${command.keywords} ${command.hint ?? ''}`
            .toLowerCase()
            .includes(query),
        )
      : commands;
    return [...matches].sort(
      (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group),
    );
  }, [commands, value]);

  const grouped = useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        items: ordered.filter((command) => command.group === group),
      })).filter((entry) => entry.items.length > 0),
    [ordered],
  );

  useEffect(() => {
    setCursor(0);
  }, [value, mode]);

  useEffect(() => {
    const node = itemRefs.current[cursor];
    node?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const commitMode = useCallback(() => {
    if (mode === 'tenant') {
      setTenantId(value);
      onClose();
    } else if (mode === 'apikey') {
      setApiKey(value.trim().length > 0 ? value : null);
      onClose();
    }
  }, [mode, onClose, setApiKey, setTenantId, value]);

  const runCommand = useCallback(
    (command: PaletteCommand) => {
      command.run();
      if (!command.keepOpen) onClose();
    },
    [onClose],
  );

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (mode !== 'root') {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitMode();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((current) => (ordered.length === 0 ? 0 : (current + 1) % ordered.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((current) =>
        (ordered.length === 0 ? 0 : (current - 1 + ordered.length) % ordered.length),
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = ordered[cursor];
      if (command) runCommand(command);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setCursor(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setCursor(Math.max(0, ordered.length - 1));
    }
  };

  /* Escape closes (or steps back from) the palette from anywhere inside the
     dialog, and Tab cycles within it instead of walking into the page behind
     the scrim. */
  const onDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (mode !== 'root') {
        setMode('root');
        setValue('');
        return;
      }
      onClose();
      return;
    }

    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  };

  let flatIndex = -1;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="palette"
          variants={SCRIM_FADE}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={SPRING_GENTLE}
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh] sm:pt-[14vh]"
        >
{/* scrim */}
          {/* high-frequency surface: opacity-only, 100ms (distilled/04_motion.md §11). */}
          <motion.div
            aria-hidden="true"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="absolute inset-0 bg-ink/25 backdrop-blur-[6px] dark:bg-black/55"
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onKeyDown={onDialogKeyDown}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className="relative w-full max-w-[560px] overflow-hidden rounded-xl border border-hairline bg-elevated/95 shadow-palette backdrop-blur-2xl"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent"
            />

            {/* input row */}
            <div className="flex items-center gap-2.5 border-b border-hairline px-4">
              {mode === 'root' ? (
                <Search className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={2} />
              ) : mode === 'tenant' ? (
                <Building2 className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
              ) : (
                <KeyRound className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
              )}

              <input
                ref={inputRef}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={onInputKeyDown}
                spellCheck={false}
                autoComplete="off"
                role="combobox"
                aria-expanded={mode === 'root'}
                aria-controls="meridian-palette-list"
                aria-activedescendant={
                  mode === 'root' && ordered[cursor]
                    ? paletteOptionId(ordered[cursor].id)
                    : undefined
                }
                aria-label={
                  mode === 'tenant' ? 'Tenant id' : mode === 'apikey' ? 'API key' : 'Command search'
                }
                placeholder={
                  mode === 'tenant'
                    ? 'Enter a tenant id…'
                    : mode === 'apikey'
                      ? 'Paste an API key…'
                      : 'Jump to a view, toggle theme, switch tenant…'
                }
                className={cx(
                  'h-12 w-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint',
                  mode === 'apikey' && 'font-mono text-[13px]',
                )}
              />

              {mode === 'root' ? (
                <kbd className="hidden h-5 shrink-0 items-center rounded-[6px] border border-hairline bg-subtle px-1.5 font-sans text-[10px] font-semibold text-ink-muted sm:inline-flex">
                  ESC
                </kbd>
              ) : (
                <button
                  type="button"
                  onClick={commitMode}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] bg-accent px-2.5 text-[11px] font-semibold text-accent-contrast transition-colors hover:bg-accent-hover"
                >
                  <Check className="h-3 w-3" strokeWidth={2.6} />
                  Save
                </button>
              )}
            </div>

            {/* body */}
            {mode === 'root' ? (
              <div
                id="meridian-palette-list"
                role="listbox"
                aria-label="Commands"
                className="max-h-[min(52vh,360px)] overflow-y-auto overscroll-contain p-1.5"
              >
                {grouped.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                    <Sparkles className="h-5 w-5 text-ink-faint" strokeWidth={1.6} />
                    <p className="text-[13px] font-medium text-ink">No matches</p>
                    <p className="text-xs text-ink-muted">
                      Try “vault”, “theme” or “tenant”.
                    </p>
                  </div>
                ) : (
                  grouped.map((entry) => (
                    <div key={entry.group} className="mb-1 last:mb-0">
                      <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
                        {entry.group}
                      </div>
                      {entry.items.map((command) => {
                        flatIndex += 1;
                        const index = flatIndex;
                        const isActive = index === cursor;
                        const Icon = command.icon;
                        return (
                          <button
                            key={command.id}
                            id={paletteOptionId(command.id)}
                            ref={(node) => {
                              itemRefs.current[index] = node;
                            }}
                            type="button"
                            role="option"
                            tabIndex={-1}
                            aria-selected={isActive}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setCursor(index)}
                            onClick={() => runCommand(command)}
                            className={cx(
                              'group flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors',
                              isActive ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-subtle',
                            )}
                          >
                            <span
                              className={cx(
                                'grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border transition-colors',
                                isActive
                                  ? 'border-accent/25 bg-elevated text-accent'
                                  : 'border-hairline bg-subtle text-ink-muted group-hover:text-ink',
                              )}
                            >
                              <Icon className="h-[14px] w-[14px]" strokeWidth={1.9} />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                              {command.label}
                            </span>
                            {command.hint ? (
                              <span
                                className={cx(
                                  'shrink-0 truncate font-mono text-[10.5px]',
                                  isActive ? 'text-accent/80' : 'text-ink-faint',
                                )}
                              >
                                {command.hint}
                              </span>
                            ) : null}
                            {isActive ? (
                              <ArrowUpRight
                                className="h-3 w-3 shrink-0 text-accent/70"
                                strokeWidth={2.2}
                              />
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="px-4 py-4">
                {mode === 'tenant' ? (
                  <p className="mb-1.5 text-[13px] font-semibold text-ink">Switch Active Tenant</p>
                ) : null}
                <p className="text-xs leading-relaxed text-ink-muted">
                  {mode === 'tenant'
                    ? 'Every query is scoped to this tenant. Retrieval, graph traversal and review queues all filter on it.'
                    : 'Sent as the X-API-Key header. Stored locally in this browser only — leave blank to use the server-configured key.'}
                </p>
                {mode === 'apikey' && apiKey ? (
                  <p className="mt-2 font-mono text-[11px] text-ink-faint">
                    current: {apiKey.slice(0, 4)}…{apiKey.slice(-4)}
                  </p>
                ) : null}
              </div>
            )}

            {/* footer */}
            <div className="flex items-center justify-between gap-3 border-t border-hairline bg-subtle/60 px-3 py-2">
              <div className="flex items-center gap-3 text-[10.5px] text-ink-muted">
                {mode === 'root' ? (
                  <>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded-[4px] border border-hairline bg-elevated px-1 py-0.5 font-sans text-[9.5px] font-semibold">
                        ↑↓
                      </kbd>
                      navigate
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded-[4px] border border-hairline bg-elevated px-1 py-0.5 font-sans text-[9.5px] font-semibold">
                        ↵
                      </kbd>
                      select
                    </span>
                    <span className="hidden items-center gap-1 sm:flex">
                      <kbd className="rounded-[4px] border border-hairline bg-elevated px-1 py-0.5 font-sans text-[9.5px] font-semibold">
                        esc
                      </kbd>
                      close
                    </span>
                  </>
                ) : (
                  <span className="flex items-center gap-1">
                    <kbd className="rounded-[4px] border border-hairline bg-elevated px-1 py-0.5 font-sans text-[9.5px] font-semibold">
                      ↵
                    </kbd>
                    save
                    <span className="mx-1 opacity-40">·</span>
                    <kbd className="rounded-[4px] border border-hairline bg-elevated px-1 py-0.5 font-sans text-[9.5px] font-semibold">
                      esc
                    </kbd>
                    back
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[10.5px] font-medium text-ink-faint">
                <Command className="h-3 w-3" strokeWidth={2} />
                Meridian
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* -------------------------------------------------------------------------- */
/* Shell                                                                      */
/* -------------------------------------------------------------------------- */

export function StudioShell({ activeView, onNavigate, children }: StudioShellProps) {
  const { tenantId } = useAuth();
  const health = useHealthPoll(HEALTH_POLL_INTERVAL_MS);
  const isMac = useIsMac();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('root');
  const [paletteOpener, setPaletteOpener] = useState<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);

  const openPalette = useCallback((mode: PaletteMode = 'root', opener: HTMLElement | null = null) => {
    setPaletteOpener(opener);
    setPaletteMode(mode);
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpener(null);
    setPaletteOpen(false);
  }, []);

  /* ⌘K / Ctrl+K — global */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteMode('root');
        if (paletteOpen) {
          closePalette();
        } else {
          openPalette('root');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [paletteOpen, closePalette, openPalette]);

  /* Hairline + blur once the viewport scrolls */
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const activeLabel = NAV_ITEMS.find((item) => item.id === activeView)?.label ?? '';

  return (
    <div className="relative flex min-h-[var(--shell-min-height)] flex-col bg-canvas text-ink">
      <AmbientBackdrop />

      <a
        href="#meridian-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:border focus:border-hairline focus:bg-elevated focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-card"
      >
        Skip to content
      </a>

      {/* ---------------- Top bar ---------------- */}
      <header
        className={cx(
          'fixed inset-x-0 top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300',
          scrolled
            ? 'border-b border-hairline bg-canvas/75 backdrop-blur-xl'
            : 'border-b border-transparent bg-transparent',
        )}
      >
        <div className="mx-auto flex h-14 w-full max-w-shell items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          {/* brand */}
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-gradient-to-br from-accent to-accent/70 shadow-hairline">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
                <g fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="8.25" opacity="0.95" />
                  <ellipse cx="12" cy="12" rx="3.6" ry="8.25" opacity="0.7" />
                  <path d="M3.75 12h16.5" opacity="0.7" />
                </g>
              </svg>
            </div>
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="hidden text-[15px] font-semibold tracking-[-0.02em] text-ink sm:inline">
                Meridian
              </span>
              <span className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-ink-faint sm:inline">
                Agentic RAG
              </span>
            </div>
            {activeLabel ? (
              <>
                <span aria-hidden="true" className="mx-1 hidden h-4 w-px bg-hairline md:block" />
                <span className="hidden text-[13px] font-medium text-ink-muted md:inline">
                  {activeLabel}
                </span>
              </>
            ) : null}
          </div>

          {/* status cluster */}
          <div className="flex min-w-0 shrink items-center justify-end gap-1 sm:gap-2">
            <HealthPill health={health} onRefresh={health.refresh} />
            <span aria-hidden="true" className="hidden h-4 w-px bg-hairline sm:block" />
            <TenantChip
              tenantId={tenantId}
              onOpen={(event) => openPalette('tenant', event.currentTarget)}
            />
            <ThemeToggle />
            <PaletteTrigger
              isMac={isMac}
              onOpen={(event) => openPalette('root', event.currentTarget)}
            />
          </div>
        </div>
      </header>

      {/* ---------------- Viewport ---------------- */}
      <main
        id="meridian-main"
        className="relative z-10 mx-auto w-full max-w-shell flex-1 px-4 pb-[var(--dock-clearance)] pt-24 sm:px-6 sm:pt-28 lg:px-8"
      >
        <motion.div
          variants={STAGGER_CONTAINER}
          initial="initial"
          animate="animate"
          className="flex flex-col gap-6"
        >
          <motion.div variants={STAGGER_ITEM}>{children}</motion.div>
        </motion.div>
      </main>

      {/* fade behind the dock */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-[var(--dock-fade-height)] bg-gradient-to-t from-canvas via-canvas/85 to-transparent"
      />

      <FloatingDock activeView={activeView} onNavigate={onNavigate} />

      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        activeView={activeView}
        onNavigate={onNavigate}
        initialMode={paletteMode}
        opener={paletteOpener}
      />
    </div>
  );
}

export default StudioShell;

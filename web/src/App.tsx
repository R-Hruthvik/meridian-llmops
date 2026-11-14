/**
 * Meridian — root application.
 *
 * Assembly rules:
 *   • `AskView` is eager — it is the first paint and must never wait on a chunk.
 *   • `Vault`, `Ops` and `Settings` are `React.lazy` route modules behind one
 *     `Suspense` boundary with a shape-matched skeleton.
 *   • View switches are wrapped in `AnimatePresence mode="wait"` so the outgoing
 *     surface finishes leaving before the incoming one settles in.
 *   • `Ask` stays mounted across navigation. The conversation and any in-flight
 *     stream live in `AskView`'s component state, so unmounting it would wipe
 *     the thread and abort the answer. The Ask surface is portalled into a host
 *     element that is detached from the document while another view is active.
 *   • `MotionConfig reducedMotion="user"` makes framer-motion honour the OS
 *     `prefers-reduced-motion` setting for every JS-driven animation.
 *
 * The provider (auth + theme + tenancy) lives one level up in `main.tsx`, so this
 * component is always mounted under `<AuthProvider>`.
 */
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { createPortal } from 'react-dom';

import { StudioShell, type NavView } from './components/shell/StudioShell';
import { FADE_UP, SPRING_SNAPPY } from './core/motion';
import AskView from './features/ask/AskView';

/* -------------------------------------------------------------------------- */
/* Route modules                                                              */
/* -------------------------------------------------------------------------- */

const VaultView = lazy(() => import('./features/vault/VaultView'));
const OpsView = lazy(() => import('./features/ops/OpsView'));
const SettingsView = lazy(() => import('./features/settings/SettingsView'));

const VIEWS: Record<NavView, ComponentType> = {
  ask: AskView,
  vault: VaultView,
  ops: OpsView,
  settings: SettingsView,
};

const VIEW_LABELS: Record<NavView, string> = {
  ask: 'Ask workspace',
  vault: 'Knowledge vault',
  ops: 'Operations',
  settings: 'Gateway settings',
};

/* -------------------------------------------------------------------------- */
/* Suspense fallback                                                          */
/* -------------------------------------------------------------------------- */

/** Keeps the page frame stable while a lazy route module resolves. */
function ViewFallback({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3.5" aria-busy="true">
      <div className="flex flex-col gap-1.5">
        <div className="h-2.5 w-40 animate-pulse rounded-pill bg-subtle/80" />
        <div className="h-7 w-56 animate-pulse rounded-md bg-subtle " />
        <div className="h-3 w-full max-w-xl animate-pulse rounded-pill bg-subtle/70" />
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <div
            key={key}
            className="h-[104px] animate-pulse rounded-lg border border-hairline bg-subtle/50"
          />
        ))}
      </div>

      <div className="h-[180px] animate-pulse rounded-lg border border-hairline bg-subtle/40" />
      <span className="sr-only">Loading {label}…</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* App                                                                        */
/* -------------------------------------------------------------------------- */

export function App() {
  const [activeView, setActiveView] = useState<NavView>('ask');
  const ActiveView = VIEWS[activeView];

  /* Ask surface — a detached container that holds the Ask view while another
     view is active. React keeps the component mounted either way, so the
     thread survives navigation; detaching the container keeps the inactive
     Ask DOM out of the document (and out of the tab order). */
  const [askSurface] = useState<HTMLDivElement | null>(() =>
    typeof document === 'undefined' ? null : document.createElement('div'),
  );
  const askHostRef = useRef<HTMLDivElement | null>(null);

  const attachAskHost = useCallback(
    (node: HTMLDivElement | null) => {
      askHostRef.current = node;
      if (node && askSurface && askSurface.parentElement !== node) {
        node.appendChild(askSurface);
      }
    },
    [askSurface],
  );

  useLayoutEffect(() => {
    const host = askHostRef.current;
    if (!host || !askSurface) return;
    if (activeView === 'ask') {
      if (askSurface.parentElement !== host) host.appendChild(askSurface);
    } else {
      askSurface.parentElement?.removeChild(askSurface);
    }
  }, [activeView, askSurface]);

  /* The Ask composer is portalled to <body>, outside the host element, so the
     shell hides it with `body[data-meridian-view]` when Ask is not active. */
  useEffect(() => {
    document.body.dataset.meridianView = activeView;
  }, [activeView]);

  return (
    <MotionConfig reducedMotion="user">
      <StudioShell activeView={activeView} onNavigate={setActiveView}>
        <div ref={attachAskHost} data-view="ask" />
        <AnimatePresence mode="wait" initial={false}>
          {activeView !== 'ask' ? (
            <motion.div
              key={activeView}
              data-view={activeView}
              variants={FADE_UP}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={SPRING_SNAPPY}
            >
              <Suspense fallback={<ViewFallback label={VIEW_LABELS[activeView]} />}>
                <ActiveView />
              </Suspense>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {askSurface ? (
          createPortal(
            <motion.div
              variants={FADE_UP}
              initial="initial"
              animate="animate"
              transition={SPRING_SNAPPY}
            >
              <AskView />
            </motion.div>,
            askSurface,
          )
        ) : null}
      </StudioShell>
    </MotionConfig>
  );
}

export default App;

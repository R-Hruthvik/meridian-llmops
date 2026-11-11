import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  FileText,
  Plus,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../../services/api';
import type { DocumentSummary } from '../../types/api';
import type { ChatTurn } from '../chat/useRagChat';
import { RagWorkspace } from '../RagWorkspace';
import { FluidPointerCanvas } from '../canvas/FluidPointerCanvas';
import { ProjectSettingsModal } from './ProjectSettingsModal';

export type ThemeName = 'default' | 'ceramic-concrete' | 'cold-titanium' | 'analog-soot';

interface Project {
  id: string;
  name: string;
}

export interface ChatSession {
  id: string;
  projectId: string;
  title: string;
  turns: ChatTurn[];
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_PROJECT: Project = { id: 'default', name: 'Default Project' };

const SESSIONS_KEY = 'meridian:sessions';
const PROJECTS_KEY = 'meridian:projects';
const THEME_KEY = 'meridian:theme';

const STORE_NAMES = [SESSIONS_KEY, PROJECTS_KEY, THEME_KEY] as const;

const createSession = (projectId: string): ChatSession => ({
  id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  projectId,
  title: 'New chat',
  turns: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const formatTime = (ts: number): string => {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/* ---------------- IndexedDB store ---------------- */

class IndexedDBStore {
  private readonly db: Promise<IDBDatabase>;

  constructor() {
    this.db = new Promise((resolve, reject) => {
      const open = indexedDB.open('meridian', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => resolve(open.result);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const name of STORE_NAMES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name);
          }
        }
      };
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const db = await this.db;
    const tx = db.transaction(key, 'readonly');
    const store = tx.objectStore(key);
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(key, 'readwrite');
    const store = tx.objectStore(key);
    return new Promise((resolve, reject) => {
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async remove(key: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(key, 'readwrite');
    const store = tx.objectStore(key);
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

const store = new IndexedDBStore();

/* ---------------- shared confirmation dialog ---------------- */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  input = false,
  inputValue = '',
  onInputChange,
  inputPlaceholder,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (value: string) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  input?: boolean;
  inputValue?: string;
  onInputChange?: (value: string) => void;
  inputPlaceholder?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === panel)) {
          last.focus();
        } else if (!e.shiftKey && active === last) {
          first.focus();
        } else {
          first.focus();
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [open, onKeyDown]);

  useEffect(() => {
    if (!open) return;
    (input ? inputRef.current : confirmRef.current)?.focus();
  }, [open, input]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirmation-dialog-title">
      <div className="fixed inset-0 bg-[rgba(15,15,12,0.40)]" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        className="relative z-10 w-full max-w-md rounded-xl border border-hairline bg-surface-raised p-6 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirmation-dialog-title" className="text-readout font-bold text-ink">
          {title}
        </h3>
        {description && <p className="mt-1 text-micro text-muted">{description}</p>}
        {input && (
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => onInputChange?.(e.target.value)}
            placeholder={inputPlaceholder}
            className="mt-3 block w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent"
          />
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-sm border border-hairline bg-surface px-4 py-1.5 text-sm font-semibold text-ink hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm(inputValue)}
            className={`rounded-sm px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
              destructive ? 'text-fail hover:bg-fail-wash' : 'text-accent-ink hover:bg-accent-wash'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectWorkspace() {
  const [projects, setProjects] = useState<Project[]>([DEFAULT_PROJECT]);
  const [activeProject, setActiveProject] = useState<Project>(DEFAULT_PROJECT);
  const [theme, setTheme] = useState<ThemeName>('default');
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [dialog, setDialog] = useState<{
    kind: 'delete-document' | 'delete-session' | 'create-project';
    id?: string;
    inputValue: string;
  } | null>(null);

  const tenantId = activeProject.id;

  const activeSession = useMemo(
    () => chatSessions.find((s) => s.id === activeSessionId) ?? null,
    [chatSessions, activeSessionId],
  );

  // Load projects, theme, and sessions from IndexedDB on mount.
  useEffect(() => {
    let active = true;
    const load = async () => {
      const storedProjects = (await store.get(PROJECTS_KEY)) as Project[] | undefined;
      const nextProjects = storedProjects ?? [DEFAULT_PROJECT];
      if (active) {
        setProjects(nextProjects);
        setActiveProject(nextProjects[0]);
      }
      const storedTheme = await store.get(THEME_KEY);
      if (active && typeof storedTheme === 'string') {
        setTheme(storedTheme as ThemeName);
      }
      const projectId = nextProjects[0].id;
      const storedSessions = (await store.get(SESSIONS_KEY)) as ChatSession[] | undefined;
      const sessions = storedSessions
        ? storedSessions.filter((s) => s.projectId === projectId)
        : [createSession(projectId)];
      if (active) {
        setChatSessions(sessions);
        setActiveSessionId(sessions[0]?.id ?? null);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  // Persist theme.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    void store.set(THEME_KEY, theme);
  }, [theme]);

  // Reload sessions when the project changes.
  useEffect(() => {
    let active = true;
    const load = async () => {
      const stored = (await store.get(SESSIONS_KEY)) as ChatSession[] | undefined;
      const sessions = stored ? stored.filter((s) => s.projectId === tenantId) : [createSession(tenantId)];
      if (active) {
        setChatSessions(sessions);
        setActiveSessionId((prev) => {
          const stillExists = sessions.some((s) => s.id === prev);
          return stillExists ? prev : (sessions[0]?.id ?? null);
        });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [tenantId]);

  // Persist sessions whenever they change.
  useEffect(() => {
    void store.set(SESSIONS_KEY, chatSessions);
  }, [chatSessions]);

  useEffect(() => {
    let active = true;
    void api.getDocuments(tenantId).then((result) => {
      if (active) { setDocuments(result.documents); setDocumentsLoaded(true); }
    }).catch(() => { if (active) setDocumentsLoaded(true); });
    return () => { active = false; };
  }, [tenantId]);

  const handleUpload = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    void api.uploadDocuments(Array.from(files), tenantId)
      .then((result) => {
        const newTitles = result.results.map((r) => r.filename).filter(Boolean);
        setDocuments((prev) => [
          ...prev.filter((d) => !newTitles.includes(d.title ?? '')),
          ...result.results.map((r) => ({ id: r.document_id ?? '', title: r.filename ?? '', format: r.format ?? '', source: 'upload', created_at: new Date().toISOString(), char_count: 0, chunk_count: r.chunks, entities_count: 0, relationships_count: 0, snippet: '' })),
        ]);
      })
      .finally(() => setUploading(false));
  }, [tenantId]);

  const handleDeleteDocument = useCallback((docId: string) => {
    setDialog({ kind: 'delete-document', id: docId, inputValue: '' });
  }, []);

  const handleDeleteSession = useCallback((id: string) => {
    setDialog({ kind: 'delete-session', id, inputValue: '' });
  }, []);

  const createNewSession = useCallback(() => {
    const fresh = createSession(tenantId);
    setChatSessions((prev) => [fresh, ...prev]);
    setActiveSessionId(fresh.id);
    document.dispatchEvent(new CustomEvent('meridian:new-chat', { bubbles: true, detail: { tenantId } }));
  }, [tenantId]);

  const selectSession = useCallback((id: string) => {
    setActiveSessionId(id);
    setRailOpen(false);
  }, []);

  const handleTurnsUpdate = useCallback((turns: ChatTurn[]) => {
    if (!activeSessionId) return;
    setChatSessions((prev) => prev.map((s) => {
      if (s.id !== activeSessionId) return s;
      const next = { ...s, turns, updatedAt: Date.now() };
      // Derive a title from the first user query when still a placeholder.
      if (next.title === 'New chat' && turns.length > 0) {
        next.title = turns[0].query.slice(0, 40) + (turns[0].query.length > 40 ? '…' : '');
      }
      return next;
    }));
  }, [activeSessionId]);

  const toggleRail = () => setRailOpen((o) => !o);
  const toggleDrawer = () => setDrawerOpen((o) => !o);
  const toggleSettings = () => setSettingsOpen((o) => !o);
  const toggleProjectPicker = () => setProjectPickerOpen((o) => !o);
  const closeProjectPicker = () => setProjectPickerOpen(false);

  const selectProject = useCallback((project: Project) => {
    setActiveProject(project);
    closeProjectPicker();
  }, [closeProjectPicker]);

  const createProject = useCallback(() => {
    setDialog({ kind: 'create-project', id: undefined, inputValue: '' });
  }, []);

  if (!activeSessionId) return null;

  return (
    <div className="project-workspace relative min-h-[100dvh] bg-surface text-ink selection:bg-accent-wash">
      <FluidPointerCanvas className="fixed inset-0 z-0 w-full h-full pointer-events-none" />

      {/* ---------- Header ---------- */}
      <header className="fixed inset-x-0 top-0 z-20 border-b border-hairline bg-surface/80 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-[11px] font-bold text-muted tracking-widest uppercase">
            MERIDIAN
          </span>
          <div className="flex items-center gap-1 border-l border-hairline pl-4 cursor-pointer" onClick={toggleProjectPicker}>
            <span className="text-micro text-muted">/</span>
            <span className="text-sm font-medium text-ink">{activeProject.name}</span>
            <ChevronRight className="size-3.5 text-muted shrink-0" aria-hidden="true" />
          </div>
          <button
            type="button"
            onClick={toggleRail}
            aria-label={railOpen ? 'Close project rail' : 'Open project rail'}
            className="flex items-center justify-center size-8 rounded border border-hairline text-muted hover:bg-surface-sunken hover:text-ink transition-colors"
          >
            <PanelLeftIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="hidden md:flex-1 text-center">
          {activeSession ? (
            <p className="text-label text-muted truncate">{activeSession.title}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={createNewSession}
            aria-label="New chat"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-hairline text-xs font-medium hover:bg-surface-sunken transition-colors"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>New Chat</span>
          </button>
          <button
            type="button"
            onClick={toggleDrawer}
            aria-label={drawerOpen ? 'Close project files' : 'Open project files'}
            className="flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-xs font-medium hover:bg-surface-sunken transition-colors"
          >
            <FileText className="size-3.5" aria-hidden="true" />
            <span>Files ({documents.length})</span>
          </button>
          <button
            type="button"
            onClick={toggleSettings}
            aria-label="Open project settings"
            className="flex items-center justify-center size-8 rounded border border-hairline text-muted hover:bg-surface-sunken hover:text-ink transition-colors"
          >
            <Settings2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* ---------- Left project & chat rail (slide-over) ---------- */}
      {railOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-[rgba(15,15,12,0.40)]"
            onClick={toggleRail}
            aria-hidden="true"
          />
          <div className="fixed inset-y-0 left-0 z-40 w-[280px] border-r border-hairline bg-surface-raised flex flex-col transition-transform duration-300 ease-out transform translate-x-0">
            <div className="border-b border-hairline bg-surface-raised px-4 py-3 flex items-center justify-between shrink-0">
              <h2 className="text-readout font-bold text-ink">Project & Chats</h2>
              <button
                type="button"
                onClick={toggleRail}
                aria-label="Close rail"
                className="rounded-sm p-1.5 text-muted hover:bg-surface-sunken hover:text-ink"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Section 1: Active project */}
              <div className="space-y-3">
                <p className="label-section text-muted uppercase tracking-wider text-[10px] font-bold">Active project</p>
                <button
                  type="button"
                  onClick={toggleProjectPicker}
                  className="flex w-full items-center gap-2 rounded border border-hairline bg-surface px-3 py-2 text-left text-ink transition-colors hover:bg-surface-sunken"
                >
                  <FileText className="size-4 text-muted shrink-0" aria-hidden="true" />
                  <span className="flex-1 text-sm font-medium truncate">{activeProject.name}</span>
                  <ChevronRight className="size-3.5 text-muted shrink-0" aria-hidden="true" />
                </button>
              </div>

              {/* Section 2: Chat sessions */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="label-section text-muted uppercase tracking-wider text-[10px] font-bold">Chats</p>
                  <button
                    type="button"
                    onClick={createNewSession}
                    className="flex items-center gap-1 rounded border border-hairline px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-surface-sunken transition-colors"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    <span>New Chat</span>
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  {chatSessions.map((session) => {
                    const active = session.id === activeSessionId;
                    return (
                      <div key={session.id} className="relative group">
                        <div
                          role="button"
                          tabIndex={0}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => selectSession(session.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              selectSession(session.id);
                            }
                          }}
                          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            active
                              ? 'border-accent bg-surface-raised text-accent-ink'
                              : 'border-transparent text-ink hover:bg-surface-sunken hover:text-accent-ink'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-sm truncate">{session.title}</span>
                              {active && (
                                <span className="size-1.5 rounded-full bg-accent-ink shrink-0" aria-hidden="true" />
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-micro text-muted">{formatTime(session.updatedAt)}</span>
                              <span className="text-micro text-muted">{session.turns.length} message{session.turns.length !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                          aria-label={`Delete ${session.title}`}
                          className="shrink-0 rounded p-1.5 text-muted transition-colors opacity-0 group-hover:opacity-100 hover:bg-surface-sunken hover:text-fail focus-visible:ring-2 focus-visible:ring-accent"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Section 3: Grounded files */}
              <div className="space-y-3">
                <p className="label-section text-muted uppercase tracking-wider text-[10px] font-bold">Grounded files</p>
                <div className="rounded border border-hairline bg-surface px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 text-muted shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-ink truncate">{documents.length} document{documents.length !== 1 ? 's' : ''}</div>
                      <div className="text-micro text-muted">
                        {documentsLoaded
                          ? documents.length > 0
                            ? 'Ready to ground answers'
                            : 'No files yet. Upload documents to ground answers.'
                          : 'Loading project files…'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleDrawer(); }}
                      className="shrink-0 rounded p-1.5 text-muted hover:bg-surface-sunken hover:text-ink transition-colors"
                      aria-label="Upload files"
                    >
                      <Upload className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  {uploading && <div className="mt-2 text-micro text-muted">Indexing…</div>}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---------- Main chat ---------- */}
      <main className="relative z-10 min-h-[100dvh] pt-16 pb-20">
        <RagWorkspace
          key={activeSessionId}
          tenantId={tenantId}
          initialTurns={activeSession?.turns ?? []}
          onTurnsUpdate={handleTurnsUpdate}
        />
      </main>

      {/* ---------- Project files drawer (right overlay) ---------- */}
      <ProjectFilesDrawer
        open={drawerOpen}
        onClose={toggleDrawer}
        documents={documents}
        documentsLoaded={documentsLoaded}
        onUpload={handleUpload}
        onDelete={handleDeleteDocument}
        uploading={uploading}
      />

      {/* ---------- Settings modal ---------- */}
      <ProjectSettingsModal
        open={settingsOpen}
        onClose={toggleSettings}
        theme={theme}
        onThemeChange={setTheme}
      />

      {/* ---------- Project picker dropdown ---------- */}
      {projectPickerOpen && (
        <div className="fixed inset-0 z-40" onClick={closeProjectPicker} aria-hidden="true" />
      )}
      {projectPickerOpen && (
        <div className="absolute left-0 top-16 z-50 w-56 rounded-xl border border-hairline bg-surface-raised p-2 animate-[overlay-slide-in_180ms_cubic-bezier(0.2,0,0,1)_both]">
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => selectProject(p)}
              className={`flex items-center gap-2 rounded border px-3 py-2 text-left text-sm transition-colors ${
                activeProject.id === p.id
                  ? 'border-accent bg-accent-wash text-accent-ink'
                  : 'border-transparent text-ink hover:bg-surface-sunken'
              }`}
            >
              <FileText className="size-4 shrink-0" aria-hidden="true" />
              <span>{p.name}</span>
            </button>
          ))}
          <div className="border-t border-hairline pt-2 mt-1">
            <button
              type="button"
              onClick={createProject}
              className="flex w-full items-center gap-2 rounded border border-dashed border-hairline bg-surface px-3 py-2 text-left text-xs text-muted hover:bg-surface-sunken transition-colors"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>New project</span>
            </button>
          </div>
        </div>
      )}

      {/* ---------- Inline confirmation dialogs ---------- */}
      {dialog?.kind === 'delete-document' && (
        <ConfirmationDialog
          open
          onClose={() => setDialog(null)}
          onConfirm={() => {
            if (dialog.id) {
              void api.deleteDocument(dialog.id, tenantId).then(() => {
                setDocuments((prev) => prev.filter((d) => d.id !== dialog.id));
              });
            }
            setDialog(null);
          }}
          title="Delete document?"
          description="Remove this document from the project?"
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
        />
      )}
      {dialog?.kind === 'delete-session' && (
        <ConfirmationDialog
          open
          onClose={() => setDialog(null)}
          onConfirm={() => {
            if (!dialog.id) return;
            setChatSessions((prev) => {
              const next = prev.filter((s) => s.id !== dialog.id);
              if (next.length === 0) {
                const fresh = createSession(tenantId);
                setActiveSessionId(fresh.id);
                return [fresh];
              }
              if (activeSessionId === dialog.id) setActiveSessionId(next[0].id);
              return next;
            });
            setDialog(null);
          }}
          title="Delete chat session?"
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
        />
      )}
      {dialog?.kind === 'create-project' && (
        <ConfirmationDialog
          open
          onClose={() => setDialog(null)}
          onConfirm={(value) => {
            const name = value.trim();
            if (!name) return;
            const project: Project = { id: `project-${Date.now()}`, name };
            const next = [...projects, project];
            setProjects(next);
            void store.set(PROJECTS_KEY, next);
            selectProject(project);
            closeProjectPicker();
            setDialog(null);
          }}
          title="New project"
          description="Enter a project name"
          confirmLabel="Create"
          cancelLabel="Cancel"
          input
          inputValue={dialog.inputValue}
          onInputChange={(value) => setDialog((d) => (d ? { ...d, inputValue: value } : null))}
          inputPlaceholder="Project name"
        />
      )}
    </div>
  );
}

interface FloatingDrawerProps {
  open: boolean;
  onClose: () => void;
  documents: DocumentSummary[];
  documentsLoaded: boolean;
  onUpload: (files: FileList | null) => void;
  onDelete: (docId: string) => void;
  uploading: boolean;
}

function ProjectFilesDrawer({ open, onClose, documents, documentsLoaded, onUpload, onDelete, uploading }: FloatingDrawerProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-full flex-col border-l border-hairline bg-surface-raised animate-[overlay-slide-in_180ms_cubic-bezier(0.2,0,0,1)_both]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <h2 className="text-body font-bold text-ink">Project files</h2>
        <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded text-muted hover:bg-surface-sunken hover:text-ink">
          <span className="size-4" aria-hidden="true">✕</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center gap-2">
          <label className="flex items-center justify-center w-full size-9 rounded border border-dashed border-hairline bg-surface text-muted cursor-pointer hover:bg-surface-sunken hover:text-ink transition-colors">
            <Upload className="size-4 mr-1.5" aria-hidden="true" />
            <input type="file" accept=".pdf,.md,.txt,.html" multiple className="hidden" onChange={(e) => onUpload(e.target.files)} />
            Add files
          </label>
          {uploading && <span className="text-micro text-muted">Indexing…</span>}
        </div>
        <div className="mt-4 text-micro text-muted">
          {documentsLoaded
            ? documents.length > 0
              ? `Ready to ground answers — ${documents.length} document{documents.length !== 1 ? 's' : ''} indexed.`
              : 'No files yet. Upload documents to ground answers.'
            : 'Loading project files…'}
        </div>
        {documentsLoaded ? documents.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2 rounded border border-hairline bg-surface px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-ink truncate">{doc.title}</div>
                  <div className="text-micro text-muted">{doc.format} · {doc.chunk_count} passages</div>
                </div>
                <button type="button" onClick={() => onDelete(doc.id)} className="p-1.5 rounded text-muted hover:bg-surface-sunken hover:text-fail transition-colors" aria-label={`Delete ${doc.title}`}>
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-micro text-muted text-center py-4">No files yet. Add documents to ground answers.</p>
        ) : (
          <p className="mt-3 text-micro text-muted text-center py-4">Loading project files…</p>
        )}
      </div>
    </div>
  );
}

function PanelLeftIcon({ className, ariaHidden }: { className?: string; ariaHidden?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={ariaHidden}
    >
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="9" y1="6" x2="9" y2="18" />
    </svg>
  );
}

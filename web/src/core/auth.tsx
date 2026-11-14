/**
 * Meridian — auth / session context.
 *
 * Deliberately minimal: a tenant scope, an optional API-key override and the
 * theme. All three persist to localStorage so a reload keeps the operator's
 * working context. The API layer reads the key straight from storage, so
 * non-React callers and `streamQuery` stay in sync automatically.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/* -------------------------------------------------------------------------- */
/* Storage                                                                    */
/* -------------------------------------------------------------------------- */

export type Theme = 'light' | 'dark';

export const STORAGE_KEYS = {
  apiKey: 'meridian_api_key',
  tenantId: 'meridian_tenant_id',
  theme: 'meridian_theme',
} as const;

export const DEFAULT_TENANT_ID = 'default';

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(key);
    return value && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null || value.trim().length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage full / disabled — state still works for this session */
  }
}

/** Stored preference, else the OS preference, else light. */
export function resolveInitialTheme(): Theme {
  const stored = readStorage(STORAGE_KEYS.theme);
  if (stored === 'light' || stored === 'dark') return stored;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

/** Reflect the theme onto `<html>` so Tailwind's `dark:` variant and the
 *  `.dark` token block both activate. */
function applyThemeToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

export interface AuthContextValue {
  /** Optional API-key override sent as `X-API-Key`. `null` = use server default. */
  apiKey: string | null;
  setApiKey: (value: string | null) => void;
  /** Tenant scope included in every query. Never empty. */
  tenantId: string;
  setTenantId: (value: string) => void;
  theme: Theme;
  setTheme: (value: Theme) => void;
  toggleTheme: () => void;
  /** True when the operator has overridden the server's configured key. */
  hasApiKeyOverride: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** Paint the theme before the browser's first paint where possible (no flash). */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export interface AuthProviderProps {
  children: ReactNode;
  /** Initial value used only on first mount (before storage is read). */
  initialTenantId?: string;
}

export function AuthProvider({ children, initialTenantId }: AuthProviderProps) {
  const [apiKey, setApiKeyState] = useState<string | null>(() => readStorage(STORAGE_KEYS.apiKey));
  const [tenantId, setTenantIdState] = useState<string>(
    () => readStorage(STORAGE_KEYS.tenantId) ?? initialTenantId ?? DEFAULT_TENANT_ID,
  );
  const [theme, setThemeState] = useState<Theme>(() => resolveInitialTheme());

  /* Persist + paint ------------------------------------------------------- */
  useIsomorphicLayoutEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.apiKey, apiKey);
  }, [apiKey]);

  useEffect(() => {
    writeStorage(STORAGE_KEYS.tenantId, tenantId);
  }, [tenantId]);

  /* Cross-tab sync -------------------------------------------------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.theme) {
        const next = event.newValue;
        if (next === 'light' || next === 'dark') setThemeState(next);
      } else if (event.key === STORAGE_KEYS.apiKey) {
        setApiKeyState(event.newValue);
      } else if (event.key === STORAGE_KEYS.tenantId) {
        setTenantIdState(event.newValue && event.newValue.trim().length > 0 ? event.newValue : DEFAULT_TENANT_ID);
      }
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /* Actions --------------------------------------------------------------- */
  const setApiKey = useCallback((value: string | null) => {
    const trimmed = value?.trim() ?? '';
    setApiKeyState(trimmed.length > 0 ? trimmed : null);
  }, []);

  const setTenantId = useCallback((value: string) => {
    const trimmed = value.trim();
    setTenantIdState(trimmed.length > 0 ? trimmed : DEFAULT_TENANT_ID);
  }, []);

  const setTheme = useCallback((value: Theme) => setThemeState(value), []);

  const toggleTheme = useCallback(
    () => setThemeState((current) => (current === 'dark' ? 'light' : 'dark')),
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      apiKey,
      setApiKey,
      tenantId,
      setTenantId,
      theme,
      setTheme,
      toggleTheme,
      hasApiKeyOverride: apiKey !== null,
    }),
    [apiKey, setApiKey, tenantId, setTenantId, theme, setTheme, toggleTheme],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Access the session context. Must be called under `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an <AuthProvider>.');
  }
  return context;
}

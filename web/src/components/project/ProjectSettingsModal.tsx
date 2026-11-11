'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import { StatusChip } from '../StatusChip';
import { api } from '../../services/api';
import { PROVIDER_MODELS } from '../../constants/providerModels';
import type {
  AppearanceSettings,
  GeneralSettings,
  GuardrailSettings,
  MaintenanceChallenge,
  MaintenanceResult,
  MaskedKeyStatus,
  ProvidersResponse,
  RAGSettings,
  StorageStatus,
  UpdateLLMSettingsPayload,
} from '../../types/api';
import type { ThemeName } from './ProjectWorkspace';

type APTheme = 'raw-paper' | 'ceramic-concrete' | 'cold-titanium' | 'analog-soot';

const API_TO_UI: Record<ThemeName, APTheme> = {
  default: 'raw-paper',
  'ceramic-concrete': 'ceramic-concrete',
  'cold-titanium': 'cold-titanium',
  'analog-soot': 'analog-soot',
};

const UI_TO_API: Record<APTheme, ThemeName> = {
  'raw-paper': 'default',
  'ceramic-concrete': 'ceramic-concrete',
  'cold-titanium': 'cold-titanium',
  'analog-soot': 'analog-soot',
};

const AP_THEMES: Array<{ id: APTheme; label: string; swatch: string; accent: string }> = [
  { id: 'raw-paper', label: 'Raw Paper', swatch: '#f6f4ee', accent: '#2d3a29' },
  { id: 'ceramic-concrete', label: 'Ceramic Concrete', swatch: '#f2f4f7', accent: '#344054' },
  { id: 'cold-titanium', label: 'Cold Titanium', swatch: '#f1f5f9', accent: '#0f172a' },
  { id: 'analog-soot', label: 'Analog Soot', swatch: '#18181b', accent: '#f59e0b' },
];

const TABS: Array<{ id: string; label: string }> = [
  { id: 'general', label: 'General & Workspace' },
  { id: 'provider', label: 'Provider & Models' },
  { id: 'rag', label: 'RAG & Retrieval Engine' },
  { id: 'guardrails', label: 'Guardrails & Safety' },
  { id: 'storage', label: 'Storage & Corpus Management' },
  { id: 'appearance', label: 'Appearance & Themes' },
];

type TabId = (typeof TABS)[number]['id'];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ProjectSettingsModalProps {
  open: boolean;
  onClose: () => void;
  theme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
}

/* ---------------- shared sub-components ---------------- */

const SliderReadout = ({
  value,
  min,
  max,
  step,
  label,
  unit = '',
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  unit?: string;
  onChange: (v: number) => void;
}) => {
  const [typed, setTyped] = useState(String(value));
  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (Number.isFinite(v)) {
      setTyped(e.target.value);
      onChange(Math.round(v / step) * step);
    }
  };
  const handleBlur = () => {
    setTyped(String(value));
  };
  return (
    <div className="space-y-1">
      <label className="text-micro text-muted font-bold">{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-accent h-2 w-full rounded-sm bg-hairline cursor-pointer"
          role="slider"
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-orientation="horizontal"
        />
        <input
          type="text"
          value={typed}
          onChange={handleInput}
          onBlur={handleBlur}
          className="w-16 rounded-sm border border-hairline bg-surface-raised px-2 py-1 id-mono text-ink text-center outline-none focus:border-accent focus-visible:ring-1 focus-visible:ring-accent"
        />
        <span className="text-micro text-muted">{unit}</span>
      </div>
    </div>
  );
};

const PasswordInput = ({
  value,
  onChange,
  label,
  status,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  status?: MaskedKeyStatus;
}) => {
  const [visible, setVisible] = useState(false);
  const badge = status
    ? status.configured
      ? `Configured •••${status.hint && status.hint !== '****' ? status.hint : '••••'}`
      : 'Not configured'
    : null;
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-2 text-label font-semibold text-ink">
        <span className="flex items-center gap-2">
          <span>{label}</span>
          {badge && <StatusChip variant="ok">{badge}</StatusChip>}
        </span>
        <span className="shrink-0 text-micro font-normal text-faint">Leave blank to keep existing</span>
      </label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Leave blank to keep existing"
          className="w-full rounded-sm border border-hairline bg-surface-raised pl-3 pr-10 py-1.5 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="button"
          onClick={() => setVisible((prev) => !prev)}
          aria-label={visible ? 'Hide key' : 'Show key'}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
};

const DoubleBezelCard = ({ children, variant = 'default' }: { children: React.ReactNode; variant?: 'default' | 'danger' }) => (
  <section
    className={`rounded border p-4 ${
      variant === 'danger'
        ? 'border-hairline bg-surface hover:border-fail-wash'
        : 'border-hairline bg-surface-raised hover:bg-surface-sunken'
    }`}
  >
    <div className="rounded-sm border border-hairline p-3 bg-surface">{children}</div>
  </section>
);

const FusionWeightSliders = ({
  bm25,
  dense,
  onChange,
}: {
  bm25: number;
  dense: number;
  onChange: (bm25: number, dense: number) => void;
}) => {
  const handleBm25 = (v: number) => onChange(Math.round((v * 100) / 10) / 100, Math.round(((1 - v) * 100) / 10) / 100);
  const handleDense = (v: number) => onChange(Math.round(((1 - v) * 100) / 10) / 100, Math.round((v * 100) / 10) / 100);
  return (
    <div className="space-y-3">
      <SliderReadout value={bm25} min={0} max={1} step={0.1} label="BM25 weight" unit="" onChange={(v) => handleBm25(v)} />
      <SliderReadout value={dense} min={0} max={1} step={0.1} label="Dense weight" unit="" onChange={(v) => handleDense(v)} />
      <div className="flex justify-between text-micro text-muted">
        <span>BM25</span>
        <span>{(bm25 * 100).toFixed(0)}%</span>
      </div>
      <div className="flex justify-between text-micro text-muted">
        <span>Dense</span>
        <span>{(dense * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
};

const ThemeSwatchGrid = ({
  themes,
  selected,
  onSelect,
}: {
  themes: typeof AP_THEMES;
  selected: APTheme;
  onSelect: (id: APTheme) => void;
}) => (
  <div className="grid grid-cols-2 gap-3">
    {themes.map((t) => {
      const active = selected === t.id;
      return (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          aria-pressed={active}
          className={`relative flex flex-col items-center gap-2 rounded-sm border p-3 text-left transition-colors ${
            active
              ? 'border-accent bg-surface-raised'
              : 'border-hairline bg-surface hover:bg-surface-sunken'
          }`}
        >
          <div
            className={`w-10 h-10 rounded-sm border border-hairline shrink-0 ${active ? 'ring-2 ring-accent' : ''}`}
            style={{ backgroundColor: t.swatch, borderColor: t.accent }}
            aria-hidden="true"
          />
          <span className={`text-sm font-semibold ${active ? 'text-accent-ink' : 'text-ink'}`}>{t.label}</span>
          {active && (
            <div className="absolute right-2 top-2 size-4 rounded-full border border-accent bg-accent-ink flex items-center justify-center text-[10px] font-bold text-white">
              <Check className="size-3" aria-hidden="true" />
            </div>
          )}
        </button>
      );
    })}
  </div>
);

/* ---------------- confirmation dialog (storage maintenance) ---------------- */

type MaintAction = 'clear_vector' | 'clear_disk_chunks' | 'database_reset';

const ACTION_LABEL: Record<MaintAction, string> = {
  clear_vector: 'Clear vector collection',
  clear_disk_chunks: 'Clear disk chunks',
  database_reset: 'Database reset',
};

const MaintenanceConfirm = ({
  open,
  action,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  action: MaintAction;
  onConfirm: (result: MaintenanceResult) => void;
  onCancel: () => void;
}) => {
  const [challenge, setChallenge] = useState<MaintenanceChallenge | null>(null);
  const [typed, setTyped] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<MaintenanceResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setChallenge(null);
      setTyped('');
      setResult(null);
      setErr(null);
      return;
    }
    api.postMaintenanceChallenge('default', action)
      .then(setChallenge)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Challenge failed'));
  }, [open, action]);

  const canConfirm = typed === 'DELETE' && Boolean(challenge) && !executing;
  const handleExecute = async () => {
    if (!challenge) return;
    setExecuting(true);
    setErr(null);
    try {
      const res = await api.postMaintenanceExecute('default', action, challenge.token);
      setResult(res);
      onConfirm(res);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Execution failed');
    } finally {
      setExecuting(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="maintenance-confirm-title"
      tabIndex={-1}
    >
      <div
        className="fixed inset-0 bg-[rgba(15,15,12,0.40)]"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="maintenance-confirm-title"
        tabIndex={-1}
        className="relative z-50 w-full max-w-md rounded-sm border border-hairline bg-surface-raised p-6 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <h3 id="maintenance-confirm-title" className="text-readout font-bold text-ink mb-1">
          Confirm {ACTION_LABEL[action]}
        </h3>
        <p className="text-micro text-muted mb-4">{challenge?.message ?? 'This action cannot be undone.'}</p>
        <div className="space-y-3">
          <label className="text-micro text-muted font-bold">Type DELETE to confirm</label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink text-uppercase outline-none focus:border-accent focus-visible:ring-1 focus-visible:ring-accent"
            maxLength={6}
          />
          {err && (
            <div className="flex items-start gap-2 rounded-sm border border-hairline bg-fail-wash px-3 py-2 text-label text-fail">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{err}</span>
            </div>
          )}
          {result && (
            <div className="flex items-start gap-2 rounded-sm border border-hairline bg-ok-wash px-3 py-2 text-label text-ok">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              <span>{result.status === 'accepted' ? 'Accepted' : 'Rejected'}: {result.message}</span>
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-sm px-4 py-1.5 text-sm font-semibold text-ink hover:bg-surface-sunken">Cancel</button>
          <button
            type="button"
            onClick={handleExecute}
            disabled={!canConfirm || executing}
            className={`rounded-sm px-4 py-1.5 text-sm font-bold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
              canConfirm ? 'bg-fail hover:bg-fail-ink' : 'bg-faint'
            }`}
          >
            {executing ? <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" /> : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- modal ---------------- */

export function ProjectSettingsModal({
  open,
  onClose,
  theme,
  onThemeChange,
}: ProjectSettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [tab, setTab] = useState<TabId>('general');

  /* load state */
  const [loadError, setLoadError] = useState<string | null>(null);

  /* general */
  const [general, setGeneral] = useState<Partial<GeneralSettings>>({
    workspace_name: '',
    tenant_id: '',
    default_language: '',
    session_timeout_minutes: 30,
  });

  /* provider */
  const [provider, setProvider] = useState<string>('');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [openaiOrgId, setOpenaiOrgId] = useState('');
  const [openaiProjId, setOpenaiProjId] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('');
  const [modelList, setModelList] = useState<string[]>([]);
  const [keyStatus, setKeyStatus] = useState<Record<string, MaskedKeyStatus>>({});
  const [providersData, setProvidersData] = useState<ProvidersResponse | null>(null);

  /* provider advanced */
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [maxCycles, setMaxCycles] = useState(3);
  const [enforceGuardrails, setEnforceGuardrails] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  /* rag */
  const [rag, setRAG] = useState<Partial<RAGSettings>>({
    top_k: 5,
    temperature: 0.7,
    top_p: 1.0,
    rerank: false,
    reranker_model: null,
    bm25_weight: 0.5,
    dense_weight: 0.5,
    embedding_model: null,
    min_dense_score: 0.0,
  });
  const [retrievalMode, setRetrievalMode] = useState<'dense' | 'bm25' | 'hybrid'>('hybrid');

  /* guardrails */
  const [guardrails, setGuardrails] = useState<Partial<GuardrailSettings>>({
    enable_input_guardrails: true,
    enable_output_guardrails: true,
    pii_redaction: true,
    hallucination_threshold: 0.85,
    refusal_behavior: 'refuse',
  });

  /* appearance */
  const [appearance, setAppearance] = useState<Partial<AppearanceSettings>>({
    theme: API_TO_UI[theme],
    display_scale: 1.0,
  });

  /* storage */
  const [storage, setStorage] = useState<StorageStatus>({ vector_collections: 0, disk_chunks: 0, db_tables: [] });
  const [maintOpen, setMaintOpen] = useState(false);
  const [maintAction, setMaintAction] = useState<MaintAction>('clear_vector');

  /* save feedback */
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tenantId = 'default';

  const loadAll = async () => {
    setLoadError(null);
    try {
      const [gen, llm, provs, ragS, guard, app, store] = await Promise.all([
        api.getGeneralSettings(tenantId).catch(() => null),
        api.getLLMSettings().catch(() => null),
        api.getProviders().catch(() => null),
        api.getRAGSettings(tenantId).catch(() => null),
        api.getGuardrailSettings(tenantId).catch(() => null),
        api.getAppearanceSettings(tenantId).catch(() => null),
        api.getStorageStatus(tenantId).catch(() => null),
      ]);

      if (gen) setGeneral(gen);
      if (llm) {
        setProvider(llm.active_provider);
        setDefaultModel(llm.default_model || '');
        const configured = llm.providers_configured ?? {};
        const next: Record<string, MaskedKeyStatus> = {};
        for (const [p, c] of Object.entries(configured)) next[p] = { configured: Boolean(c) };
        next['ollama'] = { configured: true };
        setKeyStatus(next);
        const savedBaseUrl = llm.base_url || llm.custom_base_url;
        if (savedBaseUrl && ['groq', 'openrouter', 'deepseek', 'custom'].includes(llm.active_provider)) setCustomBaseUrl(savedBaseUrl);
        if (savedBaseUrl && llm.active_provider === 'ollama') setOllamaBaseUrl(savedBaseUrl);
        const models = llm.provider_available_models?.[llm.active_provider] ?? [];
        const list = models.length > 0 ? [...models] : (PROVIDER_MODELS[llm.active_provider] ?? PROVIDER_MODELS.custom);
        setModelList(list);
        if (llm.default_model && !list.includes(llm.default_model)) list.unshift(llm.default_model);
      }
      if (provs) setProvidersData(provs);
      if (ragS) {
        setRAG(ragS);
        setRetrievalMode((ragS.bm25_weight > 0 && ragS.dense_weight === 0) ? 'bm25' : ragS.dense_weight > 0 && ragS.bm25_weight === 0 ? 'dense' : 'hybrid');
      }
      if (guard) setGuardrails(guard);
      if (app) {
        setAppearance({ theme: app.theme, display_scale: app.display_scale });
      }
      if (store) setStorage(store);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load settings.');
    }
  };
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    loadAll();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const panel = dialogRef.current;
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
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && document.activeElement?.getAttribute('role') === 'tab') {
        e.preventDefault();
        const idx = TABS.findIndex((t) => t.id === tab);
        const next = e.key === 'ArrowLeft' ? (idx - 1 + TABS.length) % TABS.length : (idx + 1) % TABS.length;
        const el = document.getElementById(`tab-${TABS[next].id}`);
        if (el) el.focus();
      }
      if (e.key === 'Home' && document.activeElement?.getAttribute('role') === 'tab') {
        e.preventDefault();
        const el = document.getElementById('tab-general');
        if (el) el.focus();
      }
      if (e.key === 'End' && document.activeElement?.getAttribute('role') === 'tab') {
        e.preventDefault();
        const el = document.getElementById(`tab-${TABS[TABS.length - 1].id}`);
        if (el) el.focus();
      }
    };

    const dialog = dialogRef.current;
    dialog?.focus();

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus();
    };
  }, [open, onClose, tab]);

  useEffect(() => {
    if (!open) return;
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [open]);

  if (!open) return null;

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const providerInfo = providersData?.providers.find((p) => p.id === newProvider);
    if (providerInfo?.current_model) setDefaultModel(providerInfo.current_model);
    else setDefaultModel((PROVIDER_MODELS[newProvider] ?? PROVIDER_MODELS.custom)[0]);
  };

  const getActiveApiKey = () => {
    if (provider === 'openai') return openaiKey;
    if (provider === 'anthropic') return anthropicKey;
    if (['groq', 'openrouter', 'deepseek', 'custom'].includes(provider)) return customKey;
    return '';
  };

  const getActiveBaseUrl = () => {
    if (['groq', 'openrouter', 'deepseek', 'custom'].includes(provider)) return customBaseUrl;
    if (provider === 'ollama') return ollamaBaseUrl;
    return '';
  };

  const handleTestConnection = async () => {
    setSaveError(null);
    try {
      const res = await api.testConnection(tenantId);
      void res;
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Connection test failed.');
    }
  };

  const handleTestAndFetchModels = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.testAndFetchModels({
        provider,
        api_key: getActiveApiKey(),
        base_url: getActiveBaseUrl(),
        organization_id: openaiOrgId || undefined,
        project_id: openaiProjId || undefined,
        model: defaultModel || undefined,
      });
      if (res.models && res.models.length > 0) setModelList(res.models);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Model fetch test failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      /* General */
      const genPatch: Partial<GeneralSettings> = {};
      if (general.workspace_name) genPatch.workspace_name = general.workspace_name;
      if (general.default_language) genPatch.default_language = general.default_language;
      if (Number.isFinite(general.session_timeout_minutes)) genPatch.session_timeout_minutes = general.session_timeout_minutes;
      await api.patchGeneralSettings(tenantId, genPatch);

      /* Provider (only non-blank fields via updateLLMSettings) */
      const isCustomFamily = ['groq', 'openrouter', 'deepseek', 'custom'].includes(provider);
      const payload: UpdateLLMSettingsPayload = {
        active_provider: provider,
        default_model: defaultModel,
      };
      if (openaiKey) payload.openai_api_key = openaiKey;
      if (anthropicKey) payload.anthropic_api_key = anthropicKey;
      if (customKey) {
        if (provider === 'groq') payload.groq_api_key = customKey;
        if (provider === 'openrouter') payload.openrouter_api_key = customKey;
        if (provider === 'deepseek') payload.deepseek_api_key = customKey;
        if (isCustomFamily) payload.custom_api_key = customKey;
      }
      if (openaiOrgId) payload.openai_org_id = openaiOrgId;
      if (provider === 'ollama') {
        if (ollamaBaseUrl) payload.custom_base_url = ollamaBaseUrl;
      } else if (isCustomFamily && customBaseUrl) {
        payload.custom_base_url = customBaseUrl;
      }
      payload.timeout_seconds = Math.min(300, Math.max(1, timeoutSeconds));
      payload.max_cycles = Math.min(10, Math.max(1, maxCycles));
      payload.enforce_guardrails = enforceGuardrails;
      await api.updateLLMSettings(payload);

      /* RAG */
      await api.patchRAGSettings(tenantId, {
        top_k: rag.top_k,
        temperature: rag.temperature,
        top_p: rag.top_p,
        rerank: rag.rerank,
        reranker_model: rag.reranker_model ?? null,
        bm25_weight: rag.bm25_weight,
        dense_weight: rag.dense_weight,
        embedding_model: rag.embedding_model ?? null,
        min_dense_score: rag.min_dense_score,
      });

      /* Guardrails */
      await api.patchGuardrailSettings(tenantId, {
        enable_input_guardrails: guardrails.enable_input_guardrails,
        enable_output_guardrails: guardrails.enable_output_guardrails,
        pii_redaction: guardrails.pii_redaction,
        hallucination_threshold: guardrails.hallucination_threshold,
        refusal_behavior: guardrails.refusal_behavior,
      });

      /* Appearance */
      await api.patchAppearanceSettings(tenantId, {
        theme: appearance.theme,
        display_scale: appearance.display_scale,
      });

      setSaveSuccess(true);
      await loadAll();
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 600);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  const applyThemeLive = (id: APTheme) => {
    setAppearance((prev) => ({ ...prev, theme: id }));
    document.documentElement.dataset.theme = UI_TO_API[id];
    onThemeChange(UI_TO_API[id]);
  };

  const handleCopyTenant = async () => {
    await navigator.clipboard.writeText(general.tenant_id || '');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* backdrop — no aria-hidden */}
      <div
        className="fixed inset-0 bg-[rgba(15,15,12,0.40)]"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-settings-title"
        tabIndex={-1}
        className="relative z-50 w-full max-w-2xl rounded-sm border border-hairline bg-surface-raised p-6 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div className="flex items-center justify-between border-b border-hairline pb-4 mb-6">
          <div>
            <h3 id="project-settings-title" className="text-readout font-bold text-ink">
              Project Settings
            </h3>
            <p className="mt-1 text-micro text-muted">Workspace, provider, retrieval, guardrails, storage and appearance.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        {/* tab nav */}
        <div className="flex gap-1 border-b border-hairline mb-6" role="tablist" aria-label="Settings tabs">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'border-accent text-accent-ink'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* panels */}
        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-2">
          {loadError && (
            <div role="alert" aria-live="polite" className="rounded-sm border border-hairline bg-fail-wash px-3 py-2 text-label text-fail">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{loadError}</span>
            </div>
          )}
          {/* General & Workspace */}
          <section
            id="panel-general"
            role="tabpanel"
            aria-labelledby="tab-general"
            className="space-y-4"
          >
            <div>
              <label htmlFor="workspace-name" className="label-section mb-1.5 block text-muted">
                Workspace name
              </label>
              <input
                id="workspace-name"
                type="text"
                value={general.workspace_name || ''}
                onChange={(e) => setGeneral((p) => ({ ...p, workspace_name: e.target.value }))}
                className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="label-section text-muted">Tenant ID</label>
              <span className="flex-1 id-mono text-micro text-ink bg-surface-raised rounded-sm px-3 py-1.5 border border-hairline truncate">
                {general.tenant_id || '—'}
              </span>
              <button
                type="button"
                onClick={handleCopyTenant}
                title="Copy tenant ID"
                className="rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                aria-label="Copy tenant ID to clipboard"
              >
                <Copy className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div>
              <label htmlFor="default-language" className="label-section mb-1.5 block text-muted">
                Default language
              </label>
              <select
                id="default-language"
                value={general.default_language || 'en'}
                onChange={(e) => setGeneral((p) => ({ ...p, default_language: e.target.value }))}
                className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent"
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
                <option value="fr">French</option>
                <option value="de">German</option>
                <option value="ja">Japanese</option>
              </select>
            </div>
            <div>
              <label htmlFor="session-timeout" className="label-section mb-1.5 block text-muted">
                Session timeout (minutes)
              </label>
              <input
                id="session-timeout"
                type="number"
                min={1}
                max={525600}
                value={general.session_timeout_minutes ?? 30}
                onChange={(e) => setGeneral((p) => ({ ...p, session_timeout_minutes: Number(e.target.value) || 30 }))}
                className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent"
              />
            </div>
          </section>

          {/* Provider & Models */}
          <section id="panel-provider" role="tabpanel" aria-labelledby="tab-provider" className="space-y-4">
            <div>
              <label htmlFor="provider-select" className="label-section mb-1.5 block text-muted">
                Provider
              </label>
              <select
                id="provider-select"
                value={provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full cursor-pointer rounded-sm border border-hairline bg-surface-raised px-3 py-2 text-body text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent"
              >
                {provider && !providersData?.providers.some((p) => p.id === provider) && <option value={provider}>{provider}</option>}
                {providersData?.providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {provider === 'openai' && (
              <>
                <PasswordInput label="OpenAI API Key" value={openaiKey} onChange={setOpenaiKey} status={keyStatus.openai} />
                <div className="grid grid-cols-1 gap-2.5 border-t border-hairline pt-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="openai-org" className="mb-1.5 block text-label font-medium text-muted">Organization ID (optional)</label>
                    <input id="openai-org" type="text" value={openaiOrgId} onChange={(e) => setOpenaiOrgId(e.target.value)} placeholder="org-..." className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent" />
                  </div>
                  <div>
                    <label htmlFor="openai-proj" className="mb-1.5 block text-label font-medium text-muted">Project ID (optional)</label>
                    <input id="openai-proj" type="text" value={openaiProjId} onChange={(e) => setOpenaiProjId(e.target.value)} placeholder="proj-..." className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent" />
                  </div>
                </div>
              </>
            )}
            {provider === 'anthropic' && (
              <PasswordInput label="Anthropic API Key" value={anthropicKey} onChange={setAnthropicKey} status={keyStatus.anthropic} />
            )}
            {['groq', 'openrouter', 'deepseek', 'custom'].includes(provider) && (
              <>
                <div>
                  <label htmlFor="base-url" className="mb-1.5 block text-label font-semibold text-ink">API base endpoint URL</label>
                  <input id="base-url" type="text" value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)} placeholder="https://api.groq.com/openai/v1" className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent" />
                </div>
                <PasswordInput label="Provider API Key" value={customKey} onChange={setCustomKey} status={keyStatus[provider as keyof typeof keyStatus]} />
              </>
            )}
            {provider === 'ollama' && (
              <div>
                <label htmlFor="ollama-url" className="mb-1.5 block text-label font-semibold text-ink">Local Ollama host endpoint</label>
                <input id="ollama-url" type="text" value={ollamaBaseUrl} onChange={(e) => setOllamaBaseUrl(e.target.value)} placeholder="http://localhost:11434" className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 id-mono text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent" />
              </div>
            )}

            <div className="rounded-sm border border-hairline bg-surface-raised p-4">
              <h3 className="label-section flex items-center gap-1.5 text-ink mb-3">
                <ActivityIcon className="size-3.5 text-accent" aria-hidden="true" />
                <span>Connection checks</span>
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-3 py-1.5 text-label font-semibold text-ink transition-colors hover:border-accent disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <RadioIcon className="size-3.5 text-accent" aria-hidden="true" />
                  <span>Test saved provider</span>
                </button>
                <button
                  type="button"
                  onClick={handleTestAndFetchModels}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-label font-bold text-white transition-colors hover:bg-accent-ink disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                >
                  <Zap className="size-3.5" aria-hidden="true" />
                  <span>Validate endpoint &amp; load models</span>
                </button>
              </div>
              {saveSuccess && (
                <div className="mt-3 flex items-start gap-2 rounded-sm border border-hairline bg-ok-wash px-3 py-2 text-label text-ok">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  <span>Connection check succeeded</span>
                </div>
              )}
              {saveError && (
                <div className="mt-3 flex items-start gap-2 rounded-sm border border-hairline bg-fail-wash px-3 py-2 text-label text-fail">
                  <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="model-select" className="label-section mb-1.5 block text-muted">Model</label>
              <input
                id="model-select"
                list="provider-model-options"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder="Choose a configured model"
                className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-2 id-mono text-ink outline-none transition-colors placeholder:text-faint focus:border-accent focus-visible:ring-1 focus-visible:ring-accent"
              />
              <datalist id="provider-model-options">{modelList.map((m) => <option key={m} value={m} />)}</datalist>
              <p className="mt-1.5 text-micro text-muted">Choose a listed model or enter a custom model name.</p>
            </div>

            {/* Advanced collapsible */}
            <div className="border-t border-hairline pt-4">
              <button
                type="button"
                onClick={() => setShowAdvanced((p) => !p)}
                aria-expanded={showAdvanced}
                className="flex w-full cursor-pointer items-center justify-between gap-2 py-1 text-label font-bold text-accent-ink transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                <span className="flex items-center gap-1.5">
                  <Zap className="size-3.5 text-accent" aria-hidden="true" />
                  <span>Advanced: timeout, guardrails & agent cycles</span>
                </span>
                <ChevronDown className={`size-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {showAdvanced && (
                <div className="mt-3 grid grid-cols-1 gap-2.5 rounded-sm border border-hairline bg-surface-sunken p-4 sm:grid-cols-3">
                  <SliderReadout
                    value={timeoutSeconds} min={1} max={300} step={1} label="Timeout (seconds)" unit="s" onChange={setTimeoutSeconds} />
                  <div>
                    <label className="text-micro text-muted font-bold">Max cycles (1–10)</label>
                    <input
                      type="number" min={1} max={10} value={maxCycles}
                      onChange={(e) => setMaxCycles(Number(e.target.value) || 3)}
                      className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label htmlFor="enforce-guardrails" className="flex cursor-pointer items-center gap-1.5 text-label font-medium text-ink">
                      <input
                        id="enforce-guardrails"
                        type="checkbox"
                        checked={enforceGuardrails}
                        onChange={(e) => setEnforceGuardrails(e.target.checked)}
                        className="cursor-pointer rounded-sm accent-[rgb(var(--accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                      />
                      <span>Enforce guardrails</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* RAG & Retrieval Engine */}
          <section id="panel-rag" role="tabpanel" aria-labelledby="tab-rag" className="space-y-4">
            <div>
              <label className="label-section mb-1.5 block text-muted">Retrieval mode</label>
              <div className="grid grid-cols-3 gap-2">
                {(['dense', 'bm25', 'hybrid'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={retrievalMode === m}
                    onClick={() => setRetrievalMode(m)}
                    className={`rounded-sm border px-3 py-2 text-sm transition-colors ${
                      retrievalMode === m
                        ? 'border-accent bg-accent-wash text-accent-ink'
                        : 'border-hairline bg-surface text-ink hover:bg-surface-sunken'
                    }`}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <FusionWeightSliders bm25={rag.bm25_weight ?? 0.5} dense={rag.dense_weight ?? 0.5} onChange={(b, d) => setRAG((p) => ({ ...p, bm25_weight: b, dense_weight: d }))} />
            <SliderReadout value={rag.top_k ?? 5} min={1} max={20} step={1} label="Top-k" onChange={(v) => setRAG((p) => ({ ...p, top_k: v }))} />
            <SliderReadout value={rag.temperature ?? 0.7} min={0} max={2} step={0.1} label="Temperature" onChange={(v) => setRAG((p) => ({ ...p, temperature: v }))} />
            <SliderReadout value={rag.top_p ?? 1.0} min={0} max={1} step={0.05} label="Top-p" onChange={(v) => setRAG((p) => ({ ...p, top_p: v }))} />
            <div className="flex items-start gap-2">
              <input
                id="rerank"
                type="checkbox"
                checked={rag.rerank ?? false}
                onChange={(e) => setRAG((p) => ({ ...p, rerank: e.target.checked }))}
                className="mt-1 cursor-pointer rounded-sm accent-[rgb(var(--accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              />
              <label htmlFor="rerank" className="text-label font-medium text-ink cursor-pointer">Reranking</label>
            </div>
            {rag.rerank && (
              <div>
                <label htmlFor="reranker-model" className="mb-1 block text-micro text-muted">Reranker model</label>
                <input id="reranker-model" type="text" value={rag.reranker_model || ''} onChange={(e) => setRAG((p) => ({ ...p, reranker_model: e.target.value || null }))} className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent" />
              </div>
            )}
            <SliderReadout value={rag.min_dense_score ?? 0} min={0} max={1} step={0.05} label="Min dense score" onChange={(v) => setRAG((p) => ({ ...p, min_dense_score: v }))} />
            <div className="text-micro text-muted">
              Embedding model: <span className="id-mono text-ink">{rag.embedding_model || 'not configured'}</span>
              <span className="text-faint"> (requires reindex to change)</span>
            </div>
          </section>

          {/* Guardrails & Safety */}
          <section id="panel-guardrails" role="tabpanel" aria-labelledby="tab-guardrails" className="space-y-4">
            <div className="flex items-start gap-2">
              <input id="input-guardrails" type="checkbox" checked={guardrails.enable_input_guardrails ?? true} onChange={(e) => setGuardrails((p) => ({ ...p, enable_input_guardrails: e.target.checked }))} className="mt-1 cursor-pointer rounded-sm accent-[rgb(var(--accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" />
              <label htmlFor="input-guardrails" className="text-label font-medium text-ink cursor-pointer">Input guardrails</label>
            </div>
            <div className="flex items-start gap-2">
              <input id="output-guardrails" type="checkbox" checked={guardrails.enable_output_guardrails ?? true} onChange={(e) => setGuardrails((p) => ({ ...p, enable_output_guardrails: e.target.checked }))} className="mt-1 cursor-pointer rounded-sm accent-[rgb(var(--accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" />
              <label htmlFor="output-guardrails" className="text-label font-medium text-ink cursor-pointer">Output guardrails</label>
            </div>
            <div className="flex items-start gap-2">
              <input id="pii-redaction" type="checkbox" checked={guardrails.pii_redaction ?? true} onChange={(e) => setGuardrails((p) => ({ ...p, pii_redaction: e.target.checked }))} className="mt-1 cursor-pointer rounded-sm accent-[rgb(var(--accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent" />
              <label htmlFor="pii-redaction" className="text-label font-medium text-ink cursor-pointer">PII redaction</label>
            </div>
            <SliderReadout value={guardrails.hallucination_threshold ?? 0.85} min={0} max={1} step={0.05} label="Hallucination threshold" onChange={(v) => setGuardrails((p) => ({ ...p, hallucination_threshold: v }))} />
            <div>
              <label htmlFor="refusal-behavior" className="mb-1.5 block text-micro text-muted font-bold">Refusal behavior</label>
              <select id="refusal-behavior" value={guardrails.refusal_behavior ?? 'refuse'} onChange={(e) => setGuardrails((p) => ({ ...p, refusal_behavior: e.target.value as 'refuse' | 'redact' | 'allow' }))} className="w-full rounded-sm border border-hairline bg-surface-raised px-3 py-1.5 text-ink outline-none transition-colors focus:border-accent focus-visible:ring-1 focus-visible:ring-accent">
                <option value="refuse">Refuse</option>
                <option value="redact">Redact</option>
                <option value="allow">Allow</option>
              </select>
            </div>
          </section>

          {/* Storage & Corpus Management */}
          <section id="panel-storage" role="tabpanel" aria-labelledby="tab-storage" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {[ { label: 'Vector collections', value: storage.vector_collections }, { label: 'Disk chunks', value: storage.disk_chunks }, { label: 'DB tables', value: storage.db_tables.length } ].map((s) => (
                <div key={s.label} className="rounded border border-hairline bg-surface-raised p-4">
                  <span className="text-micro text-muted block">{s.label}</span>
                  <span className="text-2xl font-bold text-ink">{s.value}</span>
                </div>
              ))}
              {storage.db_tables.map((t) => (
                <div key={t.name} className="rounded border border-hairline bg-surface-raised p-4">
                  <span className="text-micro text-muted block truncate">{t.name}</span>
                  <span className="text-2xl font-bold text-ink">{t.row_count}</span>
                </div>
              ))}
            </div>

            <div className="rounded border border-hairline bg-surface p-4">
              <h3 className="label-section mb-3 text-fail">Danger zone</h3>
              {['clear_vector', 'clear_disk_chunks', 'database_reset'].map((action) => (
                <DoubleBezelCard key={action} variant="danger">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-label font-semibold text-ink">{ACTION_LABEL[action as MaintAction]}</span>
                      <p className="mt-0.5 text-micro text-muted">Irreversible. Requires typed DELETE challenge.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setMaintAction(action as MaintAction); setMaintOpen(true); }}
                      className="rounded-sm px-3 py-1.5 text-xs font-bold text-fail bg-faint border border-fail/30 hover:bg-fail-wash transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                    >
                      Delete
                    </button>
                  </div>
                </DoubleBezelCard>
              ))}
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.postMaintenanceExecute(tenantId, 'reindex', '');
                    setSaveSuccess(true);
                    setTimeout(() => setSaveSuccess(false), 2000);
                  } catch (e: unknown) {
                    setSaveError(e instanceof Error ? e.message : 'Reindex failed.');
                  }
                }}
                className="mt-4 text-label font-semibold text-accent-ink hover:text-accent underline underline-offset-4"
              >
                Reindex corpus
              </button>
            </div>
          </section>

          {/* Appearance & Themes */}
          <section id="panel-appearance" role="tabpanel" aria-labelledby="tab-appearance" className="space-y-4">
            <div>
              <label className="label-section mb-2 block text-muted">Theme</label>
              <ThemeSwatchGrid themes={AP_THEMES} selected={appearance.theme as APTheme} onSelect={applyThemeLive} />
            </div>
            <div>
              <label className="label-section mb-1.5 block text-muted">Display scale</label>
              <div className="flex items-center gap-3">
                <SliderReadout value={appearance.display_scale ?? 1.0} min={0.8} max={1.5} step={0.1} unit="" label="" onChange={(v) => setAppearance((p) => ({ ...p, display_scale: v }))} />
                <div className="flex items-end">
                  <span className="id-mono text-ink">Aa</span>
                </div>
                <span className="text-micro text-muted ml-2">{((appearance.display_scale ?? 1.0) * 100).toFixed(0)}%</span>
              </div>
              <div className="mt-2 text-micro text-muted">
                Applies live via CSS variable. Preview:{' '}
                <span className="id-mono text-ink" style={{ transform: `scale(${appearance.display_scale ?? 1.0})`, display: 'inline-block' }}>Aa sample</span>
              </div>
            </div>
          </section>
        </div>

        {/* save feedback */}
        {saveSuccess && (
          <div role="alert" aria-live="polite" className="mb-4 flex items-center gap-2 rounded-sm border border-hairline bg-ok-wash px-3 py-2 text-label font-semibold text-ok">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
            <span>Settings saved successfully.</span>
          </div>
        )}
        {saveError && (
          <div role="alert" aria-live="polite" className="mb-4 flex items-start gap-2 rounded-sm border border-hairline bg-fail-wash px-3 py-2 text-label font-semibold text-fail">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{saveError}</span>
          </div>
        )}

        {/* footer */}
        <div className="mt-8 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-sm border border-hairline bg-surface px-4 py-1.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-sunken disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || saveSuccess}
            className="flex cursor-pointer items-center gap-1.5 rounded-sm px-5 py-1.5 text-label font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent bg-accent hover:bg-accent-ink"
          >
            {saving ? (
              <>
                <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save & Apply</span>
            )}
          </button>
        </div>

        {maintOpen && <MaintenanceConfirm open action={maintAction} onConfirm={loadAll} onCancel={() => setMaintOpen(false)} />}
      </div>
    </div>
  );
}

/* small icon placeholders used above to avoid new deps */
const ActivityIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
);
const RadioIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
);

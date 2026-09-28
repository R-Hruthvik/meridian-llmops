import React, { useEffect, useState } from 'react';
import { Bot, Crosshair, Database, ShieldAlert, Settings, Zap } from 'lucide-react';
import { SettingsModal } from './SettingsModal';
import { StatusChip, type StatusChipVariant } from './StatusChip';
import { api } from '../services/api';
import type { BackendHealth } from '../App';
import type { LLMSettings } from '../types/api';

/** The three primary lenses (§6). Everything else is an overlay destination. */
export type LensId = 'ask' | 'corpus' | 'operate';

const LENSES: readonly { id: LensId; label: string; icon: React.ElementType }[] = [
  { id: 'ask', label: 'Ask', icon: Bot },
  { id: 'corpus', label: 'Corpus', icon: Database },
  { id: 'operate', label: 'Operate', icon: ShieldAlert },
];

const HEALTH_LABEL: Record<BackendHealth, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
};

const HEALTH_VARIANT: Record<BackendHealth, StatusChipVariant> = {
  online: 'ok',
  degraded: 'warn',
  offline: 'fail',
};

interface TopBarProps {
  tenantId: string;
  setTenantId: (tenant: string) => void;
  backendHealth: BackendHealth;
  apiKey: string;
  setApiKey: (key: string) => void;
}

/**
 * The 56px top bar (§6): one line, hairline bottom, never wrapping. It carries
 * the whole global context — brand, tenant, serving provider and model, backend
 * health and the settings opener — so nothing else has to.
 */
export const TopBar: React.FC<TopBarProps> = ({
  tenantId,
  setTenantId,
  backendHealth,
  apiKey,
  setApiKey,
}) => {
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LLMSettings | null>(null);
  const [localTenant, setLocalTenant] = useState(tenantId);

  // Sync local tenant when parent prop changes
  useEffect(() => {
    setLocalTenant(tenantId);
  }, [tenantId]);

  // Debounce tenantId changes before propagating up
  useEffect(() => {
    const handler = setTimeout(() => {
      if (localTenant !== tenantId) {
        setTenantId(localTenant);
      }
    }, 300);
    return () => clearTimeout(handler);
  }, [localTenant, tenantId, setTenantId]);

  const fetchSettings = () => {
    api.getLLMSettings()
      .then((s) => setLlmSettings(s))
      .catch(() => {});
  };

  useEffect(() => {
    fetchSettings();
  }, [showSettingsModal]);

  return (
    <header
      data-slot="top-bar"
      className="flex h-14 shrink-0 flex-nowrap items-center gap-3 overflow-x-auto whitespace-nowrap border-b border-hairline bg-surface-raised px-3"
    >
      {/* Brand mark + wordmark */}
      <div className="flex shrink-0 items-center gap-2 pr-1">
        <Crosshair className="size-4 text-accent" aria-hidden="true" />
        <span className="text-body font-bold tracking-tight text-ink">Meridian</span>
        <span className="label-section text-faint">Workbench</span>
      </div>

      <div className="shrink-0 self-stretch w-px bg-hairline" aria-hidden="true" />

      {/* Tenant switcher — a text well, not a labelled cluster */}
      <label className="flex shrink-0 items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2 py-1 focus-within:border-accent">
        <span className="label-section text-faint">Tenant</span>
        <input
          type="text"
          value={localTenant}
          onChange={(e) => setLocalTenant(e.target.value)}
          className="id-mono w-24 rounded-sm bg-transparent text-ink outline-none placeholder:text-faint"
          placeholder="tenant_id"
          aria-label="Tenant Identifier"
        />
      </label>

      <div className="shrink-0 self-stretch w-px bg-hairline" aria-hidden="true" />

      {/* Active provider + model — a readout, not a second settings opener */}
      <div
        className="flex shrink-0 items-center gap-1.5"
        title="Active provider and model configuration"
      >
        <Zap className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
        <span className="text-label font-semibold capitalize text-ink">
          {llmSettings?.active_provider || 'OpenAI'}
        </span>
        <span className="text-faint" aria-hidden="true">
          ·
        </span>
        <span className="num text-label font-semibold text-accent-ink">
          {llmSettings?.default_model || 'gpt-4o-mini'}
        </span>
      </div>

      <div className="shrink-0 grow" aria-hidden="true" />

      {/* Backend health (driven by the /health services map) */}
      <div role="status" aria-live="polite" className="shrink-0">
        <StatusChip variant={HEALTH_VARIANT[backendHealth]}>
          {HEALTH_LABEL[backendHealth]}
        </StatusChip>
      </div>

      {/* The one settings opener in the shell */}
      <button
        type="button"
        onClick={() => setShowSettingsModal(true)}
        aria-label="Open LLM engine settings"
        title="Open LLM engine settings"
        className="shrink-0 rounded-sm p-1.5 text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <Settings className="size-4" aria-hidden="true" />
      </button>

      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => {
          setShowSettingsModal(false);
          fetchSettings();
        }}
        platformApiKey={apiKey}
        onSavePlatformApiKey={setApiKey}
      />
    </header>
  );
};

interface LensRailProps {
  activeLens: LensId;
  onSelectLens: (lens: LensId) => void;
}

/**
 * The 56px left icon rail (§6). Three lenses, icon plus tooltip, active state in
 * accent-ink on accent-wash. Index & Storage, Guardrails, Review Queue and
 * Metrics are deliberately absent — they are overlay destinations. Below `md`
 * the row becomes a bottom bar.
 */
export const LensRail: React.FC<LensRailProps> = ({ activeLens, onSelectLens }) => (
  <nav
    aria-label="Workbench lenses"
    data-slot="lens-rail"
    className="order-2 flex w-full shrink-0 flex-row items-center justify-around gap-1 border-t border-hairline bg-surface-raised px-2 py-1.5 md:order-none md:h-auto md:w-14 md:flex-col md:justify-start md:border-r md:border-t-0 md:px-0 md:py-2"
  >
    {LENSES.map(({ id, label, icon: Icon }) => {
      const isActive = activeLens === id;
      return (
        <button
          key={id}
          type="button"
          onClick={() => onSelectLens(id)}
          aria-current={isActive ? 'page' : 'false'}
          title={label}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent md:h-12 md:w-12 ${
            isActive
              ? 'bg-accent-wash text-accent-ink'
              : 'text-muted hover:bg-surface-sunken hover:text-ink'
          }`}
        >
          <Icon className="size-5" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </button>
      );
    })}
  </nav>
);

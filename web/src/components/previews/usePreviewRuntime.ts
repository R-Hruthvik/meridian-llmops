import { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import type { LLMSettingsGet, TenantMetrics } from '../../types/api';

export function usePreviewRuntime(enabled: boolean, live = false) {
  const [settings, setSettings] = useState<LLMSettingsGet | null>(null);
  const [metrics, setMetrics] = useState<TenantMetrics | null>(null);
  const [apiStatus, setApiStatus] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle');
  const [settingsError, setSettingsError] = useState('');
  const [metricsError, setMetricsError] = useState('');

  const refresh = useCallback(async () => {
    setApiStatus('loading');
    const [healthResult, metricsResult, settingsResult] = await Promise.allSettled([
      api.checkHealth(),
      api.getMetrics(),
      api.getLLMSettings(),
    ]);

    setApiStatus(healthResult.status === 'fulfilled' && healthResult.value.ready ? 'ready' : 'offline');
    if (metricsResult.status === 'fulfilled') {
      setMetrics(metricsResult.value);
      setMetricsError('');
    } else {
      setMetrics(null);
      setMetricsError('Live metrics are unavailable. Retry to check the API again.');
    }
    if (settingsResult.status === 'fulfilled') {
      setSettings(settingsResult.value);
      setSettingsError('');
    } else {
      setSettings(null);
      setSettingsError('Saved provider settings are unavailable. Retry to load them again.');
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    if (!live) return;
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [enabled, live, refresh]);

  return { settings, metrics, apiStatus, settingsError, metricsError, refresh };
}

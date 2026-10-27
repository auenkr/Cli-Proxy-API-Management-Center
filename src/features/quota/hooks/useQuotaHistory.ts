import { useEffect, useState } from 'react';
import { quotaHistoryApi, type QuotaHistorySample } from '@/services/api/quotaHistory';
import { useAuthStore } from '@/stores/useAuthStore';
import type { TimelineLane } from '../quotaTimelineModel';

/** Read backend-collected history; never record browser observations. */
export function useQuotaHistory(_lanes: TimelineLane[], enabled: boolean) {
  const [samples, setSamples] = useState<QuotaHistorySample[]>([]);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);

  useEffect(() => {
    let active = true;
    let pending = false;
    setSamples([]);
    if (!enabled) return;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const history = await quotaHistoryApi.list();
        if (active) setSamples(history);
      } catch {
        // History is optional; preserve the last successful snapshot.
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, apiBase, managementKey]);

  return samples;
}

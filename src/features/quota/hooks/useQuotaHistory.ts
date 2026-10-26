import { useCallback, useEffect, useRef, useState } from 'react';
import { quotaHistoryApi, type QuotaHistorySample } from '@/services/api/quotaHistory';
import type { TimelineLane } from '../quotaTimelineModel';
import { forecastLanes } from '../quotaForecastModel';

const HISTORY_DAYS = 14;
const RECORD_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Loads backend quota history and records fresh lane observations.
 * `enabled` must be false while disconnected.
 */
export function useQuotaHistory(lanes: TimelineLane[], enabled: boolean) {
  const [samples, setSamples] = useState<QuotaHistorySample[]>([]);
  const recorded = useRef(new Map<string, { at: number; remaining: number }>());

  const load = useCallback(async () => {
    try {
      setSamples(await quotaHistoryApi.list(Date.now() - HISTORY_DAYS * 24 * 3600 * 1000));
    } catch {
      // History is optional; the chart falls back to the current snapshot.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const fresh: QuotaHistorySample[] = [];
    forecastLanes(lanes).forEach((lane) => {
      const key = `${lane.provider}\0${lane.name}`;
      const prev = recorded.current.get(key);
      const remaining = lane.remaining as number;
      if (prev && prev.remaining === remaining && now - prev.at < RECORD_MIN_INTERVAL_MS) return;
      recorded.current.set(key, { at: now, remaining });
      fresh.push({ provider: lane.provider, name: lane.name, at: now, remaining });
    });
    if (fresh.length === 0) return;
    void quotaHistoryApi
      .record(fresh)
      .then(load)
      .catch(() => undefined);
  }, [enabled, lanes, load]);

  return samples;
}

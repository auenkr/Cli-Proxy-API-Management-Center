/** Quota history persisted by the backend (v8 observability API). */

import { apiClient } from './client';

export interface QuotaHistorySample {
  provider: string;
  name: string;
  /** Unix milliseconds. */
  at: number;
  /** Remaining percent, 0..100. */
  remaining: number;
  window?: '5h' | 'weekly';
}

const TIMEOUT_MS = 15 * 1000;

export const quotaHistoryApi = {
  list: async (sinceMs?: number): Promise<QuotaHistorySample[]> => {
    const data = await apiClient.get<{ samples?: QuotaHistorySample[] }>(
      '/observability/quota/history',
      { params: sinceMs ? { since: sinceMs } : undefined, timeout: TIMEOUT_MS }
    );
    return Array.isArray(data?.samples) ? data.samples : [];
  },
};

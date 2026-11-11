/**
 * Quota fetch entry point. The backend caches api-call GETs for 60s per
 * credential; a forced fetch (refresh button) purges that credential's cache
 * first so the upstream is actually called.
 */

import type { TFunction } from 'i18next';
import { apiClient } from '@/services/api/client';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaAdapter } from './providers';

export async function purgeApiCallCache(file: AuthFileItem): Promise<void> {
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) return;
  try {
    await apiClient.delete('/requests/api-call/cache', { params: { auth_index: authIndex } });
  } catch {
    // Older backends lack the endpoint; fall through to a normal fetch.
  }
}

export async function fetchQuota<A extends QuotaAdapter>(
  adapter: A,
  file: AuthFileItem,
  t: TFunction,
  force = false
): Promise<Awaited<ReturnType<A['fetchQuota']>>> {
  if (force) await purgeApiCallCache(file);
  return (await adapter.fetchQuota(file, t)) as Awaited<ReturnType<A['fetchQuota']>>;
}

/**
 * In-memory TTL cache for successful upstream quota fetches. Auto-loads and
 * page revisits reuse a result younger than the TTL so we stop hammering the
 * rate-limited usage endpoints; explicit refreshes pass `force` to bypass it.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaAdapter } from './providers';

export const QUOTA_FETCH_TTL_MS = 60_000;

const cache = new Map<string, { at: number; data: unknown }>();

export async function fetchQuotaCached(
  adapter: QuotaAdapter,
  file: AuthFileItem,
  t: TFunction,
  force = false
): Promise<unknown> {
  const key = `${adapter.type}:${getQuotaCacheKey(file)}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < QUOTA_FETCH_TTL_MS) return hit.data;
  const data = await adapter.fetchQuota(file, t);
  cache.set(key, { at: Date.now(), data });
  return data;
}

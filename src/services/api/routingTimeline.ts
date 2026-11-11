/**
 * Routing timeline: a one-off plan that pins a provider to chosen accounts until a time or a
 * usage limit, after which normal routing resumes. Stored as `routing.timeline` in the config.
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export type QuotaWindow = '5h' | 'weekly';

export interface TimelineAccount {
  id: string;
  provider: string;
  name: string;
  disabled: boolean;
  usage: Partial<Record<QuotaWindow, number>>;
  resets: Partial<Record<QuotaWindow, string>>;
}

export interface TimelineStatus {
  now: string;
  accounts: TimelineAccount[];
  active: Record<string, string[]>;
  protected: string[];
}

export interface TimelineBlock {
  provider: string;
  accounts: string[];
  /** RFC 3339 end time. */
  until: string;
  /** Used percentage that ends the block early; 0 or absent means no limit. */
  max5h: number;
  maxWeekly: number;
}

const readNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

function readBlocks(raw: unknown): TimelineBlock[] {
  const routing = isRecord(raw) ? raw.routing : undefined;
  const list = isRecord(routing) && Array.isArray(routing.timeline) ? routing.timeline : [];
  return list.filter(isRecord).map((entry) => ({
    provider: String(entry.provider ?? '').toLowerCase(),
    accounts: Array.isArray(entry.accounts) ? entry.accounts.map(String) : [],
    until: String(entry.until ?? ''),
    max5h: readNumber(entry['max-5h-usage']),
    maxWeekly: readNumber(entry['max-weekly-usage']),
  }));
}

export const routingTimelineApi = {
  async load(): Promise<{ status: TimelineStatus; blocks: TimelineBlock[] }> {
    const [status, raw] = await Promise.all([
      apiClient.get<TimelineStatus>('/routing/timeline/status'),
      apiClient.get<unknown>('/config'),
    ]);
    return { status, blocks: readBlocks(raw) };
  },

  async save(blocks: TimelineBlock[]): Promise<void> {
    const timeline = blocks.map((block) => ({
      provider: block.provider,
      accounts: block.accounts,
      until: block.until,
      ...(block.max5h > 0 ? { 'max-5h-usage': block.max5h } : {}),
      ...(block.maxWeekly > 0 ? { 'max-weekly-usage': block.maxWeekly } : {}),
    }));
    await apiClient.patch('/config', { routing: { timeline } });
  },
};

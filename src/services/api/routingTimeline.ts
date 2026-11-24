import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export type QuotaWindow = '5h' | 'weekly';
export type TimelineStrategy = '' | 'round-robin' | 'fill-first';

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
  protected: string[] | null;
}

export interface WeeklyWindow {
  days: number[];
  start: string;
  end: string;
  timeZone: string;
}

export interface TimelineBlock {
  provider: string;
  accounts: string[];
  until: string;
  weekly?: WeeklyWindow;
  strategy: TimelineStrategy;
  max5h: number;
  maxWeekly: number;
}

const readNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

export function readTimelineBlocks(raw: unknown): TimelineBlock[] {
  const routing = isRecord(raw) ? raw.routing : undefined;
  const list = isRecord(routing) && Array.isArray(routing.timeline) ? routing.timeline : [];
  return list.filter(isRecord).map((entry) => {
    const weekly = isRecord(entry.weekly) ? entry.weekly : undefined;
    return {
      provider: String(entry.provider ?? '').toLowerCase(),
      accounts: Array.isArray(entry.accounts) ? entry.accounts.map(String) : [],
      until: String(entry.until ?? ''),
      strategy:
        entry.strategy === 'round-robin' || entry.strategy === 'fill-first' ? entry.strategy : '',
      max5h: readNumber(entry['max-5h-usage']),
      maxWeekly: readNumber(entry['max-weekly-usage']),
      ...(weekly && {
        weekly: {
          days: Array.isArray(weekly.days)
            ? weekly.days.filter((day) => typeof day === 'number')
            : [],
          start: String(weekly.start ?? ''),
          end: String(weekly.end ?? ''),
          timeZone: String(weekly['time-zone'] ?? ''),
        },
      }),
    };
  });
}

export function writeTimelineBlocks(blocks: TimelineBlock[]) {
  return blocks.map((block) => ({
    provider: block.provider,
    accounts: block.accounts,
    ...(block.weekly
      ? {
          weekly: {
            days: block.weekly.days,
            start: block.weekly.start,
            end: block.weekly.end,
            'time-zone': block.weekly.timeZone,
          },
        }
      : { until: block.until }),
    ...(block.strategy ? { strategy: block.strategy } : {}),
    ...(block.max5h > 0 ? { 'max-5h-usage': block.max5h } : {}),
    ...(block.maxWeekly > 0 ? { 'max-weekly-usage': block.maxWeekly } : {}),
  }));
}

export const routingTimelineApi = {
  status: () => apiClient.get<TimelineStatus>('/routing/timeline/status'),

  async load(): Promise<{
    status: TimelineStatus;
    blocks: TimelineBlock[];
    paused: boolean;
    etag?: string;
  }> {
    const [status, response] = await Promise.all([
      routingTimelineApi.status(),
      apiClient.getRaw('/config'),
    ]);
    const etag = response.headers.etag;
    const routing = isRecord(response.data) ? response.data.routing : undefined;
    return {
      status,
      blocks: readTimelineBlocks(response.data),
      paused: isRecord(routing) && routing['timeline-paused'] === true,
      etag: typeof etag === 'string' ? etag : undefined,
    };
  },

  async save(blocks: TimelineBlock[], etag?: string): Promise<void> {
    await apiClient.patch(
      '/config',
      { routing: { timeline: writeTimelineBlocks(blocks) } },
      etag ? { headers: { 'If-Match': etag } } : undefined
    );
  },

  async setPaused(paused: boolean, etag?: string): Promise<string | undefined> {
    const response = await apiClient.patchRaw(
      '/config',
      { routing: { 'timeline-paused': paused } },
      etag ? { headers: { 'If-Match': etag } } : undefined
    );
    return typeof response.headers.etag === 'string' ? response.headers.etag : undefined;
  },
};

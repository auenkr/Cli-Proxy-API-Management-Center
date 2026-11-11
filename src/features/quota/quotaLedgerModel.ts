/**
 * Ledger view model: every quota limit of a credential as one flat list of
 * `{ id, label, remaining, resetAtMs }`, read structurally per provider (same
 * shapes as `buildTimelineLane`). Pure and clock-free.
 */

import type { QuotaProviderType } from './providers/types';

export interface LedgerLimit {
  /** Stable column id within one provider group. */
  id: string;
  /** Already-resolved label, or an i18n key when `labelKey` is set. */
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  /** Remaining percent, 0..100. */
  remaining: number;
  resetAtMs: number | null;
}

interface WindowLike {
  id?: string;
  label?: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent?: number | null;
  remainingPercent?: number | null;
  resetAtMs?: number | null;
}

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const resetOf = (value: unknown) => (finite(value) ? value : null);

export function buildLedgerLimits(
  provider: QuotaProviderType,
  quota: { status?: string } | undefined
): LedgerLimit[] {
  if (!quota || quota.status !== 'success') return [];

  if (provider === 'claude' || provider === 'codex' || provider === 'devin') {
    const windows = (quota as { windows?: WindowLike[] }).windows ?? [];
    return windows.flatMap((window, index): LedgerLimit[] => {
      const remaining = finite(window.usedPercent)
        ? clamp(100 - window.usedPercent)
        : finite(window.remainingPercent)
          ? clamp(window.remainingPercent)
          : null;
      if (remaining === null) return [];
      return [
        {
          id: window.id ?? `w${index}`,
          label: window.label ?? window.id ?? '',
          labelKey:
            window.labelKey ?? (provider === 'devin' ? `devin_quota.${window.id}` : undefined),
          labelParams: window.labelParams,
          remaining,
          resetAtMs: resetOf(window.resetAtMs),
        },
      ];
    });
  }

  if (provider === 'xai') {
    const billing = (
      quota as { billing?: { usagePercent?: number | null; resetAtMs?: number | null } | null }
    ).billing;
    if (!billing || !finite(billing.usagePercent)) return [];
    return [
      {
        id: 'billing',
        label: 'Usage',
        remaining: clamp(100 - billing.usagePercent),
        resetAtMs: resetOf(billing.resetAtMs),
      },
    ];
  }

  if (provider === 'antigravity' || provider === 'plugin') {
    const groups =
      (
        quota as {
          groups?: {
            id?: string;
            label?: string;
            buckets?: {
              id?: string;
              label?: string;
              remainingFraction?: number | null;
              resetAtMs?: number | null;
            }[];
          }[];
        }
      ).groups ?? [];
    return groups.flatMap((group, groupIndex) =>
      (group.buckets ?? []).flatMap((bucket, index): LedgerLimit[] => {
        if (!finite(bucket.remainingFraction)) return [];
        return [
          {
            id: `${group.id ?? groupIndex}:${bucket.id ?? bucket.label ?? index}`,
            label: [group.label, bucket.label].filter(Boolean).join(' · '),
            remaining: clamp(Math.round(bucket.remainingFraction * 100)),
            resetAtMs: resetOf(bucket.resetAtMs),
          },
        ];
      })
    );
  }

  if (provider === 'kimi') {
    const rows =
      (
        quota as {
          rows?: {
            id?: string;
            label?: string;
            labelKey?: string;
            labelParams?: Record<string, string | number>;
            used: number;
            limit: number;
            resetAtMs?: number | null;
          }[];
        }
      ).rows ?? [];
    return rows.flatMap((row, index): LedgerLimit[] => {
      if (!(row.limit > 0)) return [];
      return [
        {
          id: row.id ?? row.labelKey ?? row.label ?? `r${index}`,
          label: row.label ?? '',
          labelKey: row.labelKey,
          labelParams: row.labelParams,
          remaining: clamp(Math.round(((row.limit - row.used) / row.limit) * 100)),
          resetAtMs: resetOf(row.resetAtMs),
        },
      ];
    });
  }

  if (provider === 'meta') {
    const windows =
      (
        quota as {
          data?: { windows?: { id: string; usedPercent: number | null; resetAt?: number }[] };
        }
      ).data?.windows ?? [];
    return windows.flatMap((window): LedgerLimit[] => {
      if (!finite(window.usedPercent)) return [];
      return [
        {
          id: window.id,
          label: window.id,
          labelKey: `meta_quota.${window.id}`,
          remaining: clamp(100 - window.usedPercent),
          resetAtMs: finite(window.resetAt) ? window.resetAt * 1000 : null,
        },
      ];
    });
  }

  return [];
}

/** Ordered union of limit columns across a group's credentials, capped. */
export function ledgerColumns(
  rows: LedgerLimit[][],
  max = 3
): Pick<LedgerLimit, 'id' | 'label' | 'labelKey' | 'labelParams'>[] {
  const seen = new Map<string, { col: LedgerLimit; count: number; order: number }>();
  rows.forEach((limits) =>
    limits.forEach((limit) => {
      const hit = seen.get(limit.id);
      if (hit) hit.count += 1;
      else seen.set(limit.id, { col: limit, count: 1, order: seen.size });
    })
  );
  // Prefer the limits most credentials share, keep original order among them.
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .slice(0, max)
    .sort((a, b) => a.order - b.order)
    .map(({ col }) => ({
      id: col.id,
      label: col.label,
      labelKey: col.labelKey,
      labelParams: col.labelParams,
    }));
}

/** `19h 12m`, `2d 0h`, `7m` — compact countdown. */
export function formatCountdown(targetMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((targetMs - nowMs) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

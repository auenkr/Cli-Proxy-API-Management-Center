/**
 * Routing timeline: look at each account's usage, stack blocks of "use these accounts until a
 * time or a usage limit", and save. When the last block ends, normal routing resumes.
 *
 * Blocks are kept per provider in order. A block starts when the previous one ends (by time or
 * by usage), so the editor only asks for an end. The same rule runs in the backend scheduler.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
  routingTimelineApi,
  type QuotaWindow,
  type TimelineAccount,
  type TimelineBlock,
  type TimelineStatus,
} from '@/services/api/routingTimeline';
import { useNotificationStore } from '@/stores';
import styles from './TimelinePage.module.scss';

const DEFAULT_MAX_5H = 85;
const DEFAULT_MAX_WEEKLY = 90;
const HOUR = 3_600_000;

type DraftBlock = TimelineBlock & { key: number };
type BlockState = 'active' | 'upcoming' | 'limit' | 'ended';

let blockSequence = 0;
const withKey = (block: TimelineBlock): DraftBlock => ({ ...block, key: ++blockSequence });

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return date.toLocaleString(undefined, {
    weekday: sameDay ? undefined : 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatIn = (ms: number): string => {
  if (ms <= 0) return '0m';
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${rest}m`;
  return `${rest}m`;
};

/** Value for <input type="datetime-local"> in local time. */
const toLocalInput = (iso: string): string => {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const overLimit = (account: TimelineAccount | undefined, block: TimelineBlock): boolean => {
  if (!account) return false;
  const used5h = account.usage['5h'];
  const usedWeekly = account.usage.weekly;
  return (
    (block.max5h > 0 && used5h !== undefined && used5h >= block.max5h) ||
    (block.maxWeekly > 0 && usedWeekly !== undefined && usedWeekly >= block.maxWeekly)
  );
};

/** Mirrors the backend: first unexpired block with an account under its limits is active. */
function blockStates(
  blocks: readonly DraftBlock[],
  accounts: Map<string, TimelineAccount>,
  now: number
): BlockState[] {
  let claimed = false;
  return blocks.map((block) => {
    if (Date.parse(block.until) <= now) return 'ended';
    const usable = block.accounts.some((id) => !overLimit(accounts.get(id), block));
    if (!usable) return 'limit';
    if (claimed) return 'upcoming';
    claimed = true;
    return 'active';
  });
}

function UsageBar({
  label,
  used,
  reset,
  now,
}: {
  label: string;
  used?: number;
  reset?: string;
  now: number;
}) {
  const known = used !== undefined;
  const value = known ? Math.min(100, Math.max(0, used)) : 0;
  const tone = value >= 85 ? styles.barHigh : value >= 60 ? styles.barMedium : styles.barLow;
  return (
    <div className={styles.usage}>
      <div className={styles.usageHead}>
        <span>{label}</span>
        <span className={styles.usageValue}>{known ? `${Math.round(value)}%` : '—'}</span>
      </div>
      <div className={styles.bar}>
        <div className={`${styles.barFill} ${tone}`} style={{ width: `${value}%` }} />
      </div>
      {reset && <div className={styles.usageReset}>↻ {formatIn(Date.parse(reset) - now)}</div>}
    </div>
  );
}

export function TimelinePage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [status, setStatus] = useState<TimelineStatus | null>(null);
  const [saved, setSaved] = useState<DraftBlock[]>([]);
  const [draft, setDraft] = useState<DraftBlock[]>([]);
  const [provider, setProvider] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await routingTimelineApi.load();
      const blocks = result.blocks.map(withKey);
      setStatus(result.status);
      setSaved(blocks);
      setDraft(blocks);
      setNow(Date.now());
    } catch (error) {
      showNotification(
        t('timeline.load_failed', { message: error instanceof Error ? error.message : '' }),
        'error'
      );
    } finally {
      setLoading(false);
    }
  }, [showNotification, t]);

  useEffect(() => {
    void load();
  }, [load]);
  useHeaderRefresh(load);

  // Keep relative times and block states fresh without refetching.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const accountsById = useMemo(
    () => new Map((status?.accounts ?? []).map((account) => [account.id, account])),
    [status]
  );

  const providers = useMemo(() => {
    const set = new Set((status?.accounts ?? []).filter((a) => !a.disabled).map((a) => a.provider));
    return [...set].sort();
  }, [status]);

  const current = provider && providers.includes(provider) ? provider : (providers[0] ?? '');
  const providerAccounts = useMemo(
    () => (status?.accounts ?? []).filter((a) => a.provider === current && !a.disabled),
    [status, current]
  );
  const blocks = draft.filter((block) => block.provider === current);
  const states = blockStates(blocks, accountsById, now);

  const dirty =
    JSON.stringify(draft.map(({ key: _k, ...b }) => b)) !==
    JSON.stringify(saved.map(({ key: _k, ...b }) => b));

  const { allowNextNavigation } = useUnsavedChangesGuard({
    shouldBlock: dirty,
    dialog: {
      title: t('timeline.unsaved_title'),
      message: t('timeline.unsaved_message'),
      confirmText: t('timeline.unsaved_leave'),
      cancelText: t('timeline.unsaved_stay'),
      variant: 'danger',
    },
  });

  /** When a block starts: the previous block's end, or now. */
  const startOf = (index: number): number =>
    Math.max(now, index > 0 ? Date.parse(blocks[index - 1].until) : now);

  const resetAfter = (
    ids: readonly string[],
    window: QuotaWindow,
    after: number
  ): number | null => {
    const times = ids
      .map((id) => accountsById.get(id)?.resets[window])
      .filter((iso): iso is string => Boolean(iso))
      .map((iso) => Date.parse(iso))
      .filter((at) => at > after);
    return times.length ? Math.min(...times) : null;
  };

  const updateBlock = (key: number, patch: Partial<TimelineBlock>) =>
    setDraft((list) => list.map((block) => (block.key === key ? { ...block, ...patch } : block)));

  const removeBlock = (key: number) =>
    setDraft((list) => list.filter((block) => block.key !== key));

  const moveBlock = (key: number, direction: -1 | 1) =>
    setDraft((list) => {
      const own = list.filter((block) => block.provider === current);
      const index = own.findIndex((block) => block.key === key);
      const target = own[index + direction];
      if (!target) return list;
      // Swap the order but keep the slot end times, so the timeline stays chronological.
      const a = own[index];
      return list.map((block) => {
        if (block.key === a.key) return { ...target, until: a.until };
        if (block.key === target.key) return { ...a, until: target.until };
        return block;
      });
    });

  const addBlock = (accountId?: string) => {
    const start = blocks.length ? Math.max(now, Date.parse(blocks[blocks.length - 1].until)) : now;
    const previous = new Set(blocks[blocks.length - 1]?.accounts ?? []);
    const pick =
      accountId ??
      [...providerAccounts]
        .sort((a, b) => (a.usage['5h'] ?? 0) - (b.usage['5h'] ?? 0))
        .find((account) => !previous.has(account.id))?.id ??
      providerAccounts[0]?.id;
    if (!pick) return;
    const end = resetAfter([pick], '5h', start) ?? start + 3 * HOUR;
    setDraft((list) => [
      ...list,
      withKey({
        provider: current,
        accounts: [pick],
        until: new Date(end).toISOString(),
        max5h: DEFAULT_MAX_5H,
        maxWeekly: DEFAULT_MAX_WEEKLY,
      }),
    ]);
  };

  const save = async () => {
    setSaving(true);
    try {
      // Ended blocks have no effect; drop them so the config stays small.
      const live = draft.filter((block) => Date.parse(block.until) > Date.now());
      await routingTimelineApi.save(live.map(({ key: _k, ...block }) => block));
      showNotification(t('timeline.saved'), 'success');
      allowNextNavigation();
      await load();
    } catch (error) {
      showNotification(
        t('timeline.save_failed', { message: error instanceof Error ? error.message : '' }),
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const activeIds = new Set(status?.active[current] ?? []);
  const heldIds = new Set(status?.protected ?? []);
  const lastEnd = blocks.length ? Math.max(...blocks.map((b) => Date.parse(b.until))) : now;
  const span = Math.max(lastEnd - now, HOUR);
  const activeIndex = states.indexOf('active');

  const summary =
    activeIndex >= 0 && !dirty
      ? t('timeline.summary_active', {
          accounts: blocks[activeIndex].accounts
            .map((id) => accountsById.get(id)?.name ?? id)
            .join(', '),
          time: formatTime(blocks[activeIndex].until),
        })
      : t('timeline.summary_normal');

  if (loading && !status) {
    return <div className={styles.page}>{t('common.loading')}</div>;
  }

  if (!providers.length) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{t('timeline.title')}</h1>
        <EmptyState
          title={t('timeline.no_accounts')}
          description={t('timeline.no_accounts_hint')}
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{t('timeline.title')}</h1>
          <p className={styles.subtitle}>{t('timeline.subtitle')}</p>
        </div>
        <div className={styles.headerActions}>
          {draft.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setDraft([])}>
              {t('timeline.clear_all')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={!dirty || saving}
            onClick={() => setDraft(saved)}
          >
            {t('timeline.discard')}
          </Button>
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? t('timeline.saving') : t('timeline.save')}
          </Button>
        </div>
      </header>

      <nav className={styles.tabs} role="tablist">
        {providers.map((name) => {
          const count = draft.filter(
            (b) => b.provider === name && Date.parse(b.until) > now
          ).length;
          return (
            <button
              key={name}
              role="tab"
              aria-selected={name === current}
              className={`${styles.tab} ${name === current ? styles.tabActive : ''}`}
              onClick={() => setProvider(name)}
            >
              {name}
              {count > 0 && <span className={styles.tabCount}>{count}</span>}
            </button>
          );
        })}
      </nav>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('timeline.accounts_title')}</h2>
        <div className={styles.accounts}>
          {providerAccounts.map((account) => (
            <div key={account.id} className={styles.account}>
              <div className={styles.accountHead}>
                <span className={styles.accountName} title={account.id}>
                  {account.name}
                </span>
                {activeIds.has(account.id) && !dirty && (
                  <span className={`${styles.pill} ${styles.pillActive}`}>
                    {t('timeline.routing_now')}
                  </span>
                )}
                {heldIds.has(account.id) && (
                  <span className={`${styles.pill} ${styles.pillHeld}`}>{t('timeline.held')}</span>
                )}
              </div>
              <UsageBar
                label="5h"
                used={account.usage['5h']}
                reset={account.resets['5h']}
                now={now}
              />
              <UsageBar
                label={t('timeline.weekly')}
                used={account.usage.weekly}
                reset={account.resets.weekly}
                now={now}
              />
              <Button variant="ghost" size="sm" onClick={() => addBlock(account.id)}>
                {t('timeline.use_next')}
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('timeline.plan_title')}</h2>
          <span className={styles.summary}>{summary}</span>
        </div>

        <div className={styles.track} aria-hidden>
          {blocks.map((block, index) => {
            const start = startOf(index);
            const end = Date.parse(block.until);
            const width = Math.max(0, ((end - start) / span) * 100);
            if (width <= 0) return null;
            return (
              <div
                key={block.key}
                className={`${styles.segment} ${styles[`seg_${states[index]}`]}`}
                style={{ width: `${width}%` }}
                title={`${formatTime(new Date(start).toISOString())} → ${formatTime(block.until)}`}
              >
                {block.accounts.map((id) => accountsById.get(id)?.name ?? id).join(', ')}
              </div>
            );
          })}
          <div className={styles.segmentNormal}>{t('timeline.normal')}</div>
        </div>
        <div className={styles.trackAxis}>
          <span>{t('timeline.now')}</span>
          {blocks.length > 0 && <span>{formatTime(new Date(lastEnd).toISOString())}</span>}
        </div>

        {blocks.length === 0 && <p className={styles.empty}>{t('timeline.empty')}</p>}

        <ol className={styles.blocks}>
          {blocks.map((block, index) => {
            const start = startOf(index);
            const end = Date.parse(block.until);
            const reset5h = resetAfter(block.accounts, '5h', start);
            const resetWeekly = resetAfter(block.accounts, 'weekly', start);
            const presets: { label: string; at: number | null }[] = [
              { label: '1h', at: start + HOUR },
              { label: '3h', at: start + 3 * HOUR },
              { label: t('timeline.until_5h_reset'), at: reset5h },
              { label: t('timeline.until_weekly_reset'), at: resetWeekly },
            ];
            const invalid = end <= start && states[index] !== 'ended';
            return (
              <li key={block.key} className={`${styles.block} ${styles[`block_${states[index]}`]}`}>
                <div className={styles.blockHead}>
                  <span className={styles.blockIndex}>{index + 1}</span>
                  <span className={`${styles.pill} ${styles[`pill_${states[index]}`]}`}>
                    {t(`timeline.state_${states[index]}`)}
                  </span>
                  <span className={styles.blockWhen}>
                    {formatTime(new Date(start).toISOString())} → {formatTime(block.until)}
                    <span className={styles.muted}> · {formatIn(end - Math.max(start, now))}</span>
                  </span>
                  <span className={styles.blockTools}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => moveBlock(block.key, -1)}
                      aria-label={t('timeline.move_up')}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={index === blocks.length - 1}
                      onClick={() => moveBlock(block.key, 1)}
                      aria-label={t('timeline.move_down')}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeBlock(block.key)}
                      aria-label={t('timeline.remove')}
                    >
                      ✕
                    </Button>
                  </span>
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t('timeline.use_accounts')}</span>
                  <div className={styles.chips}>
                    {providerAccounts.map((account) => {
                      const on = block.accounts.includes(account.id);
                      return (
                        <button
                          key={account.id}
                          type="button"
                          className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                          aria-pressed={on}
                          onClick={() => {
                            const next = on
                              ? block.accounts.filter((id) => id !== account.id)
                              : [...block.accounts, account.id];
                            if (next.length) updateBlock(block.key, { accounts: next });
                          }}
                        >
                          {account.name}
                          <span className={styles.chipMeta}>
                            {account.usage['5h'] !== undefined
                              ? `${Math.round(account.usage['5h'])}%`
                              : '—'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t('timeline.ends_at')}</span>
                  <div className={styles.chips}>
                    {presets.map((preset) => {
                      const on = preset.at !== null && Math.abs(preset.at - end) < 60_000;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          disabled={preset.at === null}
                          className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                          onClick={() =>
                            preset.at !== null &&
                            updateBlock(block.key, { until: new Date(preset.at).toISOString() })
                          }
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                    <input
                      type="datetime-local"
                      className={styles.dateInput}
                      value={toLocalInput(block.until)}
                      onChange={(event) => {
                        const at = Date.parse(event.target.value);
                        if (!Number.isNaN(at))
                          updateBlock(block.key, { until: new Date(at).toISOString() });
                      }}
                    />
                  </div>
                  {invalid && (
                    <span className={styles.error}>{t('timeline.ends_before_start')}</span>
                  )}
                </div>

                <div className={styles.field}>
                  <span className={styles.fieldLabel}>{t('timeline.or_when_usage')}</span>
                  <div className={styles.limits}>
                    {(
                      [
                        ['max5h', '5h'],
                        ['maxWeekly', t('timeline.weekly')],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field} className={styles.limit}>
                        <span>{label} ≥</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          placeholder={t('timeline.off')}
                          value={block[field] || ''}
                          onChange={(event) =>
                            updateBlock(block.key, {
                              [field]: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
                            })
                          }
                        />
                        <span>%</span>
                      </label>
                    ))}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className={styles.addRow}>
          <Button variant="secondary" onClick={() => addBlock()}>
            + {t('timeline.add_block')}
          </Button>
          <span className={styles.muted}>{t('timeline.after_plan')}</span>
        </div>
      </section>
    </div>
  );
}

export default TimelinePage;

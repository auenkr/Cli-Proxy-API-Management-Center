import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
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
import { apiClient } from '@/services/api/client';
import { useConfigStore, useNotificationStore } from '@/stores';
import styles from './TimelinePage.module.scss';
import { WeeklyFields } from './WeeklyFields';
import {
  WEEK,
  weekday,
  validWeekly,
  nextWeeklyWindow,
  carriesIntoDay,
  coversWeekday,
  weekdayAt,
} from './weeklyWindow';
import { AccountFields } from './AccountFields';

const DEFAULT_MAX_5H = 85;
const DEFAULT_MAX_WEEKLY = 90;
const HOUR = 3_600_000;

type DraftBlock = TimelineBlock & { key: number };
type BlockState = 'active' | 'upcoming' | 'limit' | 'ended';

const ACCOUNT_DRAG = 'application/x-cliproxy-timeline-account';

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
  if (!Number.isFinite(date.getTime())) return '';
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
  now: number,
  paused: boolean
): BlockState[] {
  const live = blocks.filter((block) => Date.parse(block.until) > now);
  const held = new Set(
    live.flatMap((block) => block.accounts.filter((id) => overLimit(accounts.get(id), block)))
  );
  let claimed = false;
  return blocks.map((block) => {
    if (!(Date.parse(block.until) > now)) return 'ended';
    if (paused) return 'upcoming';
    const usable = block.accounts.some((id) => !held.has(id));
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
  const { t } = useTranslation();
  const known = used !== undefined;
  // Show the remaining share, matching the Quota page.
  const value = known ? 100 - Math.min(100, Math.max(0, used)) : 0;
  const tone = value <= 15 ? styles.barHigh : value <= 40 ? styles.barMedium : styles.barLow;
  return (
    <div className={styles.usage}>
      <div className={styles.usageHead}>
        <span>{label}</span>
        <span className={styles.usageValue}>
          {known ? t('timeline.left', { value: Math.round(value) }) : '—'}
        </span>
      </div>
      <div className={styles.bar}>
        <div className={`${styles.barFill} ${tone}`} style={{ width: `${value}%` }} />
      </div>
      {reset && <div className={styles.usageReset}>↻ {formatIn(Date.parse(reset) - now)}</div>}
    </div>
  );
}

export function TimelinePage() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [status, setStatus] = useState<TimelineStatus | null>(null);
  const [paused, setPaused] = useState(false);
  const [saved, setSaved] = useState<DraftBlock[]>([]);
  const [draft, setDraft] = useState<DraftBlock[]>([]);
  const [provider, setProvider] = useState('');
  const [view, setView] = useState<'weekly' | 'once'>('weekly');
  const [day, setDay] = useState<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const loaded = useRef(false);
  const etag = useRef<string | undefined>(undefined);
  const latestLoad = useRef({ id: 0 });
  const clearConfigCache = useConfigStore((state) => state.clearCache);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const load = useCallback(
    async (statusOnly = false) => {
      const request = ++latestLoad.current.id;
      const revision = apiClient.getConnectionRevision();
      const isCurrent = () =>
        request === latestLoad.current.id && revision === apiClient.getConnectionRevision();
      setLoading(true);
      try {
        if (statusOnly) {
          const next = await routingTimelineApi.status();
          if (isCurrent()) setStatus(next);
        } else {
          const result = await routingTimelineApi.load();
          if (!isCurrent()) return;
          const blocks = result.blocks.map(withKey);
          if (!loaded.current && blocks.length && !blocks.some((block) => block.weekly)) {
            setView('once');
          }
          loaded.current = true;
          etag.current = result.etag;
          setStatus(result.status);
          setPaused(result.paused);
          setSaved(blocks);
          setDraft(blocks);
        }
        if (isCurrent()) setNow(Date.now());
      } catch (error) {
        if (!isCurrent()) return;
        showNotification(
          tRef.current('timeline.load_failed', {
            message: error instanceof Error ? error.message : '',
          }),
          'error'
        );
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [showNotification]
  );

  useEffect(() => {
    const sequence = latestLoad.current;
    void load();
    return () => {
      sequence.id++;
    };
  }, [load]);

  useEffect(() => {
    if (loading || saving || !loaded.current) return;
    let active = true;
    const revision = apiClient.getConnectionRevision();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState !== 'visible') return;
      void routingTimelineApi
        .status()
        .then((next) => {
          if (active && revision === apiClient.getConnectionRevision()) setStatus(next);
        })
        .catch(() => {});
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [loading, saving]);

  const accountsById = useMemo(
    () => new Map((status?.accounts ?? []).map((account) => [account.id, account])),
    [status]
  );

  const providers = useMemo(() => {
    const set = new Set([
      ...(status?.accounts ?? []).map((a) => a.provider),
      ...draft.map((b) => b.provider),
    ]);
    return [...set].sort();
  }, [status, draft]);

  const current = provider && providers.includes(provider) ? provider : (providers[0] ?? '');
  const providerAccounts = useMemo(
    () => (status?.accounts ?? []).filter((a) => a.provider === current),
    [status, current]
  );
  const eligibleAccounts = providerAccounts.filter((account) => !account.disabled);
  const blocks = draft.filter(
    (block) => block.provider === current && !!block.weekly === (view === 'weekly')
  );
  const states = view === 'once' ? blockStates(blocks, accountsById, now, paused) : [];
  const visibleBlocks = blocks.filter(
    (block) => day === null || (block.weekly && coversWeekday(block.weekly, day))
  );
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const zones = new Set(
    blocks.flatMap((block) =>
      block.weekly && validWeekly(block.weekly) ? [block.weekly.timeZone] : []
    )
  );
  const sharedZone = zones.size === 1 ? [...zones][0] : undefined;
  const today = weekdayAt(now, sharedZone ?? localZone);

  const payload = (list: DraftBlock[]) => list.map(({ key: _key, ...block }) => block);
  const dirty = JSON.stringify(payload(draft)) !== JSON.stringify(payload(saved));
  const invalidWeekly = draft.some((block) => block.weekly && !validWeekly(block.weekly));
  useHeaderRefresh(() => (saving || loading ? undefined : load(dirty)));

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
    Math.max(now, index > 0 ? Date.parse(blocks[index - 1].until) || now : now);

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

  const moveBlock = (key: number, direction: -1 | 1) => {
    setDay(null);
    setDraft((list) => {
      const own = list.filter(
        (block) => block.provider === current && !!block.weekly === (view === 'weekly')
      );
      const index = own.findIndex((block) => block.key === key);
      const target = own[index + direction];
      if (!target) return list;
      // Swap the order but keep the slot end times, so the timeline stays chronological.
      const a = own[index];
      return list.map((block) => {
        if (block.key === a.key) return a.weekly ? target : { ...target, until: a.until };
        if (block.key === target.key) return a.weekly ? a : { ...a, until: target.until };
        return block;
      });
    });
  };

  const focusWindow = (key: number) => {
    setSelectedKey(key);
    requestAnimationFrame(() => {
      const editor = document.getElementById(`timeline-block-${key}`);
      editor?.focus({ preventScroll: true });
      editor?.scrollIntoView({ block: 'nearest' });
    });
  };

  const addBlock = (accountId?: string, startDay = day) => {
    const pick = accountId ?? eligibleAccounts[0]?.id;
    if (!pick) return;
    const start = startOf(blocks.length);
    const end = resetAfter([pick], '5h', start) ?? start + 3 * HOUR;
    const weekdayIndex = startDay ?? today;
    const weekly =
      view === 'weekly'
        ? nextWeeklyWindow(
            weekdayIndex,
            sharedZone ?? localZone,
            blocks.flatMap((block) => (block.weekly ? [block.weekly] : []))
          )
        : undefined;
    if (view === 'weekly' && !weekly) {
      showNotification(t('timeline.no_free_slot'), 'warning');
      return;
    }
    const block = withKey({
      provider: current,
      accounts: [pick],
      until: weekly ? '' : new Date(end).toISOString(),
      ...(weekly && { weekly }),
      strategy: '',
      max5h: DEFAULT_MAX_5H,
      maxWeekly: DEFAULT_MAX_WEEKLY,
    });
    setDraft((list) => [...list, block]);
    if (weekly) {
      if (day !== null && day !== weekdayIndex) setDay(null);
      focusWindow(block.key);
    }
  };

  const acceptDrop = (event: DragEvent, target: string | number) => {
    if (event.dataTransfer.types.includes(ACCOUNT_DRAG)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setDropTarget(target);
    }
  };

  const leaveDropTarget = (event: DragEvent) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !event.currentTarget.contains(event.relatedTarget)
    ) {
      setDropTarget(null);
    }
  };

  const dropAccount = (event: DragEvent, add: (id: string) => void) => {
    if (!event.dataTransfer.types.includes(ACCOUNT_DRAG)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const id = event.dataTransfer.getData(ACCOUNT_DRAG);
    if (eligibleAccounts.some((account) => account.id === id)) add(id);
  };

  const addAccountToBlock = (block: DraftBlock, id: string) => {
    if (!block.accounts.includes(id)) {
      updateBlock(block.key, { accounts: [...block.accounts, id] });
    }
  };

  const save = async () => {
    const revision = apiClient.getConnectionRevision();
    setSaving(true);
    try {
      // Ended blocks have no effect; drop them so the config stays small.
      const live = draft.filter((block) => block.weekly || Date.parse(block.until) > Date.now());
      await routingTimelineApi.save(payload(live), etag.current);
      if (revision !== apiClient.getConnectionRevision()) return;
      clearConfigCache('routing/strategy');
      setSaved(live);
      setDraft(live);
      showNotification(t('timeline.saved'), 'success');
      allowNextNavigation();
      await load();
    } catch (error) {
      if (revision !== apiClient.getConnectionRevision()) return;
      showNotification(
        t('timeline.save_failed', { message: error instanceof Error ? error.message : '' }),
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const togglePaused = async () => {
    const revision = apiClient.getConnectionRevision();
    setSaving(true);
    try {
      const nextETag = await routingTimelineApi.setPaused(!paused, etag.current);
      if (revision !== apiClient.getConnectionRevision()) return;
      etag.current = nextETag;
      setPaused(!paused);
      clearConfigCache('routing/strategy');
      await load(true);
    } catch (error) {
      if (revision !== apiClient.getConnectionRevision()) return;
      showNotification(
        t('timeline.save_failed', { message: error instanceof Error ? error.message : '' }),
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const activeIds = new Set(paused ? [] : (status?.active[current] ?? []));
  const heldIds = new Set(paused ? [] : (status?.protected ?? []));
  const lastEnd = Math.max(now, ...blocks.map((block) => Date.parse(block.until) || now));
  const span = Math.max(lastEnd - now, HOUR);
  const summary = activeIds.size
    ? t('timeline.routing_accounts', {
        accounts: [...activeIds].map((id) => accountsById.get(id)?.name ?? id).join(', '),
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
          <p className={styles.subtitle} role="status">
            {paused && t('timeline.paused_hint')}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={saving || loading}
            onClick={() => void togglePaused()}
          >
            {t(paused ? 'timeline.resume' : 'timeline.pause')}
          </Button>
          {draft.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || loading}
              onClick={() => setDraft([])}
            >
              {t('timeline.clear_all')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={!dirty || saving || loading}
            onClick={() => setDraft(saved)}
          >
            {t('timeline.discard')}
          </Button>
          <Button
            size="sm"
            disabled={!dirty || saving || loading || invalidWeekly}
            onClick={() => void save()}
          >
            {saving ? t('timeline.saving') : t('timeline.save')}
          </Button>
        </div>
      </header>

      <fieldset
        aria-label={t('timeline.plan_title')}
        className={styles.editor}
        disabled={saving || loading}
      >
        <nav className={styles.tabs} role="tablist">
          {providers.map((name) => {
            const count = draft.filter(
              (b) => b.provider === name && (b.weekly || Date.parse(b.until) > now)
            ).length;
            return (
              <button
                key={name}
                role="tab"
                aria-selected={name === current}
                className={`${styles.tab} ${name === current ? styles.tabActive : ''}`}
                onClick={() => {
                  setProvider(name);
                  setDay(null);
                  setSelectedKey(null);
                }}
              >
                {name}
                {count > 0 && <span className={styles.tabCount}>{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className={styles.chips} role="group" aria-label={t('timeline.plan_title')}>
          {(['weekly', 'once'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${styles.chip} ${view === mode ? styles.chipOn : ''}`}
              aria-pressed={view === mode}
              onClick={() => {
                setView(mode);
                setDay(null);
                setSelectedKey(null);
              }}
            >
              {t(`timeline.view_${mode}`)}
            </button>
          ))}
        </div>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('timeline.accounts_title')}</h2>
          <div className={styles.accounts}>
            {providerAccounts.map((account) => (
              <div
                className={styles.account}
                key={account.id}
                draggable={!account.disabled && !saving && !loading}
                onDragStart={(event) => {
                  event.dataTransfer.setData(ACCOUNT_DRAG, account.id);
                  event.dataTransfer.effectAllowed = 'copy';
                }}
                onDragEnd={() => setDropTarget(null)}
              >
                <div className={styles.accountHead}>
                  <span className={styles.accountName} title={account.id}>
                    {account.name}
                  </span>
                  {activeIds.has(account.id) && !dirty && (
                    <span className={`${styles.pill} ${styles.pillActive}`}>
                      {t('timeline.routing_now')}
                    </span>
                  )}
                  {account.disabled && (
                    <span className={styles.pill}>{t('timeline.disabled')}</span>
                  )}
                  {heldIds.has(account.id) && (
                    <span className={`${styles.pill} ${styles.pillHeld}`}>
                      {t('timeline.held')}
                    </span>
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
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={account.disabled}
                  onClick={() => addBlock(account.id)}
                >
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

          {view === 'weekly' && <p className={styles.empty}>{t('timeline.drag_hint')}</p>}
          {view === 'weekly' ? (
            <>
              <div className={styles.boardMeta}>
                {sharedZone
                  ? `${t('timeline.time_zone')} · ${sharedZone}`
                  : zones.size > 1
                    ? t('timeline.mixed_zones')
                    : null}
              </div>
              <div className={styles.week} role="group" aria-label={t('timeline.view_weekly')}>
                {WEEK.map((weekdayIndex) => {
                  const slot = `day-${weekdayIndex}`;
                  const previousDay = (weekdayIndex + 6) % 7;
                  const windows = blocks
                    .flatMap((block) => {
                      const weekly = block.weekly;
                      if (!weekly) return [];
                      const overnight = weekly.end <= weekly.start;
                      const entries = [];
                      if (weekly.days.includes(weekdayIndex)) {
                        entries.push({
                          block,
                          start: weekly.start,
                          end: weekly.end,
                          overnight,
                          carry: false,
                        });
                      }
                      if (carriesIntoDay(weekly, weekdayIndex)) {
                        entries.push({
                          block,
                          start: '00:00',
                          end: weekly.end,
                          overnight: false,
                          carry: true,
                        });
                      }
                      return entries;
                    })
                    .sort((a, b) => a.start.localeCompare(b.start));
                  return (
                    <div
                      key={weekdayIndex}
                      className={`${styles.day} ${today === weekdayIndex ? styles.today : ''} ${day === weekdayIndex ? styles.daySelected : ''} ${dropTarget === slot ? styles.dropActive : ''}`}
                      onDragOver={(event) => acceptDrop(event, slot)}
                      onDragLeave={leaveDropTarget}
                      onDrop={(event) =>
                        dropAccount(event, (id) => {
                          if (day !== null && day !== weekdayIndex) setDay(null);
                          addBlock(id, weekdayIndex);
                        })
                      }
                    >
                      <div className={styles.dayHead}>
                        <button
                          type="button"
                          className={styles.dayLabel}
                          aria-pressed={day === weekdayIndex}
                          title={t('timeline.filter_day', {
                            day: weekday(weekdayIndex, i18n.language),
                          })}
                          onClick={() => setDay(day === weekdayIndex ? null : weekdayIndex)}
                        >
                          {weekday(weekdayIndex, i18n.language)}
                          {today === weekdayIndex && (
                            <small>{t('quota_management.windows_today')}</small>
                          )}
                        </button>
                        <button
                          type="button"
                          className={styles.dayAdd}
                          disabled={!eligibleAccounts.length}
                          aria-label={t('timeline.add_on_day', {
                            day: weekday(weekdayIndex, i18n.language),
                          })}
                          onClick={() => addBlock(undefined, weekdayIndex)}
                        >
                          +
                        </button>
                      </div>
                      {windows.map(({ block, start, end, overnight, carry }) => (
                        <button
                          type="button"
                          key={`${block.key}-${carry}`}
                          className={`${styles.dayWindow} ${carry ? styles.carryWindow : ''} ${selectedKey === block.key ? styles.windowSelected : ''} ${dropTarget === block.key ? styles.dropActive : ''}`}
                          aria-pressed={selectedKey === block.key}
                          onClick={() => {
                            if (day !== null && block.weekly && !coversWeekday(block.weekly, day))
                              setDay(null);
                            focusWindow(block.key);
                          }}
                          onDragOver={(event) => acceptDrop(event, block.key)}
                          onDragLeave={leaveDropTarget}
                          onDrop={(event) =>
                            dropAccount(event, (id) => {
                              addAccountToBlock(block, id);
                              if (day !== null && block.weekly && !coversWeekday(block.weekly, day))
                                setDay(null);
                              focusWindow(block.key);
                            })
                          }
                        >
                          {start}–{end}
                          {overnight ? ' +1' : ''}
                          {carry && (
                            <small>
                              {t('timeline.carry_from_day', {
                                day: weekday(previousDay, i18n.language),
                              })}
                            </small>
                          )}
                          <span
                            title={block.accounts
                              .map((id) => accountsById.get(id)?.name ?? id)
                              .join(', ')}
                          >
                            {block.accounts
                              .map((id) => accountsById.get(id)?.name ?? id)
                              .join(', ')}
                          </span>
                          {(!sharedZone || sharedZone !== block.weekly?.timeZone) && (
                            <small>{block.weekly?.timeZone}</small>
                          )}
                          {block.accounts.length > 1 && (
                            <small>
                              {t(
                                block.strategy === 'round-robin'
                                  ? 'timeline.mode_round_robin'
                                  : block.strategy === 'fill-first'
                                    ? 'timeline.mode_fill_first'
                                    : 'timeline.mode_default'
                              )}
                            </small>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
              <p className={styles.empty}>{t('timeline.weekly_precedence')}</p>
            </>
          ) : (
            <>
              <div className={styles.track} aria-hidden>
                {blocks.map((block, index) => {
                  const start = startOf(index);
                  const end = Date.parse(block.until);
                  const width = Math.max(0, ((end - start) / span) * 100);
                  if (!(width > 0)) return null;
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
            </>
          )}

          {visibleBlocks.length === 0 && (
            <p className={styles.empty}>
              {t(view === 'weekly' ? 'timeline.empty_weekly' : 'timeline.empty')}
            </p>
          )}

          <ol className={styles.blocks}>
            {visibleBlocks.map((block) => {
              const index = blocks.indexOf(block);
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
              const weekly = block.weekly;
              const invalid = end <= start && states[index] !== 'ended';
              const state = states[index];
              return (
                <li
                  key={block.key}
                  id={`timeline-block-${block.key}`}
                  tabIndex={-1}
                  className={`${styles.block} ${selectedKey === block.key ? styles.windowSelected : ''} ${state ? styles[`block_${state}`] : ''} ${dropTarget === block.key ? styles.dropActive : ''}`}
                  onDragOver={(event) => acceptDrop(event, block.key)}
                  onDragLeave={leaveDropTarget}
                  onDrop={(event) => dropAccount(event, (id) => addAccountToBlock(block, id))}
                >
                  <div className={styles.blockHead}>
                    {weekly ? (
                      <span className={styles.blockWhen}>
                        {WEEK.filter((day) => weekly.days.includes(day))
                          .map((day) => weekday(day, i18n.language))
                          .join(', ')}
                        {' · '}
                        {weekly.start}–{weekly.end}
                        {weekly.end <= weekly.start ? ' +1' : ''}
                        {' · '}
                        {weekly.timeZone}
                      </span>
                    ) : (
                      <>
                        <span className={`${styles.pill} ${styles[`pill_${state}`]}`}>
                          {t(`timeline.state_${state}`)}
                        </span>
                        <span className={styles.blockWhen}>
                          {formatTime(new Date(start).toISOString())} → {formatTime(block.until)}
                          <span className={styles.muted}>
                            {' '}
                            · {formatIn(end - Math.max(start, now))}
                          </span>
                        </span>
                      </>
                    )}
                    <span className={styles.blockTools}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={index === 0}
                        onClick={() => moveBlock(block.key, -1)}
                        aria-label={t(weekly ? 'timeline.raise_priority' : 'timeline.move_up')}
                        title={t(weekly ? 'timeline.raise_priority' : 'timeline.move_up')}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={index === blocks.length - 1}
                        onClick={() => moveBlock(block.key, 1)}
                        aria-label={t(weekly ? 'timeline.lower_priority' : 'timeline.move_down')}
                        title={t(weekly ? 'timeline.lower_priority' : 'timeline.move_down')}
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

                  <AccountFields
                    block={block}
                    accountsById={accountsById}
                    eligibleAccounts={eligibleAccounts}
                    onChange={(patch) => updateBlock(block.key, patch)}
                    onRemove={() => removeBlock(block.key)}
                  />

                  {weekly ? (
                    <WeeklyFields
                      weekly={weekly}
                      onChange={(next) => {
                        if (day !== null && !coversWeekday(next, day)) setDay(null);
                        updateBlock(block.key, { weekly: next });
                      }}
                    />
                  ) : (
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
                          aria-label={t('timeline.ends_at')}
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
                  )}

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
                          <span>{label} ≤</span>
                          <input
                            type="number"
                            min={0}
                            max={99}
                            step={1}
                            placeholder={t('timeline.off')}
                            // Edited as "% left"; stored as the used share the backend checks.
                            value={block[field] ? 100 - block[field] : ''}
                            onChange={(event) => {
                              const left = event.target.valueAsNumber;
                              updateBlock(block.key, {
                                [field]: Number.isNaN(left)
                                  ? 0
                                  : 100 - Math.min(99, Math.max(0, left)),
                              });
                            }}
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

          <div
            className={`${styles.addRow} ${dropTarget === 'new' ? styles.dropActive : ''}`}
            onDragOver={(event) => acceptDrop(event, 'new')}
            onDragLeave={leaveDropTarget}
            onDrop={(event) => dropAccount(event, (id) => addBlock(id))}
          >
            <Button
              variant="secondary"
              disabled={!eligibleAccounts.length}
              onClick={() => addBlock()}
            >
              + {t('timeline.add_block')}
            </Button>
            <span className={styles.muted}>{t('timeline.drop_new')}</span>
          </div>
        </section>
      </fieldset>
    </div>
  );
}

export default TimelinePage;

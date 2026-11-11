/**
 * Ledger view: credentials grouped by provider, one row each, with the shared
 * limits as columns ("55% left · Resets in 19h 12m"). Replaces the card grid.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { IconChevronDown, IconChevronUp, IconRefreshCw } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { ResolvedTheme } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { maskEmails } from '../maskEmail';
import {
  buildLedgerLimits,
  formatCountdown,
  ledgerColumns,
  type LedgerLimit,
} from '../quotaLedgerModel';
import styles from './QuotaLedger.module.scss';

const LOW_THRESHOLD = 20;

type Column = ReturnType<typeof ledgerColumns>[number];

const columnLabel = (t: TFunction, col: Column) =>
  col.labelKey ? String(t(col.labelKey, col.labelParams ?? {})) : col.label;

function IconBolt({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

export interface QuotaLedgerProps {
  entries: QuotaFileEntry[];
  quotaFor: (entry: QuotaFileEntry) => QuotaCardState | undefined;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  resettingName: string | null;
  showEmails: boolean;
  onRefresh: (entry: QuotaFileEntry) => void;
  onReset: (entry: QuotaFileEntry) => void;
}

export function QuotaLedger(props: QuotaLedgerProps) {
  const { entries, quotaFor } = props;
  const groups = useMemo(() => {
    const map = new Map<QuotaProviderType, QuotaFileEntry[]>();
    entries.forEach((entry) => {
      const list = map.get(entry.type) ?? [];
      list.push(entry);
      map.set(entry.type, list);
    });
    return [...map.entries()];
  }, [entries]);

  return (
    <div className={styles.ledger}>
      {groups.map(([type, list]) => (
        <LedgerGroup key={type} {...props} type={type} entries={list} quotaFor={quotaFor} />
      ))}
    </div>
  );
}

function LedgerGroup(props: QuotaLedgerProps & { type: QuotaProviderType }) {
  const { type, entries, quotaFor, resolvedTheme } = props;
  const { t } = useTranslation();
  const now = useNow();
  const [collapsed, setCollapsed] = useState(false);

  const rows = useMemo(
    () => entries.map((entry) => ({ entry, limits: buildLedgerLimits(type, quotaFor(entry)) })),
    [entries, quotaFor, type]
  );
  const columns = useMemo(() => ledgerColumns(rows.map((row) => row.limits)), [rows]);

  // Pool: the first (primary) column summed across loaded credentials.
  const primary = columns[0];
  const pool = useMemo(() => {
    if (!primary) return null;
    const hits = rows
      .map((row) => row.limits.find((limit) => limit.id === primary.id))
      .filter((limit): limit is LedgerLimit => Boolean(limit));
    if (hits.length === 0) return null;
    const remaining = hits.reduce((sum, limit) => sum + limit.remaining, 0);
    const next = hits
      .filter((limit) => limit.resetAtMs !== null && limit.resetAtMs > now)
      .sort((a, b) => (a.resetAtMs as number) - (b.resetAtMs as number))[0];
    return { remaining, capacity: hits.length * 100, next };
  }, [rows, primary, now]);

  const iconSrc = getAuthFileIcon(type, resolvedTheme);
  const typeLabel = getTypeLabel(t, type);

  return (
    <section className={styles.group}>
      <header className={styles.groupHead}>
        <span
          className={styles.icon}
          style={
            isThemeSurfaceIconProvider(type)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? <img src={iconSrc} alt="" /> : typeLabel.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.groupName}>{typeLabel}</span>
        <span className={styles.groupCount}>{entries.length}</span>
        {pool && (
          <span className={styles.pool}>
            <strong>{Math.round(pool.remaining)}%</strong>{' '}
            {t('quota_ledger.of_pool', { capacity: pool.capacity })}
          </span>
        )}
        {pool?.next && pool.next.resetAtMs !== null && (
          <span className={styles.nextReset}>
            {t('quota_ledger.next_reset', {
              gain: Math.round(100 - pool.next.remaining),
              when: new Date(pool.next.resetAtMs).toLocaleString(undefined, {
                weekday: 'short',
                hour: 'numeric',
                minute: '2-digit',
              }),
            })}
          </span>
        )}
        <button type="button" className={styles.collapse} onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? t('quota_ledger.expand') : t('quota_ledger.collapse')}
          {collapsed ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
        </button>
      </header>

      {!collapsed && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('quota_ledger.credential')}</th>
                {columns.map((col) => (
                  <th key={col.id}>{columnLabel(t, col)}</th>
                ))}
                <th>{t('quota_ledger.resets')}</th>
                <th aria-label={t('quota_ledger.actions')} />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry, limits }) => (
                <LedgerRow
                  key={getQuotaCacheKey(entry.file)}
                  {...props}
                  entry={entry}
                  limits={limits}
                  columns={columns}
                  now={now}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LedgerRow(
  props: QuotaLedgerProps & {
    entry: QuotaFileEntry;
    limits: LedgerLimit[];
    columns: Column[];
    now: number;
  }
) {
  const {
    entry,
    limits,
    columns,
    now,
    quotaFor,
    canRefresh,
    resettingName,
    showEmails,
    onRefresh,
    onReset,
  } = props;
  const { t } = useTranslation();
  const file = entry.file;
  const quota = quotaFor(entry);
  const adapter = QUOTA_ADAPTERS[entry.type];
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const resetting = resettingName === getQuotaCacheKey(file);
  const name = showEmails ? getQuotaDisplayName(file) : maskEmails(getQuotaDisplayName(file));

  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    () => onRefresh(entry),
    name
  );

  const codexCredits =
    entry.type === 'codex'
      ? (
          (
            quota as
              { rateLimitResetCredits?: { status?: string; expiresAt?: string }[] } | undefined
          )?.rateLimitResetCredits ?? []
        ).filter((credit) => credit.status === 'available')
      : [];
  const resetCount =
    entry.type === 'claude'
      ? claudeReset.count
      : entry.type === 'codex'
        ? codexCredits.length
        : null;
  const soonestCreditMs =
    entry.type === 'codex'
      ? codexCredits
          .map((credit) => new Date(credit.expiresAt ?? '').getTime())
          .filter((ms) => Number.isFinite(ms) && ms > now)
          .sort((a, b) => a - b)[0]
      : undefined;
  const claudeGrantMs =
    entry.type === 'claude'
      ? claudeReset.grants
          .filter((grant) => grant.resetsLeft > 0)
          .map((grant) => new Date(grant.endsAt ?? '').getTime())
          .filter((ms) => Number.isFinite(ms) && ms > now)
          .sort((a, b) => a - b)[0]
      : undefined;
  const creditExpiryMs = soonestCreditMs ?? claudeGrantMs;

  const canCodexReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));
  const showBolt = entry.type === 'claude' ? status !== 'idle' : canCodexReset;
  const boltDisabled =
    entry.type === 'claude' ? claudeReset.blocked : !canRefresh || loading || resetting;
  const boltBusy = entry.type === 'claude' ? claudeReset.busy : resetting;
  const boltTitle =
    entry.type === 'claude'
      ? t(`claude_reset.${claudeReset.buttonLabel}`)
      : t('codex_quota.reset_button');

  const errorMessage =
    status === 'error'
      ? t(`${adapter.i18nPrefix}.load_failed`, {
          message: resolveQuotaErrorMessage(
            t,
            quota?.errorStatus,
            quota?.error || t('common.unknown_error')
          ),
        })
      : '';

  return (
    <tr>
      <td className={styles.credCell}>
        <div className={styles.credName} title={name}>
          {name}
        </div>
        <div className={styles.credMeta}>{getTypeLabel(t, entry.type)}</div>
      </td>

      {status === 'success' ? (
        columns.map((col) => {
          const limit = limits.find((item) => item.id === col.id);
          if (!limit)
            return (
              <td key={col.id} className={styles.muted}>
                —
              </td>
            );
          const low = limit.remaining <= LOW_THRESHOLD;
          return (
            <td key={col.id}>
              <div className={`${styles.pct} ${low ? styles.low : ''}`}>
                {t('quota_ledger.left', { value: Math.round(limit.remaining) })}
                {low && <span className={styles.lowTag}>⚠ {t('quota_ledger.low')}</span>}
              </div>
              <div className={styles.track}>
                <span
                  className={`${styles.fill} ${low ? styles.fillLow : ''}`}
                  style={{ width: `${limit.remaining}%` }}
                />
              </div>
              <div className={styles.resetsIn}>
                {limit.resetAtMs !== null && limit.resetAtMs > now
                  ? t('quota_ledger.resets_in', { value: formatCountdown(limit.resetAtMs, now) })
                  : ' '}
              </div>
            </td>
          );
        })
      ) : (
        <td
          colSpan={Math.max(1, columns.length)}
          className={status === 'error' ? styles.error : styles.muted}
        >
          {status === 'error'
            ? errorMessage
            : loading
              ? t(`${adapter.i18nPrefix}.loading`)
              : t(`${adapter.i18nPrefix}.idle`)}
        </td>
      )}

      <td className={styles.resetCell}>
        {resetCount !== null && resetCount !== undefined ? (
          <span>
            <strong>{resetCount}</strong>
            {creditExpiryMs !== undefined && (
              <span className={styles.muted}> · {formatCountdown(creditExpiryMs, now)}</span>
            )}
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </td>

      <td className={styles.actions}>
        {showBolt && (
          <button
            type="button"
            className={styles.iconBtn}
            disabled={boltDisabled}
            onClick={entry.type === 'claude' ? claudeReset.confirm : () => onReset(entry)}
            title={boltTitle}
            aria-label={boltTitle}
          >
            <span className={boltBusy ? styles.spinning : undefined}>
              <IconBolt />
            </span>
          </button>
        )}
        <button
          type="button"
          className={styles.iconBtn}
          disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
          onClick={() => onRefresh(entry)}
          title={t('auth_files.quota_refresh_single')}
          aria-label={t('auth_files.quota_refresh_single')}
        >
          <IconRefreshCw size={15} className={loading ? styles.spinning : undefined} />
        </button>
      </td>
    </tr>
  );
}

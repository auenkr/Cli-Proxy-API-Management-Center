/**
 * API-equivalent cost across all subscriptions: total, per provider, hourly
 * chart, cost by token type and a per-model breakdown. Costs are list-price
 * estimates computed from recorded token usage, not what was billed.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usageCostApi, type UsageCostReport } from '@/services/api';
import { formatCompactNumber } from '@/utils/format';
import styles from './QuotaCost.module.scss';

const RANGES = [1, 7, 30] as const;
const HOUR_MS = 3_600_000;
const CHART_W = 760;
const CHART_H = 150;
const PALETTE = ['#d7dce3', '#e0774f', '#5ea1d6', '#6fbf8f', '#d9b24c', '#a98bd6'];

const usd = (value: number): string =>
  value >= 100 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;

export function QuotaCost() {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(7);
  const [report, setReport] = useState<UsageCostReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<'model' | 'hour'>('model');

  const load = useCallback(async () => {
    try {
      setReport(await usageCostApi.get(days));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [days]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const providers = useMemo(() => report?.providers.map((p) => p.provider) ?? [], [report]);
  const color = (provider: string) => PALETTE[Math.max(0, providers.indexOf(provider)) % PALETTE.length];

  const series = useMemo(() => {
    if (!report) return null;
    const end = Math.floor(report.until / HOUR_MS) * HOUR_MS;
    const bucketMs = days > 7 ? 24 * HOUR_MS : HOUR_MS;
    const start = Math.floor((end - days * 24 * HOUR_MS) / bucketMs) * bucketMs;
    const slots = Math.max(1, Math.round((end - start) / bucketMs) + 1);
    const grouped = providers.map(() => new Array<number>(slots).fill(0));
    report.hourly.forEach((point) => {
      const index = Math.floor((point.hour - start) / bucketMs);
      if (index < 0 || index >= slots) return;
      providers.forEach((name, row) => {
        grouped[row][index] += point.by_provider[name] ?? 0;
      });
    });
    const max = Math.max(0.01, ...grouped.flat());
    const path = (values: number[]) =>
      values
        .map((value, i) => {
          const x = (i / Math.max(1, slots - 1)) * CHART_W;
          const y = CHART_H - (value / max) * (CHART_H - 8) - 2;
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');
    return { start, end, bucketMs, max, paths: grouped.map(path) };
  }, [report, providers, days]);

  if (failed && !report) return null;
  if (!report || report.requests === 0) return null;

  const costs = report.costs;
  const typeRows = [
    { key: 'input', label: t('quota_tokens.input'), value: costs.input, tone: styles.toneInput },
    { key: 'cache_read', label: t('quota_tokens.cache_read'), value: costs.cache_read, tone: styles.toneCacheRead },
    { key: 'cache_write', label: t('quota_tokens.cache_write'), value: costs.cache_write, tone: styles.toneCacheWrite },
    { key: 'output', label: t('quota_tokens.output'), value: costs.output, tone: styles.toneOutput },
  ].filter((row) => row.value > 0);

  const totalTokens =
    report.tokens.input +
    report.tokens.cache_read +
    report.tokens.cache_write +
    report.tokens.output +
    report.tokens.reasoning;
  const cached = report.tokens.cache_read;
  const hourRows = [...report.hourly].reverse();
  const fmtHour = (ms: number) =>
    new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
  const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <div>
          <div className={styles.big}>{usd(costs.total)}</div>
          <div className={styles.sub}>
            {t('quota_cost.requests', { count: report.requests })} · {t('quota_cost.estimate')}
          </div>
        </div>
        <div className={styles.ranges} role="group">
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              className={`${styles.rangeBtn} ${days === range ? styles.rangeActive : ''}`.trim()}
              onClick={() => setDays(range)}
            >
              {range === 1 ? t('quota_cost.range_24h') : t('quota_cost.range_days', { count: range })}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.top}>
        <ul className={styles.providerList}>
          {report.providers.map((p) => (
            <li key={p.provider} className={styles.providerItem}>
              <span className={styles.dot} style={{ background: color(p.provider) }} aria-hidden="true" />
              <span className={styles.providerName}>{p.provider}</span>
              <span className={styles.providerCost}>{usd(p.costs.total)}</span>
              <span className={styles.providerMeta}>
                {costs.total > 0 ? ((p.costs.total / costs.total) * 100).toFixed(1) : '0.0'}% ·{' '}
                {formatCompactNumber(
                  p.tokens.input + p.tokens.cache_read + p.tokens.cache_write + p.tokens.output + p.tokens.reasoning
                )}{' '}
                {t('quota_cost.tokens')}
              </span>
            </li>
          ))}
        </ul>

        {series && (
          <div className={styles.chart}>
            <div className={styles.chartTitle}>
              {days > 7 ? t('quota_cost.daily_cost') : t('quota_cost.hourly_cost')}
              <span className={styles.chartMax}>{usd(series.max)}</span>
            </div>
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className={styles.svg} preserveAspectRatio="none" role="img">
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1="0" x2={CHART_W} y1={CHART_H * f} y2={CHART_H * f} className={styles.grid} />
              ))}
              {series.paths.map((d, i) => (
                <path key={providers[i]} d={d} fill="none" stroke={color(providers[i])} strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            <div className={styles.axis}>
              <span>{fmtDay(series.start)}</span>
              <span>{fmtDay(series.end)}</span>
            </div>
          </div>
        )}
      </div>

      <div className={styles.totals}>
        <div>
          <span>{t('quota_cost.processed')}</span>
          <strong>{formatCompactNumber(totalTokens)}</strong>
        </div>
        <div>
          <span>{t('quota_cost.cached_input')}</span>
          <strong>{formatCompactNumber(cached + report.tokens.cache_write)}</strong>
        </div>
        <div>
          <span>{t('quota_cost.uncached_input')}</span>
          <strong>{formatCompactNumber(report.tokens.input)}</strong>
        </div>
        <div>
          <span>{t('quota_tokens.output')}</span>
          <strong>{formatCompactNumber(report.tokens.output + report.tokens.reasoning)}</strong>
        </div>
        <div>
          <span>{t('quota_cost.cache_savings')}</span>
          <strong>{usd(report.cache_savings)}</strong>
        </div>
      </div>

      <div className={styles.typeBlock}>
        <div className={styles.blockTitle}>{t('quota_cost.cost_by_type')}</div>
        <div className={styles.bar}>
          {typeRows.map((row) => (
            <span key={row.key} className={`${styles.segment} ${row.tone}`} style={{ width: `${(row.value / costs.total) * 100}%` }} />
          ))}
        </div>
        <ul className={styles.legend}>
          {typeRows.map((row) => (
            <li key={row.key}>
              <span className={`${styles.dot} ${row.tone}`} aria-hidden="true" />
              {row.label} <strong>{usd(row.value)}</strong>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.breakdownHead}>
        <div className={styles.blockTitle}>{t('quota_cost.breakdown')}</div>
        <div className={styles.ranges} role="group">
          {(['model', 'hour'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${styles.rangeBtn} ${view === mode ? styles.rangeActive : ''}`.trim()}
              onClick={() => setView(mode)}
            >
              {t(`quota_cost.by_${mode}`)}
            </button>
          ))}
        </div>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>{view === 'model' ? t('quota_cost.model') : t('quota_cost.hour')}</th>
            <th>{t('quota_cost.cost')}</th>
            <th>{t('quota_cost.share')}</th>
            <th>{t('quota_cost.tokens')}</th>
          </tr>
        </thead>
        <tbody>
          {view === 'model'
            ? report.models.map((row) => (
                <tr key={`${row.provider}/${row.model}`}>
                  <td>
                    <span className={styles.dot} style={{ background: color(row.provider) }} aria-hidden="true" />
                    {row.model}
                  </td>
                  <td>{row.priced ? usd(row.costs.total) : t('quota_cost.unpriced')}</td>
                  <td>{row.priced ? `${(row.share * 100).toFixed(1)}%` : '—'}</td>
                  <td>
                    {formatCompactNumber(
                      row.tokens.input + row.tokens.cache_read + row.tokens.cache_write + row.tokens.output + row.tokens.reasoning
                    )}
                  </td>
                </tr>
              ))
            : hourRows.slice(0, 72).map((row) => (
                <tr key={row.hour}>
                  <td>{fmtHour(row.hour)}</td>
                  <td>{usd(row.total)}</td>
                  <td>{costs.total > 0 ? `${((row.total / costs.total) * 100).toFixed(1)}%` : '—'}</td>
                  <td>—</td>
                </tr>
              ))}
        </tbody>
      </table>
      {report.unpriced_tokens > 0 && (
        <div className={styles.note}>{t('quota_cost.unpriced_note')}</div>
      )}
    </section>
  );
}

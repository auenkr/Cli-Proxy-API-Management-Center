/**
 * Quota forecast: one panel per provider with the summed remaining quota, its
 * recorded history, a projection, and the drain rate. A shared toolbar drives
 * every panel. All maths lives in quotaForecastModel.ts.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { TYPE_COLORS } from '@/utils/quota';
import type { ResolvedTheme } from '@/types';
import type { QuotaHistorySample } from '@/services/api/quotaHistory';
import { HOUR_MS } from '../quotaTimelineModel';
import type { TimelineLane } from '../quotaTimelineModel';
import {
  averageDrainPerHour,
  buildDrainSeries,
  buildRemainingSeries,
  forecastLanes,
  projectRemaining,
  summarizeLanes,
  type ForecastPoint,
} from '../quotaForecastModel';
import styles from './QuotaForecast.module.scss';

const W = 1000;
const H = 260;
const PAD = { left: 48, right: 12, top: 24, bottom: 28 };

const BURN_OPTIONS = [1, 3, 6] as const;
const FUTURE_USAGE = [
  { key: 'same', factor: 1, label: 'Same as now' },
  { key: 'half', factor: 0.5, label: 'Half of now' },
  { key: 'double', factor: 2, label: 'Double' },
  { key: 'none', factor: 0, label: 'No usage' },
] as const;
const DAY_MS = 24 * HOUR_MS;

type ChartTab = 'remaining' | 'drain';
type QuotaWindow = 'weekly' | '5h';

const WINDOW_SPAN: Record<QuotaWindow, { spanMs: number; pastMs: number }> = {
  weekly: { spanMs: 14 * DAY_MS, pastMs: 3 * DAY_MS },
  '5h': { spanMs: DAY_MS, pastMs: 6 * HOUR_MS },
};

const formatTick = (ms: number, spanMs: number) => {
  const d = new Date(ms);
  return spanMs > 36 * HOUR_MS
    ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })
    : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const formatShortDate = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const formatWhen = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

const formatIn = (ms: number) => {
  const minutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
};

const niceMax = (max: number) => {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / step) * step;
};

/** Upward jumps between consecutive points are resets; label them "+N%". */
const resetMarkers = (points: ForecastPoint[]) => {
  const markers: { at: number; value: number; label: string }[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const gain = points[i].value - points[i - 1].value;
    if (gain >= 1)
      markers.push({ at: points[i].at, value: points[i].value, label: `+${Math.round(gain)}%` });
  }
  return markers;
};

interface ChartProps {
  series: { points: ForecastPoint[]; dashed?: boolean }[];
  fromMs: number;
  toMs: number;
  yMax: number;
  nowMs?: number;
  unit: string;
  emptyLabel: string;
  markers?: { at: number; value: number; label: string }[];
}

function Chart({ series, fromMs, toMs, yMax, nowMs, unit, emptyLabel, markers = [] }: ChartProps) {
  const [hover, setHover] = useState<{ at: number; value: number; dashed: boolean } | null>(null);
  const x = (at: number) =>
    PAD.left + ((at - fromMs) / (toMs - fromMs)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - Math.min(v, yMax) / yMax) * (H - PAD.top - PAD.bottom);
  const hasData = series.some((s) => s.points.length > 1);
  const ticks = [0, 1, 2].map((i) => (yMax / 2) * i);
  const spanMs = toMs - fromMs;

  const all = series.flatMap((s) => s.points.map((p) => ({ ...p, dashed: Boolean(s.dashed) })));
  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const at =
      fromMs +
      ((((event.clientX - rect.left) / rect.width) * W - PAD.left) / (W - PAD.left - PAD.right)) *
        spanMs;
    let best: (typeof all)[number] | null = null;
    all.forEach((p) => {
      if (!best || Math.abs(p.at - at) < Math.abs(best.at - at)) best = p;
    });
    setHover(best);
  };

  const columns = spanMs > 36 * HOUR_MS ? Math.round(spanMs / DAY_MS) : 6;

  return (
    <div className={styles.chartWrap}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className={styles.chart}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              className={styles.grid}
            />
            <text x={PAD.left - 8} y={y(tick) + 4} className={styles.axisText} textAnchor="end">
              {Math.round(tick)}
              {unit === '%' ? '%' : ''}
            </text>
          </g>
        ))}
        {Array.from({ length: columns }, (_, i) => {
          const at = fromMs + (spanMs / columns) * (i + 0.5);
          return (
            <g key={i}>
              <line
                x1={x(fromMs + (spanMs / columns) * i)}
                x2={x(fromMs + (spanMs / columns) * i)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                className={styles.gridV}
              />
              <text x={x(at)} y={H - 8} className={styles.axisText} textAnchor="middle">
                {formatTick(at, spanMs)}
              </text>
            </g>
          );
        })}
        {nowMs !== undefined && nowMs > fromMs && nowMs < toMs && (
          <g>
            <line
              x1={x(nowMs)}
              x2={x(nowMs)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className={styles.nowLine}
            />
            <text x={x(nowMs)} y={PAD.top - 8} className={styles.axisText} textAnchor="middle">
              Now
            </text>
          </g>
        )}
        {series.map((s, index) => {
          const pts = s.points.filter((p) => p.at >= fromMs && p.at <= toMs);
          if (pts.length < 2) return null;
          const line = pts.map((p) => `${x(p.at)},${y(p.value)}`).join(' ');
          return (
            <g key={index}>
              <polygon
                points={`${x(pts[0].at)},${y(0)} ${line} ${x(pts[pts.length - 1].at)},${y(0)}`}
                className={s.dashed ? styles.areaDashed : styles.area}
              />
              <polyline points={line} className={s.dashed ? styles.lineDashed : styles.line} />
            </g>
          );
        })}
        {markers
          .filter((m) => m.at >= fromMs && m.at <= toMs)
          .map((m) => (
            <text
              key={`${m.at}-${m.label}`}
              x={x(m.at)}
              y={Math.max(PAD.top + 10, y(m.value) - 6)}
              className={styles.markerText}
              textAnchor="middle"
            >
              {m.label}
            </text>
          ))}
        {hover && (
          <g>
            <line
              x1={x(hover.at)}
              x2={x(hover.at)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              className={styles.hoverLine}
            />
            <circle cx={x(hover.at)} cy={y(hover.value)} r={4} className={styles.dot} />
          </g>
        )}
      </svg>
      {!hasData && <div className={styles.empty}>{emptyLabel}</div>}
      {hover && (
        <div className={styles.tooltip}>
          {formatWhen(hover.at)} · {Math.round(hover.value * 10) / 10}
          {unit === '%' ? '%' : ` ${unit}`}
          {unit === '%' ? ' left' : ''}
          {hover.dashed ? ' · projected' : ''}
        </div>
      )}
    </div>
  );
}

interface PanelProps {
  provider: string;
  lanes: TimelineLane[];
  samples: QuotaHistorySample[];
  now: number;
  tab: ChartTab;
  burnHours: number;
  factor: number;
  fromMs: number;
  toMs: number;
  showAccounts: boolean;
  displayNameFor: (name: string) => string;
  resolvedTheme: ResolvedTheme;
}

function ProviderPanel(props: PanelProps) {
  const {
    provider,
    lanes,
    samples,
    now,
    tab,
    burnHours,
    factor,
    fromMs,
    toMs,
    showAccounts,
    displayNameFor,
    resolvedTheme,
  } = props;
  const { t } = useTranslation();
  const colorSet = TYPE_COLORS[provider] || TYPE_COLORS.unknown;
  const color = resolvedTheme === 'dark' && colorSet.dark ? colorSet.dark : colorSet.light;
  const summary = useMemo(() => summarizeLanes(lanes), [lanes]);

  const basisDrain = useMemo(
    () => averageDrainPerHour(buildDrainSeries(samples, lanes, now - burnHours * HOUR_MS, now)),
    [samples, lanes, now, burnHours]
  );
  const rate = (basisDrain ?? 0) * factor;
  const horizonMs = Math.max(0, toMs - now);
  const projection = useMemo(
    () => projectRemaining(lanes, rate, now, horizonMs),
    [lanes, rate, now, horizonMs]
  );

  const history = useMemo(() => {
    const points = buildRemainingSeries(samples, lanes, fromMs, Math.min(now, toMs));
    return toMs > now && fromMs < now
      ? [...points.filter((p) => p.at < now), { at: now, value: summary.remaining }]
      : points;
  }, [samples, lanes, fromMs, toMs, now, summary.remaining]);
  const projected = useMemo(
    () => [{ at: now, value: summary.remaining }, ...projection.points.slice(1)],
    [now, summary.remaining, projection.points]
  );

  const drain = useMemo(
    () => buildDrainSeries(samples, lanes, fromMs, Math.min(now, toMs)),
    [samples, lanes, fromMs, toMs, now]
  );
  const drainPeak = drain.reduce((max, p) => Math.max(max, p.value), 0);

  // Pool empty: first projected point at zero. First empty: first single lane to hit zero
  // before its own next reset.
  const poolEmpty = projection.points.find((p) => p.at > now && p.value <= 0.5)?.at ?? null;
  const share = lanes.length > 0 ? rate / lanes.length : 0;
  let firstEmpty: { at: number; name: string } | null = null;
  if (share > 0) {
    lanes.forEach((lane) => {
      if (lane.remaining === null || lane.anchorMs === null || !lane.periodHours) return;
      const period = lane.periodHours * HOUR_MS;
      const nextReset =
        lane.anchorMs > now
          ? lane.anchorMs
          : lane.anchorMs + Math.ceil((now - lane.anchorMs) / period) * period;
      const emptyAt = now + (lane.remaining / share) * HOUR_MS;
      if (emptyAt < nextReset && (!firstEmpty || emptyAt < firstEmpty.at)) {
        firstEmpty = { at: emptyAt, name: lane.displayName };
      }
    });
  }
  const first = firstEmpty as { at: number; name: string } | null;

  const label = provider.charAt(0).toUpperCase() + provider.slice(1);
  const markers = useMemo(
    () => [...resetMarkers(history), ...resetMarkers(projected)],
    [history, projected]
  );

  return (
    <section
      className={styles.panel}
      style={{ '--accent': color.text } as CSSProperties}
      aria-label={label}
    >
      <header className={styles.panelHead}>
        <span className={styles.providerName}>{label}</span>
        <span className={styles.count}>
          {lanes.length} {t('quota_management.forecast_accounts', { defaultValue: 'accounts' })}
        </span>
      </header>

      <div className={styles.summary}>
        <div className={styles.bigRow}>
          <span className={styles.big}>{summary.remaining}%</span>
          <span className={styles.of}>
            {t('quota_management.forecast_of', { defaultValue: 'of' })} {summary.capacity}%
          </span>
        </div>
        <dl className={styles.stats}>
          <div>
            <dt>{t('quota_management.forecast_pool_empty', { defaultValue: 'Pool empty' })}</dt>
            <dd>
              {poolEmpty !== null
                ? formatWhen(poolEmpty)
                : `${t('quota_management.forecast_not_by', { defaultValue: 'Not by' })} ${formatShortDate(toMs)}`}
            </dd>
          </div>
          <div>
            <dt>{t('quota_management.forecast_first_empty', { defaultValue: 'First empty' })}</dt>
            <dd>
              {first
                ? `${displayNameFor(first.name)} · ${t('quota_management.forecast_in', { defaultValue: 'in' })} ${formatIn(first.at - now)}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>{t('quota_management.forecast_next_reset', { defaultValue: 'Next reset' })}</dt>
            <dd>
              {projection.nextReset
                ? `+${projection.nextReset.gain}% ${formatWhen(projection.nextReset.at)}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>
              {t('quota_management.forecast_burn_last', { defaultValue: 'Burn, last' })} {burnHours}
              h
            </dt>
            <dd>{basisDrain === null ? '—' : `${Math.round(basisDrain * 10) / 10}%/h`}</dd>
          </div>
        </dl>
      </div>

      {tab === 'remaining' ? (
        <Chart
          series={[{ points: history }, { points: projected, dashed: true }]}
          fromMs={fromMs}
          toMs={toMs}
          yMax={Math.max(summary.capacity, 100)}
          nowMs={now}
          unit="%"
          markers={markers}
          emptyLabel={t('quota_management.forecast_empty', { defaultValue: 'Not enough data yet' })}
        />
      ) : (
        <Chart
          series={[{ points: drain }]}
          fromMs={fromMs}
          toMs={toMs}
          yMax={niceMax(drainPeak)}
          nowMs={now}
          unit="%/h"
          emptyLabel={t('quota_management.forecast_empty', { defaultValue: 'Not enough data yet' })}
        />
      )}

      <footer className={styles.legendRow}>
        <span className={styles.poolLabel}>
          {tab === 'remaining'
            ? t('quota_management.forecast_pool', { defaultValue: 'Pool' })
            : `${t('quota_management.forecast_peak', { defaultValue: 'Peak' })} ${Math.round(drainPeak)}%/h`}
        </span>
        <span className={styles.legend}>
          <span className={styles.keyLine} />
          {t('quota_management.forecast_legend_recorded', { defaultValue: 'Recorded' })}
          {tab === 'remaining' && (
            <>
              <span className={styles.keyDash} />
              {t('quota_management.forecast_legend_projected', { defaultValue: 'Projected' })}
            </>
          )}
        </span>
      </footer>

      {showAccounts && (
        <ul className={styles.accounts}>
          {lanes.map((lane) => (
            <li key={lane.name}>
              <span title={displayNameFor(lane.displayName)}>
                {displayNameFor(lane.displayName)}
              </span>
              <b>{Math.round(lane.remaining ?? 0)}%</b>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export interface QuotaForecastProps {
  lanes: TimelineLane[];
  samples: QuotaHistorySample[];
  now: number;
  displayNameFor?: (name: string) => string;
  resolvedTheme?: ResolvedTheme;
}

export function QuotaForecast({
  lanes,
  samples,
  now,
  displayNameFor = (name) => name,
  resolvedTheme = 'dark',
}: QuotaForecastProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ChartTab>('remaining');
  const [quotaWindow, setQuotaWindow] = useState<QuotaWindow>('5h');
  const [burnHours, setBurnHours] = useState<number>(3);
  const [futureKey, setFutureKey] = useState<(typeof FUTURE_USAGE)[number]['key']>('same');
  const [showAccounts, setShowAccounts] = useState(false);
  const [offset, setOffset] = useState(0);

  const { spanMs, pastMs } = WINDOW_SPAN[quotaWindow];
  const fromMs = now - pastMs + offset * spanMs;
  const toMs = fromMs + spanMs;
  const factor = FUTURE_USAGE.find((o) => o.key === futureKey)?.factor ?? 1;

  const byProvider = useMemo(() => {
    const groups = new Map<string, TimelineLane[]>();
    forecastLanes(lanes)
      .filter((lane) => (quotaWindow === '5h' ? lane.periodHours === 5 : lane.periodHours === 168))
      .forEach((lane) => {
        const list = groups.get(lane.provider) ?? [];
        list.push(lane);
        groups.set(lane.provider, list);
      });
    return [...groups.entries()];
  }, [lanes, quotaWindow]);

  if (forecastLanes(lanes).length === 0) return null;

  const rangeLabel = `${formatShortDate(fromMs)} ${t('quota_management.forecast_to', { defaultValue: 'to' })} ${formatShortDate(toMs)}`;

  return (
    <div className={styles.forecast}>
      <div className={styles.controls}>
        <div className={styles.segment} role="tablist">
          {(['remaining', 'drain'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? styles.segActive : styles.seg}
              onClick={() => setTab(id)}
            >
              {id === 'remaining'
                ? t('quota_management.forecast_tab_remaining', { defaultValue: 'Remaining' })
                : t('quota_management.forecast_tab_drain', { defaultValue: 'Drain rate' })}
            </button>
          ))}
        </div>

        <div className={styles.group}>
          <span className={styles.groupLabel}>
            {t('quota_management.forecast_burn_rate', { defaultValue: 'Burn rate' })}
          </span>
          <div className={styles.segment}>
            {BURN_OPTIONS.map((hours) => (
              <button
                key={hours}
                type="button"
                aria-pressed={burnHours === hours}
                className={burnHours === hours ? styles.segActive : styles.seg}
                onClick={() => setBurnHours(hours)}
              >
                {hours}h
              </button>
            ))}
          </div>
        </div>

        <label className={styles.group}>
          <span className={styles.groupLabel}>
            {t('quota_management.forecast_future_usage', { defaultValue: 'Future usage' })}
          </span>
          <select
            className={styles.selectBox}
            value={futureKey}
            onChange={(event) => setFutureKey(event.target.value as typeof futureKey)}
          >
            {FUTURE_USAGE.map((option) => (
              <option key={option.key} value={option.key}>
                {t(`quota_management.forecast_future_${option.key}`, {
                  defaultValue: option.label,
                })}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.segment}>
          {(['5h', 'weekly'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={quotaWindow === value}
              className={quotaWindow === value ? styles.segActive : styles.seg}
              onClick={() => {
                setQuotaWindow(value);
                setOffset(0);
              }}
            >
              {value === '5h'
                ? t('quota_management.forecast_window_5h')
                : t('quota_management.forecast_window_weekly')}
            </button>
          ))}
        </div>

        <button
          type="button"
          aria-pressed={showAccounts}
          className={showAccounts ? styles.segActive : styles.seg}
          onClick={() => setShowAccounts((value) => !value)}
        >
          {t('quota_management.forecast_accounts_toggle', { defaultValue: 'Accounts' })}
        </button>

        <div className={styles.nav}>
          <span className={styles.range}>{rangeLabel}</span>
          <button type="button" onClick={() => setOffset((v) => v - 1)} aria-label="Previous">
            ‹
          </button>
          <button type="button" onClick={() => setOffset(0)} disabled={offset === 0}>
            {t('quota_management.windows_today', { defaultValue: 'Today' })}
          </button>
          <button type="button" onClick={() => setOffset((v) => v + 1)} aria-label="Next">
            ›
          </button>
        </div>
      </div>

      {byProvider.length === 0 ? (
        <div className={styles.panel}>
          <div className={styles.emptyPanel}>
            {t('quota_management.forecast_empty_window', {
              defaultValue: 'No credentials report a quota window of this length.',
            })}
          </div>
        </div>
      ) : (
        byProvider.map(([provider, providerLanes]) => (
          <ProviderPanel
            key={provider}
            provider={provider}
            lanes={providerLanes}
            samples={samples}
            now={now}
            tab={tab}
            burnHours={burnHours}
            factor={factor}
            fromMs={fromMs}
            toMs={toMs}
            showAccounts={showAccounts}
            displayNameFor={displayNameFor}
            resolvedTheme={resolvedTheme}
          />
        ))
      )}
    </div>
  );
}

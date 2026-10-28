/**
 * Collapsible aggregate panel: summed remaining quota, its history and
 * projection, and the drain rate. All maths lives in quotaForecastModel.ts.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HOUR_MS } from '../quotaTimelineModel';
import type { TimelineLane } from '../quotaTimelineModel';
import type { QuotaHistorySample } from '@/services/api/quotaHistory';
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
const PAD = { left: 48, right: 12, top: 12, bottom: 28 };

const FUTURE_DAYS = [3, 7, 14] as const;
const FUTURE_HOURS = [12, 24] as const;
const PAST_OPTIONS = [
  { hours: 6, key: '6h' },
  { hours: 24, key: '24h' },
  { hours: 168, key: '7d' },
] as const;

type ChartTab = 'remaining' | 'drain';

const formatTick = (ms: number, spanMs: number) => {
  const d = new Date(ms);
  return spanMs > 36 * HOUR_MS
    ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const niceMax = (max: number) => {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / step) * step;
};

interface ChartProps {
  series: { points: ForecastPoint[]; dashed?: boolean }[];
  fromMs: number;
  toMs: number;
  yMax: number;
  nowMs?: number;
  unit: string;
  emptyLabel: string;
}

function Chart({ series, fromMs, toMs, yMax, nowMs, unit, emptyLabel }: ChartProps) {
  const [hover, setHover] = useState<{ at: number; value: number; dashed: boolean } | null>(null);
  const x = (at: number) =>
    PAD.left + ((at - fromMs) / (toMs - fromMs)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - Math.min(v, yMax) / yMax) * (H - PAD.top - PAD.bottom);
  const hasData = series.some((s) => s.points.length > 1);
  const ticks = [0, 1, 2, 3, 4].map((i) => (yMax / 4) * i);
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
        {[0, 1, 2, 3, 4].map((i) => {
          const at = fromMs + (spanMs / 4) * i;
          return (
            <text
              key={i}
              x={x(at)}
              y={H - 8}
              className={styles.axisText}
              textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}
            >
              {formatTick(at, spanMs)}
            </text>
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
            <text x={x(nowMs) + 4} y={PAD.top + 10} className={styles.axisText}>
              Now
            </text>
          </g>
        )}
        {series.map((s, index) => {
          if (s.points.length < 2) return null;
          const line = s.points.map((p) => `${x(p.at)},${y(p.value)}`).join(' ');
          return (
            <g key={index}>
              {!s.dashed && (
                <polygon
                  points={`${x(s.points[0].at)},${y(0)} ${line} ${x(s.points[s.points.length - 1].at)},${y(0)}`}
                  className={styles.area}
                />
              )}
              <polyline points={line} className={s.dashed ? styles.lineDashed : styles.line} />
            </g>
          );
        })}
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
          {new Date(hover.at).toLocaleString(undefined, {
            weekday: 'short',
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          · {Math.round(hover.value * 10) / 10}
          {unit === '%' ? '%' : ` ${unit}`}
          {unit === '%' ? ' left' : ''}
          {hover.dashed ? ' · projected' : ''}
        </div>
      )}
    </div>
  );
}

export interface QuotaForecastProps {
  lanes: TimelineLane[];
  samples: QuotaHistorySample[];
  now: number;
}

export function QuotaForecast({ lanes, samples, now }: QuotaForecastProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<ChartTab>('remaining');
  const [futureDays, setFutureDays] = useState<number>(7);
  const [futureHours, setFutureHours] = useState<number>(12);
  const [pastHours, setPastHours] = useState<number>(24);
  const [basisHours, setBasisHours] = useState<number>(24);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [window, setWindow] = useState<'weekly' | '5h'>('weekly');

  const horizonMs = (window === '5h' ? futureHours : futureDays * 24) * HOUR_MS;

  const usable = useMemo(
    () =>
      forecastLanes(lanes).filter((lane) =>
        window === '5h' ? lane.periodHours === 5 : lane.periodHours === 168
      ),
    [lanes, window]
  );
  const summary = useMemo(() => summarizeLanes(usable), [usable]);

  const basisDrain = useMemo(
    () => averageDrainPerHour(buildDrainSeries(samples, usable, now - basisHours * HOUR_MS, now)),
    [samples, usable, now, basisHours]
  );

  const projection = useMemo(
    () => projectRemaining(usable, basisDrain ?? 0, now, horizonMs),
    [usable, basisDrain, now, horizonMs]
  );

  const history = useMemo(
    () => buildRemainingSeries(samples, usable, now - 3 * 24 * HOUR_MS, now),
    [samples, usable, now]
  );
  // Anchor the solid line at the live snapshot so it joins the projection.
  const historyWithNow = useMemo(
    () => [...history.filter((p) => p.at < now), { at: now, value: summary.remaining }],
    [history, now, summary.remaining]
  );

  const drain = useMemo(
    () => buildDrainSeries(samples, usable, now - pastHours * HOUR_MS, now),
    [samples, usable, now, pastHours]
  );
  const drainPeak = drain.reduce((max, p) => Math.max(max, p.value), 0);

  if (forecastLanes(lanes).length === 0) return null;

  const rate = basisDrain === null ? null : Math.round(basisDrain * 10) / 10;

  return (
    <section className={styles.panel}>
      <header className={styles.summary}>
        <span className={styles.big}>{summary.remaining}%</span>
        <span className={styles.of}>
          / {summary.capacity}%{' '}
          {t('quota_management.forecast_remaining', { defaultValue: 'remaining' })}
        </span>
        {rate !== null && (
          <span className={styles.rate}>
            ~{rate}% {t('quota_management.forecast_per_hour', { defaultValue: 'per hour' })}
          </span>
        )}
        <button
          type="button"
          className={styles.collapse}
          aria-expanded={open}
          aria-label={t('quota_management.forecast_toggle', { defaultValue: 'Toggle forecast' })}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '⌃' : '⌄'}
        </button>
      </header>

      {open && (
        <>
          <div className={styles.tabs} role="tablist">
            {(['remaining', 'drain'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? styles.tabActive : styles.tab}
                onClick={() => setTab(id)}
              >
                {id === 'remaining'
                  ? t('quota_management.forecast_tab_remaining', {
                      defaultValue: 'Remaining quota',
                    })
                  : t('quota_management.forecast_tab_drain', { defaultValue: 'Drain rate' })}
              </button>
            ))}
          </div>

          <div className={styles.toolbar}>
            <label className={styles.select}>
              {t('quota_management.forecast_window')}
              <select
                value={window}
                onChange={(event) => setWindow(event.target.value as 'weekly' | '5h')}
              >
                <option value="weekly">{t('quota_management.forecast_window_weekly')}</option>
                <option value="5h">{t('quota_management.forecast_window_5h')}</option>
              </select>
            </label>
            <span className={styles.legend}>
              {tab === 'remaining' ? (
                <>
                  <span className={styles.keyLine} />{' '}
                  {t('quota_management.forecast_legend_remaining', { defaultValue: 'Remaining' })}
                  <span className={styles.keyDash} />{' '}
                  {t('quota_management.forecast_legend_projected', { defaultValue: 'Projected' })}
                </>
              ) : (
                <>
                  <span className={styles.keyLine} /> %{' '}
                  {t('quota_management.forecast_per_hour', { defaultValue: 'per hour' })}
                  {' · '}
                  {t('quota_management.forecast_hour_average', { defaultValue: '1-hour average' })}
                </>
              )}
            </span>
            <label className={styles.select}>
              {tab === 'remaining'
                ? t('quota_management.forecast_next', { defaultValue: 'Next' })
                : t('quota_management.forecast_show', { defaultValue: 'Show' })}
              {tab === 'remaining' ? (
                <select
                  value={window === '5h' ? futureHours : futureDays}
                  onChange={(e) =>
                    window === '5h'
                      ? setFutureHours(Number(e.target.value))
                      : setFutureDays(Number(e.target.value))
                  }
                >
                  {(window === '5h' ? FUTURE_HOURS : FUTURE_DAYS).map((duration) => (
                    <option key={duration} value={duration}>
                      {duration}{' '}
                      {window === '5h'
                        ? t('quota_management.forecast_hours')
                        : t('quota_management.forecast_days', { defaultValue: 'days' })}
                    </option>
                  ))}
                </select>
              ) : (
                <select value={pastHours} onChange={(e) => setPastHours(Number(e.target.value))}>
                  {PAST_OPTIONS.map((option) => (
                    <option key={option.key} value={option.hours}>
                      {t(`quota_management.forecast_last_${option.key}`, {
                        defaultValue: `Last ${option.key === '7d' ? '7 days' : option.key === '24h' ? '24 hours' : '6 hours'}`,
                      })}
                    </option>
                  ))}
                </select>
              )}
            </label>
          </div>

          {tab === 'remaining' ? (
            <>
              <Chart
                series={[
                  { points: historyWithNow },
                  {
                    points: [{ at: now, value: summary.remaining }, ...projection.points.slice(1)],
                    dashed: true,
                  },
                ]}
                fromMs={now - 3 * 24 * HOUR_MS}
                toMs={now + horizonMs}
                yMax={Math.max(summary.capacity, 100)}
                nowMs={now}
                unit="%"
                emptyLabel={t('quota_management.forecast_empty', {
                  defaultValue: 'Not enough data yet',
                })}
              />
              <footer className={styles.foot}>
                <span>
                  {projection.nextReset
                    ? `${t('quota_management.forecast_next_reset', { defaultValue: 'Next reset' })} +${projection.nextReset.gain}% · ${new Date(projection.nextReset.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
                    : ''}
                </span>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setSettingsOpen((v) => !v)}
                >
                  {settingsOpen ? '▼' : '▶'}{' '}
                  {t('quota_management.forecast_settings', { defaultValue: 'Forecast settings' })}
                </button>
              </footer>
              {settingsOpen && (
                <div className={styles.settings}>
                  <label className={styles.select}>
                    {t('quota_management.forecast_basis', { defaultValue: 'Drain rate based on' })}
                    <select
                      value={basisHours}
                      onChange={(e) => setBasisHours(Number(e.target.value))}
                    >
                      <option value={6}>
                        {t('quota_management.forecast_last_6h', { defaultValue: 'Last 6 hours' })}
                      </option>
                      <option value={24}>
                        {t('quota_management.forecast_last_24h', { defaultValue: 'Last 24 hours' })}
                      </option>
                      <option value={168}>
                        {t('quota_management.forecast_last_7d', { defaultValue: 'Last 7 days' })}
                      </option>
                    </select>
                  </label>
                </div>
              )}
            </>
          ) : (
            <>
              <Chart
                series={[{ points: drain }]}
                fromMs={now - pastHours * HOUR_MS}
                toMs={now}
                yMax={niceMax(drainPeak)}
                unit="%/h"
                emptyLabel={t('quota_management.forecast_empty', {
                  defaultValue: 'Not enough data yet',
                })}
              />
              <footer className={styles.foot}>
                <span>
                  {t('quota_management.forecast_peak', { defaultValue: 'Peak' })}{' '}
                  {Math.round(drainPeak)} %{' '}
                  {t('quota_management.forecast_per_hour', { defaultValue: 'per hour' })}
                  {' · '}
                  {t('quota_management.forecast_drain_note', {
                    defaultValue: 'Resets excluded · Gaps mean missing history',
                  })}
                </span>
              </footer>
            </>
          )}
        </>
      )}
    </section>
  );
}

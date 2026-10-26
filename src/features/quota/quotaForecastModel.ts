/**
 * Quota forecast maths: aggregate remaining, history series, drain rate and
 * projection. Pure functions — `now` is always passed in.
 */

import type { QuotaHistorySample } from '@/services/api/quotaHistory';
import { HOUR_MS, windowsIn, type TimelineLane } from './quotaTimelineModel';

/** Longest gap between two samples that is still treated as continuous. */
const MAX_SAMPLE_GAP_MS = 3 * HOUR_MS;

export interface ForecastPoint {
  at: number;
  value: number;
}

export interface ForecastSummary {
  remaining: number;
  capacity: number;
}

/** Lanes that can be summed: they report a remaining percent for their window. */
export const forecastLanes = (lanes: TimelineLane[]) =>
  lanes.filter((lane) => lane.anchorMs !== null && lane.remaining !== null && lane.periodHours);

export function summarizeLanes(lanes: TimelineLane[]): ForecastSummary {
  const usable = forecastLanes(lanes);
  return {
    remaining: Math.round(usable.reduce((sum, lane) => sum + (lane.remaining ?? 0), 0)),
    capacity: usable.length * 100,
  };
}

const laneKey = (provider: string, name: string) => `${provider}\0${name}`;

const groupSamples = (samples: QuotaHistorySample[], lanes: TimelineLane[]) => {
  const wanted = new Set(lanes.map((lane) => laneKey(lane.provider, lane.name)));
  const byLane = new Map<string, QuotaHistorySample[]>();
  samples.forEach((sample) => {
    const key = laneKey(sample.provider, sample.name);
    if (!wanted.has(key)) return;
    const list = byLane.get(key) ?? [];
    list.push(sample);
    byLane.set(key, list);
  });
  byLane.forEach((list) => list.sort((a, b) => a.at - b.at));
  return byLane;
};

/** Summed remaining percent per hour bucket; null buckets are gaps in history. */
export function buildRemainingSeries(
  samples: QuotaHistorySample[],
  lanes: TimelineLane[],
  fromMs: number,
  toMs: number
): ForecastPoint[] {
  const byLane = groupSamples(samples, lanes);
  const points: ForecastPoint[] = [];
  const start = Math.ceil(fromMs / HOUR_MS) * HOUR_MS;
  for (let at = start; at <= toMs; at += HOUR_MS) {
    let total = 0;
    let seen = 0;
    byLane.forEach((list) => {
      let last: QuotaHistorySample | undefined;
      for (const sample of list) {
        if (sample.at > at) break;
        last = sample;
      }
      if (last && at - last.at <= MAX_SAMPLE_GAP_MS) {
        total += last.remaining;
        seen += 1;
      }
    });
    if (seen > 0) points.push({ at, value: total });
  }
  return points;
}

/**
 * Percent drained per hour, 1-hour buckets. Increases between samples are
 * resets and are excluded, as are intervals with missing history.
 */
export function buildDrainSeries(
  samples: QuotaHistorySample[],
  lanes: TimelineLane[],
  fromMs: number,
  toMs: number
): ForecastPoint[] {
  const byLane = groupSamples(samples, lanes);
  const start = Math.floor(fromMs / HOUR_MS) * HOUR_MS;
  const buckets = new Map<number, number>();
  const covered = new Set<number>();
  byLane.forEach((list) => {
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1];
      const cur = list[i];
      const dt = cur.at - prev.at;
      if (dt <= 0 || dt > MAX_SAMPLE_GAP_MS || cur.at < start || cur.at > toMs) continue;
      const bucket = Math.floor(cur.at / HOUR_MS) * HOUR_MS;
      covered.add(bucket);
      const drained = prev.remaining - cur.remaining;
      if (drained > 0) buckets.set(bucket, (buckets.get(bucket) ?? 0) + drained);
    }
  });
  return [...covered].sort((a, b) => a - b).map((at) => ({ at, value: buckets.get(at) ?? 0 }));
}

/** Average drain in percent per hour across the window; null without history. */
export function averageDrainPerHour(drain: ForecastPoint[]): number | null {
  if (drain.length === 0) return null;
  return drain.reduce((sum, point) => sum + point.value, 0) / drain.length;
}

/**
 * Projected summed remaining. Each lane drains an equal share of `drainPerHour`
 * and snaps back to 100% at every reset boundary of its window.
 */
export function projectRemaining(
  lanes: TimelineLane[],
  drainPerHour: number,
  nowMs: number,
  horizonMs: number
): { points: ForecastPoint[]; nextReset: { at: number; gain: number } | null } {
  const usable = forecastLanes(lanes);
  if (usable.length === 0) return { points: [], nextReset: null };

  const share = Math.max(0, drainPerHour) / usable.length;
  const stepMs = HOUR_MS / 2;
  const endMs = nowMs + horizonMs;
  const resets = usable.map((lane) =>
    windowsIn(lane.anchorMs as number, (lane.periodHours as number) * HOUR_MS, nowMs, endMs)
      .map((window) => window.endMs)
      .filter((at) => at > nowMs)
  );

  const valueAt = (at: number, laneIndex: number) => {
    const lane = usable[laneIndex];
    const lastReset = resets[laneIndex].filter((reset) => reset <= at).pop();
    const base = lastReset === undefined ? (lane.remaining as number) : 100;
    const from = lastReset ?? nowMs;
    return Math.max(0, base - (share * (at - from)) / HOUR_MS);
  };

  const times = new Set<number>();
  for (let at = nowMs; at <= endMs; at += stepMs) times.add(at);
  resets.flat().forEach((reset) => {
    times.add(reset - 1);
    times.add(reset);
  });
  const points = [...times]
    .filter((at) => at <= endMs)
    .sort((a, b) => a - b)
    .map((at) => ({
      at,
      value: usable.reduce((sum, _lane, index) => sum + valueAt(at, index), 0),
    }));

  const firstReset = resets.flat().sort((a, b) => a - b)[0];
  let nextReset: { at: number; gain: number } | null = null;
  if (firstReset !== undefined) {
    const before = points.find((p) => p.at === firstReset - 1);
    const after = points.find((p) => p.at === firstReset);
    if (before && after)
      nextReset = { at: firstReset, gain: Math.round(after.value - before.value) };
  }
  return { points, nextReset };
}

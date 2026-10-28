import { expect, test } from 'bun:test';
import {
  averageDrainPerHour,
  buildDrainSeries,
  projectRemaining,
  summarizeLanes,
} from '../src/features/quota/quotaForecastModel';
import type { TimelineLane } from '../src/features/quota/quotaTimelineModel';

const HOUR = 3600_000;
const lane = (name: string, remaining: number, anchorMs: number): TimelineLane => ({
  name,
  displayName: name,
  provider: 'claude',
  anchorMs,
  periodHours: 168,
  remaining,
  limits: [],
  resetCredits: [],
});

test('summarizes remaining and capacity', () => {
  const s = summarizeLanes([lane('a', 40, 1), lane('b', 60, 1)]);
  expect(s).toEqual({ remaining: 100, capacity: 200 });
});

test('drain ignores resets and gaps', () => {
  const base = 100 * HOUR;
  const lanes = [lane('a', 0, 1)];
  const at = (h: number, remaining: number) => ({
    provider: 'claude',
    name: 'a',
    at: base + h * HOUR,
    remaining,
    window: 'weekly' as const,
  });
  const drain = buildDrainSeries(
    [at(0, 50), at(1, 45), at(2, 100), at(10, 90)],
    lanes,
    base,
    base + 12 * HOUR
  );
  expect(drain.map((p) => p.value)).toEqual([5, 0]);
  expect(averageDrainPerHour(drain)).toBe(2.5);
});

test('history keeps five-hour and weekly windows independent and ignores legacy samples', () => {
  const base = 100 * HOUR;
  const samples = [
    { provider: 'claude', name: 'a', at: base, remaining: 80, window: 'weekly' as const },
    { provider: 'claude', name: 'a', at: base + HOUR, remaining: 75, window: 'weekly' as const },
    { provider: 'claude', name: 'a', at: base, remaining: 90, window: '5h' as const },
    { provider: 'claude', name: 'a', at: base + HOUR, remaining: 60, window: '5h' as const },
    { provider: 'claude', name: 'a', at: base + HOUR / 2, remaining: 0 },
  ];
  expect(buildDrainSeries(samples, [lane('a', 75, 1)], base, base + HOUR)[0].value).toBe(5);
  expect(
    buildDrainSeries(samples, [{ ...lane('a', 60, 1), periodHours: 5 }], base, base + HOUR)[0].value
  ).toBe(30);
});

test('projection resets lane to full at its boundary', () => {
  const now = 1000 * HOUR;
  const { points, nextReset } = projectRemaining(
    [lane('a', 10, now + 5 * HOUR)],
    1,
    now,
    10 * HOUR
  );
  expect(nextReset?.at).toBe(now + 5 * HOUR);
  expect(nextReset?.gain ?? 0).toBeGreaterThan(80);
  expect(points[points.length - 1].value).toBeGreaterThan(90);
});

test('five-hour projections cover both hourly horizons and include repeated resets', () => {
  const now = 1000 * HOUR;
  const lanes = [{ ...lane('a', 50, now + HOUR), periodHours: 5 }];
  for (const hours of [12, 24]) {
    const projection = projectRemaining(lanes, 10, now, hours * HOUR);
    expect(projection.points.at(-1)?.at).toBe(now + hours * HOUR);
    for (let resetHour = 1; resetHour <= hours; resetHour += 5) {
      const resetAt = now + resetHour * HOUR;
      expect(projection.points.find((point) => point.at === resetAt)?.value).toBe(100);
      expect(projection.points.find((point) => point.at === resetAt - 1)?.value).toBeLessThan(100);
    }
  }
});

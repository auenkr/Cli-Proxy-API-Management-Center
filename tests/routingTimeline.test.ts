import { expect, test } from 'bun:test';
import { readTimelineBlocks, writeTimelineBlocks } from '../src/services/api/routingTimeline';
import { coversWeekday, nextWeeklyWindow, weekdayAt } from '../src/features/timeline/weeklyWindow';

test('weekly routing keeps weekdays, time zone, account order, strategy, and quota', () => {
  const timeline = [
    {
      provider: 'codex',
      accounts: ['second', 'first'],
      strategy: 'fill-first',
      weekly: { days: [1, 3, 5], start: '21:00', end: '03:00', 'time-zone': 'Asia/Kolkata' },
      'max-weekly-usage': 90,
    },
    { provider: 'codex', accounts: ['first'], until: '2026-11-23T18:00:00Z' },
  ];
  const blocks = readTimelineBlocks({ routing: { timeline } });
  expect(blocks[0].weekly?.timeZone).toBe('Asia/Kolkata');
  expect(blocks[1].strategy).toBe('');
  expect(writeTimelineBlocks(blocks)).toEqual(timeline);
});

test('new weekly windows avoid existing same-day and overnight coverage', () => {
  const overnight = { days: [6], start: '22:00', end: '11:00', timeZone: 'UTC' };
  const morning = { days: [0], start: '11:00', end: '12:00', timeZone: 'UTC' };
  expect(nextWeeklyWindow(0, 'UTC', [overnight, morning])).toEqual({
    days: [0],
    start: '12:00',
    end: '15:00',
    timeZone: 'UTC',
  });
  expect(
    nextWeeklyWindow(0, 'UTC', [{ ...morning, start: '00:00', end: '00:00' }])
  ).toBeUndefined();
});

test('overnight filtering includes the next day and uses the plan zone to mark today', () => {
  const weekly = { days: [6], start: '22:00', end: '02:00', timeZone: 'UTC' };
  expect(coversWeekday(weekly, 0)).toBe(true);
  expect(coversWeekday({ ...weekly, end: '00:00' }, 0)).toBe(false);
  expect(weekdayAt(Date.parse('2026-11-23T00:30:00Z'), 'America/New_York')).toBe(0);
});

test('suggested gaps only compare clocks in the selected zone', () => {
  const utc = { days: [1], start: '09:00', end: '12:00', timeZone: 'UTC' };
  const newYork = { days: [1], start: '12:00', end: '15:00', timeZone: 'America/New_York' };
  expect(nextWeeklyWindow(1, 'UTC', [utc, newYork])).toEqual({
    days: [1],
    start: '12:00',
    end: '15:00',
    timeZone: 'UTC',
  });
});

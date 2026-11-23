import type { WeeklyWindow } from '@/services/api/routingTimeline';

export const WEEK = [1, 2, 3, 4, 5, 6, 0];
export const weekday = (day: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, 7 + day))
  );

export const carriesIntoDay = (weekly: WeeklyWindow, day: number) =>
  weekly.days.includes((day + 6) % 7) && weekly.end !== '00:00' && weekly.end <= weekly.start;

export const coversWeekday = (weekly: WeeklyWindow, day: number) =>
  weekly.days.includes(day) || carriesIntoDay(weekly, day);

export function weekdayAt(now: number, timeZone: string): number {
  const label = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(now);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(label);
}

const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const validWeekly = (weekly: WeeklyWindow): boolean => {
  if (!weekly.days.length || weekly.days.some((day) => !WEEK.includes(day))) return false;
  if (!clockTime.test(weekly.start) || !clockTime.test(weekly.end)) return false;
  // Go expects a named zone. Intl also accepts fixed offsets, which the scheduler cannot load.
  if (!/^[A-Za-z][\w+/-]*$/.test(weekly.timeZone) || weekly.timeZone === 'Local') return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: weekly.timeZone });
    return true;
  } catch {
    return false;
  }
};

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const timeAt = (minute: number) =>
  `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

export function nextWeeklyWindow(
  day: number,
  defaultZone: string,
  windows: WeeklyWindow[]
): WeeklyWindow | undefined {
  const relevant = windows.filter((window) => validWeekly(window) && coversWeekday(window, day));
  const timeZone = relevant[0]?.timeZone ?? defaultZone;
  const occupied: [number, number][] = [];
  for (const window of relevant) {
    if (window.timeZone !== timeZone) continue;
    const start = minutes(window.start);
    const end = minutes(window.end);
    if (window.days.includes(day)) occupied.push([start, end <= start ? 1440 : end]);
    if (carriesIntoDay(window, day)) occupied.push([0, end]);
  }
  occupied.sort(([a], [b]) => a - b);

  // Prefer daytime, then look before 09:00 if the rest of the day is full.
  for (const preferredStart of [540, 0]) {
    let start = preferredStart;
    for (const [from, to] of [...occupied, [1440, 1440]]) {
      if (from > start) {
        return {
          days: [day],
          start: timeAt(start),
          end: timeAt(Math.min(start + 180, from)),
          timeZone,
        };
      }
      start = Math.max(start, to);
    }
  }
}

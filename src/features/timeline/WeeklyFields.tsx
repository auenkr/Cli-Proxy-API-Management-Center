import { useTranslation } from 'react-i18next';
import type { WeeklyWindow } from '@/services/api/routingTimeline';
import styles from './TimelinePage.module.scss';

import { WEEK, weekday, validWeekly } from './weeklyWindow';

const timeZoneValues = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] })
  .supportedValuesOf;
const ZONES = ['UTC', ...(timeZoneValues?.('timeZone') ?? [])];

export function WeeklyFields({
  weekly,
  onChange,
}: {
  weekly: WeeklyWindow;
  onChange: (weekly: WeeklyWindow) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className={styles.field}>
      <div className={styles.chips} role="group" aria-label={t('timeline.repeat_days')}>
        <span className={styles.fieldLabel}>{t('timeline.repeat_days')}</span>
        {WEEK.map((day) => {
          const selected = weekly.days.includes(day);
          return (
            <button
              key={day}
              type="button"
              className={`${styles.chip} ${selected ? styles.chipOn : ''}`}
              aria-pressed={selected}
              onClick={() =>
                onChange({
                  ...weekly,
                  days: selected
                    ? weekly.days.filter((value) => value !== day)
                    : [...weekly.days, day],
                })
              }
            >
              {weekday(day, i18n.language)}
            </button>
          );
        })}
      </div>
      <div className={styles.chips}>
        {(['start', 'end'] as const).map((field) => (
          <label className={styles.inlineField} key={field}>
            <span className={styles.fieldLabel}>{t(`timeline.weekly_${field}`)}</span>
            <input
              className={styles.dateInput}
              type="time"
              value={weekly[field]}
              onChange={(event) => onChange({ ...weekly, [field]: event.target.value })}
            />
          </label>
        ))}
        <label className={styles.inlineField}>
          <span className={styles.fieldLabel}>{t('timeline.time_zone')}</span>
          <select
            className={styles.dateInput}
            value={weekly.timeZone}
            onChange={(event) => onChange({ ...weekly, timeZone: event.target.value })}
          >
            {!ZONES.includes(weekly.timeZone) && (
              <option value={weekly.timeZone}>{weekly.timeZone || '—'}</option>
            )}
            {ZONES.map((zone) => (
              <option key={zone}>{zone}</option>
            ))}
          </select>
        </label>
        {weekly.start && weekly.end && weekly.end <= weekly.start && (
          <span className={styles.muted}>{t('timeline.next_day')}</span>
        )}
      </div>
      {!validWeekly(weekly) && <span className={styles.error}>{t('timeline.invalid_weekly')}</span>}
    </div>
  );
}

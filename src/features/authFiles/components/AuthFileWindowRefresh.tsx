import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { authFilesApi } from '@/services/api/authFiles';
import { useNotificationStore } from '@/stores';
import styles from './AuthFileWindowRefresh.module.scss';

const pad = (n: number) => String(n).padStart(2, '0');

// RFC3339 -> date and time values for native inputs in the browser's local zone.
const toLocalDate = (iso?: string): string => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const toLocalTime = (iso?: string): string => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// Interpret the selected date and time in the user's local zone and persist its UTC instant.
const localDateTimeToUtc = (day: string, time: string): string => {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dayMatch || !timeMatch) return '';
  const date = new Date(
    Number(dayMatch[1]),
    Number(dayMatch[2]) - 1,
    Number(dayMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  if (
    date.getFullYear() !== Number(dayMatch[1]) ||
    date.getMonth() !== Number(dayMatch[2]) - 1 ||
    date.getDate() !== Number(dayMatch[3])
  ) {
    return '';
  }
  return date.toISOString();
};

export function AuthFileWindowRefresh({
  fileName,
  disabled,
}: {
  fileName: string;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [enabled, setEnabled] = useState(true);
  const [anchorDate, setAnchorDate] = useState('');
  const [anchor, setAnchor] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    authFilesApi
      .getWindowRefresh(fileName)
      .then((setting) => {
        if (cancelled) return;
        setEnabled(setting.enabled);
        setAnchorDate(toLocalDate(setting.anchor));
        setAnchor(toLocalTime(setting.anchor));
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fileName]);

  const save = async () => {
    setSaving(true);
    try {
      await authFilesApi.putWindowRefresh(fileName, {
        enabled,
        anchor: localDateTimeToUtc(anchorDate, anchor),
      });
      showNotification(t('auth_files.window_refresh_saved'), 'success');
    } catch {
      showNotification(t('auth_files.window_refresh_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const busy = disabled || saving || !loaded;
  return (
    <div className="form-group">
      <label>{t('auth_files.window_refresh_label')}</label>
      <ToggleSwitch
        checked={enabled}
        onChange={setEnabled}
        disabled={busy}
        ariaLabel={t('auth_files.window_refresh_label')}
      />
      <div className="form-group">
        <label>{t('auth_files.window_refresh_anchor')}</label>
        <div className={styles.pickerGrid}>
          <Input
            label={t('auth_files.window_refresh_date')}
            type="date"
            value={anchorDate}
            disabled={busy || !enabled}
            className={styles.pickerInput}
            onChange={(event) => setAnchorDate(event.target.value)}
          />
          <Input
            label={t('auth_files.window_refresh_time')}
            type="time"
            value={anchor}
            step={60}
            disabled={busy || !enabled}
            className={styles.pickerInput}
            onChange={(event) => setAnchor(event.target.value)}
          />
        </div>
      </div>
      <div className="hint">{t('auth_files.window_refresh_hint')}</div>
      <Button variant="secondary" disabled={busy} onClick={() => void save()}>
        {t('common.save')}
      </Button>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { authFilesApi } from '@/services/api/authFiles';
import { useNotificationStore } from '@/stores';

const pad = (n: number) => String(n).padStart(2, '0');

// RFC3339 -> value for <input type="time"> in the browser's local zone.
const toLocalTime = (iso?: string): string => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// A time-only input has no date or timezone. Use the next occurrence in the user's
// local timezone, then send its UTC instant so the server timezone cannot shift it.
const localTimeToUtc = (value: string): string => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return '';
  const now = new Date();
  const date = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number(match[1]),
    Number(match[2]),
  );
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1);
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
        anchor: localTimeToUtc(anchor),
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
      <Input
        label={t('auth_files.window_refresh_anchor')}
        type="time"
        value={anchor}
        disabled={busy || !enabled}
        onChange={(event) => setAnchor(event.target.value)}
      />
      <div className="hint">{t('auth_files.window_refresh_hint')}</div>
      <Button variant="secondary" disabled={busy} onClick={() => void save()}>
        {t('common.save')}
      </Button>
    </div>
  );
}

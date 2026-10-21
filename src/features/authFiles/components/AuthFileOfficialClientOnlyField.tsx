import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { getOfficialClientOnly, setOfficialClientOnly } from '@/services/api';
import { supportsAuthFileOfficialClientOnly } from '@/features/authFiles/constants';
import { useNotificationStore } from '@/stores';

interface AuthFileOfficialClientOnlyFieldProps {
  providerKey: string;
  disabled: boolean;
}

/** Provider-wide switch stored in config.yaml (oauth.official-client-only), not in the auth file. */
export function AuthFileOfficialClientOnlyField({
  providerKey,
  disabled,
}: AuthFileOfficialClientOnlyFieldProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const supported = supportsAuthFileOfficialClientOnly(providerKey);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(supported);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    setLoading(true);
    getOfficialClientOnly(providerKey)
      .then((value) => {
        if (!cancelled) setEnabled(value);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        showNotification(
          t('auth_files.official_client_only_save_failed', {
            message: error instanceof Error ? error.message : String(error),
          }),
          'error'
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerKey, supported, showNotification, t]);

  if (!supported) return null;

  const handleChange = async (value: boolean) => {
    setSaving(true);
    try {
      await setOfficialClientOnly(providerKey, value);
      setEnabled(value);
    } catch (error) {
      showNotification(
        t('auth_files.official_client_only_save_failed', {
          message: error instanceof Error ? error.message : String(error),
        }),
        'error'
      );
    } finally {
      setSaving(false);
    }
  };

  const provider = providerKey === 'codex' ? 'Codex' : 'Claude';
  return (
    <div className="form-group">
      <label>{t('auth_files.official_client_only_label')}</label>
      <ToggleSwitch
        checked={enabled}
        onChange={(value) => void handleChange(value)}
        disabled={disabled || loading || saving}
        ariaLabel={t('auth_files.official_client_only_label')}
      />
      <div className="hint">
        {t(
          providerKey === 'codex'
            ? 'auth_files.official_client_only_hint_codex'
            : 'auth_files.official_client_only_hint_claude'
        )}
      </div>
      <div className="hint">{t('auth_files.official_client_only_scope', { provider })}</div>
    </div>
  );
}

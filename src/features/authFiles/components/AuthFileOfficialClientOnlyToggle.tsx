import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { supportsAuthFileOfficialClientOnly } from '@/features/authFiles/constants';
import { useNotificationStore } from '@/stores';
import { useOfficialClientOnlyStore } from '@/stores/useOfficialClientOnlyStore';

interface AuthFileOfficialClientOnlyToggleProps {
  providerKey: string;
  disabled: boolean;
  labelClassName?: string;
  groupClassName?: string;
}

/** Provider-wide switch stored in config.yaml (oauth.official-client-only), not in the auth file. */
export function AuthFileOfficialClientOnlyToggle({
  providerKey,
  disabled,
  labelClassName,
  groupClassName,
}: AuthFileOfficialClientOnlyToggleProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const supported = supportsAuthFileOfficialClientOnly(providerKey);
  const enabled = useOfficialClientOnlyStore((state) => state.values[providerKey] === true);
  const loaded = useOfficialClientOnlyStore((state) => state.loaded[providerKey] === true);
  const load = useOfficialClientOnlyStore((state) => state.load);
  const save = useOfficialClientOnlyStore((state) => state.save);
  const [saving, setSaving] = useState(false);

  const reportError = (error: unknown) =>
    showNotification(
      t('auth_files.official_client_only_save_failed', {
        message: error instanceof Error ? error.message : String(error),
      }),
      'error'
    );

  useEffect(() => {
    if (supported) load(providerKey).catch(reportError);
    // reportError only closes over stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerKey, supported, load]);

  if (!supported) return null;

  const handleChange = async (value: boolean) => {
    setSaving(true);
    try {
      await save(providerKey, value);
    } catch (error) {
      reportError(error);
    } finally {
      setSaving(false);
    }
  };

  const provider = providerKey === 'codex' ? 'Codex' : 'Claude';
  const hint = `${t(
    providerKey === 'codex'
      ? 'auth_files.official_client_only_hint_codex'
      : 'auth_files.official_client_only_hint_claude'
  )} ${t('auth_files.official_client_only_scope', { provider })}`;

  return (
    <div className={groupClassName} title={hint}>
      <span className={labelClassName}>{t('auth_files.official_client_only_short')}</span>
      <ToggleSwitch
        ariaLabel={t('auth_files.official_client_only_label')}
        checked={enabled}
        disabled={disabled || !loaded || saving}
        onChange={(value) => void handleChange(value)}
      />
    </div>
  );
}

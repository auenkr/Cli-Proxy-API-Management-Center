import { memo, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useModelsStore } from '@/stores/useModelsStore';
import { apiKeyNameFingerprint, readApiKeyNames, saveApiKeyName } from '../../apiKeyNames';
import { copyToClipboard } from '@/utils/clipboard';
import { makeClientId } from '@/types/visualConfig';
import { generateSecureApiKey } from '@/utils/apiKey';
import { maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import { ApiKeyStrengthMeter } from './ApiKeyStrengthMeter';
import styles from './Blocks.module.scss';

interface ApiKeysCardEditorProps {
  value: string;
  modelRestrictions: Record<string, string[]>;
  onModelRestrictionsChange: (value: Record<string, string[]>) => void;
  disabled?: boolean;
  onChange: (nextValue: string) => void;
}

export const ApiKeysCardEditor = memo(function ApiKeysCardEditor(props: ApiKeysCardEditorProps) {
  const apiBase = useAuthStore((state) => state.apiBase);
  return <ScopedApiKeysCardEditor key={apiBase} {...props} apiBase={apiBase} />;
});

function ScopedApiKeysCardEditor({
  value,
  modelRestrictions,
  onModelRestrictionsChange,
  disabled,
  onChange,
  apiBase,
}: ApiKeysCardEditorProps & { apiBase: string }) {
  const [names, setNames] = useState(() => readApiKeyNames(apiBase));
  const [nameValue, setNameValue] = useState('');
  const [restrictModels, setRestrictModels] = useState(false);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModels = useModelsStore((state) => state.fetchModels);
  const apiKeys = useMemo(
    () =>
      value
        .split('\n')
        .map((key) => key.trim())
        .filter(Boolean),
    [value]
  );
  const nameFingerprints = useMemo(
    () => apiKeys.map((key) => apiKeyNameFingerprint(apiBase, key)),
    [apiBase, apiKeys]
  );
  const [apiKeyIds, setApiKeyIds] = useState(() => apiKeys.map(() => makeClientId()));
  const renderApiKeyIds = useMemo(() => {
    if (apiKeyIds.length === apiKeys.length) return apiKeyIds;
    if (apiKeyIds.length > apiKeys.length) return apiKeyIds.slice(0, apiKeys.length);
    return [
      ...apiKeyIds,
      ...Array.from({ length: apiKeys.length - apiKeyIds.length }, () => makeClientId()),
    ];
  }, [apiKeyIds, apiKeys.length]);

  const apiKeyInputId = useId();
  const nameInputId = useId();
  const nameHintId = `${nameInputId}-hint`;
  const apiKeyHintId = `${apiKeyInputId}-hint`;
  const apiKeyErrorId = `${apiKeyInputId}-error`;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingApiKeyId, setEditingApiKeyId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [formError, setFormError] = useState('');

  const openAddModal = () => {
    setRestrictModels(false);
    setSelectedModels(new Set());
    setNameValue('');
    setEditingApiKeyId(null);
    setInputValue('');
    setFormError('');
    setModalOpen(true);
    void fetchModels(apiBase, apiKeys[0] || undefined, false).catch(() => undefined);
  };

  const openEditModal = (apiKeyId: string) => {
    const editingIndex = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    const latestNames = readApiKeyNames(apiBase);
    setNames(latestNames);
    setNameValue(latestNames[nameFingerprints[editingIndex]] ?? '');
    setEditingApiKeyId(apiKeyId);
    setInputValue(apiKeys[editingIndex] ?? '');
    const key = apiKeys[editingIndex];
    const restricted = Object.prototype.hasOwnProperty.call(modelRestrictions, key);
    setRestrictModels(restricted);
    setSelectedModels(new Set(restricted ? modelRestrictions[key] : []));
    setFormError('');
    setModalOpen(true);
    const fetchForKey = (apiKeys[editingIndex] ?? '').trim() || apiKeys.find((k) => k.trim()) || '';
    void fetchModels(apiBase, fetchForKey || undefined, false).catch(() => undefined);
  };

  const closeModal = () => {
    setModalOpen(false);
    setInputValue('');
    setEditingApiKeyId(null);
    setFormError('');
  };

  const updateApiKeys = (nextKeys: string[]) => {
    onChange(nextKeys.join('\n'));
  };

  const handleDelete = (apiKeyId: string) => {
    const index = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    if (index < 0) return;
    setApiKeyIds(renderApiKeyIds.filter((id) => id !== apiKeyId));
    const nextRestrictions = { ...modelRestrictions };
    delete nextRestrictions[apiKeys[index]];
    onModelRestrictionsChange(nextRestrictions);
    updateApiKeys(apiKeys.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setFormError(t('config_management.visual.api_keys.error_empty'));
      return;
    }
    if (!isValidApiKeyCharset(trimmed)) {
      setFormError(t('config_management.visual.api_keys.error_invalid'));
      return;
    }

    const editingIndex = editingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === editingApiKeyId)
      : -1;
    const nextKeys =
      editingApiKeyId === null
        ? [...apiKeys, trimmed]
        : apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key));
    if (!saveApiKeyName(apiBase, trimmed, nameValue)) {
      setFormError(t('config_management.visual.api_keys.name_save_error'));
      return;
    }
    setNames(readApiKeyNames(apiBase));
    const nextRestrictions = { ...modelRestrictions };
    if (editingIndex >= 0 && apiKeys[editingIndex] !== trimmed) {
      delete nextRestrictions[apiKeys[editingIndex]];
    }
    if (restrictModels) {
      const selected = Array.from(selectedModels);
      // All selected (or none loaded) means unrestricted.
      if (selected.length > 0 && selected.length < models.length) {
        nextRestrictions[trimmed] = selected;
      } else if (selected.length === 0 && models.length > 0) {
        nextRestrictions[trimmed] = [];
      } else {
        delete nextRestrictions[trimmed];
      }
    } else {
      delete nextRestrictions[trimmed];
    }
    onModelRestrictionsChange(nextRestrictions);
    // Retain old fingerprints: configuration edits can still be discarded or fail to save.
    if (editingApiKeyId === null) {
      setApiKeyIds([...renderApiKeyIds, makeClientId()]);
    }
    if (nextKeys.join('\n') !== apiKeys.join('\n')) updateApiKeys(nextKeys);
    closeModal();
  };

  const handleCopy = async (apiKey: string) => {
    const copied = await copyToClipboard(apiKey);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const handleGenerate = () => {
    setInputValue(generateSecureApiKey());
    setFormError('');
  };

  return (
    <div className={styles.apiKeys}>
      <div className={styles.apiKeysHeader}>
        <div className={styles.apiKeysCopy}>
          <span className={styles.apiKeysTitle}>
            {t('config_management.visual.api_keys.label')}
          </span>
          <span className={styles.apiKeysHint}>{t('config_management.visual.api_keys.hint')}</span>
        </div>
        <Button size="sm" onClick={openAddModal} disabled={disabled}>
          {t('config_management.visual.api_keys.add')}
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <div className={styles.emptyState}>{t('config_management.visual.api_keys.empty')}</div>
      ) : (
        <ol className={styles.apiKeyList}>
          {apiKeys.map((key, index) => (
            <li key={renderApiKeyIds[index] ?? `${key}-${index}`} className={styles.apiKeyRow}>
              <span className={styles.apiKeyIndex}>#{index + 1}</span>
              <span className={styles.apiKeyMeta}>
                <span className={styles.apiKeyName}>
                  {names[nameFingerprints[index]] ??
                    t('config_management.visual.api_keys.input_label')}
                </span>
                <span className={styles.apiKeyValue}>{maskApiKey(String(key || ''))}</span>
              </span>
              <span className={styles.apiKeyActions}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(key)}
                  disabled={disabled}
                >
                  {t('common.copy')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEditModal(renderApiKeyIds[index] ?? '')}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.edit')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.apiKeyDelete}
                  onClick={() => handleDelete(renderApiKeyIds[index] ?? '')}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.delete')}
                </Button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={
          editingApiKeyId !== null
            ? t('config_management.visual.api_keys.edit_title')
            : t('config_management.visual.api_keys.add_title')
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={disabled}>
              {t('config_management.visual.common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={disabled}>
              {editingApiKeyId !== null
                ? t('config_management.visual.common.update')
                : t('config_management.visual.common.add')}
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label htmlFor={nameInputId}>{t('config_management.visual.api_keys.name_label')}</label>
          <input
            id={nameInputId}
            className="input"
            value={nameValue}
            onChange={(event) => setNameValue(event.target.value)}
            placeholder={t('config_management.visual.api_keys.name_placeholder')}
            aria-describedby={nameHintId}
            disabled={disabled}
          />
          <div id={nameHintId} className="hint">
            {t('config_management.visual.api_keys.name_hint')}
          </div>
        </div>
        <div className="form-group">
          <label htmlFor={apiKeyInputId}>
            {t('config_management.visual.api_keys.input_label')}
          </label>
          <div className={styles.apiKeyModalInputRow}>
            <input
              id={apiKeyInputId}
              className="input"
              placeholder={t('config_management.visual.api_keys.input_placeholder')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={disabled}
              aria-describedby={formError ? `${apiKeyErrorId} ${apiKeyHintId}` : apiKeyHintId}
              aria-invalid={Boolean(formError)}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleGenerate}
              disabled={disabled}
            >
              {t('config_management.visual.api_keys.generate')}
            </Button>
          </div>
          <ApiKeyStrengthMeter value={inputValue} />
          <div id={apiKeyHintId} className="hint">
            {t('config_management.visual.api_keys.input_hint')}
          </div>
          {formError && (
            <div id={apiKeyErrorId} className="error-box">
              {formError}
            </div>
          )}
        </div>
        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={restrictModels}
              disabled={disabled}
              onChange={(event) => {
                const checked = event.target.checked;
                setRestrictModels(checked);
                if (checked && selectedModels.size === 0 && models.length > 0) {
                  setSelectedModels(new Set(models.map((model) => model.name)));
                }
              }}
            />
            {t('config_management.visual.api_keys.restrict_models')}
          </label>
          {restrictModels && (
            <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="hint">
                {modelsLoading
                  ? t('system_info.models_loading')
                  : t('config_management.visual.api_keys.models_hint')}
              </div>
              <div
                style={{
                  maxHeight: 260,
                  overflow: 'auto',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
                  borderRadius: 8,
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  background: 'var(--surface-secondary, transparent)',
                }}
              >
                {models.map((model) => (
                  <label
                    key={model.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      padding: '2px 0',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedModels.has(model.name)}
                      disabled={disabled}
                      onChange={(event) => {
                        const next = new Set(selectedModels);
                        if (event.target.checked) next.add(model.name);
                        else next.delete(model.name);
                        setSelectedModels(next);
                      }}
                      style={{ margin: 0 }}
                    />
                    <span>{model.name}</span>
                  </label>
                ))}
                {models.length === 0 && !modelsLoading && (
                  <div className="hint">{t('system_info.models_empty')}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

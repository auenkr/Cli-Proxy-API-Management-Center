import { fetchQuotaCached } from '@/features/quota/quotaFetchCache';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
} from '@/stores';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { getStatusFromError, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { isRuntimeOnlyAuthFile, type QuotaProviderType } from '@/features/authFiles/constants';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { bindQuotaClasses } from '@/features/quota/types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import { hasClaudeUsageData } from '@/features/quota/providers/claude/data';
import { useTokenUsage } from '@/features/quota/hooks/useTokenUsage';
import { hasTokenCostData } from '@/features/quota/tokenUsage';
import { TokenCostDistribution } from '@/features/quota/components/TokenCostDistribution';
import { maskEmails } from '@/features/quota/maskEmail';
import { useClaudeResetGrants } from '@/features/quota/providers/claude/ClaudeResetGrants';
import { ClaudeResetGrantDetails } from '@/features/quota/providers/claude/ClaudeResetGrantDetails';
import styles from './AuthFileQuota.module.scss';

/** Bind the auth-file host's compact styles to the quota rendering contract. */
const compactQuotaClasses = bindQuotaClasses(styles, 'AuthFileQuota.module.scss');

const assertNever = (value: never): never => {
  throw new Error(`Unsupported quota type: ${value}`);
};

type QuotaMapUpdater = (
  updater: (prev: Record<string, QuotaCardState>) => Record<string, QuotaCardState>
) => void;

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
  showEmails?: boolean;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls, showEmails = false } = props;
  const displayName = showEmails ? file.name : maskEmails(file.name);
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuota, setResettingQuota] = useState(false);
  const adapter = QUOTA_ADAPTERS[quotaType];
  const cacheKey = getQuotaCacheKey(file);
  const tokenUsage = useTokenUsage();
  const tokenBreakdown = tokenUsage.lookup(file);

  const quota = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.antigravityQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'claude') return state.claudeQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'codex') return state.codexQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'devin') return state.devinQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'kimi') return state.kimiQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'meta') return state.metaQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'plugin') return state.pluginQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'xai') return state.xaiQuota[cacheKey] as QuotaCardState | undefined;
    return assertNever(quotaType);
  });
  const retainedClaudeUsage =
    quotaType === 'claude' && hasClaudeUsageData(quota as ClaudeQuotaState | undefined);

  const updateQuotaState = useQuotaStore(
    (state) => state[adapter.storeSetter] as unknown as QuotaMapUpdater
  );

  const refreshQuotaForFile = useCallback(
    async (force = true) => {
      if (disableControls) return;
      if (isRuntimeOnlyAuthFile(file)) return;
      if (quota?.status === 'loading' || resettingQuota) return;

      const cacheGeneration = captureQuotaCacheGeneration(file.name);

      updateQuotaState((prev) => ({
        ...prev,
        [cacheKey]: adapter.buildLoadingState(),
      }));

      try {
        const data = (await fetchQuotaCached(adapter, file, t, force)) as Awaited<
          ReturnType<typeof adapter.fetchQuota>
        >;
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          updateQuotaState((prev) => ({
            ...prev,
            [cacheKey]: adapter.buildSuccessState(data),
          }));
          showNotification(t('auth_files.quota_refresh_success', { name: displayName }), 'success');
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          updateQuotaState((prev) => ({
            ...prev,
            [cacheKey]: adapter.buildErrorState(message, status),
          }));
          showNotification(
            t('auth_files.quota_refresh_failed', {
              name: displayName,
              message: showEmails ? message : maskEmails(message),
            }),
            'error'
          );
        });
      }
    },
    [
      adapter,
      cacheKey,
      disableControls,
      displayName,
      file,
      quota?.status,
      resettingQuota,
      showEmails,
      showNotification,
      t,
      updateQuotaState,
    ]
  );

  // Auto-load quota when this credential has no cached data yet, so the card
  // no longer sits on the idle "click to refresh" prompt. Runs once per mount.
  const quotaAutoLoadRef = useRef(false);
  useEffect(() => {
    if (quotaAutoLoadRef.current) return;
    if (quota?.status !== undefined && quota.status !== 'idle') return;
    if (disableControls || isRuntimeOnlyAuthFile(file)) return;
    quotaAutoLoadRef.current = true;
    void refreshQuotaForFile(false);
  }, [disableControls, file, quota?.status, refreshQuotaForFile]);

  const resetQuotaForFile = useCallback(() => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;
    if (resettingQuota) return;

    const resetQuota = adapter.resetQuota;
    if (!resetQuota) return;

    showConfirmation({
      title: t('codex_quota.reset_confirm_title'),
      message: t('codex_quota.reset_confirm_message', { name: displayName }),
      confirmText: t('codex_quota.reset_confirm_button'),
      variant: 'primary',
      onConfirm: async () => {
        const cacheGeneration = captureQuotaCacheGeneration(file.name);
        setResettingQuota(true);
        try {
          const data = await resetQuota(file, t);
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            updateQuotaState((prev) => ({
              ...prev,
              [cacheKey]: adapter.buildSuccessState(data),
            }));
            showNotification(t('codex_quota.reset_success', { name: displayName }), 'success');
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            showNotification(
              t('codex_quota.reset_failed', {
                name: displayName,
                message: showEmails ? message : maskEmails(message),
              }),
              'error'
            );
          });
        } finally {
          setResettingQuota(false);
        }
      },
    });
  }, [
    adapter,
    cacheKey,
    disableControls,
    displayName,
    file,
    quota?.status,
    resettingQuota,
    showConfirmation,
    showEmails,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !resettingQuota;
  const canUseResetQuota = canRefreshQuota && !file.disabled && quotaStatus !== 'loading';
  // Idle state already renders a clickable "click to refresh" prompt; only offer the
  // explicit refresh button once quota has been requested so it can be refreshed again.
  const showRefreshQuotaAction = quotaStatus !== 'idle';
  const showResetQuotaAction = quota !== undefined && Boolean(adapter.canResetQuota?.(quota));
  const resetQuotaAction =
    adapter.resetQuota && showResetQuotaAction ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={styles.quotaResetCreditButton}
        onClick={() => resetQuotaForFile()}
        disabled={!canUseResetQuota}
        loading={resettingQuota}
        title={t('codex_quota.reset_button')}
        aria-label={t('codex_quota.reset_button')}
      >
        {!resettingQuota && <IconRefreshCw size={14} />}
        {t('codex_quota.reset_button')}
      </Button>
    ) : undefined;
  // Claude banked resets: same chip, expiry list and action as the quota page.
  const claudeReset = useClaudeResetGrants(
    file,
    quotaType === 'claude' && quotaStatus !== 'idle',
    !canRefreshQuota || quotaStatus === 'loading',
    quota,
    () => void refreshQuotaForFile(),
    displayName
  );
  const showClaudeReset = quotaType === 'claude' && quotaStatus === 'success';
  const claudePlanItems = showClaudeReset ? (
    <span className={compactQuotaClasses.codexPlanItem}>
      <span className={compactQuotaClasses.codexPlanLabel}>{t('claude_reset.remaining')}</span>
      <span className={compactQuotaClasses.codexPlanValue}>{claudeReset.count ?? '--'}</span>
    </span>
  ) : undefined;
  const claudeAfterPlan = showClaudeReset ? (
    <>
      <ClaudeResetGrantDetails grants={claudeReset.grants} classes={compactQuotaClasses} />
      {claudeReset.message && (
        <div role="status" className={compactQuotaClasses.codexResetCreditsError}>
          {t(`claude_reset.${claudeReset.message}`)}
        </div>
      )}
    </>
  ) : undefined;
  const claudeResetAction =
    quotaType === 'claude' && quotaStatus !== 'idle' ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={styles.quotaResetCreditButton}
        onClick={claudeReset.confirm}
        disabled={claudeReset.blocked}
        loading={claudeReset.busy}
        title={t(`claude_reset.${claudeReset.buttonLabel}`)}
      >
        {!claudeReset.busy && <IconRefreshCw size={14} />}
        {t(`claude_reset.${claudeReset.buttonLabel}`)}
      </Button>
    ) : undefined;
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  return (
    <div className={styles.quotaSection}>
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => void refreshQuotaForFile()}
          disabled={!canRefreshQuota}
        >
          {t(`${adapter.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${adapter.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage,
          })}
        </div>
      ) : quota && !retainedClaudeUsage ? (
        <adapter.Body
          quota={quota}
          classes={compactQuotaClasses}
          planItems={claudePlanItems}
          afterPlan={claudeAfterPlan}
        />
      ) : !retainedClaudeUsage ? (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.idle`)}</div>
      ) : null}
      {retainedClaudeUsage && quota && (
        <adapter.Body
          quota={quota}
          classes={compactQuotaClasses}
          planItems={claudePlanItems}
          afterPlan={claudeAfterPlan}
        />
      )}
      {(showRefreshQuotaAction || resetQuotaAction || claudeResetAction) && (
        <div className={styles.quotaCardActions}>
          {claudeResetAction}
          {resetQuotaAction}
          {showRefreshQuotaAction && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={styles.quotaResetCreditButton}
              onClick={() => void refreshQuotaForFile()}
              disabled={!canRefreshQuota || quotaStatus === 'loading'}
              loading={quotaStatus === 'loading'}
              title={t('auth_files.quota_refresh_hint')}
            >
              {quotaStatus !== 'loading' && <IconRefreshCw size={14} />}
              {t('auth_files.quota_refresh_single')}
            </Button>
          )}
        </div>
      )}
      {hasTokenCostData(tokenBreakdown) && tokenBreakdown && (
        <TokenCostDistribution breakdown={tokenBreakdown} compact />
      )}
    </div>
  );
}

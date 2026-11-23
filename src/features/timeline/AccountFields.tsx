import { useTranslation } from 'react-i18next';
import type { TimelineAccount, TimelineBlock } from '@/services/api/routingTimeline';
import styles from './TimelinePage.module.scss';

interface AccountFieldsProps {
  block: TimelineBlock;
  accountsById: ReadonlyMap<string, TimelineAccount>;
  eligibleAccounts: TimelineAccount[];
  onChange: (patch: Partial<TimelineBlock>) => void;
  onRemove: () => void;
}

export function AccountFields({
  block,
  accountsById,
  eligibleAccounts,
  onChange,
  onRemove,
}: AccountFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>{t('timeline.use_accounts')}</span>
        <div className={styles.chips}>
          {block.accounts.map((id, accountIndex) => {
            const account = accountsById.get(id);
            const name = account?.name ?? id;
            return (
              <div className={`${styles.chip} ${styles.chipOn}`} key={id}>
                <span>{name}</span>
                {(!account || account.disabled) && (
                  <span className={styles.chipMeta}>
                    {t(account ? 'timeline.disabled' : 'timeline.unavailable')}
                  </span>
                )}
                {block.strategy === 'fill-first' && accountIndex > 0 && (
                  <button
                    type="button"
                    className={styles.chipAction}
                    aria-label={t('timeline.prioritize_account', { account: name })}
                    onClick={() => {
                      const accounts = [...block.accounts];
                      [accounts[accountIndex - 1], accounts[accountIndex]] = [
                        accounts[accountIndex],
                        accounts[accountIndex - 1],
                      ];
                      onChange({ accounts });
                    }}
                  >
                    ←
                  </button>
                )}
                <button
                  type="button"
                  className={styles.chipAction}
                  aria-label={t('timeline.remove_account', { account: name })}
                  onClick={() =>
                    block.accounts.length === 1
                      ? onRemove()
                      : onChange({
                          accounts: block.accounts.filter((selected) => selected !== id),
                          ...(block.accounts.length === 2 && { strategy: '' }),
                        })
                  }
                >
                  ×
                </button>
              </div>
            );
          })}
          <select
            className={styles.dateInput}
            aria-label={t('timeline.add_account')}
            value=""
            disabled={eligibleAccounts.every((account) => block.accounts.includes(account.id))}
            onChange={(event) =>
              onChange({
                accounts: [...block.accounts, event.target.value],
              })
            }
          >
            <option value="" disabled>
              {t('timeline.add_account')}
            </option>
            {eligibleAccounts
              .filter((account) => !block.accounts.includes(account.id))
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {block.accounts.length > 1 && (
        <label className={styles.inlineField}>
          <span className={styles.fieldLabel}>{t('timeline.routing_mode')}</span>
          <select
            className={styles.dateInput}
            aria-label={t('timeline.routing_mode')}
            value={block.strategy}
            onChange={(event) => {
              const strategy = event.target.value;
              onChange({
                strategy: strategy === 'fill-first' || strategy === 'round-robin' ? strategy : '',
              });
            }}
          >
            <option value="">{t('timeline.mode_default')}</option>
            <option value="round-robin">{t('timeline.mode_round_robin')}</option>
            <option value="fill-first">{t('timeline.mode_fill_first')}</option>
          </select>
          {block.strategy && (
            <span className={styles.muted}>{t(`timeline.mode_hint_${block.strategy}`)}</span>
          )}
        </label>
      )}
    </>
  );
}

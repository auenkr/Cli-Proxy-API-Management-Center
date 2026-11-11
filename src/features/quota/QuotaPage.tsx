/**
 * 额度查询页：提供商 tabs + 统一卡网格。
 *
 * 保留的行为契约（重设计不改）：
 * - 现有提供商保持点击加载；Devin 首次可见时主动查询一次，不轮询；
 * - cacheGeneration 会话隔离 + request-id 去重（见 useQuotaBatchLoader）；
 * - 文件列表变化后按 provider 剪枝额度缓存（已删文件不残留）；
 * - useHeaderRefresh 单槽位：本页唯一注册者，全局刷新 = 重取文件列表。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconSearch, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import { QuotaHeader } from './components/QuotaHeader';
import { QuotaLedger } from './components/QuotaLedger';
import { QuotaTimeline } from './components/QuotaTimeline';
import { QuotaForecast } from './components/QuotaForecast';
import { useQuotaHistory } from './hooks/useQuotaHistory';
import { maskEmails } from './maskEmail';
import { buildTimelineLane, laneHasWindow } from './quotaTimelineModel';
import {
  QUOTA_PAGE_SIZE,
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  type QuotaSortMode,
  type QuotaTabId,
} from './constants';
import {
  buildTabCounts,
  canRefreshQuotaAfterList,
  classifyQuotaFiles,
  filterEntriesByTab,
  filterEntriesBySearch,
  paginate,
  sortQuotaEntries,
  type QuotaFileEntry,
} from './logic';
import { nextRecoveryMs } from './resetSchedule';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { useQuotaAutoLoad } from './hooks/useQuotaAutoLoad';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import { readQuotaUiState, writeQuotaUiState } from './uiState';
import styles from './QuotaPage.module.scss';

const TAB_IDS: string[] = ['all', ...QUOTA_TAB_ORDER];
const SKELETON_CARD_COUNT = 6;

const FORECAST_MAX_PERIOD_HOURS = 7 * 24;

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QuotaTabId>(() => readQuotaUiState()?.tab ?? 'all');
  const [sortMode, setSortMode] = useState<QuotaSortMode>(
    () => readQuotaUiState()?.sortMode ?? 'default'
  );
  const [showEmails, setShowEmails] = useState(() => readQuotaUiState()?.showEmails ?? false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 页头 + tabs 的入场级联（标题 → meta → 动作 → tabs，级差 70ms）
  const revealRef = useRevealGroup<HTMLDivElement>();

  const disableControls = connectionStatus !== 'connected';

  /* ---------- 文件列表 ---------- */

  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [filesGeneration, setFilesGeneration] = useState<number | null>(null);
  const listRequestRef = useRef(0);
  const loadFiles = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesGeneration(null);
      setLoading(false);
      return;
    }
    const isCurrent = () =>
      requestId === listRequestRef.current &&
      sessionGeneration === useQuotaStore.getState().cacheGeneration;
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      if (!isCurrent()) return;
      setFiles(data?.files || []);
      setFilesGeneration(sessionGeneration);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connectionStatus, sessionGeneration, t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    void loadFiles();
    return () => {
      listRequestRef.current += 1;
    };
  }, [loadFiles]);

  /* ---------- 额度缓存 ----------
   * 排在归类/排序之前：「最快恢复优先」要读它算排序键。 */

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const pluginQuota = useQuotaStore((state) => state.pluginQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const quotaByType = useMemo<Record<QuotaProviderType, Record<string, QuotaCardState>>>(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: devinQuota,
        kimi: kimiQuota,
        meta: metaQuota,
        plugin: pluginQuota,
        xai: xaiQuota,
      }) as unknown as Record<QuotaProviderType, Record<string, QuotaCardState>>,
    [
      antigravityQuota,
      claudeQuota,
      codexQuota,
      devinQuota,
      kimiQuota,
      metaQuota,
      pluginQuota,
      xaiQuota,
    ]
  );

  const getQuota = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined =>
      quotaByType[entry.type][getQuotaCacheKey(entry.file)],
    [quotaByType]
  );

  /* ---------- 归类 / 过滤 / 排序 / 分页 ---------- */

  // 只在「最快恢复优先」下订阅分钟时钟。默认序下不门控的话，pageItems 每分钟
  // 换一次身份，会反复空转下面那个「刷新全部」的 loading 下降沿 effect。
  const tick = useNow(sortMode !== 'default');
  const sortNow = sortMode === 'default' ? 0 : tick;

  const entries = useMemo(() => classifyQuotaFiles(files), [files]);
  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  const filteredEntries = useMemo(
    () => filterEntriesBySearch(filterEntriesByTab(entries, tab), search),
    [entries, tab, search]
  );
  const handleToggleEmails = useCallback(() => {
    setShowEmails((value) => {
      writeQuotaUiState({ showEmails: !value });
      return !value;
    });
  }, []);
  const maskedDisplayName = useCallback(
    (name: string) => (showEmails ? name : maskEmails(name)),
    [showEmails]
  );
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  // Forecast covers every credential in the tab, not just the visible page.
  const tabEntries = useMemo(() => filterEntriesByTab(entries, tab), [entries, tab]);
  const forecastNow = useNow();
  const forecastLaneList = useMemo(
    () =>
      tabEntries
        .flatMap((entry) =>
          [FORECAST_MAX_PERIOD_HOURS, 5].map((maxPeriodHours) =>
            buildTimelineLane({
              name: getQuotaCacheKey(entry.file),
              displayName: entry.file.name,
              provider: entry.type,
              quota: getQuota(entry),
              maxPeriodHours,
            })
          )
        )
        .filter(laneHasWindow)
        .filter(
          (lane, index, all) =>
            all.findIndex(
              (other) =>
                other.provider === lane.provider &&
                other.name === lane.name &&
                other.periodHours === lane.periodHours
            ) === index
        ),
    [tabEntries, getQuota]
  );
  const quotaSamples = useQuotaHistory(forecastLaneList, !disableControls);

  const resolveNextRecovery = useCallback(
    (entry: QuotaFileEntry) => nextRecoveryMs(entry.type, getQuota(entry), sortNow),
    [getQuota, sortNow]
  );
  // 排序在分页之前：否则「最快恢复」只在当前页内成立。
  const sortedEntries = useMemo(
    () => sortQuotaEntries(filteredEntries, sortMode, resolveNextRecovery),
    [filteredEntries, sortMode, resolveNextRecovery]
  );

  const { pageItems, currentPage, totalPages } = useMemo(
    () => paginate(sortedEntries, page, QUOTA_PAGE_SIZE),
    [sortedEntries, page]
  );

  const handleTabChange = useCallback((next: string) => {
    setTab(next as QuotaTabId);
    setPage(1);
    writeQuotaUiState({ tab: next as QuotaTabId });
  }, []);

  const handleSortModeChange = useCallback((next: string) => {
    setSortMode(next as QuotaSortMode);
    setPage(1);
    writeQuotaUiState({ sortMode: next as QuotaSortMode });
  }, []);

  const sortOptions = useMemo(
    () =>
      QUOTA_SORT_MODES.map((mode) => ({ value: mode, label: t(`quota_management.sort_${mode}`) })),
    [t]
  );

  const { loadedCount, attentionCount } = useMemo(() => {
    let loaded = 0;
    let attention = 0;
    entries.forEach((entry) => {
      const status = quotaByType[entry.type][getQuotaCacheKey(entry.file)]?.status;
      if (status === 'success') loaded += 1;
      else if (status === 'error') attention += 1;
    });
    return { loadedCount: loaded, attentionCount: attention };
  }, [entries, quotaByType]);

  // 剪枝：文件列表落定后，各 provider 缓存只保留仍存在的凭证
  useEffect(() => {
    if (loading || error || filesGeneration !== sessionGeneration) return;
    const survivorsByType = new Map<QuotaProviderType, Set<string>>(
      QUOTA_TAB_ORDER.map((type) => [type, new Set<string>()])
    );
    entries.forEach((entry) => survivorsByType.get(entry.type)?.add(getQuotaCacheKey(entry.file)));

    QUOTA_TAB_ORDER.forEach((type) => {
      const survivors = survivorsByType.get(type) ?? new Set<string>();
      const setQuota = getQuotaSetter(QUOTA_ADAPTERS[type]);
      setQuota((prev) => {
        const staleKeys = Object.keys(prev).filter((name) => !survivors.has(name));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        staleKeys.forEach((name) => delete next[name]);
        return next;
      });
    });
  }, [entries, error, filesGeneration, loading, sessionGeneration]);

  /* ---------- 加载与操作 ---------- */

  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(
    disableControls,
    maskedDisplayName
  );

  const pendingRefreshRef = useRef<number | null>(null);
  const prevLoadingRef = useRef(loading);

  // 刷新全部：先重取文件列表，待其落定（loading 下降沿）再批量拉当前页额度
  const handleRefreshAll = useCallback(() => {
    if (disableControls) return;
    pendingRefreshRef.current = sessionGeneration;
    void loadFiles();
  }, [disableControls, loadFiles, sessionGeneration]);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    const requestedSession = pendingRefreshRef.current;
    if (requestedSession === null) return;
    if (requestedSession !== sessionGeneration) {
      pendingRefreshRef.current = null;
      return;
    }
    if (loading || !wasLoading) return;

    pendingRefreshRef.current = null;
    if (
      canRefreshQuotaAfterList(
        requestedSession,
        sessionGeneration,
        filesGeneration,
        Boolean(error),
        disableControls
      )
    ) {
      void loadQuota(pageItems, true);
    }
  }, [disableControls, error, filesGeneration, loading, loadQuota, pageItems, sessionGeneration]);

  useQuotaAutoLoad(
    pageItems,
    disableControls ||
      loading ||
      batchLoading ||
      Boolean(error) ||
      filesGeneration !== sessionGeneration,
    loadQuota
  );

  const canUseActions = !disableControls && !loading && filesGeneration === sessionGeneration;

  /* ---------- 渲染 ---------- */

  const isEmpty = !loading && filteredEntries.length === 0;

  return (
    <div className={styles.page} ref={revealRef}>
      <QuotaHeader
        totalCount={entries.length}
        loadedCount={loadedCount}
        attentionCount={attentionCount}
        refreshing={loading || batchLoading}
        disableControls={disableControls}
        onRefreshAll={handleRefreshAll}
        showEmails={showEmails}
        onToggleEmails={handleToggleEmails}
      />

      <section className={styles.workbench}>
        {/* 提供商导航与搜索工具栏分层，避免不同控件争夺视觉焦点。 */}
        <div className={styles.tabsRow} data-reveal>
          <ProviderTabs
            types={TAB_IDS}
            counts={tabCounts}
            active={tab}
            resolvedTheme={resolvedTheme}
            onChange={handleTabChange}
          />
        </div>

        <QuotaForecast
          lanes={forecastLaneList}
          samples={quotaSamples}
          now={forecastNow}
          displayNameFor={maskedDisplayName}
          resolvedTheme={resolvedTheme}
        />

        <div className={styles.toolbar}>
          <div className={styles.search}>
            <IconSearch size={16} className={styles.searchIcon} aria-hidden="true" />
            <input
              ref={searchInputRef}
              className={styles.searchInput}
              type="search"
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder={t('quota_management.search_placeholder')}
              aria-label={t('quota_management.search_label')}
            />
            {search && (
              <button
                type="button"
                className={styles.clearSearch}
                aria-label={t('quota_management.search_clear')}
                title={t('quota_management.search_clear')}
                onClick={() => {
                  handleSearchChange('');
                  searchInputRef.current?.focus();
                }}
              >
                <IconX size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className={styles.sort}>
            <Select
              value={sortMode}
              options={sortOptions}
              onChange={handleSortModeChange}
              ariaLabel={t('quota_management.sort_label')}
              size="sm"
            />
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.grid} aria-hidden="true">
            {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
              <Skeleton key={index} height={168} rounded={14} />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            title={
              search.trim()
                ? t('quota_management.search_empty_title')
                : tab === 'all'
                  ? t('quota_management.empty_title')
                  : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_title`)
            }
            description={
              search.trim()
                ? t('quota_management.search_empty_desc')
                : tab === 'all'
                  ? t('quota_management.empty_desc')
                  : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_desc`)
            }
            action={
              search.trim() ? (
                <Button variant="secondary" size="sm" onClick={() => handleSearchChange('')}>
                  {t('quota_management.search_clear')}
                </Button>
              ) : tab === 'all' ? undefined : (
                <Button variant="secondary" size="sm" onClick={() => handleTabChange('all')}>
                  {t('auth_files.filter_all')}
                </Button>
              )
            }
          />
        ) : (
          <QuotaLedger
            entries={pageItems}
            quotaFor={getQuota}
            resolvedTheme={resolvedTheme}
            canRefresh={canUseActions}
            resettingName={resettingQuotaName}
            showEmails={showEmails}
            onRefresh={(entry) => void refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
            onReset={(entry) => resetQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
          />
        )}

        {!loading && filteredEntries.length > QUOTA_PAGE_SIZE && (
          <div className={styles.pagination}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              {t('auth_files.pagination_prev')}
            </Button>
            <div className={styles.pageInfo}>
              {t('auth_files.pagination_info', {
                current: currentPage,
                total: totalPages,
                count: filteredEntries.length,
              })}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              {t('auth_files.pagination_next')}
            </Button>
          </div>
        )}

        {/* 时间线只比较当前页凭证，避免大量凭证一次性生成无界泳道。 */}
        <QuotaTimeline
          entries={pageItems}
          quotaFor={getQuota}
          displayNameFor={maskedDisplayName}
          resolvedTheme={resolvedTheme}
        />
      </section>
    </div>
  );
}

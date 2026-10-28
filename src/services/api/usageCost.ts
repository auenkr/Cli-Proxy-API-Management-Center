/** API-equivalent cost report (USD) aggregated hourly by provider and model. */

import { apiClient } from './client';

export interface UsageCostTokens {
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
  reasoning: number;
}

export interface UsageCostCosts {
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
  total: number;
}

export interface UsageCostReport {
  since: number;
  until: number;
  requests: number;
  tokens: UsageCostTokens;
  costs: UsageCostCosts;
  cache_savings: number;
  unpriced_tokens: number;
  hourly: Array<{ hour: number; total: number; by_provider: Record<string, number> }>;
  models: Array<{
    provider: string;
    model: string;
    requests: number;
    tokens: UsageCostTokens;
    costs: UsageCostCosts;
    priced: boolean;
    share: number;
  }>;
  providers: Array<{
    provider: string;
    requests: number;
    tokens: UsageCostTokens;
    costs: UsageCostCosts;
  }>;
}

export const usageCostApi = {
  get: (days: number) =>
    apiClient.get<UsageCostReport>('/observability/usage/cost', {
      params: { days },
      timeout: 15 * 1000,
    }),
};

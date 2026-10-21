/**
 * Shared view of oauth.official-client-only (config.yaml) so every credential card
 * reads one config value instead of fetching it per card.
 */

import { create } from 'zustand';
import { getOfficialClientOnly, setOfficialClientOnly } from '@/services/api/authFiles';

interface OfficialClientOnlyState {
  values: Record<string, boolean>;
  loaded: Record<string, boolean>;
  load: (provider: string) => Promise<void>;
  save: (provider: string, enabled: boolean) => Promise<void>;
}

const inflight = new Map<string, Promise<void>>();

export const useOfficialClientOnlyStore = create<OfficialClientOnlyState>((set, get) => ({
  values: {},
  loaded: {},
  load: (provider) => {
    if (get().loaded[provider]) return Promise.resolve();
    const pending = inflight.get(provider);
    if (pending) return pending;
    const request = getOfficialClientOnly(provider)
      .then((value) =>
        set((state) => ({
          values: { ...state.values, [provider]: value },
          loaded: { ...state.loaded, [provider]: true },
        }))
      )
      .finally(() => inflight.delete(provider));
    inflight.set(provider, request);
    return request;
  },
  save: async (provider, enabled) => {
    await setOfficialClientOnly(provider, enabled);
    set((state) => ({
      values: { ...state.values, [provider]: enabled },
      loaded: { ...state.loaded, [provider]: true },
    }));
  },
}));

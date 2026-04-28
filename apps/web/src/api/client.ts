import {
  type ApiClient,
  createApiClient,
  createRefreshScheduler,
  type RefreshScheduler,
} from '@myreport/api-client';
import { useAuthStore } from '../stores/auth.ts';

interface CachedClient {
  client: ApiClient;
  scheduler: RefreshScheduler;
}

let cached: CachedClient | null = null;

// Single shared instance: the api-client and the refresh scheduler
// reference each other (the scheduler triggers the client's silent
// refresh; the client's onAccessTokenRotated re-arms the scheduler).
function build(): CachedClient {
  let scheduler: RefreshScheduler;

  const client = createApiClient({
    baseUrl: '/api',
    getAccessToken: () => useAuthStore().accessToken,
    onAccessTokenRotated: (token) => {
      const store = useAuthStore();
      store.accessToken = token;
      scheduler.schedule(token);
    },
    onSessionExpired: (cause) => {
      const store = useAuthStore();
      const hadSession = store.user !== null;
      store.reset();
      scheduler.cancel();
      // Toast + redirect are only relevant when a session actually
      // existed; the silent bootstrap "no session" case stays quiet.
      if (hadSession) {
        store.markSessionExpired(cause);
      }
    },
  });

  scheduler = createRefreshScheduler({
    refresh: () => client.ensureRefresh(),
  });

  return { client, scheduler };
}

function ensureBuilt(): CachedClient {
  if (!cached) cached = build();
  return cached;
}

export function useApiClient(): ApiClient {
  return ensureBuilt().client;
}

export function useRefreshScheduler(): RefreshScheduler {
  return ensureBuilt().scheduler;
}

// Test helper: drop the cached instances so a fresh Pinia in a unit
// test gets its own pair.
export function resetApiClientForTests(): void {
  cached = null;
}

import { type ApiClient, createApiClient } from '@myreport/api-client';
import { useAuthStore } from '../stores/auth.ts';

let instance: ApiClient | null = null;

// Lazily build the singleton on first call: the auth store needs an
// active Pinia instance, which only exists after `app.use(createPinia())`
// runs in main.ts.
export function useApiClient(): ApiClient {
  if (!instance) {
    const auth = useAuthStore();
    instance = createApiClient({
      baseUrl: '/api',
      getAccessToken: () => auth.accessToken,
    });
  }
  return instance;
}

// Test helper: drop the cached instance so a fresh Pinia in a unit test
// gets its own client.
export function resetApiClientForTests(): void {
  instance = null;
}

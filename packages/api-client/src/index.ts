import { type ApiClientConfig, createApiClientCore } from './client.ts';
import { type AuthApi, createAuthApi } from './routes/auth.ts';
import { createMeApi, type MeApi } from './routes/me.ts';
import { createTenantsApi, type TenantsApi } from './routes/tenants.ts';

export type { ApiClientConfig, RequestOptions } from './client.ts';
export { ApiContractError, ApiError, ApiNetworkError } from './errors.ts';
export { decodeJwtExp } from './jwt.ts';
export {
  createRefreshScheduler,
  type RefreshScheduler,
  type RefreshSchedulerConfig,
} from './refresh-scheduler.ts';
export type { AuthApi } from './routes/auth.ts';
export type { MeApi } from './routes/me.ts';
export type { TenantsApi } from './routes/tenants.ts';

export interface ApiClient {
  auth: AuthApi;
  me: MeApi;
  tenants: TenantsApi;
  // Forces a silent refresh. Used by the host to bootstrap auth on app
  // load (try /auth/refresh; if it works, follow up with /me to
  // hydrate the store).
  ensureRefresh(): Promise<string>;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const core = createApiClientCore(config);
  return {
    auth: createAuthApi(core),
    me: createMeApi(core),
    tenants: createTenantsApi(core),
    ensureRefresh: () => core.ensureRefresh(),
  };
}

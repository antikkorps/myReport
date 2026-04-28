import { type ApiClientConfig, createApiClientCore } from './client.ts';
import { type AuthApi, createAuthApi } from './routes/auth.ts';
import { createMeApi, type MeApi } from './routes/me.ts';

export type { ApiClientConfig, RequestOptions } from './client.ts';
export { ApiContractError, ApiError, ApiNetworkError } from './errors.ts';
export type { AuthApi } from './routes/auth.ts';
export type { MeApi } from './routes/me.ts';

export interface ApiClient {
  auth: AuthApi;
  me: MeApi;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const core = createApiClientCore(config);
  return {
    auth: createAuthApi(core),
    me: createMeApi(core),
  };
}

import {
  type LoginRequest,
  type LoginResponse,
  type RefreshResponse,
  ZLoginResponse,
  ZRefreshResponse,
} from '@myreport/shared-schemas';
import type { ApiClientCore, RequestOptions } from '../client.ts';

export interface AuthApi {
  login(body: LoginRequest, options?: RequestOptions): Promise<LoginResponse>;
  refresh(options?: RequestOptions): Promise<RefreshResponse>;
  logout(options?: RequestOptions): Promise<void>;
}

export function createAuthApi(core: ApiClientCore): AuthApi {
  return {
    login(body, options) {
      return core.request({
        method: 'POST',
        path: '/auth/login',
        body,
        responseSchema: ZLoginResponse,
        ...(options ? { options } : {}),
      });
    },
    refresh(options) {
      return core.request({
        method: 'POST',
        path: '/auth/refresh',
        responseSchema: ZRefreshResponse,
        ...(options ? { options } : {}),
      });
    },
    logout(options) {
      return core.request({
        method: 'POST',
        path: '/auth/logout',
        ...(options ? { options } : {}),
      });
    },
  };
}

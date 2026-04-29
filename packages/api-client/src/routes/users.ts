import { type UserListResponse, ZUserListResponse } from '@myreport/shared-schemas';
import type { ApiClientCore, RequestOptions } from '../client.ts';

export interface UsersApi {
  list(query?: { tenantId?: string }, options?: RequestOptions): Promise<UserListResponse>;
}

export function createUsersApi(core: ApiClientCore): UsersApi {
  return {
    list(query, options) {
      const path = query?.tenantId
        ? `/users?tenantId=${encodeURIComponent(query.tenantId)}`
        : '/users';
      return core.request({
        method: 'GET',
        path,
        responseSchema: ZUserListResponse,
        ...(options ? { options } : {}),
      });
    },
  };
}

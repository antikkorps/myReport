import {
  type CreateTenantRequest,
  type CreateTenantResponse,
  type TenantListResponse,
  ZCreateTenantResponse,
  ZTenantListResponse,
} from '@myreport/shared-schemas';
import type { ApiClientCore, RequestOptions } from '../client.ts';

export interface TenantsApi {
  create(body: CreateTenantRequest, options?: RequestOptions): Promise<CreateTenantResponse>;
  list(options?: RequestOptions): Promise<TenantListResponse>;
}

export function createTenantsApi(core: ApiClientCore): TenantsApi {
  return {
    create(body, options) {
      return core.request({
        method: 'POST',
        path: '/tenants',
        body,
        responseSchema: ZCreateTenantResponse,
        ...(options ? { options } : {}),
      });
    },
    list(options) {
      return core.request({
        method: 'GET',
        path: '/tenants',
        responseSchema: ZTenantListResponse,
        ...(options ? { options } : {}),
      });
    },
  };
}

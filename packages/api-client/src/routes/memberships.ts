import {
  type UpdateMembershipRequest,
  type UpdateMembershipResponse,
  ZUpdateMembershipResponse,
} from '@myreport/shared-schemas';
import type { ApiClientCore, RequestOptions } from '../client.ts';

export interface MembershipsApi {
  update(
    id: string,
    body: UpdateMembershipRequest,
    options?: RequestOptions,
  ): Promise<UpdateMembershipResponse>;
  remove(id: string, options?: RequestOptions): Promise<void>;
}

export function createMembershipsApi(core: ApiClientCore): MembershipsApi {
  return {
    update(id, body, options) {
      return core.request({
        method: 'PATCH',
        path: `/memberships/${encodeURIComponent(id)}`,
        body,
        responseSchema: ZUpdateMembershipResponse,
        ...(options ? { options } : {}),
      });
    },
    remove(id, options) {
      return core.request({
        method: 'DELETE',
        path: `/memberships/${encodeURIComponent(id)}`,
        ...(options ? { options } : {}),
      });
    },
  };
}

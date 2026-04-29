import {
  type AcceptInvitationRequest,
  type AcceptInvitationResponse,
  type CreateInvitationRequest,
  type CreateInvitationResponse,
  type InvitationListResponse,
  type InvitationStatus,
  ZAcceptInvitationResponse,
  ZCreateInvitationResponse,
  ZInvitationListResponse,
} from '@myreport/shared-schemas';
import type { ApiClientCore, RequestOptions } from '../client.ts';

export interface InvitationsListQuery {
  status?: InvitationStatus | 'all';
  tenantId?: string;
}

export interface InvitationsApi {
  create(
    body: CreateInvitationRequest,
    options?: RequestOptions,
  ): Promise<CreateInvitationResponse>;
  list(query?: InvitationsListQuery, options?: RequestOptions): Promise<InvitationListResponse>;
  revoke(id: string, options?: RequestOptions): Promise<void>;
  // Public route — must be called without an access token.
  accept(
    token: string,
    body: AcceptInvitationRequest,
    options?: RequestOptions,
  ): Promise<AcceptInvitationResponse>;
}

export function createInvitationsApi(core: ApiClientCore): InvitationsApi {
  return {
    create(body, options) {
      return core.request({
        method: 'POST',
        path: '/invitations',
        body,
        responseSchema: ZCreateInvitationResponse,
        ...(options ? { options } : {}),
      });
    },
    list(query, options) {
      const params = new URLSearchParams();
      if (query?.status) params.set('status', query.status);
      if (query?.tenantId) params.set('tenantId', query.tenantId);
      const qs = params.toString();
      return core.request({
        method: 'GET',
        path: qs ? `/invitations?${qs}` : '/invitations',
        responseSchema: ZInvitationListResponse,
        ...(options ? { options } : {}),
      });
    },
    revoke(id, options) {
      return core.request({
        method: 'DELETE',
        path: `/invitations/${encodeURIComponent(id)}`,
        ...(options ? { options } : {}),
      });
    },
    accept(token, body, options) {
      return core.request({
        method: 'POST',
        path: `/invitations/${encodeURIComponent(token)}/accept`,
        body,
        responseSchema: ZAcceptInvitationResponse,
        ...(options ? { options } : {}),
      });
    },
  };
}

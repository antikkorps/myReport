import { type ApiClientConfig, createApiClientCore } from './client.ts';
import { type AuthApi, createAuthApi } from './routes/auth.ts';
import { createInvitationsApi, type InvitationsApi } from './routes/invitations.ts';
import { createMeApi, type MeApi } from './routes/me.ts';
import { createMembershipsApi, type MembershipsApi } from './routes/memberships.ts';
import { createTemplateVersionsApi, type TemplateVersionsApi } from './routes/template-versions.ts';
import { createTemplatesApi, type TemplatesApi } from './routes/templates.ts';
import { createTenantsApi, type TenantsApi } from './routes/tenants.ts';
import { createUsersApi, type UsersApi } from './routes/users.ts';

export type { ApiClientConfig, RequestOptions } from './client.ts';
export { ApiContractError, ApiError, ApiNetworkError } from './errors.ts';
export { decodeJwtExp } from './jwt.ts';
export {
  createRefreshScheduler,
  type RefreshScheduler,
  type RefreshSchedulerConfig,
} from './refresh-scheduler.ts';
export type { AuthApi } from './routes/auth.ts';
export type { InvitationsApi, InvitationsListQuery } from './routes/invitations.ts';
export type { MeApi } from './routes/me.ts';
export type { MembershipsApi } from './routes/memberships.ts';
export type {
  TemplateVersionsApi,
  TemplateVersionsListQuery,
} from './routes/template-versions.ts';
export type { TemplatesApi } from './routes/templates.ts';
export type { TenantsApi } from './routes/tenants.ts';
export type { UsersApi } from './routes/users.ts';

export interface ApiClient {
  auth: AuthApi;
  me: MeApi;
  tenants: TenantsApi;
  users: UsersApi;
  memberships: MembershipsApi;
  invitations: InvitationsApi;
  templates: TemplatesApi;
  templateVersions: TemplateVersionsApi;
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
    users: createUsersApi(core),
    memberships: createMembershipsApi(core),
    invitations: createInvitationsApi(core),
    templates: createTemplatesApi(core),
    templateVersions: createTemplateVersionsApi(core),
    ensureRefresh: () => core.ensureRefresh(),
  };
}

import { ApiError } from '@myreport/api-client';
import type {
  AcceptInvitationResponse,
  AuthenticatedTenant,
  AuthenticatedUser,
  LoginRequest,
} from '@myreport/shared-schemas';
import { defineStore } from 'pinia';
import { useApiClient, useRefreshScheduler } from '../api/client.ts';

interface AuthState {
  user: AuthenticatedUser | null;
  currentTenant: AuthenticatedTenant | null;
  accessToken: string | null;
  loading: boolean;
  error: string | null;
  bootstrapped: boolean;
  // Monotonic counter incremented each time a session expires while a
  // user was active. Components watch it to surface a toast + redirect.
  sessionExpiredTick: number;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    currentTenant: null,
    accessToken: null,
    loading: false,
    error: null,
    bootstrapped: false,
    sessionExpiredTick: 0,
  }),
  getters: {
    isAuthenticated: (state): boolean => state.user !== null && state.accessToken !== null,
  },
  actions: {
    async bootstrap(): Promise<void> {
      // Try a silent refresh from the httpOnly cookie. On success, the
      // access token lands via onAccessTokenRotated and we hydrate /me.
      // On failure (no cookie / expired / reused) we stay logged out
      // — silently, since the user simply hasn't logged in yet.
      const client = useApiClient();
      try {
        await client.ensureRefresh();
        const me = await client.me.get();
        this.user = me.user;
        this.currentTenant = me.currentTenant;
      } catch {
        // No active session — leave the store in its initial state.
      } finally {
        this.bootstrapped = true;
      }
    },
    async login(payload: LoginRequest): Promise<boolean> {
      this.loading = true;
      this.error = null;
      try {
        const client = useApiClient();
        const response = await client.auth.login(payload);
        this.user = response.user;
        this.currentTenant = response.tenant;
        this.accessToken = response.accessToken;
        useRefreshScheduler().schedule(response.accessToken);
        return true;
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'Erreur réseau';
        return false;
      } finally {
        this.loading = false;
      }
    },
    async logout(): Promise<void> {
      useRefreshScheduler().cancel();
      try {
        const client = useApiClient();
        await client.auth.logout();
      } catch {
        // Logout is best-effort: even if the server call fails (offline,
        // already-expired session) we still clear local state below.
      }
      this.reset();
    },
    // Drops the local session without calling /auth/logout. Used when
    // the server has already invalidated the session (e.g. the user
    // just removed their own membership and the API revoked their
    // sessions transactionally). Calling /auth/logout in that case
    // would 401 against an already-expired refresh cookie.
    forceLocalLogout(): void {
      useRefreshScheduler().cancel();
      this.reset();
    },
    // Lands the user straight into a session after accepting an
    // invitation. Mirrors the post-login state: user/tenant filled,
    // access token stored, refresh scheduler armed.
    completeAcceptedInvitation(response: AcceptInvitationResponse): void {
      this.user = response.user;
      this.currentTenant = response.tenant;
      this.accessToken = response.accessToken;
      useRefreshScheduler().schedule(response.accessToken);
    },
    markSessionExpired(_cause: unknown): void {
      this.sessionExpiredTick += 1;
    },
    reset(): void {
      this.user = null;
      this.currentTenant = null;
      this.accessToken = null;
      this.error = null;
    },
  },
});

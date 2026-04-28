import { ApiError } from '@myreport/api-client';
import type {
  AuthenticatedTenant,
  AuthenticatedUser,
  LoginRequest,
} from '@myreport/shared-schemas';
import { defineStore } from 'pinia';
import { useApiClient } from '../api/client.ts';

interface AuthState {
  user: AuthenticatedUser | null;
  currentTenant: AuthenticatedTenant | null;
  accessToken: string | null;
  loading: boolean;
  error: string | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    currentTenant: null,
    accessToken: null,
    loading: false,
    error: null,
  }),
  getters: {
    isAuthenticated: (state): boolean => state.user !== null && state.accessToken !== null,
  },
  actions: {
    async login(payload: LoginRequest): Promise<boolean> {
      this.loading = true;
      this.error = null;
      try {
        const client = useApiClient();
        const response = await client.auth.login(payload);
        this.user = response.user;
        this.currentTenant = response.tenant;
        this.accessToken = response.accessToken;
        return true;
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'Erreur réseau';
        return false;
      } finally {
        this.loading = false;
      }
    },
    async logout(): Promise<void> {
      try {
        const client = useApiClient();
        await client.auth.logout();
      } catch {
        // Logout is best-effort: even if the server call fails (offline,
        // already-expired session) we still clear local state below.
      }
      this.reset();
    },
    reset(): void {
      this.user = null;
      this.currentTenant = null;
      this.accessToken = null;
      this.error = null;
    },
  },
});

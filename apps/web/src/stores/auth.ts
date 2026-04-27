import type { AuthenticatedTenant, AuthenticatedUser } from '@myreport/shared-schemas';
import { defineStore } from 'pinia';

// Placeholder shape — populated by the next backlog item once the
// login flow calls /auth/login. Kept here so consumers can type
// against `useAuthStore()` already.
interface AuthState {
  user: AuthenticatedUser | null;
  currentTenant: AuthenticatedTenant | null;
  accessToken: string | null;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    currentTenant: null,
    accessToken: null,
  }),
  getters: {
    isAuthenticated: (state) => state.user !== null && state.accessToken !== null,
  },
  actions: {
    reset(): void {
      this.user = null;
      this.currentTenant = null;
      this.accessToken = null;
    },
  },
});

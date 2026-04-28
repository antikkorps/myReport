import { decodeJwtExp } from './jwt.ts';

export interface RefreshScheduler {
  // Arms a one-shot timer that fires `marginSec` seconds before the
  // token's exp. Cancels any previously scheduled fire.
  schedule(accessToken: string): void;
  cancel(): void;
}

export interface RefreshSchedulerConfig {
  // Triggers the refresh. The implementation is expected to handle
  // success/failure side-effects (store updates, session reset) via the
  // api-client's callbacks; the scheduler only owns the timing.
  refresh: () => Promise<unknown>;
  // Seconds before `exp` at which to fire. Default 30s.
  marginSec?: number;
  // Test seams.
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  now?: () => number;
}

export function createRefreshScheduler(cfg: RefreshSchedulerConfig): RefreshScheduler {
  const setT = cfg.setTimeout ?? ((cb, ms) => setTimeout(cb, ms));
  const clearT =
    cfg.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const now = cfg.now ?? (() => Date.now());
  const margin = cfg.marginSec ?? 30;
  let handle: unknown = null;

  function cancel(): void {
    if (handle !== null) {
      clearT(handle);
      handle = null;
    }
  }

  function fire(): void {
    handle = null;
    cfg.refresh().catch(() => {
      // Failures are surfaced by the refresh implementation itself
      // (api-client callbacks). Nothing to do here.
    });
  }

  function schedule(accessToken: string): void {
    cancel();
    const exp = decodeJwtExp(accessToken);
    if (exp === null) return;
    const delayMs = (exp - margin) * 1000 - now();
    if (delayMs <= 0) {
      // Token already past the margin — fire immediately.
      fire();
      return;
    }
    handle = setT(fire, delayMs);
  }

  return { schedule, cancel };
}

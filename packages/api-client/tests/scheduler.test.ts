import { describe, expect, it, vi } from 'vitest';
import { createRefreshScheduler, decodeJwtExp } from '../src/index.ts';

// Minimal JWT with a chosen `exp` claim (no signature; client side does
// not verify anyway).
function jwt(exp: number): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '');
  const payload = btoa(JSON.stringify({ sub: 'u', exp })).replace(/=+$/, '');
  return `${header}.${payload}.sig`;
}

describe('decodeJwtExp', () => {
  it('returns the exp claim when present', () => {
    expect(decodeJwtExp(jwt(1730000000))).toBe(1730000000);
  });

  it('returns null on malformed input', () => {
    expect(decodeJwtExp('not-a-jwt')).toBeNull();
    expect(decodeJwtExp('a.b')).toBeNull();
    expect(decodeJwtExp('a.!!!.c')).toBeNull();
  });
});

describe('createRefreshScheduler', () => {
  it('schedules a fire `marginSec` seconds before exp', () => {
    let armedAt = 0;
    const fakeNow = 1_000_000_000_000; // ms
    const exp = Math.floor(fakeNow / 1000) + 900; // +15 min
    const setT = ((_cb: () => void, ms: number) => {
      armedAt = ms;
      return 42;
    }) as unknown as typeof setTimeout;
    const clearT = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const scheduler = createRefreshScheduler({
      refresh,
      marginSec: 30,
      setTimeout: setT,
      clearTimeout: clearT,
      now: () => fakeNow,
    });

    scheduler.schedule(jwt(exp));

    // 900s - 30s = 870s = 870000 ms before fire.
    expect(armedAt).toBe(870_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('fires the refresh when the timer elapses', async () => {
    let captured: (() => void) | null = null;
    const setT = ((cb: () => void) => {
      captured = cb;
      return 1;
    }) as unknown as typeof setTimeout;
    const refresh = vi.fn().mockResolvedValue(undefined);
    const fakeNow = 1_000_000_000_000;
    const scheduler = createRefreshScheduler({
      refresh,
      marginSec: 30,
      setTimeout: setT,
      now: () => fakeNow,
    });

    scheduler.schedule(jwt(Math.floor(fakeNow / 1000) + 600));
    if (!captured) throw new Error('expected timer to be armed');
    (captured as () => void)();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('fires immediately when the token is already past the margin', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    const setT = vi.fn() as unknown as typeof setTimeout;
    const fakeNow = 1_000_000_000_000;
    const scheduler = createRefreshScheduler({
      refresh,
      marginSec: 30,
      setTimeout: setT,
      now: () => fakeNow,
    });

    scheduler.schedule(jwt(Math.floor(fakeNow / 1000) - 10));
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
    expect(setT).not.toHaveBeenCalled();
  });

  it('cancels a previously scheduled fire when re-scheduled', () => {
    const setT = vi.fn().mockReturnValue(7) as unknown as typeof setTimeout;
    const clearT = vi.fn();
    const fakeNow = 1_000_000_000_000;
    const scheduler = createRefreshScheduler({
      refresh: vi.fn(),
      marginSec: 30,
      setTimeout: setT,
      clearTimeout: clearT,
      now: () => fakeNow,
    });

    scheduler.schedule(jwt(Math.floor(fakeNow / 1000) + 900));
    scheduler.schedule(jwt(Math.floor(fakeNow / 1000) + 1200));

    expect(clearT).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('cancel() clears any armed timer', () => {
    const setT = vi.fn().mockReturnValue(99) as unknown as typeof setTimeout;
    const clearT = vi.fn();
    const fakeNow = 1_000_000_000_000;
    const scheduler = createRefreshScheduler({
      refresh: vi.fn(),
      marginSec: 30,
      setTimeout: setT,
      clearTimeout: clearT,
      now: () => fakeNow,
    });

    scheduler.schedule(jwt(Math.floor(fakeNow / 1000) + 900));
    scheduler.cancel();

    expect(clearT).toHaveBeenCalledExactlyOnceWith(99);
  });

  it('is a no-op for tokens with no exp claim', () => {
    const setT = vi.fn() as unknown as typeof setTimeout;
    const refresh = vi.fn();
    const scheduler = createRefreshScheduler({
      refresh,
      setTimeout: setT,
    });

    scheduler.schedule('garbage');

    expect(setT).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

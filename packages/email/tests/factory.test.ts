import { describe, expect, it, vi } from 'vitest';
import { createEmailSender, type EmailConfig } from '../src/factory.ts';

describe('createEmailSender', () => {
  it('returns a working sender for the console driver', async () => {
    const sender = createEmailSender({ driver: 'console' });
    await expect(sender.send({ to: 'a@b', subject: 's', text: 't' })).resolves.toBeUndefined();
  });

  it('returns a sender for the resend driver that POSTs to Resend', async () => {
    // Stub globalThis.fetch for the duration of this test — the resend
    // driver is built without an injected fetch so the factory exposes
    // the same defaults a consumer would get in production.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'msg' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const sender = createEmailSender({
        driver: 'resend',
        apiKey: 'k',
        from: { address: 'noreply@example.test' },
      });
      await sender.send({ to: 'a@b', subject: 's', text: 't' });
      expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.any(Object));
    } finally {
      globalThis.fetch = original;
    }
  });

  it('throws on an unknown driver value built dynamically', () => {
    // Compile-time narrowing already prevents this at type-check time;
    // the runtime guard still needs to be exercised for callers building
    // the config from untrusted input (e.g. parsed env vars).
    const config = { driver: 'postmark' } as unknown as EmailConfig;
    expect(() => createEmailSender(config)).toThrow(/Unsupported email driver: postmark/);
  });
});

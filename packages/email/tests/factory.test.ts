import { describe, expect, it } from 'vitest';
import { createEmailSender, type EmailConfig } from '../src/factory.ts';

describe('createEmailSender', () => {
  it('returns a working sender for the console driver', async () => {
    const sender = createEmailSender({ driver: 'console' });
    await expect(sender.send({ to: 'a@b', subject: 's', text: 't' })).resolves.toBeUndefined();
  });

  it('throws on an unknown driver value built dynamically', () => {
    // The exhaustive `never` switch is a compile-time safety net; this
    // test guards the runtime branch for when config is built from
    // untrusted input (e.g. parsed env vars in a future PR).
    const config = { driver: 'mailjet' } as unknown as EmailConfig;
    expect(() => createEmailSender(config)).toThrow(/Unsupported email driver: mailjet/);
  });
});

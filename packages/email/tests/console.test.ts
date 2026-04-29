import { describe, expect, it, vi } from 'vitest';
import { createConsoleEmailSender, type SentEmail } from '../src/drivers/console.ts';
import type { Email } from '../src/sender.ts';

const sample: Email = {
  to: 'alice@example.test',
  subject: 'Welcome',
  text: 'Hello Alice,\n\nClick the link to set your password.',
  html: '<p>Hello Alice</p>',
  replyTo: 'noreply@myreport.test',
};

describe('createConsoleEmailSender', () => {
  it('captures sent emails verbatim', async () => {
    const sender = createConsoleEmailSender({ log: () => {} });
    await sender.send(sample);
    expect(sender.sent).toHaveLength(1);
    const captured = sender.sent[0];
    if (!captured) throw new Error('expected one captured email');
    expect(captured.email).toEqual(sample);
    expect(captured.sentAt).toBeInstanceOf(Date);
  });

  it('captures multiple emails in order', async () => {
    const sender = createConsoleEmailSender({ log: () => {} });
    await sender.send({ ...sample, subject: 'first' });
    await sender.send({ ...sample, subject: 'second' });
    await sender.send({ ...sample, subject: 'third' });
    expect(sender.sent.map((s) => s.email.subject)).toEqual(['first', 'second', 'third']);
  });

  it('reset() clears the captured outbox', async () => {
    const sender = createConsoleEmailSender({ log: () => {} });
    await sender.send(sample);
    expect(sender.sent).toHaveLength(1);
    sender.reset();
    expect(sender.sent).toHaveLength(0);
  });

  it('forwards each delivery to the custom log sink', async () => {
    const log = vi.fn<(entry: SentEmail) => void>();
    const sender = createConsoleEmailSender({ log });
    await sender.send(sample);
    expect(log).toHaveBeenCalledTimes(1);
    const arg = log.mock.calls[0]?.[0];
    expect(arg?.email).toEqual(sample);
    expect(arg?.sentAt).toBeInstanceOf(Date);
  });

  it('uses console.info as the default sink', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const sender = createConsoleEmailSender();
      await sender.send(sample);
      expect(spy).toHaveBeenCalledTimes(1);
      // Default sink emits a structured payload, not the raw body, so
      // accidental sensitive content (token links) doesn't end up in
      // ANSI-rendered terminal output.
      expect(spy.mock.calls[0]?.[0]).toBe('[email:console]');
      const payload = spy.mock.calls[0]?.[1] as { to: string; subject: string; sentAt: string };
      expect(payload.to).toBe(sample.to);
      expect(payload.subject).toBe(sample.subject);
      expect(typeof payload.sentAt).toBe('string');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not leak email body via the default sink', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const sender = createConsoleEmailSender();
      await sender.send({
        ...sample,
        text: 'SECRET-TOKEN-do-not-log',
        html: '<a>SECRET-TOKEN-do-not-log</a>',
      });
      const serialised = JSON.stringify(spy.mock.calls);
      expect(serialised).not.toContain('SECRET-TOKEN-do-not-log');
    } finally {
      spy.mockRestore();
    }
  });

  it('omits optional fields when not provided', async () => {
    const sender = createConsoleEmailSender({ log: () => {} });
    const minimal: Email = {
      to: 'b@example.test',
      subject: 'Hi',
      text: 'Hello',
    };
    await sender.send(minimal);
    expect(sender.sent[0]?.email).toEqual(minimal);
    expect(sender.sent[0]?.email.html).toBeUndefined();
    expect(sender.sent[0]?.email.replyTo).toBeUndefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createResendEmailSender } from '../src/drivers/resend.ts';
import type { Email, EmailAddress } from '../src/sender.ts';

const FROM: EmailAddress = { address: 'noreply@myreport.dev', name: 'myReport' };

const SAMPLE: Email = {
  to: 'alice@example.test',
  subject: 'Welcome',
  text: 'Hello Alice',
};

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createResendEmailSender', () => {
  it('POSTs to the configured endpoint with Bearer auth and the expected payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'msg_123' }));
    const sender = createResendEmailSender({
      apiKey: 're_test_key',
      from: FROM,
      fetch: fetchMock,
    });

    await sender.send({
      ...SAMPLE,
      html: '<p>Hi</p>',
      replyTo: 'inbox@myreport.dev',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');

    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer re_test_key');
    expect(init.headers['Content-Type']).toBe('application/json');
    const payload = JSON.parse(init.body as string);
    expect(payload).toEqual({
      from: 'myReport <noreply@myreport.dev>',
      to: ['alice@example.test'],
      subject: 'Welcome',
      text: 'Hello Alice',
      html: '<p>Hi</p>',
      reply_to: 'inbox@myreport.dev',
    });
  });

  it('omits optional html and reply_to when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'msg_124' }));
    const sender = createResendEmailSender({
      apiKey: 'k',
      from: FROM,
      fetch: fetchMock,
    });

    await sender.send(SAMPLE);

    const init = fetchMock.mock.calls[0]?.[1];
    const payload = JSON.parse(init.body as string);
    expect(payload).not.toHaveProperty('html');
    expect(payload).not.toHaveProperty('reply_to');
  });

  it('formats `from` without angle brackets when no name is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'msg_125' }));
    const sender = createResendEmailSender({
      apiKey: 'k',
      from: { address: 'noreply@myreport.dev' },
      fetch: fetchMock,
    });

    await sender.send(SAMPLE);
    const payload = JSON.parse(fetchMock.mock.calls[0]?.[1].body as string);
    expect(payload.from).toBe('noreply@myreport.dev');
  });

  it('throws with the API error name + message on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          name: 'validation_error',
          message: 'The from field must be a valid email address.',
          statusCode: 422,
        },
        { status: 422 },
      ),
    );
    const sender = createResendEmailSender({ apiKey: 'k', from: FROM, fetch: fetchMock });

    await expect(sender.send(SAMPLE)).rejects.toThrow(
      /resend: send failed \(422\): validation_error: The from field/,
    );
  });

  it('falls back to the raw text body when the error response is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('upstream blew up', {
        status: 502,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const sender = createResendEmailSender({ apiKey: 'k', from: FROM, fetch: fetchMock });

    await expect(sender.send(SAMPLE)).rejects.toThrow(
      /resend: send failed \(502\): upstream blew up/,
    );
  });

  it('wraps fetch failures in an Error that mentions the endpoint', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const sender = createResendEmailSender({
      apiKey: 'k',
      from: FROM,
      fetch: fetchMock,
      endpoint: 'https://stub.example/emails',
    });

    await expect(sender.send(SAMPLE)).rejects.toThrow(
      /resend: network error contacting https:\/\/stub\.example\/emails/,
    );
  });

  it('honours the endpoint override for tests / on-prem deployments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'x' }));
    const sender = createResendEmailSender({
      apiKey: 'k',
      from: FROM,
      fetch: fetchMock,
      endpoint: 'http://localhost:9999/emails',
    });

    await sender.send(SAMPLE);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:9999/emails');
  });

  it('does not log or include the api key in error messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'Invalid API key.' }, { status: 401 }));
    const sender = createResendEmailSender({
      apiKey: 're_super_secret_key_42',
      from: FROM,
      fetch: fetchMock,
    });

    let caught: unknown;
    try {
      await sender.send(SAMPLE);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain('re_super_secret_key_42');
  });
});

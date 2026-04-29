import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildInvitationEmail } from '../src/services/emails.ts';
import {
  buildAcceptUrl,
  generateInvitationToken,
  hashInvitationToken,
  INVITATION_TTL_DAYS,
  invitationExpiry,
} from '../src/services/invitations.ts';

describe('generateInvitationToken', () => {
  it('returns a base64url string and the matching sha256 hash', () => {
    const token = generateInvitationToken();
    expect(token.clear).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.clear.length).toBeGreaterThanOrEqual(43);
    const expected = createHash('sha256').update(token.clear).digest();
    expect(token.hash.equals(expected)).toBe(true);
  });

  it('produces unique tokens across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(generateInvitationToken().clear);
    }
    expect(seen.size).toBe(50);
  });
});

describe('hashInvitationToken', () => {
  it('is deterministic for a given clear token', () => {
    const a = hashInvitationToken('abc');
    const b = hashInvitationToken('abc');
    expect(a.equals(b)).toBe(true);
  });

  it('matches the hash carried by generateInvitationToken', () => {
    const token = generateInvitationToken();
    expect(hashInvitationToken(token.clear).equals(token.hash)).toBe(true);
  });
});

describe('buildAcceptUrl', () => {
  it('appends the route and url-encodes the token', () => {
    const url = buildAcceptUrl('http://localhost:5173', 'abc/+=');
    expect(url).toBe('http://localhost:5173/invitations/accept?token=abc%2F%2B%3D');
  });

  it('strips a single trailing slash from the base url', () => {
    const url = buildAcceptUrl('http://localhost:5173/', 'tok');
    expect(url).toBe('http://localhost:5173/invitations/accept?token=tok');
  });
});

describe('invitationExpiry', () => {
  it('adds the configured TTL in days', () => {
    const now = new Date('2026-04-29T10:00:00.000Z');
    const exp = invitationExpiry(now);
    expect(exp.toISOString()).toBe('2026-05-06T10:00:00.000Z');
    expect(INVITATION_TTL_DAYS).toBe(7);
  });
});

describe('buildInvitationEmail', () => {
  it('addresses the invitee and embeds the accept URL', () => {
    const email = buildInvitationEmail({
      inviteeEmail: 'alice@example.test',
      tenantName: 'Acme Audit',
      inviterName: 'Bob',
      role: 'auditor',
      acceptUrl: 'http://localhost:5173/invitations/accept?token=xyz',
      expiresAt: new Date('2026-05-06T10:00:00.000Z'),
    });
    expect(email.to).toBe('alice@example.test');
    expect(email.subject).toContain('Acme Audit');
    expect(email.text).toContain('http://localhost:5173/invitations/accept?token=xyz');
    expect(email.text).toContain('auditor');
    expect(email.text).toContain('Bob');
    expect(email.text).toContain('2026-05-06');
  });

  it('falls back to a generic inviter when the name is unknown', () => {
    const email = buildInvitationEmail({
      inviteeEmail: 'alice@example.test',
      tenantName: 'Acme Audit',
      inviterName: null,
      role: 'cabinet_admin',
      acceptUrl: 'http://localhost:5173/invitations/accept?token=xyz',
      expiresAt: new Date('2026-05-06T10:00:00.000Z'),
    });
    expect(email.text).toContain('A myReport administrator');
    expect(email.text).toContain('cabinet administrator');
  });
});

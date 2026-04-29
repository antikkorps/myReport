import type { Email } from '@myreport/email';

export interface InvitationEmailVars {
  inviteeEmail: string;
  tenantName: string;
  inviterName: string | null;
  role: 'cabinet_admin' | 'auditor';
  acceptUrl: string;
  expiresAt: Date;
}

// Plain-text invitation email. We deliberately stay text-only for now:
// HTML rendering would require a templating layer we don't have a
// concrete need for yet, and a clean text body covers screen readers
// and mail clients that strip HTML.
export function buildInvitationEmail(vars: InvitationEmailVars): Email {
  const roleLabel = vars.role === 'cabinet_admin' ? 'cabinet administrator' : 'auditor';
  const inviter = vars.inviterName ?? 'A myReport administrator';
  const expiresOn = vars.expiresAt.toISOString().slice(0, 10);

  const text = [
    `Hello,`,
    ``,
    `${inviter} has invited you to join "${vars.tenantName}" on myReport as ${roleLabel}.`,
    ``,
    `Open the link below to set your password and accept the invitation. The link is valid until ${expiresOn} (UTC):`,
    ``,
    vars.acceptUrl,
    ``,
    `If you weren't expecting this invitation, you can safely ignore this email.`,
    ``,
    `— myReport`,
  ].join('\n');

  return {
    to: vars.inviteeEmail,
    subject: `You're invited to join ${vars.tenantName} on myReport`,
    text,
  };
}

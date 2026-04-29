export {
  type ConsoleEmailSender,
  type ConsoleEmailSenderOptions,
  createConsoleEmailSender,
  type SentEmail,
} from './drivers/console.ts';
export { createResendEmailSender, type ResendEmailSenderOptions } from './drivers/resend.ts';
export { createEmailSender, type EmailConfig } from './factory.ts';
export type { Email, EmailAddress, EmailSender } from './sender.ts';

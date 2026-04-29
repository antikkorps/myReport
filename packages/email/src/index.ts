export {
  type ConsoleEmailSender,
  type ConsoleEmailSenderOptions,
  createConsoleEmailSender,
  type SentEmail,
} from './drivers/console.ts';
export { createEmailSender, type EmailConfig } from './factory.ts';
export type { Email, EmailSender } from './sender.ts';

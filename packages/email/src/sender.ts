// Outbound transactional email payload. `text` is mandatory (a11y +
// spam score); `html` is optional and only delivered when present.
export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

// Driver contract. Implementations may queue, retry, or batch — the
// caller only awaits successful submission to the underlying transport.
export interface EmailSender {
  send(email: Email): Promise<void>;
}

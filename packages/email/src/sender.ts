// Structured email address. Carrying the display name as a separate
// field avoids the parsing pitfalls of "Name <email@domain>" strings
// (escaping commas, quotes, etc.) — drivers format it themselves.
export interface EmailAddress {
  address: string;
  name?: string;
}

// Outbound transactional email payload. `text` is mandatory (a11y +
// spam score); `html` is optional and only delivered when present.
// `from` is *not* part of this payload — drivers know the sender and
// inject it themselves so templates stay portable across drivers.
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

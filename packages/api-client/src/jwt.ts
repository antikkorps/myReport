// Decodes the `exp` claim of a JWT without verifying its signature.
// The signature can't be verified on the client (no shared secret), but
// `exp` is enough to schedule a proactive refresh — the server is still
// the source of truth for actual expiry.
export function decodeJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payloadPart = parts[1];
  if (!payloadPart) return null;
  try {
    const padded = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded);
    const parsed: unknown = JSON.parse(decoded);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'exp' in parsed &&
      typeof (parsed as { exp: unknown }).exp === 'number'
    ) {
      return (parsed as { exp: number }).exp;
    }
    return null;
  } catch {
    return null;
  }
}

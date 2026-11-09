export function redactSensitiveText(message: string): string {
  let redacted = message;
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value &&
      value.length >= 4 &&
      (name === 'DATABASE_URL' || name === 'DATABASE_URL_DIRECT' || /(PASSWORD|SECRET|TOKEN|KEY)/i.test(name))
    ) {
      redacted = redacted.replaceAll(value, '[redacted]');
    }
  }
  return redacted.replace(
    /((?:postgres(?:ql)?|https?):\/\/)[^\s/@]+:[^\s/@]+@/gi,
    '$1[redacted]@',
  );
}

export function formatStartupError(error: unknown): string {
  const seen = new Set<unknown>();
  const describe = (cause: unknown, depth: number): string => {
    if (depth > 3 || seen.has(cause)) return 'Additional error details omitted.';
    seen.add(cause);

    if (!(cause instanceof Error)) return redactSensitiveText(String(cause));

    const detail = redactSensitiveText(
      `${cause.name}: ${cause.message || 'No error message was provided.'}`,
    );
    const nestedErrors =
      cause instanceof AggregateError
        ? Array.from(cause.errors, (nested) => describe(nested, depth + 1)).join('; ')
        : '';
    const nestedCause =
      'cause' in cause && cause.cause !== undefined ? describe(cause.cause, depth + 1) : '';
    const nested = [nestedErrors, nestedCause].filter(Boolean).join('; ');
    return nested ? `${detail} (${nested})` : detail;
  };

  return describe(error, 0);
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly headers: Record<string, string>;

  constructor(
    status: number,
    message: string,
    code?: string,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

import { HttpError } from './errors.ts';

export function normalizeWebsiteUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new HttpError(400, 'Website must be a valid HTTP or HTTPS URL.', 'INVALID_PROFILE');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new HttpError(400, 'Website must be a valid HTTP or HTTPS URL.', 'INVALID_PROFILE');
  }
  return url.href;
}

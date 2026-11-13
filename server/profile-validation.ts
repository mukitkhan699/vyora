import type { User } from '../src/types/index.ts';
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

export function normalizeAppMediaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (/^\/api\/files\/file_[a-f0-9-]{36}$/i.test(parsed.pathname)) return parsed.pathname;
  } catch {
    // Relative media references are already in the API's stable format.
  }
  return url;
}

export function buildProfileUpdates(data: Partial<User>): Array<[string, string | null]> {
  const patch: Array<[keyof User, string]> = [
    ['name', 'name'],
    ['avatarUrl', 'avatar_url'],
    ['bannerUrl', 'banner_url'],
    ['bio', 'bio'],
    ['location', 'location'],
    ['website', 'website'],
  ];
  const updates: Array<[string, string | null]> = [];
  for (const [property, column] of patch) {
    const rawValue = data[property];
    if (rawValue === undefined) continue;
    if (typeof rawValue !== 'string') {
      throw new HttpError(400, `Invalid ${property} value.`, 'INVALID_PROFILE');
    }
    const value =
      property === 'avatarUrl' || property === 'bannerUrl'
        ? normalizeAppMediaUrl(rawValue)
        : property === 'website'
          ? normalizeWebsiteUrl(rawValue) || ''
          : rawValue;
    const max = property === 'bio' ? 500 : property === 'website' ? 2048 : 120;
    if (value.length > max) {
      throw new HttpError(400, `${property} is too long.`, 'INVALID_PROFILE');
    }
    updates.push([column, column === 'avatar_url' ? value : value || null]);
  }
  return updates;
}

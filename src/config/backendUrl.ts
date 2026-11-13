/**
 * Backend URL configuration.
 *
 * Android builds use the production Zunari backend.
 * Web builds retain the existing same-origin behavior.
 */

const ANDROID_BACKEND_URL = 'https://zunari.duckdns.org';

export function getBackendApiUrl(): string {
  if (import.meta.env.VITE_ANDROID_BUILD === 'true') {
    return ANDROID_BACKEND_URL;
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'http://localhost:3000';
}

export const BACKEND_URL = getBackendApiUrl();

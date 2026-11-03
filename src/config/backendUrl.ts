/**
 * =====================================================================
 * HARDCODED BACKEND API SERVER URL
 * =====================================================================
 * As requested, the frontend and backend are decoupled.
 * The backend handles all configurations and business logic.
 *
 * To point this frontend to your separate standalone backend server,
 * change the HARDCODED_BACKEND_URL below to your backend URL:
 * e.g., "http://localhost:5000" or "https://api.vyora.social"
 *
 * If left empty (""), it automatically connects to the current host origin.
 */
export const HARDCODED_BACKEND_URL: string = "";

export function getBackendApiUrl(): string {
  // If a hardcoded backend URL is specified, use it directly
  if (HARDCODED_BACKEND_URL && HARDCODED_BACKEND_URL.trim() !== "") {
    return HARDCODED_BACKEND_URL.replace(/\/$/, "");
  }

  // Fallback to active browser origin so the preview environment works seamlessly
  if (typeof window !== "undefined" && window.location && window.location.origin) {
    return window.location.origin;
  }

  return "http://localhost:3000";
}

export const BACKEND_URL = getBackendApiUrl();

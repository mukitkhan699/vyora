import { CDNInfo } from '../types/index.ts';
import { getBackendApiUrl } from '../config/backendUrl.ts';

class MultiCDNManager {
  private cdns: string[] = [];
  private cdnHealth: Map<string, CDNInfo> = new Map();
  private failedUrls: Set<string> = new Set();

  constructor() {
    // Initialized without local frontend configuration.
    // The backend dynamically provides CDN arrays via /api/config
  }

  public setCdns(urls: string[]) {
    if (!urls || urls.length === 0) return;
    this.cdns = urls.map(u => u.replace(/\/$/, ''));
    this.cdns.forEach(url => {
      if (!this.cdnHealth.has(url)) {
        try {
          const parsed = new URL(url);
          this.cdnHealth.set(url, {
            url,
            name: parsed.hostname,
            status: 'active',
          });
        } catch {
          this.cdnHealth.set(url, {
            url,
            name: url,
            status: 'active',
          });
        }
      }
    });


    // Dynamically inject dns-prefetch and preconnect headers
    if (typeof document !== 'undefined') {
      this.cdns.forEach(url => {
        try {
          const origin = new URL(url).origin;
          if (!document.querySelector(`link[href="${origin}"]`)) {
            const preconnect = document.createElement('link');
            preconnect.rel = 'preconnect';
            preconnect.href = origin;
            preconnect.crossOrigin = 'anonymous';
            document.head.appendChild(preconnect);
          }
        } catch {
          // ignore invalid urls
        }
      });
    }
  }

  public getCdns(): string[] {
    return this.cdns;
  }

  public getCdnHealthList(): CDNInfo[] {
    return Array.from(this.cdnHealth.values());
  }

  /**
   * Resolves an asset URL.
   * If the url is already fully qualified (starts with http), it checks if it needs CDN routing.
   * If an asset path is relative, it prepends the first active CDN.
   * If preferred CDN is specified or has failed, it selects the next available fallback CDN.
   */
  public resolveAssetUrl(originalUrl: string, fallbackAttempt = 0): string {
    if (!originalUrl) return '';

    // If it's a data url or blob, return directly
    if (originalUrl.startsWith('data:') || originalUrl.startsWith('blob:')) {
      return originalUrl;
    }

    // Backend-provided file URL (e.g. /api/files/file_123)
    if (originalUrl.startsWith('/api/files/')) {
      const backendUrl = getBackendApiUrl();
      return `${backendUrl}${originalUrl}`;
    }

    if (this.cdns.length === 0) return originalUrl;

    // If the URL is already an absolute URL from an external source:
    if (originalUrl.startsWith('http://') || originalUrl.startsWith('https://')) {
      // If this specific URL failed previously, try replacing hostname with a secondary CDN if applicable
      if (this.failedUrls.has(originalUrl) && this.cdns.length > 1) {
        const nextCdn = this.cdns[fallbackAttempt % this.cdns.length];
        try {
          const parsed = new URL(originalUrl);
          return `${nextCdn}${parsed.pathname}${parsed.search}`;
        } catch {
          return originalUrl;
        }
      }
      return originalUrl;
    }

    // Relative asset path (e.g. "/avatars/user1.png")
    const cleanPath = originalUrl.startsWith('/') ? originalUrl : `/${originalUrl}`;
    const selectedCdn = this.cdns[fallbackAttempt % this.cdns.length];
    return `${selectedCdn}${cleanPath}`;
  }


  /**
   * Register a failed asset URL so future requests can switch to fallback CDN
   */
  public recordAssetFailure(failedUrl: string): string | null {
    this.failedUrls.add(failedUrl);

    // If we have multiple CDNs, suggest the next CDN
    for (let i = 0; i < this.cdns.length; i++) {
      const cdn = this.cdns[i];
      if (failedUrl.includes(cdn)) {
        const nextCdn = this.cdns[(i + 1) % this.cdns.length];
        const updated = failedUrl.replace(cdn, nextCdn);
        return updated;
      }
    }

    return null;
  }

  /**
   * Test latency and availability for each configured CDN
   */
  public async testAllCdns(): Promise<CDNInfo[]> {
    const promises = this.cdns.map(async (url) => {
      const startTime = performance.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        // Ping with HEAD or GET
        await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
        clearTimeout(timeout);
        const latencyMs = Math.round(performance.now() - startTime);
        const info: CDNInfo = {
          url,
          name: new URL(url).hostname,
          status: 'active',
          latencyMs,
        };
        this.cdnHealth.set(url, info);
        return info;
      } catch {
        const latencyMs = Math.round(performance.now() - startTime);
        const info: CDNInfo = {
          url,
          name: url.includes('://') ? new URL(url).hostname : url,
          status: 'fallback',
          latencyMs,
        };
        this.cdnHealth.set(url, info);
        return info;
      }
    });

    return Promise.all(promises);
  }
}

export const cdnManager = new MultiCDNManager();

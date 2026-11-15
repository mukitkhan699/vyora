import type { IncomingMessage, ServerResponse } from 'node:http';

export function applySecurityHeaders(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: http: ws: wss:; media-src 'self' blob: https:; frame-ancestors *;",
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const isEncrypted = Boolean((req.socket as { encrypted?: boolean }).encrypted);
  if (isEncrypted) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

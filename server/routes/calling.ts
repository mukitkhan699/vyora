import type { IncomingMessage, ServerResponse } from 'node:http';
import { callingService } from '../calling.ts';
import { HttpError } from '../errors.ts';

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string, code?: string): void {
  sendJson(res, status, { error: message, ...(code && { code }) });
}

export async function handleCallingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  currentUserId: string | null,
  readJson: (req: IncomingMessage) => Promise<Record<string, unknown>>,
  requireSessionWithCsrf: (req: IncomingMessage) => Promise<unknown>,
): Promise<boolean> {
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  // POST /api/calls/initiate
  if (pathname === '/api/calls/initiate' && method === 'POST') {
    if (!currentUserId) {
      sendError(res, 401, 'Authentication required.');
      return true;
    }
    await requireSessionWithCsrf(req);
    const body = await readJson(req);
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : '';
    const type = body.type === 'video' ? 'video' : 'voice';

    if (!conversationId) {
      sendError(res, 400, 'conversationId is required.', 'INVALID_PAYLOAD');
      return true;
    }

    const result = await callingService.initiateCall(currentUserId, conversationId, type);
    sendJson(res, 201, result);
    return true;
  }

  // POST /api/calls/:id/respond
  const respondMatch = /^\/api\/calls\/([^/]+)\/respond$/.exec(pathname);
  if (respondMatch && method === 'POST') {
    if (!currentUserId) {
      sendError(res, 401, 'Authentication required.');
      return true;
    }
    await requireSessionWithCsrf(req);
    const callId = respondMatch[1];
    const body = await readJson(req);
    const action = body.action === 'accept' ? 'accept' : 'reject';

    const result = await callingService.respondToCall(currentUserId, callId, action);
    sendJson(res, 200, result);
    return true;
  }

  // POST /api/calls/:id/end
  const endMatch = /^\/api\/calls\/([^/]+)\/end$/.exec(pathname);
  if (endMatch && method === 'POST') {
    if (!currentUserId) {
      sendError(res, 401, 'Authentication required.');
      return true;
    }
    await requireSessionWithCsrf(req);
    const callId = endMatch[1];
    const result = await callingService.endCall(currentUserId, callId);
    sendJson(res, 200, { call: result });
    return true;
  }

  // LiveKit Webhook: POST /api/calls/webhook
  if (pathname === '/api/calls/webhook' && method === 'POST') {
    const authHeader = req.headers.authorization;
    const body = await readJson(req);
    const bodyStr = JSON.stringify(body);
    try {
      const event = await callingService.validateWebhook(bodyStr, authHeader);
      await callingService.handleWebhook(event);
      sendJson(res, 200, { received: true });
    } catch {
      // In production or when validation fails, respond with 401 unauthorized
      sendError(res, 401, 'Unauthorized webhook event');
    }
    return true;
  }

  return false;
}

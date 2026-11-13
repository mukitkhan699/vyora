import type { IncomingMessage, ServerResponse } from 'node:http';
import { callingService } from '../calling.ts';
import { HttpError } from '../errors.ts';

const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;
const WEBHOOK_CONTENT_TYPE = 'application/webhook+json';

class WebhookBodyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'WebhookBodyError';
  }
}

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

function closeAfterResponse(req: IncomingMessage, res: ServerResponse): void {
  req.pause();
  res.setHeader('Connection', 'close');
  res.shouldKeepAlive = false;
}

function validateWebhookContentType(req: IncomingMessage): boolean {
  const rawContentType = req.headers['content-type'];
  if (typeof rawContentType !== 'string') return false;

  const [mediaType, ...parameters] = rawContentType.split(';');
  if (mediaType.trim().toLowerCase() !== WEBHOOK_CONTENT_TYPE) return false;
  if (parameters.length === 0) return true;
  if (parameters.length !== 1) return false;

  const charsetParameter =
    /^\s*charset\s*=\s*(?:"([^"]*)"|([!#$%&'*+.^_`|~0-9a-z-]+))\s*$/i.exec(parameters[0]);
  const charset = (charsetParameter?.[1] ?? charsetParameter?.[2])?.toLowerCase();
  return charset === 'utf-8' || charset === 'utf8';
}

async function readWebhookBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const removeBodyListeners = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('aborted', onAborted);
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      removeBodyListeners();
      req.off('error', onError);
      reject(new WebhookBodyError('Unable to read webhook request body.', 400));
    };

    const onAborted = () => {
      if (settled) return;
      settled = true;
      removeBodyListeners();
      req.off('error', onError);
      reject(new WebhookBodyError('Webhook request body was interrupted.', 400));
    };

    const onEnd = () => {
      if (settled) return;
      settled = true;
      removeBodyListeners();
      req.off('error', onError);
      if (total === 0) {
        reject(new WebhookBodyError('Webhook request body is empty.', 400));
        return;
      }
      resolve(Buffer.concat(chunks, total));
    };

    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > WEBHOOK_MAX_BODY_BYTES) {
        settled = true;
        req.pause();
        removeBodyListeners();
        req.once('close', () => req.off('error', onError));
        reject(new WebhookBodyError('Webhook request body is too large.', 413));
        return;
      }
      chunks.push(buffer);
    };

    req.on('data', onData);
    req.once('end', onEnd);
    req.once('aborted', onAborted);
    req.on('error', onError);
  });
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
    if (body.action !== 'accept' && body.action !== 'reject') {
      sendError(res, 400, 'action must be accept or reject.', 'INVALID_ACTION');
      return true;
    }

    const result = await callingService.respondToCall(currentUserId, callId, body.action);
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
    if (!validateWebhookContentType(req)) {
      closeAfterResponse(req, res);
      sendError(res, 415, 'Unsupported webhook content type.', 'UNSUPPORTED_CONTENT_TYPE');
      return true;
    }

    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string' || authHeader.trim() === '') {
      closeAfterResponse(req, res);
      sendError(res, 401, 'Unauthorized webhook event.', 'INVALID_WEBHOOK');
      return true;
    }

    let event: Awaited<ReturnType<typeof callingService.validateWebhook>>;
    try {
      const body = await readWebhookBody(req);
      let bodyString: string;
      try {
        bodyString = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
      } catch {
        throw new WebhookBodyError('Webhook request body must be valid UTF-8.', 400);
      }

      event = await callingService.validateWebhook(bodyString, authHeader);
    } catch (error) {
      if (error instanceof WebhookBodyError) {
        if (error.status === 413) {
          closeAfterResponse(req, res);
        }
        sendError(res, error.status, error.message, 'INVALID_WEBHOOK_BODY');
      } else if (error instanceof HttpError && error.status === 503) {
        sendError(res, 503, 'Webhook verification is unavailable.', 'WEBHOOK_UNAVAILABLE');
      } else if (error instanceof SyntaxError) {
        sendError(res, 400, 'Webhook request body is not valid JSON.', 'INVALID_WEBHOOK_BODY');
      } else {
        sendError(res, 401, 'Unauthorized webhook event.', 'INVALID_WEBHOOK');
      }
      return true;
    }

    await callingService.handleWebhook(event);
    sendJson(res, 200, { received: true });
    return true;
  }

  return false;
}

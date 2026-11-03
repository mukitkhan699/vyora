import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { dbAdapter } from '../db/adapter.ts';
import { getAuthUser, handleAuthRequest, setAuthError } from '../auth.ts';

interface StoredFile {
  id: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  size: number;
  uploadedBy: string;
  createdAt: string;
}

const fileStorage = new Map<string, StoredFile>();
const MAX_JSON_BYTES = 12 * 1024 * 1024;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload));
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

async function readJson(req: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      req.resume();
      throw new Error('Request body is too large.');
    }
    chunks.push(buffer);
  }
  if (total === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function getCurrentUserId(req: IncomingMessage): string {
  const authUser = getAuthUser(req);
  if (authUser) return dbAdapter.syncAuthProfile(authUser).id;
  return 'user_mukit';
}

function requireUserId(req: IncomingMessage, res: ServerResponse): string | null {
  const authUser = getAuthUser(req);
  if (!authUser) {
    sendError(res, 401, 'Authentication required.');
    return null;
  }
  return dbAdapter.syncAuthProfile(authUser).id;
}

function getPathSegments(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const pathname = url.pathname;
  const method = (req.method || 'GET').toUpperCase();

  try {
    if (await handleAuthRequest(req, res, url)) return true;

    if (pathname === '/api/auth/demo-accounts' && method === 'GET') {
      const accounts = dbAdapter.getDemoAccounts();
      sendJson(res, 200, {
        accounts: accounts.map((entry) => ({
          ...entry.user,
          defaultPassword: entry.defaultPassword,
        })),
      });
      return true;
    }

    if (pathname === '/api/config' && method === 'GET') {
      sendJson(res, 200, {
        appName: config.appName,
        appTagline: config.appTagline,
        appDescription: config.appDescription,
        brandIcon: config.brandIcon,
        defaultTheme: config.defaultTheme,
        defaultAccentColor: config.defaultAccentColor,
        maxPostLength: config.maxPostLength,
        enablePolls: config.enablePolls,
        enableBookmarks: config.enableBookmarks,
        enableDirectMessages: config.enableDirectMessages,
        allowMediaUploads: config.allowMediaUploads,
        enableTelemetryPulse: config.enableTelemetryPulse,
        cdnUrls: config.cdnUrls,
        databaseType: 'SQLite + memory',
        databaseStatus: dbAdapter.getStatus(),
        endpoints: config.endpoints,
        fileEndpoints: {
          upload: '/api/upload',
          filesBase: '/api/files',
          mediaCatalog: '/api/media/catalog',
        },
        nodeVersion: process.version,
        serverUptime: Math.round(process.uptime()),
        isConfigManagedByBackend: true,
      });
      return true;
    }

    if (pathname === '/api/media/catalog' && method === 'GET') {
      sendJson(res, 200, {
        avatars: config.mediaCatalog.avatars,
        attachments: config.mediaCatalog.attachments,
        cdns: config.cdnUrls,
      });
      return true;
    }

    if (pathname === '/api/upload' && method === 'POST') {
      try {
        const currentUserId = getCurrentUserId(req);
        const body = await readJson(req, MAX_JSON_BYTES);
        const { data, filename, mimeType: providedMime } = body;

        if (!data || typeof data !== 'string') {
          sendError(res, 400, 'Missing file payload or data.');
          return true;
        }

        let mimeType = typeof providedMime === 'string' ? providedMime : 'application/octet-stream';
        let base64Data = data;
        if (data.startsWith('data:')) {
          const match = data.match(/^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/);
          if (match) {
            mimeType = match[1];
            base64Data = match[2];
          }
        }

        const fileBuffer = Buffer.from(base64Data, 'base64');
        if (fileBuffer.length > config.fileConfig.uploadLimitBytes) {
          sendError(
            res,
            413,
            `File exceeds maximum upload limit of ${Math.round(config.fileConfig.uploadLimitBytes / (1024 * 1024))}MB.`,
          );
          return true;
        }

        const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const cleanFilename =
          typeof filename === 'string' && filename
            ? filename
            : `${fileId}.${mimeType.split('/')[1] || 'bin'}`;

        const storedFile: StoredFile = {
          id: fileId,
          filename: cleanFilename,
          mimeType,
          data: fileBuffer,
          size: fileBuffer.length,
          uploadedBy: currentUserId,
          createdAt: new Date().toISOString(),
        };
        fileStorage.set(fileId, storedFile);

        sendJson(res, 201, {
          success: true,
          fileId,
          url: `/api/files/${fileId}`,
          filename: cleanFilename,
          mimeType,
          size: fileBuffer.length,
          createdAt: storedFile.createdAt,
        });
      } catch (error) {
        sendError(res, 500, `File upload failed: ${(error as Error).message}`);
      }
      return true;
    }

    const fileMatch = /^\/api\/files\/([^/]+)$/.exec(pathname);
    if (fileMatch && method === 'GET') {
      const file = fileStorage.get(fileMatch[1]);
      if (!file) {
        sendError(res, 404, 'File not found on backend server.');
        return true;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', file.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Disposition', `inline; filename="${file.filename.replace(/"/g, '')}"`);
      res.end(file.data);
      return true;
    }

    if (pathname === '/api/files' && method === 'GET') {
      sendJson(res, 200, {
        files: Array.from(fileStorage.values()).map((file) => ({
          id: file.id,
          url: `/api/files/${file.id}`,
          filename: file.filename,
          mimeType: file.mimeType,
          size: file.size,
          uploadedBy: file.uploadedBy,
          createdAt: file.createdAt,
        })),
      });
      return true;
    }

    if (pathname === '/api/backend-code' && method === 'GET') {
      const files = [
        { name: 'server.ts', path: 'server.ts', description: 'Development entry point (Vite middleware in dev)' },
        { name: 'server/index.ts', path: 'server/index.ts', description: 'Dependency-free HTTP server and static asset handler' },
        { name: 'server/config.ts', path: 'server/config.ts', description: 'Environment & platform configuration' },
        { name: 'server/auth.ts', path: 'server/auth.ts', description: 'Scrypt authentication, sessions, CSRF & verification' },
        { name: 'server/routes/api.ts', path: 'server/routes/api.ts', description: 'REST API handlers' },
        { name: 'server/db/adapter.ts', path: 'server/db/adapter.ts', description: 'Social data adapter' },
        { name: 'server/db/store.ts', path: 'server/db/store.ts', description: 'In-memory social state and seed data' },
      ];
      sendJson(res, 200, {
        files: files.map((file) => {
          let code = '';
          try {
            code = fs.readFileSync(path.join(process.cwd(), file.path), 'utf-8');
          } catch (error) {
            code = `// Error reading ${file.path}: ${(error as Error).message}`;
          }
          return { ...file, code };
        }),
      });
      return true;
    }

    if (pathname === '/api/cdn/health' && method === 'GET') {
      const results = await Promise.all(
        config.cdnUrls.map(async (cdnUrl) => {
          const startTime = Date.now();
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3500);
            const response = await fetch(cdnUrl, { method: 'HEAD', signal: controller.signal });
            clearTimeout(timeout);
            return {
              url: cdnUrl,
              name: new URL(cdnUrl).hostname,
              status: response.ok || response.status < 500 ? 'active' : 'fallback',
              latencyMs: Date.now() - startTime,
              statusCode: response.status,
            };
          } catch (error) {
            return {
              url: cdnUrl,
              name: new URL(cdnUrl).hostname,
              status: 'offline',
              latencyMs: Date.now() - startTime,
              error: (error as Error).message,
            };
          }
        }),
      );
      sendJson(res, 200, { cdns: results });
      return true;
    }

    if (pathname === '/api/posts' && method === 'GET') {
      const currentUserId = getCurrentUserId(req);
      const feedType = (url.searchParams.get('feed') as 'for-you' | 'following') || 'for-you';
      const authorId = url.searchParams.get('authorId') || undefined;
      sendJson(res, 200, await dbAdapter.getPosts(currentUserId, feedType, authorId));
      return true;
    }

    if (pathname === '/api/posts' && method === 'POST') {
      const authorId = requireUserId(req, res);
      if (!authorId) return true;
      const body = await readJson(req);
      const content = typeof body.content === 'string' ? body.content : '';
      const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls.map(String) : undefined;
      const pollOptions = Array.isArray(body.pollOptions) ? body.pollOptions.map(String) : undefined;
      const replyToId = typeof body.replyToId === 'string' ? body.replyToId : undefined;
      const quotePostId = typeof body.quotePostId === 'string' ? body.quotePostId : undefined;

      if (!content.trim()) {
        sendError(res, 400, 'Post content cannot be empty.');
        return true;
      }
      if (content.length > config.maxPostLength) {
        sendError(res, 400, `Post exceeds maximum length of ${config.maxPostLength} characters.`);
        return true;
      }
      const post = await dbAdapter.createPost(
        authorId,
        content.trim(),
        mediaUrls,
        pollOptions,
        replyToId,
        quotePostId,
      );
      sendJson(res, 201, post);
      return true;
    }

    const postMatch = /^\/api\/posts\/([^/]+)$/.exec(pathname);
    if (postMatch && method === 'GET') {
      const result = await dbAdapter.getPostById(postMatch[1], getCurrentUserId(req));
      if (!result.post) {
        sendError(res, 404, 'Post not found.');
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }

    if (postMatch && method === 'DELETE') {
      const currentUserId = requireUserId(req, res);
      if (!currentUserId) return true;
      try {
        const success = await dbAdapter.deletePost(currentUserId, postMatch[1]);
        if (!success) {
          sendError(res, 404, 'Post not found.');
          return true;
        }
        sendJson(res, 200, { success: true });
      } catch (error) {
        sendError(res, 403, (error as Error).message);
      }
      return true;
    }

    const actionMatch = /^\/api\/posts\/([^/]+)\/(like|repost|bookmark)$/.exec(pathname);
    if (actionMatch && method === 'POST') {
      const currentUserId = requireUserId(req, res);
      if (!currentUserId) return true;
      const [, postId, action] = actionMatch;
      if (action === 'like') {
        sendJson(res, 200, await dbAdapter.toggleLike(currentUserId, postId));
      } else if (action === 'repost') {
        sendJson(res, 200, await dbAdapter.toggleRepost(currentUserId, postId));
      } else {
        sendJson(res, 200, await dbAdapter.toggleBookmark(currentUserId, postId));
      }
      return true;
    }

    const pollVoteMatch = /^\/api\/posts\/([^/]+)\/poll\/vote$/.exec(pathname);
    if (pollVoteMatch && method === 'POST') {
      const currentUserId = requireUserId(req, res);
      if (!currentUserId) return true;
      const body = await readJson(req);
      if (typeof body.optionIndex !== 'number') {
        sendError(res, 400, 'optionIndex must be a number.');
        return true;
      }
      sendJson(res, 200, await dbAdapter.votePoll(currentUserId, pollVoteMatch[1], body.optionIndex));
      return true;
    }

    if (pathname === '/api/users' && method === 'GET') {
      sendJson(res, 200, await dbAdapter.getUsers());
      return true;
    }

    const userMatch = /^\/api\/users\/([^/]+)$/.exec(pathname);
    if (userMatch && method === 'GET') {
      const user = await dbAdapter.getUserByUsername(decodeURIComponent(userMatch[1]));
      if (!user) {
        sendError(res, 404, 'User not found.');
        return true;
      }
      sendJson(res, 200, {
        ...user,
        isFollowing: await dbAdapter.isFollowing(getCurrentUserId(req), user.id),
      });
      return true;
    }

    if (pathname === '/api/users/profile' && method === 'PUT') {
      const currentUserId = requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, await dbAdapter.updateProfile(currentUserId, await readJson(req)));
      return true;
    }

    const followMatch = /^\/api\/users\/([^/]+)\/follow$/.exec(pathname);
    if (followMatch && method === 'POST') {
      const currentUserId = requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, await dbAdapter.toggleFollow(currentUserId, followMatch[1]));
      return true;
    }

    if (pathname === '/api/bookmarks' && method === 'GET') {
      sendJson(res, 200, await dbAdapter.getBookmarks(getCurrentUserId(req)));
      return true;
    }

    if (pathname === '/api/notifications' && method === 'GET') {
      sendJson(res, 200, await dbAdapter.getNotifications(getCurrentUserId(req)));
      return true;
    }

    if (pathname === '/api/notifications/read-all' && method === 'POST') {
      sendJson(res, 200, { success: await dbAdapter.markNotificationsRead() });
      return true;
    }

    const messagesMatch = /^\/api\/messages\/([^/]+)$/.exec(pathname);
    if (messagesMatch && method === 'GET') {
      const currentUserId = requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, await dbAdapter.getMessages(currentUserId, messagesMatch[1]));
      return true;
    }

    if (pathname === '/api/messages' && method === 'POST') {
      const currentUserId = requireUserId(req, res);
      if (!currentUserId) return true;
      const body = await readJson(req);
      const recipientId = typeof body.recipientId === 'string' ? body.recipientId : '';
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!recipientId || !text) {
        sendError(res, 400, 'recipientId and text are required.');
        return true;
      }
      sendJson(res, 201, await dbAdapter.sendMessage(currentUserId, recipientId, text));
      return true;
    }

    if (pathname === '/api/trends' && method === 'GET') {
      sendJson(res, 200, await dbAdapter.getTrends());
      return true;
    }

    const segments = getPathSegments(pathname);
    if (segments[0] === 'api') {
      sendError(res, 404, 'Not found.');
      return true;
    }

    return false;
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendError(res, 400, 'Invalid JSON request body.');
      return true;
    }
    if (error instanceof Error && error.message === 'Request body is too large.') {
      sendError(res, 413, error.message);
      return true;
    }
    setAuthError(res, error);
    return true;
  }
}

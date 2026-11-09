import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config.ts';
import { dbAdapter } from '../db/adapter.ts';
import {
  getAuthUser,
  handleAuthRequest,
  requireSessionWithCsrf,
  setAuthError,
} from '../auth.ts';
import { handleAdminRequest } from './admin.ts';
import {
  abortUpload,
  createLegacyUpload,
  createUploadUrl,
  deleteOwnedAsset,
  finalizeUpload,
  getAuthorizedDownloadUrl,
  listOwnedAssets,
  type MediaPurpose,
} from '../storage/b2.ts';
import {
  createUserReport,
  createPostReport,
} from '../db/admin.ts';
import { handleMessagingRequest } from './messaging.ts';
import { handleCallingRequest } from './calling.ts';
import { enforceReportRateLimit } from '../rate-limit.ts';
import { HttpError } from '../errors.ts';

class PayloadTooLargeError extends Error {}

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

async function readFileBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      req.resume();
      throw new PayloadTooLargeError(
        `File exceeds maximum upload limit of ${Math.round(maxBytes / (1024 * 1024))}MB.`,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function getCurrentUserId(req: IncomingMessage): Promise<string> {
  const authUser = await getAuthUser(req);
  if (authUser) return (await dbAdapter.syncAuthProfile(authUser)).id;
  return '';
}

async function requireUserId(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    await requireSessionWithCsrf(req);
  }
  const authUser = await getAuthUser(req);
  if (!authUser) {
    sendError(res, 401, 'Authentication required.');
    return null;
  }
  return (await dbAdapter.syncAuthProfile(authUser)).id;
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

    if (await handleAdminRequest(req, res, url)) return true;

    const currentUserIdForMessaging = await getCurrentUserId(req);
    if (await handleMessagingRequest(req, res, url, currentUserIdForMessaging || null, readJson, requireSessionWithCsrf)) {
      return true;
    }

    if (await handleCallingRequest(req, res, url, currentUserIdForMessaging || null, readJson, requireSessionWithCsrf)) {
      return true;
    }

    if (pathname === '/api/auth/demo-accounts' && method === 'GET') {
      const accounts = await dbAdapter.getDemoAccounts();
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
      });
      return true;
    }

    if (pathname === '/api/media/catalog' && method === 'GET') {
      sendJson(res, 200, {
        avatars: config.mediaCatalog.avatars,
        attachments: config.mediaCatalog.attachments,
      });
      return true;
    }

    if (pathname === '/api/upload' && method === 'POST') {
      if (!config.allowMediaUploads) {
        sendError(res, 403, 'Media uploads are disabled.');
        return true;
      }
      await requireSessionWithCsrf(req);
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      const mimeType = (req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
      if (!config.fileConfig.allowedMimeTypes.includes(mimeType)) {
        sendError(res, 415, 'Unsupported media type.');
        return true;
      }
      const fileBuffer = await readFileBody(req, config.fileConfig.uploadLimitBytes);
      if (fileBuffer.length === 0) {
        sendError(res, 400, 'Uploaded file is empty.');
        return true;
      }
      const requestedPurpose = url.searchParams.get('purpose');
      const purpose: MediaPurpose =
        requestedPurpose === 'profile-avatar' || requestedPurpose === 'profile-cover'
          ? requestedPurpose
          : 'post-image';
      const storedFile = await createLegacyUpload(
        {
          ownerId: currentUserId,
          filename: url.searchParams.get('filename') || 'upload',
          mimeType,
          size: fileBuffer.length,
          purpose,
        },
        fileBuffer,
      );
      sendJson(res, 201, {
        success: true,
        fileId: storedFile.id,
        url: `/api/files/${storedFile.id}`,
        filename: storedFile.filename,
        mimeType: storedFile.mime_type,
        size: Number(storedFile.byte_size),
        createdAt: new Date(Number(storedFile.created_at)).toISOString(),
      });
      return true;
    }

    if (pathname === '/api/uploads/presign' && method === 'POST') {
      if (!config.allowMediaUploads) {
        sendError(res, 403, 'Media uploads are disabled.');
        return true;
      }
      await requireSessionWithCsrf(req);
      const ownerId = await requireUserId(req, res);
      if (!ownerId) return true;
      const body = await readJson(req);
      const purpose = body.purpose;
      if (
        purpose !== 'profile-avatar' &&
        purpose !== 'profile-cover' &&
        purpose !== 'post-image'
      ) {
        sendError(res, 400, 'A supported upload purpose is required.');
        return true;
      }
      const upload = await createUploadUrl({
        ownerId,
        filename: typeof body.filename === 'string' ? body.filename : '',
        mimeType: typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '',
        size: Number(body.size),
        purpose,
      });
      sendJson(res, 201, {
        ...upload,
        headers: { 'Content-Type': upload.mimeType },
      });
      return true;
    }

    const finalizeMatch = /^\/api\/uploads\/([^/]+)\/complete$/.exec(pathname);
    if (finalizeMatch && method === 'POST') {
      await requireSessionWithCsrf(req);
      const ownerId = await requireUserId(req, res);
      if (!ownerId) return true;
      await readJson(req);
      const asset = await finalizeUpload(ownerId, finalizeMatch[1]);
      sendJson(res, 200, {
        success: true,
        fileId: asset.id,
        url: `/api/files/${asset.id}`,
        filename: asset.filename,
        mimeType: asset.mime_type,
        size: Number(asset.byte_size),
        createdAt: new Date(Number(asset.created_at)).toISOString(),
      });
      return true;
    }

    const abortMatch = /^\/api\/uploads\/([^/]+)\/abort$/.exec(pathname);
    if (abortMatch && method === 'POST') {
      const ownerId = await requireUserId(req, res);
      if (!ownerId) return true;
      await readJson(req);
      await abortUpload(ownerId, abortMatch[1]);
      sendJson(res, 200, { success: true });
      return true;
    }

    const fileMatch = /^\/api\/files\/([^/]+)$/.exec(pathname);
    if (fileMatch && method === 'GET') {
      const authUser = await getAuthUser(req);
      const requesterId = authUser ? (await dbAdapter.syncAuthProfile(authUser)).id : null;
      const downloadUrl = await getAuthorizedDownloadUrl(fileMatch[1], requesterId);
      res.statusCode = 302;
      res.setHeader('Location', downloadUrl);
      res.setHeader('Cache-Control', 'private, no-store');
      res.end();
      return true;
    }

    if (pathname === '/api/files' && method === 'GET') {
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, {
        files: await listOwnedAssets(currentUserId),
      });
      return true;
    }

    if (fileMatch && method === 'DELETE') {
      await requireSessionWithCsrf(req);
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      await deleteOwnedAsset(currentUserId, fileMatch[1]);
      sendJson(res, 200, { success: true });
      return true;
    }

    if (pathname === '/api/posts' && method === 'GET') {
      const currentUserId = await getCurrentUserId(req);
      const feedType = (url.searchParams.get('feed') as 'for-you' | 'following') || 'for-you';
      const authorId = url.searchParams.get('authorId') || undefined;
      sendJson(res, 200, await dbAdapter.getPosts(currentUserId, feedType, authorId));
      return true;
    }

    if (pathname === '/api/posts' && method === 'POST') {
      const authorId = await requireUserId(req, res);
      if (!authorId) return true;
      const body = await readJson(req);
      const content = typeof body.content === 'string' ? body.content : '';
      const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls.map(String) : undefined;
      const pollOptions = Array.isArray(body.pollOptions) ? body.pollOptions.map(String) : undefined;
      const replyToId = typeof body.replyToId === 'string' ? body.replyToId : undefined;
      const quotePostId = typeof body.quotePostId === 'string' ? body.quotePostId : undefined;

      if (!content.trim() && (!mediaUrls || mediaUrls.length === 0)) {
        sendError(res, 400, 'Post content or media is required.');
        return true;
      }
      if (content.length > config.maxPostLength) {
        sendError(res, 400, `Post exceeds maximum length of ${config.maxPostLength} characters.`);
        return true;
      }
      if (mediaUrls && mediaUrls.length > 4) {
        sendError(res, 400, 'A maximum of 4 media attachments are allowed per post.');
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
      const result = await dbAdapter.getPostById(postMatch[1], await getCurrentUserId(req));
      if (!result.post) {
        sendError(res, 404, 'Post not found.');
        return true;
      }
      sendJson(res, 200, result);
      return true;
    }

    if (postMatch && method === 'DELETE') {
      const currentUserId = await requireUserId(req, res);
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
      const currentUserId = await requireUserId(req, res);
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
      const currentUserId = await requireUserId(req, res);
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
        isFollowing: await dbAdapter.isFollowing(await getCurrentUserId(req), user.id),
      });
      return true;
    }

    if (pathname === '/api/users/profile' && method === 'PUT') {
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, await dbAdapter.updateProfile(currentUserId, await readJson(req)));
      return true;
    }

    const followMatch = /^\/api\/users\/([^/]+)\/follow$/.exec(pathname);
    if (followMatch && method === 'POST') {
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, await dbAdapter.toggleFollow(currentUserId, followMatch[1]));
      return true;
    }

    if (pathname === '/api/bookmarks' && method === 'GET') {
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, await dbAdapter.getBookmarks(currentUserId));
      return true;
    }

    if (pathname === '/api/notifications' && method === 'GET') {
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, await dbAdapter.getNotifications(currentUserId));
      return true;
    }

    if (pathname === '/api/notifications/read-all' && method === 'POST') {
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, { success: await dbAdapter.markNotificationsRead(currentUserId) });
      return true;
    }

    const messagesMatch = /^\/api\/messages\/([^/]+)$/.exec(pathname);
    if (messagesMatch && method === 'GET') {
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      sendJson(res, 200, await dbAdapter.getMessages(currentUserId, messagesMatch[1]));
      return true;
    }

    if (pathname === '/api/messages' && method === 'POST') {
      const currentUserId = await requireUserId(req, res);
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

    // Report creation endpoints
    if (pathname === '/api/reports/user' && method === 'POST') {
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      await requireSessionWithCsrf(req);
      const body = await readJson(req);
      const reportedUserId = typeof body.reportedUserId === 'string' ? body.reportedUserId : '';
      const reason = typeof body.reason === 'string' ? body.reason : '';
      const details = typeof body.details === 'string' ? body.details : null;
      const validReasons = ['spam', 'harassment', 'hate', 'violence', 'illegal', 'misinfo', 'fake', 'other'];
      if (!reportedUserId || !reason || !validReasons.includes(reason)) {
        sendError(res, 400, 'reportedUserId and valid reason are required.', 'INVALID_FIELDS');
        return true;
      }
      if (reportedUserId === currentUserId) {
        sendError(res, 400, 'You cannot report yourself.', 'SELF_REPORT');
        return true;
      }
      // Rate limit after validation to avoid consuming quota on invalid requests
      await enforceReportRateLimit(req, currentUserId);
      try {
        const report = await createUserReport(currentUserId, reportedUserId, reason, details, req);
        sendJson(res, 201, { success: true, report });
      } catch (error) {
        if (error instanceof HttpError) {
          setAuthError(res, error);
        } else {
          throw error;
        }
      }
      return true;
    }

    if (pathname === '/api/reports/post' && method === 'POST') {
      const currentUserId = await requireUserId(req, res);
      if (!currentUserId) return true;
      await requireSessionWithCsrf(req);
      const body = await readJson(req);
      const postId = typeof body.postId === 'string' ? body.postId : '';
      const reason = typeof body.reason === 'string' ? body.reason : '';
      const details = typeof body.details === 'string' ? body.details : null;
      const validReasons = ['spam', 'harassment', 'hate', 'violence', 'illegal', 'misinfo', 'fake', 'other'];
      if (!postId || !reason || !validReasons.includes(reason)) {
        sendError(res, 400, 'postId and valid reason are required.', 'INVALID_FIELDS');
        return true;
      }
      // Rate limit after validation to avoid consuming quota on invalid requests
      await enforceReportRateLimit(req, currentUserId);
      try {
        const report = await createPostReport(currentUserId, postId, reason, details, req);
        sendJson(res, 201, { success: true, report });
      } catch (error) {
        if (error instanceof HttpError) {
          setAuthError(res, error);
        } else {
          throw error;
        }
      }
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
    if (error instanceof PayloadTooLargeError) {
      sendError(res, 413, error.message);
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

import { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { getSession } from './auth.ts';
import { dbAdapter } from './db/adapter.ts';
import { onMessage, onNotification, onSessionRevocation } from './realtime-events.ts';

let activeServer: SocketServer | undefined;
let stopMessageListener: (() => void) | undefined;
let stopNotificationListener: (() => void) | undefined;
let stopSessionRevocationListener: (() => void) | undefined;

function getConfiguredOrigin(): string | undefined {
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) return undefined;
  try {
    return new URL(appUrl).origin;
  } catch {
    return undefined;
  }
}

function getAdminOrigin(): string | undefined {
  const adminOrigin = process.env.ADMIN_ORIGIN?.trim();
  if (!adminOrigin) return undefined;
  try {
    return new URL(adminOrigin).origin;
  } catch {
    return undefined;
  }
}

function isAllowedOrigin(socket: Socket): boolean {
  const origin = socket.handshake.headers.origin;
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const allowedOrigins = new Set<string>();
  const configuredOrigin = getConfiguredOrigin();
  if (configuredOrigin) allowedOrigins.add(configuredOrigin);
  const adminOrigin = getAdminOrigin();
  if (adminOrigin) allowedOrigins.add(adminOrigin);
  const host = socket.request.headers.host;
  if (host) {
    const forwardedProtocol = socket.request.headers['x-forwarded-proto'];
    const protocol =
      typeof forwardedProtocol === 'string' &&
      ['http', 'https'].includes(forwardedProtocol.split(',')[0].trim())
        ? forwardedProtocol.split(',')[0].trim()
        : 'http';
    allowedOrigins.add(`${protocol}://${host}`);
  }
  return allowedOrigins.has(originUrl.origin);
}

export function attachRealtimeServer(httpServer: HttpServer): SocketServer {
  if (activeServer) throw new Error('Socket.IO is already attached to an HTTP server.');
  const allowedOrigin = getConfiguredOrigin();
  const adminOrigin = getAdminOrigin();
  const corsOrigins = [allowedOrigin, adminOrigin].filter((o): o is string => Boolean(o));
  const io = new SocketServer(httpServer, {
    serveClient: false,
    maxHttpBufferSize: 64 * 1024,
    cors: corsOrigins.length > 0 ? { origin: corsOrigins, credentials: true } : undefined,
  });
  activeServer = io;

  io.use((socket, next) => {
    void (async () => {
      if (!isAllowedOrigin(socket)) {
        next(new Error('Origin is not allowed.'));
        return;
      }
      const session = await getSession(socket.request);
      if (!session?.userId) {
        next(new Error('Authentication required.'));
        return;
      }
      const authUser = {
        id: session.userId,
        username: session.username || '',
        email: session.email,
        createdAt: session.userCreatedAt || 0,
      };
      const socialUser = await dbAdapter.syncAuthProfile(authUser);
      socket.data.userId = socialUser.id;
      socket.data.authUserId = session.userId;
      socket.data.sessionTokenHash = session.tokenHash;
      next();
    })().catch(() => next(new Error('Unable to authenticate realtime connection.')));
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    const authUserId = socket.data.authUserId;
    const sessionTokenHash = socket.data.sessionTokenHash;
    if (typeof userId === 'string') socket.join(`user:${userId}`);
    if (typeof authUserId === 'number') socket.join(`auth-user:${authUserId}`);
    if (typeof sessionTokenHash === 'string') socket.join(`session:${sessionTokenHash}`);
  });

  stopMessageListener = onMessage((message) => {
    io.to(`user:${message.recipientId}`).emit('message:new', { ...message, isSender: false });
    io.to(`user:${message.senderId}`).emit('message:new', { ...message, isSender: true });
  });
  stopNotificationListener = onNotification(({ recipientId, notification }) => {
    io.to(`user:${recipientId}`).emit('notification:new', notification);
  });
  stopSessionRevocationListener = onSessionRevocation(({ tokenHash, userId }) => {
    if (tokenHash) io.in(`session:${tokenHash}`).disconnectSockets(true);
    if (userId) io.in(`auth-user:${userId}`).disconnectSockets(true);
  });

  return io;
}

export async function closeRealtimeServer(): Promise<void> {
  stopMessageListener?.();
  stopNotificationListener?.();
  stopSessionRevocationListener?.();
  stopMessageListener = undefined;
  stopNotificationListener = undefined;
  stopSessionRevocationListener = undefined;
  if (!activeServer) return;
  const io = activeServer;
  activeServer = undefined;
  await new Promise<void>((resolve) => io.close(() => resolve()));
}

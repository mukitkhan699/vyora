import { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { getSession } from './auth.ts';
import { dbAdapter } from './db/adapter.ts';
import { query } from './db/pool.ts';
import {
  onMessage,
  onNotification,
  onSessionRevocation,
  onConversationMessage,
  onConversationMessageEdit,
  onConversationMessageDelete,
  onTyping,
  onReceipt,
  onReaction,
  onCallEvent,
  publishTyping,
  publishReceipt,
} from './realtime-events.ts';

let activeServer: SocketServer | undefined;
let stopListeners: Array<() => void> = [];

// Track online users: Map<userId, Set<socketId>>
const onlineUserSockets = new Map<string, Set<string>>();

export function isUserOnline(userId: string): boolean {
  const sockets = onlineUserSockets.get(userId);
  return Boolean(sockets && sockets.size > 0);
}

export function getOnlineUserIds(): string[] {
  return Array.from(onlineUserSockets.keys()).filter((uid) => {
    const s = onlineUserSockets.get(uid);
    return s && s.size > 0;
  });
}

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
      socket.data.username = socialUser.username;
      socket.data.name = socialUser.name;
      socket.data.authUserId = session.userId;
      socket.data.sessionTokenHash = session.tokenHash;
      next();
    })().catch(() => next(new Error('Unable to authenticate realtime connection.')));
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string | undefined;
    const authUserId = socket.data.authUserId;
    const sessionTokenHash = socket.data.sessionTokenHash;
    const username = socket.data.username as string | undefined;

    if (typeof userId === 'string') {
      socket.join(`user:${userId}`);
      let userSet = onlineUserSockets.get(userId);
      if (!userSet) {
        userSet = new Set();
        onlineUserSockets.set(userId, userSet);
      }
      userSet.add(socket.id);

      // Broadcast user online if first socket
      if (userSet.size === 1) {
        io.emit('presence:update', { userId, isOnline: true });
      }
    }
    if (typeof authUserId === 'number') socket.join(`auth-user:${authUserId}`);
    if (typeof sessionTokenHash === 'string') socket.join(`session:${sessionTokenHash}`);

    // Join conversation room after authorization
    socket.on('conversation:join', (data: { conversationId: string }, ack?: (res: { success: boolean }) => void) => {
      void (async () => {
        if (!userId || !data?.conversationId) {
          ack?.({ success: false });
          return;
        }
        try {
          const check = await query(
            'SELECT 1 FROM zunari_conversation_participants WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL',
            [data.conversationId, userId],
          );
          if (check.rowCount) {
            socket.join(`conv:${data.conversationId}`);
            ack?.({ success: true });
          } else {
            ack?.({ success: false });
          }
        } catch {
          ack?.({ success: false });
        }
      })();
    });

    socket.on('conversation:leave', (data: { conversationId: string }) => {
      if (data?.conversationId) {
        socket.leave(`conv:${data.conversationId}`);
      }
    });

    // Typing indicators
    socket.on('typing:start', (data: { conversationId: string }) => {
      if (!userId || !data?.conversationId) return;
      publishTyping({
        conversationId: data.conversationId,
        userId,
        username: username || '',
        isTyping: true,
      });
    });

    socket.on('typing:stop', (data: { conversationId: string }) => {
      if (!userId || !data?.conversationId) return;
      publishTyping({
        conversationId: data.conversationId,
        userId,
        username: username || '',
        isTyping: false,
      });
    });

    // Online presence check
    socket.on('presence:query', (_data: unknown, ack?: (res: { onlineUserIds: string[] }) => void) => {
      ack?.({ onlineUserIds: getOnlineUserIds() });
    });

    // Disconnect handling
    socket.on('disconnect', () => {
      if (typeof userId === 'string') {
        const userSet = onlineUserSockets.get(userId);
        if (userSet) {
          userSet.delete(socket.id);
          if (userSet.size === 0) {
            onlineUserSockets.delete(userId);
            io.emit('presence:update', { userId, isOnline: false, lastSeen: Date.now() });
          }
        }
      }
    });
  });

  // Event subscribers
  const stopLegacyMsg = onMessage((msg: any) => {
    if (msg.recipientId) io.to(`user:${msg.recipientId}`).emit('message:new', { ...msg, isSender: false });
    if (msg.senderId) io.to(`user:${msg.senderId}`).emit('message:new', { ...msg, isSender: true });
  });

  const stopConvMsg = onConversationMessage(({ conversationId, message, recipientIds }) => {
    io.to(`conv:${conversationId}`).emit('conversation:message', message);
    for (const rId of recipientIds) {
      io.to(`user:${rId}`).emit('conversation:message-notification', { conversationId, message });
    }
  });

  const stopConvMsgEdit = onConversationMessageEdit(({ conversationId, message }) => {
    io.to(`conv:${conversationId}`).emit('conversation:message-edit', message);
  });

  const stopConvMsgDelete = onConversationMessageDelete(({ conversationId, messageId }) => {
    io.to(`conv:${conversationId}`).emit('conversation:message-delete', { conversationId, messageId });
  });

  const stopTyping = onTyping((event) => {
    io.to(`conv:${event.conversationId}`).emit('conversation:typing', event);
  });

  const stopReceipt = onReceipt((event) => {
    io.to(`conv:${event.conversationId}`).emit('conversation:receipt', event);
  });

  const stopReaction = onReaction((event) => {
    io.to(`conv:${event.conversationId}`).emit('conversation:reaction', event);
  });

  const stopCall = onCallEvent((event) => {
    // Deliver call events to participants
    for (const rId of event.recipientIds) {
      io.to(`user:${rId}`).emit(`call:${event.event}`, event);
    }
    io.to(`conv:${event.conversationId}`).emit('call:update', event);
  });

  const stopNotif = onNotification(({ recipientId, notification }) => {
    io.to(`user:${recipientId}`).emit('notification:new', notification);
  });

  const stopSessionRev = onSessionRevocation(({ tokenHash, userId }) => {
    if (tokenHash) io.in(`session:${tokenHash}`).disconnectSockets(true);
    if (userId) io.in(`auth-user:${userId}`).disconnectSockets(true);
  });

  stopListeners = [
    stopLegacyMsg,
    stopConvMsg,
    stopConvMsgEdit,
    stopConvMsgDelete,
    stopTyping,
    stopReceipt,
    stopReaction,
    stopCall,
    stopNotif,
    stopSessionRev,
  ];

  return io;
}

export async function closeRealtimeServer(): Promise<void> {
  for (const stop of stopListeners) stop();
  stopListeners = [];
  if (!activeServer) return;
  const io = activeServer;
  activeServer = undefined;
  await new Promise<void>((resolve) => io.close(() => resolve()));
}

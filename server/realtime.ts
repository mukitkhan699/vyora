import { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { getSession } from './auth.ts';
import { dbAdapter } from './db/adapter.ts';
import { query } from './db/pool.ts';
import {
  attachPostgresRealtimeAdapter,
  type RealtimeAdapterHandle,
} from './realtime-adapter.ts';
import {
  onNotification,
  onSessionRevocation,
  onConversationMessage,
  onConversationMessageEdit,
  onConversationMessageDelete,
  onTyping,
  onReceipt,
  onReaction,
  onCallEvent,
  type RealtimeMessageEvent,
  type RealtimeDeliveryMetadata,
  type RealtimeTypingEvent,
  type RealtimeReceiptEvent,
  type RealtimeReactionEvent,
  type RealtimeCallEvent,
  type SessionRevocation,
  publishTyping,
  publishReceipt,
} from './realtime-events.ts';
import type { Notification } from '../src/types/index.ts';

let activeServer: SocketServer | undefined;
let realtimeAdapter: RealtimeAdapterHandle | undefined;
let stopListeners: Array<() => void> = [];

// Track online users: Map<userId, Set<socketId>>
const onlineUserSockets = new Map<string, Set<string>>();

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function isUserOnline(userId: string): boolean {
  const sockets = onlineUserSockets.get(userId);
  return Boolean(sockets && sockets.size > 0);
}

export function evictUserFromConversation(userId: string, conversationId: string): void {
  const io = activeServer;
  if (!io) return;
  evictUserFromConversationLocal(io, userId, conversationId);
  if (!realtimeAdapter?.isReady()) return;
  void Promise.resolve(
    io.serverSideEmit('zunari:realtime:evict-conversation', { userId, conversationId }),
  ).catch((error) => {
    console.error('[realtime] Unable to forward conversation eviction:', error);
  });
}

export function emitConversationMessageToUsers(
  event: RealtimeMessageEvent,
  emitToUser: (userId: string, eventName: string, ...args: unknown[]) => void,
): void {
  const metadata: RealtimeDeliveryMetadata | undefined = event.eventId
    ? { eventId: event.eventId }
    : undefined;
  for (const recipientId of event.recipientIds) {
    const messageArgs = metadata ? [event.message, metadata] : [event.message];
    emitToUser(recipientId, 'conversation:message', ...messageArgs);
    const notification = { conversationId: event.conversationId, message: event.message };
    emitToUser(
      recipientId,
      'conversation:message-notification',
      ...(metadata ? [notification, metadata] : [notification]),
    );
  }
}

function emitConversationMessageEditToUsers(
  event: {
    conversationId: string;
    message: RealtimeMessageEvent['message'];
    recipientIds: string[];
    eventId: string;
  },
  io: SocketServer,
): void {
  const metadata: RealtimeDeliveryMetadata = { eventId: event.eventId };
  for (const recipientId of event.recipientIds) {
    io.local.to(`user:${recipientId}`).emit(
      'conversation:message-edit',
      event.message,
      metadata,
    );
  }
}

function emitConversationMessageToLocalUsers(
  event: RealtimeMessageEvent,
  io: SocketServer,
): void {
  emitConversationMessageToUsers(event, (userId, eventName, ...args) => {
    io.local.to(`user:${userId}`).emit(eventName, ...args);
  });
}

function emitConversationMessageDeleteToLocalUsers(
  io: SocketServer,
  event: { conversationId: string; messageId: string; recipientIds: string[] },
): void {
  const payload = { conversationId: event.conversationId, messageId: event.messageId };
  io.local.to(`conv:${event.conversationId}`).emit('conversation:message-delete', payload);
  for (const recipientId of event.recipientIds) {
    io.local.to(`user:${recipientId}`).emit('conversation:message-delete', payload);
  }
}

function emitTypingToLocalUsers(
  io: SocketServer,
  event: RealtimeTypingEvent,
): void {
  io.local.to(`conv:${event.conversationId}`).emit('conversation:typing', event);
}

function emitReceiptToLocalUsers(
  io: SocketServer,
  event: RealtimeReceiptEvent,
): void {
  const { recipientIds = [], ...payload } = event;
  io.local.to(`conv:${event.conversationId}`).emit('conversation:receipt', payload);
  for (const recipientId of recipientIds) {
    io.local.to(`user:${recipientId}`).emit('conversation:receipt', payload);
  }
}

function emitReactionToLocalUsers(
  io: SocketServer,
  event: RealtimeReactionEvent,
): void {
  const { recipientIds = [], ...payload } = event;
  io.local.to(`conv:${event.conversationId}`).emit('conversation:reaction', payload);
  for (const recipientId of recipientIds) {
    io.local.to(`user:${recipientId}`).emit('conversation:reaction', payload);
  }
}

function emitCallEventToLocalUsers(
  io: SocketServer,
  event: RealtimeCallEvent,
): void {
  for (const recipientId of event.recipientIds) {
    io.local.to(`user:${recipientId}`).emit(`call:${event.event}`, event);
  }
  io.local.to(`conv:${event.conversationId}`).emit('call:update', event);
}

function emitNotificationToLocalUsers(
  io: SocketServer,
  event: { recipientId: string; notification: Notification },
): void {
  io.local.to(`user:${event.recipientId}`).emit('notification:new', event.notification);
}

function disconnectRevokedSessionLocal(
  io: SocketServer,
  revocation: SessionRevocation,
): void {
  if (revocation.tokenHash) {
    io.local.in(`session:${revocation.tokenHash}`).disconnectSockets(true);
  }
  if (revocation.userId) {
    io.local.in(`auth-user:${revocation.userId}`).disconnectSockets(true);
  }
}

function evictUserFromConversationLocal(
  io: SocketServer,
  userId: string,
  conversationId: string,
): void {
  const userRoom = `user:${userId}`;
  const conversationRoom = `conv:${conversationId}`;
  for (const socket of io.sockets.sockets.values()) {
    if (!socket.rooms.has(userRoom)) continue;
    socket.leave(conversationRoom);
    const joined = socket.data.joinedConversations;
    if (joined instanceof Set) joined.delete(conversationId);
  }
}

export async function publishConversationMessageToCluster(
  io: SocketServer,
  isAdapterReady: () => boolean,
  event: RealtimeMessageEvent,
): Promise<boolean> {
  if (!isAdapterReady()) return false;
  emitConversationMessageToLocalUsers(event, io);
  await io.serverSideEmitWithAck('zunari:realtime:outbox-message', event);
  return isAdapterReady();
}

export async function publishConversationMessageEditToCluster(
  io: SocketServer,
  isAdapterReady: () => boolean,
  event: {
    conversationId: string;
    message: RealtimeMessageEvent['message'];
    recipientIds: string[];
    eventId: string;
  },
): Promise<boolean> {
  if (!isAdapterReady()) return false;
  emitConversationMessageEditToUsers(event, io);
  await io.serverSideEmitWithAck('zunari:realtime:outbox-edit', event);
  return isAdapterReady();
}

export async function publishConversationMessageAcrossInstances(
  event: RealtimeMessageEvent,
): Promise<boolean> {
  const io = activeServer;
  if (!io || !realtimeAdapter?.isReady()) return false;
  return publishConversationMessageToCluster(io, () => Boolean(realtimeAdapter?.isReady()), event);
}

export async function publishConversationMessageEditAcrossInstances(event: {
  conversationId: string;
  message: RealtimeMessageEvent['message'];
  recipientIds: string[];
  eventId: string;
}): Promise<boolean> {
  const io = activeServer;
  if (!io || !realtimeAdapter?.isReady()) return false;
  return publishConversationMessageEditToCluster(
    io,
    () => Boolean(realtimeAdapter?.isReady()),
    event,
  );
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

export async function getClusterOnlineUserIds(
  io: SocketServer,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const allowed = new Set(userIds);
  const sockets = await io
    .in(userIds.map((userId) => `user:${userId}`))
    .fetchSockets();
  const online = new Set<string>();
  for (const remoteSocket of sockets) {
    const remoteUserId = (remoteSocket.data as { userId?: unknown } | undefined)?.userId;
    if (typeof remoteUserId === 'string' && allowed.has(remoteUserId)) {
      online.add(remoteUserId);
      continue;
    }
    for (const room of remoteSocket.rooms) {
      if (!room.startsWith('user:')) continue;
      const roomUserId = room.slice('user:'.length);
      if (allowed.has(roomUserId)) online.add(roomUserId);
    }
  }
  return [...online];
}

export interface RealtimeEventPropagationHandle {
  forward(eventName: string, payload: unknown): void;
  stop(): void;
}

/**
 * Wires local publishers to local-only Socket.IO delivery and forwards the
 * same events to the other instances through serverSideEmit. Remote handlers
 * always use io.local so that an event is never rebroadcast through the
 * cluster adapter.
 */
export function installRealtimeEventPropagation(
  io: SocketServer,
  isAdapterReady: () => boolean,
  options: { localPublishers?: boolean } = {},
): RealtimeEventPropagationHandle {
  type RemoteHandler = (raw: unknown, ack?: () => void) => void;
  const listenerStops: Array<() => void> = [];
  const remoteHandlers = new Map<string, RemoteHandler>();

  const forward = (eventName: string, payload: unknown): void => {
    if (!isAdapterReady()) return;
    void Promise.resolve(io.serverSideEmit(eventName, payload)).catch((error) => {
      console.error(`[realtime] Unable to forward ${eventName} to other instances:`, error);
    });
  };

  const onRemote = (eventName: string, handler: RemoteHandler): void => {
    remoteHandlers.set(eventName, handler);
    io.on(eventName, handler);
  };

  const onConversationMessageDeleteLocal = (event: {
    conversationId: string;
    messageId: string;
    recipientIds: string[];
  }): void => {
    emitConversationMessageDeleteToLocalUsers(io, event);
  };

  onRemote('zunari:realtime:conversation-delete', (
    raw: unknown,
    ack?: () => void,
  ) => {
    const event = raw as {
      conversationId?: unknown;
      messageId?: unknown;
      recipientIds?: unknown;
    };
    if (
      !isAdapterReady() ||
      !event ||
      typeof event.conversationId !== 'string' ||
      typeof event.messageId !== 'string' ||
      !isStringArray(event.recipientIds)
    ) {
      ack?.();
      return;
    }
    onConversationMessageDeleteLocal({
      conversationId: event.conversationId,
      messageId: event.messageId,
      recipientIds: event.recipientIds,
    });
    ack?.();
  });

  onRemote('zunari:realtime:typing', (raw: unknown, ack?: () => void) => {
    const event = raw as {
      conversationId?: unknown;
      userId?: unknown;
      username?: unknown;
      isTyping?: unknown;
    };
    if (
      !isAdapterReady() ||
      !event ||
      typeof event.conversationId !== 'string' ||
      typeof event.userId !== 'string' ||
      typeof event.username !== 'string' ||
      typeof event.isTyping !== 'boolean'
    ) {
      ack?.();
      return;
    }
    emitTypingToLocalUsers(io, {
      conversationId: event.conversationId,
      userId: event.userId,
      username: event.username,
      isTyping: event.isTyping,
    });
    ack?.();
  });

  onRemote('zunari:realtime:receipt', (raw: unknown, ack?: () => void) => {
    const event = raw as {
      conversationId?: unknown;
      userId?: unknown;
      messageIds?: unknown;
      receiptType?: unknown;
      recipientIds?: unknown;
    };
    if (
      !isAdapterReady() ||
      !event ||
      typeof event.conversationId !== 'string' ||
      typeof event.userId !== 'string' ||
      !isStringArray(event.messageIds) ||
      (event.receiptType !== 'delivered' && event.receiptType !== 'read') ||
      (event.recipientIds !== undefined && !isStringArray(event.recipientIds))
    ) {
      ack?.();
      return;
    }
    emitReceiptToLocalUsers(io, {
      conversationId: event.conversationId,
      userId: event.userId,
      messageIds: event.messageIds,
      receiptType: event.receiptType,
      recipientIds: event.recipientIds,
    });
    ack?.();
  });

  onRemote('zunari:realtime:reaction', (raw: unknown, ack?: () => void) => {
    const event = raw as {
      conversationId?: unknown;
      messageId?: unknown;
      userId?: unknown;
      username?: unknown;
      emoji?: unknown;
      added?: unknown;
      recipientIds?: unknown;
    };
    if (
      !isAdapterReady() ||
      !event ||
      typeof event.conversationId !== 'string' ||
      typeof event.messageId !== 'string' ||
      typeof event.userId !== 'string' ||
      typeof event.username !== 'string' ||
      typeof event.emoji !== 'string' ||
      typeof event.added !== 'boolean' ||
      (event.recipientIds !== undefined && !isStringArray(event.recipientIds))
    ) {
      ack?.();
      return;
    }
    emitReactionToLocalUsers(io, {
      conversationId: event.conversationId,
      messageId: event.messageId,
      userId: event.userId,
      username: event.username,
      emoji: event.emoji,
      added: event.added,
      recipientIds: event.recipientIds,
    });
    ack?.();
  });

  onRemote('zunari:realtime:call', (raw: unknown, ack?: () => void) => {
    const event = raw as {
      conversationId?: unknown;
      event?: unknown;
      recipientIds?: unknown;
    };
    if (
      !isAdapterReady() ||
      !event ||
      typeof event.conversationId !== 'string' ||
      typeof event.event !== 'string' ||
      !isStringArray(event.recipientIds)
    ) {
      ack?.();
      return;
    }
    emitCallEventToLocalUsers(io, event as RealtimeCallEvent);
    ack?.();
  });

  onRemote('zunari:realtime:notification', (raw: unknown, ack?: () => void) => {
    const event = raw as { recipientId?: unknown; notification?: unknown };
    if (
      !isAdapterReady() ||
      !event ||
      typeof event.recipientId !== 'string' ||
      !event.notification ||
      typeof event.notification !== 'object'
    ) {
      ack?.();
      return;
    }
    emitNotificationToLocalUsers(io, {
      recipientId: event.recipientId,
      notification: event.notification as Notification,
    });
    ack?.();
  });

  onRemote('zunari:realtime:session-revocation', (raw: unknown, ack?: () => void) => {
    const event = raw as { tokenHash?: unknown; userId?: unknown };
    if (
      !isAdapterReady() ||
      !event ||
      (event.tokenHash !== undefined && typeof event.tokenHash !== 'string') ||
      (event.userId !== undefined && typeof event.userId !== 'number')
    ) {
      ack?.();
      return;
    }
    disconnectRevokedSessionLocal(io, {
      tokenHash: event.tokenHash,
      userId: event.userId,
    });
    ack?.();
  });

  onRemote('zunari:realtime:evict-conversation', (raw: unknown, ack?: () => void) => {
    const event = raw as { userId?: unknown; conversationId?: unknown };
    if (
      !isAdapterReady() ||
      !event ||
      typeof event.userId !== 'string' ||
      typeof event.conversationId !== 'string'
    ) {
      ack?.();
      return;
    }
    evictUserFromConversationLocal(io, event.userId, event.conversationId);
    ack?.();
  });

  if (options.localPublishers !== false) {
    listenerStops.push(
      onConversationMessage((event) => {
        emitConversationMessageToLocalUsers(event, io);
        forward('zunari:realtime:outbox-message', event);
      }),
      onConversationMessageEdit(({ conversationId, message, recipientIds, eventId }) => {
        const metadata: RealtimeDeliveryMetadata | undefined = eventId ? { eventId } : undefined;
        for (const recipientId of recipientIds) {
          io.local.to(`user:${recipientId}`).emit(
            'conversation:message-edit',
            message,
            ...(metadata ? [metadata] : []),
          );
        }
        if (eventId) {
          forward('zunari:realtime:outbox-edit', {
            conversationId,
            message,
            recipientIds,
            eventId,
          });
        }
      }),
      onConversationMessageDelete((event) => {
        onConversationMessageDeleteLocal(event);
        forward('zunari:realtime:conversation-delete', event);
      }),
      onTyping((event) => {
        emitTypingToLocalUsers(io, event);
        forward('zunari:realtime:typing', event);
      }),
      onReceipt((event) => {
        emitReceiptToLocalUsers(io, event);
        forward('zunari:realtime:receipt', event);
      }),
      onReaction((event) => {
        emitReactionToLocalUsers(io, event);
        forward('zunari:realtime:reaction', event);
      }),
      onCallEvent((event) => {
        emitCallEventToLocalUsers(io, event);
        forward('zunari:realtime:call', event);
      }),
      onNotification((event) => {
        emitNotificationToLocalUsers(io, event);
        forward('zunari:realtime:notification', event);
      }),
      onSessionRevocation((revocation) => {
        disconnectRevokedSessionLocal(io, revocation);
        forward('zunari:realtime:session-revocation', revocation);
      }),
    );
  }

  return {
    forward,
    stop() {
      for (const stop of listenerStops) stop();
      for (const [eventName, handler] of remoteHandlers) {
        io.off(eventName, handler);
      }
      remoteHandlers.clear();
    },
  };
}

export async function attachRealtimeServer(httpServer: HttpServer): Promise<SocketServer> {
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
  let adapterReady = false;

  const handleAdapterAvailability = (ready: boolean) => {
    adapterReady = ready;
    if (!ready) {
      for (const socket of io.sockets.sockets.values()) {
        socket.disconnect(true);
      }
    }
  };

  io.on('zunari:realtime:adapter-probe', (ack: () => void) => {
    ack();
  });
  io.on('zunari:realtime:outbox-message', (
    event: RealtimeMessageEvent,
    ack: () => void,
  ) => {
    if (
      !adapterReady ||
      !event ||
      typeof event.conversationId !== 'string' ||
      !Array.isArray(event.recipientIds) ||
      !event.recipientIds.every((recipientId) => typeof recipientId === 'string') ||
      !event.message ||
      typeof event.eventId !== 'string'
    ) return;
    emitConversationMessageToLocalUsers(event, io);
    ack();
  });
  io.on('zunari:realtime:outbox-edit', (
    event: {
      conversationId: string;
      message: RealtimeMessageEvent['message'];
      recipientIds: string[];
      eventId: string;
    },
    ack: () => void,
  ) => {
    if (
      !adapterReady ||
      !event ||
      typeof event.conversationId !== 'string' ||
      !Array.isArray(event.recipientIds) ||
      !event.recipientIds.every((recipientId) => typeof recipientId === 'string') ||
      !event.message ||
      typeof event.eventId !== 'string'
    ) return;
    emitConversationMessageEditToUsers(event, io);
    ack();
  });

  io.use((socket, next) => {
    void (async () => {
      if (!adapterReady) {
        next(new Error('Realtime delivery is temporarily unavailable.'));
        return;
      }
      if (!isAllowedOrigin(socket)) {
        next(new Error('Origin is not allowed.'));
        return;
      }
      const session = await getSession(socket.request);
      if (!session?.userId) {
        next(new Error('Authentication required.'));
        return;
      }
      if (session.expiresAt <= Date.now()) {
        next(new Error('Session expired.'));
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
      socket.data.sessionExpiresAt = session.expiresAt;
      next();
    })().catch(() => next(new Error('Unable to authenticate realtime connection.')));
  });

  io.on('connection', (socket) => {
    // Session validation and expiration handling
    const userId = socket.data.userId as string | undefined;
    const sessionTokenHash = socket.data.sessionTokenHash;
    const sessionExpiresAt = socket.data.sessionExpiresAt;
    const username = socket.data.username as string | undefined;
    let expirationTimer: NodeJS.Timeout | undefined;
    const validSessionExpiresAt =
      typeof sessionExpiresAt === 'number' && Number.isFinite(sessionExpiresAt)
        ? sessionExpiresAt
        : undefined;
    const effectiveExpiresAt = validSessionExpiresAt ?? Date.now() + 30 * 60 * 1000;

    // Immediately disconnect if session has already expired
    if (validSessionExpiresAt !== undefined && validSessionExpiresAt <= Date.now()) {
      socket.disconnect(true);
      return;
    }

    const scheduleExpiration = () => {
      if (socket.disconnected) return;
      if (expirationTimer) clearTimeout(expirationTimer);
      expirationTimer = undefined;
      const timeRemaining = effectiveExpiresAt - Date.now();

      if (timeRemaining <= 0) {
        socket.disconnect(true);
        return;
      }

      const safeDelay = Math.min(timeRemaining, 2147483647);

      expirationTimer = setTimeout(() => {
        expirationTimer = undefined;
        scheduleExpiration();
      }, safeDelay);
    };

    scheduleExpiration();

    // Join standard rooms
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
    const authUserId = socket.data.authUserId;
    if (typeof authUserId === 'number') socket.join(`auth-user:${authUserId}`);
    if (typeof sessionTokenHash === 'string') socket.join(`session:${sessionTokenHash}`);

    // Join conversation room after authorization. Membership is cached per
    // socket so ephemeral events (typing) can be gated without a DB round-trip.
    if (!(socket.data.joinedConversations instanceof Set)) {
      socket.data.joinedConversations = new Set<string>();
    }
    const joinedConversations = socket.data.joinedConversations as Set<string>;

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
            joinedConversations.add(data.conversationId);
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
        joinedConversations.delete(data.conversationId);
      }
    });

    // Session validation helper for sensitive operations
    const validateSession = (): boolean => {
      if (!userId || !sessionTokenHash) return false;
      if (sessionExpiresAt && sessionExpiresAt <= Date.now()) return false;
      return true;
    };

    socket.on('typing:start', (data: { conversationId: string }) => {
      if (!userId || !data?.conversationId) return;
      if (!joinedConversations.has(data.conversationId)) return;
      if (!validateSession()) return;
      publishTyping({
        conversationId: data.conversationId,
        userId,
        username: username || '',
        isTyping: true,
      });
    });

    socket.on('typing:stop', (data: { conversationId: string }) => {
      if (!userId || !data?.conversationId) return;
      if (!joinedConversations.has(data.conversationId)) return;
      if (!validateSession()) return;
      publishTyping({
        conversationId: data.conversationId,
        userId,
        username: username || '',
        isTyping: false,
      });
    });

    socket.on('presence:query', async (_data: unknown, ack?: (res: { onlineUserIds: string[] }) => void) => {
      if (!validateSession()) {
        ack?.({ onlineUserIds: [] });
        return;
      }
      try {
        const authorizedUserIds = await query<{ user_id: string }>(
          `SELECT DISTINCT peer.user_id
           FROM zunari_conversation_participants me
           JOIN zunari_conversation_participants peer
             ON peer.conversation_id = me.conversation_id
           WHERE me.user_id = $1
             AND me.left_at IS NULL
             AND peer.left_at IS NULL
             AND peer.user_id <> $1`,
          [userId],
        );
        const allowed = new Set(authorizedUserIds.rows.map((row) => row.user_id));
        try {
          const clusterOnline = await getClusterOnlineUserIds(io, [...allowed]);
          ack?.({ onlineUserIds: clusterOnline });
        } catch (error) {
          console.error('[realtime] Unable to query cluster presence:', error);
          const localOnline = getOnlineUserIds().filter((onlineId) => allowed.has(onlineId));
          ack?.({ onlineUserIds: localOnline });
        }
      } catch {
        ack?.({ onlineUserIds: [] });
      }
    });

    // Clean up timer on disconnect
    socket.on('disconnect', () => {
      if (expirationTimer) {
        clearTimeout(expirationTimer);
        expirationTimer = undefined;
      }
      if (typeof userId === 'string') {
        const userSet = onlineUserSockets.get(userId);
        if (userSet) {
          userSet.delete(socket.id);
          if (userSet.size === 0) {
            onlineUserSockets.delete(userId);
            // A user can have sockets on several instances. Only mark them
            // offline once no instance still has a live socket for them.
            void (async () => {
              try {
                const remaining = await io.in(`user:${userId}`).fetchSockets();
                if (remaining.length === 0) {
                  io.emit('presence:update', {
                    userId,
                    isOnline: false,
                    lastSeen: Date.now(),
                  });
                }
              } catch (error) {
                // Keep the previous state on failure rather than incorrectly
                // marking a remote user offline.
                console.error('[realtime] Unable to resolve cluster presence:', error);
              }
            })();
          }
        }
      }
    });
  });

  const propagation = installRealtimeEventPropagation(io, () => adapterReady);
  stopListeners = [propagation.stop];

  try {
    realtimeAdapter = await attachPostgresRealtimeAdapter(io, undefined, handleAdapterAvailability);
    await realtimeAdapter.waitForCluster();
  } catch (error) {
    for (const stop of stopListeners) stop();
    stopListeners = [];
    activeServer = undefined;
    const adapter = realtimeAdapter;
    realtimeAdapter = undefined;
    if (adapter) {
      await adapter.close().catch(() => {});
    } else {
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
    throw error;
  }

  return io;
}

export async function closeRealtimeServer(): Promise<void> {
  for (const stop of stopListeners) stop();
  stopListeners = [];
  if (!activeServer) return;
  const io = activeServer;
  const adapter = realtimeAdapter;
  activeServer = undefined;
  realtimeAdapter = undefined;
  onlineUserSockets.clear();
  if (adapter) {
    // Closing the adapter clears its reconnection/cleanup timers before the
    // PostgreSQL pools are closed by the caller.
    await adapter.close();
    return;
  }
  await new Promise<void>((resolve) => io.close(() => resolve()));
}

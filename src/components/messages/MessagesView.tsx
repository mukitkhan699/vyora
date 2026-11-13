import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ChevronUp,
  Loader2,
  Mail,
  MessageSquarePlus,
  RefreshCw,
  Search,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  Conversation,
  Message,
  MessageAttachment,
  PendingMessageAttachment,
  User,
} from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useRealtime } from '../../context/RealtimeContext.tsx';
import { useKeyboardHeight } from '../../hooks/useKeyboard.ts';
import {
  useOutboxContext,
  OUTBOX_MESSAGE_SENT_EVENT,
  OUTBOX_MESSAGE_FAILED_EVENT,
} from '../../context/OutboxContext.tsx';
import { useCacheFirstConversationsLoader, useCacheFirstMessagesLoader } from '../../hooks/useCacheFirstLoaders.ts';
import { recordSendInitiated, recordTiming, onTiming } from '../../lib/messaging/performance.ts';
import { useCall } from '../../context/CallContext.tsx';
import { useToast } from '../common/ToastProvider.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { ConfirmationDialog } from '../common/ConfirmationDialog.tsx';
import { ImageLightbox } from '../feed/ImageLightbox.tsx';
import { ConversationListItem } from './ConversationListItem.tsx';
import { ConversationHeader } from './ConversationHeader.tsx';
import { ConversationEmpty } from './ConversationEmpty.tsx';
import { NewMessageModal } from './NewMessageModal.tsx';
import { CreateGroupModal } from './CreateGroupModal.tsx';
import { GroupDetailsModal } from './GroupDetailsModal.tsx';
import { MessageBubble } from './MessageBubble.tsx';
import { VirtualizedMessageList } from './VirtualizedMessageList.tsx';
import { MessageComposer } from './MessageComposer.tsx';
import { AttachmentPicker } from './AttachmentPicker.tsx';
import {
  applyRealtimeMessageEvent,
  applyRealtimeMessageNotification,
  createBoundedEventIdSet,
  formatDateSeparator,
  getConversationTitle,
  getDirectCounterpart,
  isImageMime,
  MAX_TRACKED_REALTIME_EVENT_IDS,
  supportsFileType,
} from '../../utils/messaging.ts';

const PAGE_SIZE = 50;
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const TYPING_STOP_MS = 1800;

type InboxFilter = 'all' | 'unread' | 'groups';

interface LightboxState {
  open: boolean;
  images: string[];
  downloadUrls: string[];
  index: number;
}

interface RenderedMessage {
  message: Message;
  showDate: boolean;
  dateLabel: string;
  showAvatar: boolean;
  showName: boolean;
  isContinuation: boolean;
}

const toMillis = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && value.trim() !== '') return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const compareMessages = (a: Message, b: Message): number =>
  toMillis(a.createdAt) - toMillis(b.createdAt);

const upsertMessage = (list: Message[], incoming: Message): Message[] => {
  const next = [...list];
  let index = next.findIndex((message) => message.id === incoming.id);
  if (index < 0 && incoming.clientId) {
    index = next.findIndex(
      (message) => Boolean(message.clientId) && message.clientId === incoming.clientId,
    );
  }
  if (index >= 0) {
    next[index] = {
      ...next[index],
      ...incoming,
      localStatus: incoming.localStatus,
      localError: incoming.localError,
    };
  } else {
    next.push(incoming);
  }
  return next.sort(compareMessages);
};

const mergeMessages = (current: Message[], incoming: Message[]): Message[] =>
  incoming.reduce((list, message) => upsertMessage(list, message), current);

const conversationTimestamp = (conversation: Conversation): number =>
  conversation.lastMessageAt || toMillis(conversation.lastMessage?.createdAt);

const sortConversations = (list: Conversation[]): Conversation[] =>
  [...list].sort((a, b) => conversationTimestamp(b) - conversationTimestamp(a));

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const formatError = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const typingLabelFor = (names: string[]): string => {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names[0]} and ${names.length - 1} others are typing…`;
};

interface MessagesViewProps {
  onOpenProfile?: (username: string) => void;
  resetNonce?: number;
}

export const MessagesView: React.FC<MessagesViewProps> = ({ onOpenProfile, resetNonce = 0 }) => {
  const { currentUser, allUsers } = useAuth();
  const { socket, connected, onlineUserIds, lastSeenByUser, reconnectNonce } = useRealtime();
  const { startCall, isBusy: callBusy } = useCall();
  const { showToast } = useToast();

  const keyboardHeight = useKeyboardHeight();
  const keyboardOpen = keyboardHeight > 150;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );
  const [keyboardInset, setKeyboardInset] = useState(0);

  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [pendingAttachments, setPendingAttachments] = useState<PendingMessageAttachment[]>([]);
  const [showAttachments, setShowAttachments] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupDetails, setShowGroupDetails] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [unseenBelow, setUnseenBelow] = useState(false);
  const [groupDetailsStartAdd, setGroupDetailsStartAdd] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [callStarting, setCallStarting] = useState<'voice' | 'video' | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState>({
    open: false,
    images: [],
    downloadUrls: [],
    index: 0,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const messagesRootRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(null);
  const shouldStickRef = useRef(true);
  const scrollMetricsRef = useRef<{ clientHeight: number; scrollTop: number } | null>(null);
  const prependingRef = useRef(false);
  const previousCountRef = useRef(0);

  const typingTimerRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const typingTimeoutsRef = useRef<Map<string, number>>(new Map());
  const readSentRef = useRef<Set<string>>(new Set());
  const deliveredSentRef = useRef<Set<string>>(new Set());
  const uploadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const retryAssetsRef = useRef<Map<string, string[]>>(new Map());
  const refreshTimerRef = useRef<number | null>(null);
  const previousConversationIdRef = useRef<string | null>(null);
  const reconciliationNonceRef = useRef(reconnectNonce);
  const highlightTimerRef = useRef<number | null>(null);
  const previousSelectedIdRef = useRef<string | null>(null);
  const draftsLoadedRef = useRef(false);
  const processedMessageEventIdsRef = useRef(
    createBoundedEventIdSet(MAX_TRACKED_REALTIME_EVENT_IDS),
  );
  const processedMessageNotificationEventIdsRef = useRef(
    createBoundedEventIdSet(MAX_TRACKED_REALTIME_EVENT_IDS),
  );

  const bottomInset = keyboardOpen
    ? keyboardInset
    : isMobile
      ? 'var(--z-mobile-nav-height)'
      : 'env(safe-area-inset-bottom, 0px)';

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 639px)');
    const updateMobile = () => setIsMobile(mobileQuery.matches);
    mobileQuery.addEventListener('change', updateMobile);
    return () => mobileQuery.removeEventListener('change', updateMobile);
  }, []);

  useEffect(() => {
    const root = messagesRootRef.current;
    if (!keyboardOpen || !root) {
      setKeyboardInset(0);
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      setKeyboardInset(keyboardHeight);
      return;
    }

    const updateInset = () => {
      setKeyboardInset(Math.max(0, root.getBoundingClientRect().height - viewport.height));
    };

    updateInset();
    viewport.addEventListener('resize', updateInset);
    viewport.addEventListener('scroll', updateInset);
    return () => {
      viewport.removeEventListener('resize', updateInset);
      viewport.removeEventListener('scroll', updateInset);
    };
  }, [keyboardHeight, keyboardOpen]);

  const { addToOutbox, retryMessage, removeFromOutbox } = useOutboxContext();

  const {
    loadConversations,
    refreshConversations: fetchConversations,
    saveConversation,
  } = useCacheFirstConversationsLoader(currentUser?.id);

  const {
    loadMessages,
    fetchMessages,
    saveMessage,
    removeMessage,
    loadOlder: loadOlderMessages,
  } = useCacheFirstMessagesLoader(currentUser?.id);

  const sendReceipts = useCallback(
    (conversationId: string, type: 'delivered' | 'read', source: Message[]) => {
      if (!currentUser?.id) return;
      const registry = type === 'read' ? readSentRef.current : deliveredSentRef.current;
      const ids = source
        .filter((message) => message.senderId && message.senderId !== currentUser.id)
        .filter((message) => !message.localStatus && !message.id.startsWith('local-'))
        .filter((message) => {
          if (registry.has(message.id)) return false;
          if (type === 'read') {
            return !message.receipts?.some(
              (receipt) => receipt.userId === currentUser.id && receipt.readAt,
            );
          }
          return !message.receipts?.some(
            (receipt) => receipt.userId === currentUser.id && receipt.deliveredAt,
          );
        })
        .map((message) => message.id);

      if (ids.length === 0) return;
      ids.forEach((id) => registry.add(id));
      void api
        .sendReceipts(conversationId, type, ids)
        .catch(() => {
          ids.forEach((id) => registry.delete(id));
        });
    },
    [currentUser?.id],
  );

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const loadInboxFromCache = useCallback(async () => {
    if (!currentUser?.id) return;
    try {
      const loaded = await loadConversations();
      setConversations(loaded);
    } catch {
      // Cache is best-effort; the network phase below can still succeed.
    }
  }, [currentUser?.id, loadConversations]);

  const refreshConversations = useCallback(async () => {
    if (!currentUser?.id) return;
    setConversationsLoading(true);
    let loadedFromCache = false;
    try {
      const cached = await loadConversations();
      setConversations(cached);
      loadedFromCache = true;
    } catch {
      // Keep whatever is already displayed.
    }
    try {
      const server = await fetchConversations();
      setConversations(sortConversations(server));
      setConversationsError('');
    } catch (error) {
      if (!loadedFromCache) {
        setConversationsError(
          error instanceof Error ? error.message : 'Unable to load conversations.',
        );
      }
    } finally {
      setConversationsLoading(false);
    }
  }, [currentUser?.id, loadConversations, fetchConversations]);

  // Update the inbox locally for a live message instead of re-fetching the
  // whole inbox on every event, then persist the updated preview.
  const updateConversationPreview = useCallback(
    (message: Message) => {
      setConversations((previous) => {
        const existing = previous.find(
          (conversation) => conversation.id === message.conversationId,
        );
        if (!existing) return previous;
        const incomingAt = toMillis(message.createdAt);
        // Only refresh the preview when this really is the newest message; an
        // edit/delete of an older message must not reorder the inbox.
        if (existing.lastMessageAt && incomingAt < existing.lastMessageAt) {
          return previous;
        }
        const updated: Conversation = {
          ...existing,
          lastMessage: message,
          lastMessageAt: incomingAt,
        };
        void saveConversation(updated);
        return sortConversations(
          previous.map((conversation) =>
            conversation.id === updated.id ? updated : conversation,
          ),
        );
      });
    },
    [saveConversation],
  );

  useEffect(() => {
    if (!currentUser?.id) {
      setConversations([]);
      setConversationsLoading(false);
      return;
    }
    void refreshConversations();
  }, [currentUser?.id, connected, reconnectNonce, refreshConversations]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeIdRef.current = activeConversation?.id ?? null;
  }, [activeConversation?.id]);

  const draftStorageKey = currentUser?.id ? `zunari:message-drafts:${currentUser.id}` : null;

  useEffect(() => {
    draftsLoadedRef.current = false;
    if (!draftStorageKey) return;
    try {
      const raw = window.localStorage.getItem(draftStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const next: Record<string, string> = {};
          for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === 'string') next[key] = value;
          }
          setDrafts(next);
        }
      }
    } catch {
      // Draft persistence is best-effort.
    } finally {
      draftsLoadedRef.current = true;
    }
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftStorageKey || !draftsLoadedRef.current) return;
    try {
      if (Object.keys(drafts).length === 0) window.localStorage.removeItem(draftStorageKey);
      else window.localStorage.setItem(draftStorageKey, JSON.stringify(drafts));
    } catch {
      // Storage can be unavailable in private browsing.
    }
  }, [drafts, draftStorageKey]);

  useEffect(() => {
    if (!resetNonce) return;
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    setShowMobileChat(false);
    setActiveConversation(null);
  }, [resetNonce]);

  useEffect(() => {
    if (!showMobileChat || !activeConversation?.id) return;
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    const timer = window.setTimeout(() => {
      sectionRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [showMobileChat, activeConversation?.id]);

  useEffect(() => {
    if (showMobileChat) return;
    const previousId = previousSelectedIdRef.current;
    if (!previousId || !window.matchMedia('(max-width: 767px)').matches) return;
    const timer = window.setTimeout(() => {
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-conversation-id="${CSS.escape(previousId)}"]`)
        ?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [showMobileChat]);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && activeIdRef.current) {
        sendReceipts(activeIdRef.current, 'read', messagesRef.current);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [sendReceipts]);

  const clearPendingAttachments = useCallback(() => {
    uploadControllersRef.current.forEach((controller) => controller.abort());
    uploadControllersRef.current.clear();
    setPendingAttachments((previous) => {
      previous.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setShowAttachments(false);
  }, []);

  const emitTypingStop = useCallback(
    (conversationId?: string) => {
      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      const target = conversationId || activeIdRef.current;
      if (typingActiveRef.current && socket && target) {
        socket.emit('typing:stop', { conversationId: target });
      }
      typingActiveRef.current = false;
    },
    [socket],
  );

  useEffect(() => {
    if (previousConversationIdRef.current === (activeConversation?.id ?? null)) return;
    if (previousConversationIdRef.current) {
      emitTypingStop(previousConversationIdRef.current);
      clearPendingAttachments();
      setReplyTarget(null);
      setTypingUsers(new Map());
      retryAssetsRef.current.clear();
      typingTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
      typingTimeoutsRef.current.clear();
    }
    previousConversationIdRef.current = activeConversation?.id ?? null;
    if (!activeConversation?.id) setShowMobileChat(false);
  }, [activeConversation?.id, clearPendingAttachments, emitTypingStop]);

  useEffect(() => {
    if (!activeConversation?.id || !currentUser?.id) {
      setMessages([]);
      setMessagesLoading(false);
      setMessagesError('');
      setHasMore(true);
      return;
    }

    let cancelled = false;
    const conversationId = activeConversation.id;
    setMessages([]);
    setMessagesLoading(true);
    setMessagesError('');

    const applyMessages = (incoming: Message[]) => {
      if (cancelled) return;
      const sorted = [...incoming].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      setMessages((previous) => mergeMessages(previous, sorted));
      setHasMore(sorted.length >= PAGE_SIZE);
      setMessagesLoading(false);
      if (sorted.length > 0) {
        sendReceipts(
          conversationId,
          document.visibilityState === 'visible' ? 'read' : 'delivered',
          sorted,
        );
      }
    };

    // Load cached messages first so the conversation opens offline.
    loadMessages(conversationId, { limit: PAGE_SIZE })
      .then(applyMessages)
      .catch((error) => {
        if (cancelled) return;
        setMessagesError(error instanceof Error ? error.message : 'Unable to load messages.');
        setMessagesLoading(false);
      });

    // Always reconcile with the server: the cache can be empty or stale and
    // may be missing messages sent from another device.
    fetchMessages(conversationId, { limit: PAGE_SIZE })
      .then(applyMessages)
      .catch(() => {
        // Offline or network failure: keep the cached view.
      });

    return () => {
      cancelled = true;
    };
  }, [activeConversation?.id, currentUser?.id, connected, loadMessages, fetchMessages, sendReceipts]);

  useEffect(
    () => () => {
      emitTypingStop();
      clearPendingAttachments();
      typingTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
      typingTimeoutsRef.current.clear();
    },
    [clearPendingAttachments, emitTypingStop],
  );

  useEffect(() => {
    if (!socket || !activeConversation?.id || !currentUser?.id) return;
    const conversationId = activeConversation.id;

    const join = () => {
      socket.emit('conversation:join', { conversationId }, (response?: { success?: boolean }) => {
        if (response && response.success === false) {
          showToast('You no longer have access to this conversation.', 'error');
        }
      });
    };

    if (socket.connected) join();
    else socket.on('connect', join);

    const handleMessage = (incoming: Message, metadata?: { eventId?: string }) => {
      applyRealtimeMessageEvent(
        incoming,
        metadata,
        processedMessageEventIdsRef.current,
        {
          conversationId,
          currentUserId: currentUser.id,
          shouldStick: shouldStickRef.current,
          visible: document.visibilityState === 'visible',
        },
        {
          recordTiming,
          saveMessage,
          upsertMessage: (message) => {
            setMessages((previous) => upsertMessage(previous, message));
          },
          updateConversationPreview,
          setUnseenBelow: () => setUnseenBelow(true),
          sendReceipts,
        },
        processedMessageNotificationEventIdsRef.current,
      );
    };

    const handleEdit = (updated: Message) => {
      if (updated.conversationId && updated.conversationId !== conversationId) return;
      saveMessage(updated);
      setMessages((previous) => upsertMessage(previous, updated));
      updateConversationPreview(updated);
    };

    const handleDelete = (data: { conversationId: string; messageId: string }) => {
      if (data.conversationId !== conversationId) return;
      const target = messagesRef.current.find((message) => message.id === data.messageId);
      if (!target) return;
      const deleted: Message = {
        ...target,
        isDeleted: true,
        text: 'This message was deleted.',
        attachments: [],
        reactions: [],
      };
      saveMessage(deleted);
      setMessages((previous) =>
        previous.map((message) => (message.id === deleted.id ? deleted : message)),
      );
      updateConversationPreview(deleted);
    };

    const handleTyping = (event: {
      conversationId: string;
      userId: string;
      username: string;
      isTyping: boolean;
    }) => {
      if (event.conversationId !== conversationId || event.userId === currentUser.id) return;
      const name = event.username || 'Someone';
      setTypingUsers((previous) => {
        const next = new Map(previous);
        if (event.isTyping) next.set(event.userId, name);
        else next.delete(event.userId);
        return next;
      });
      const existing = typingTimeoutsRef.current.get(event.userId);
      if (existing) window.clearTimeout(existing);
      if (event.isTyping) {
        const timer = window.setTimeout(() => {
          setTypingUsers((previous) => {
            const next = new Map(previous);
            next.delete(event.userId);
            return next;
          });
          typingTimeoutsRef.current.delete(event.userId);
        }, 6000);
        typingTimeoutsRef.current.set(event.userId, timer);
      } else {
        typingTimeoutsRef.current.delete(event.userId);
      }
    };

    const handleReceipt = (event: {
      conversationId: string;
      userId: string;
      messageIds: string[];
      receiptType: 'delivered' | 'read';
    }) => {
      if (event.conversationId !== conversationId) return;
      const updated: Message[] = [];
      for (const message of messagesRef.current) {
        if (!event.messageIds.includes(message.id)) continue;
        const receipts = [...(message.receipts || [])];
        const index = receipts.findIndex((receipt) => receipt.userId === event.userId);
        const timestamp = Date.now();
        if (index >= 0) {
          receipts[index] = {
            ...receipts[index],
            deliveredAt: receipts[index].deliveredAt ?? timestamp,
            readAt:
              event.receiptType === 'read'
                ? receipts[index].readAt ?? timestamp
                : receipts[index].readAt,
          };
        } else {
          receipts.push({
            userId: event.userId,
            deliveredAt: timestamp,
            readAt: event.receiptType === 'read' ? timestamp : null,
          });
        }
        const next = { ...message, receipts };
        updated.push(next);
      }
      if (updated.length === 0) return;
      const byId = new Map(updated.map((message) => [message.id, message]));
      setMessages((previous) =>
        previous.map((message) => byId.get(message.id) ?? message),
      );
      for (const message of updated) void saveMessage(message);
    };

    const handleReaction = (event: {
      conversationId: string;
      messageId: string;
      userId: string;
      username: string;
      emoji: string;
      added: boolean;
    }) => {
      if (event.conversationId !== conversationId) return;
      const target = messagesRef.current.find((message) => message.id === event.messageId);
      if (!target) return;
      const reactions = (target.reactions || []).filter(
        (reaction) => !(reaction.userId === event.userId && reaction.emoji === event.emoji),
      );
      if (event.added) {
        reactions.push({
          emoji: event.emoji,
          userId: event.userId,
          username: event.username,
          createdAt: Date.now(),
        });
      }
      const updated: Message = { ...target, reactions };
      setMessages((previous) =>
        previous.map((message) => (message.id === updated.id ? updated : message)),
      );
      void saveMessage(updated);
    };

    socket.on('conversation:message', handleMessage);
    socket.on('conversation:message-edit', handleEdit);
    socket.on('conversation:message-delete', handleDelete);
    socket.on('conversation:typing', handleTyping);
    socket.on('conversation:receipt', handleReceipt);
    socket.on('conversation:reaction', handleReaction);

    return () => {
      if (socket.connected) socket.emit('conversation:leave', { conversationId });
      socket.off('connect', join);
      socket.off('conversation:message', handleMessage);
      socket.off('conversation:message-edit', handleEdit);
      socket.off('conversation:message-delete', handleDelete);
      socket.off('conversation:typing', handleTyping);
      socket.off('conversation:receipt', handleReceipt);
      socket.off('conversation:reaction', handleReaction);
      typingTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
      typingTimeoutsRef.current.clear();
      setTypingUsers(new Map());
    };
  }, [
    socket,
    activeConversation?.id,
    currentUser?.id,
    reconnectNonce,
    sendReceipts,
    updateConversationPreview,
    showToast,
  ]);

  // Notifications for conversations that are not currently open. The server
  // only sends these to the user room, so this listener must be global.
  useEffect(() => {
    if (!socket || !currentUser?.id) return;
    const handleNotification = (
      payload: { conversationId?: string; message?: Message },
      metadata?: { eventId?: string },
    ) => {
      applyRealtimeMessageNotification(
        payload,
        metadata,
        processedMessageNotificationEventIdsRef.current,
        {
          activeConversationId: activeIdRef.current,
          currentUserId: currentUser.id,
          visible: document.visibilityState === 'visible',
          conversationKnown: conversationsRef.current.some(
            (conversation) => conversation.id === (payload?.conversationId || payload?.message?.conversationId),
          ),
        },
        {
          saveMessage: (message) => {
            void saveMessage(message);
          },
          upsertActiveMessage: (message) => {
            setMessages((previous) => upsertMessage(previous, message));
          },
          sendReceipts,
          updateConversationPreview,
          refreshConversations: () => {
            void refreshConversations();
          },
        },
        processedMessageEventIdsRef.current,
      );
    };
    // Keep inactive conversation previews/cache in step with edits and deletes.
    // The active conversation already handles these via its own listeners.
    const handleInactiveEdit = (updated: Message) => {
      if (!updated?.conversationId) return;
      if (updated.conversationId === activeIdRef.current) return;
      void saveMessage(updated);
      updateConversationPreview(updated);
    };
    const handleInactiveDelete = (data: { conversationId?: string; messageId?: string }) => {
      if (!data?.conversationId || !data.messageId) return;
      if (data.conversationId === activeIdRef.current) return;
      const conversation = conversationsRef.current.find(
        (item) => item.id === data.conversationId,
      );
      if (!conversation?.lastMessage || conversation.lastMessage.id !== data.messageId) return;
      const deleted: Message = {
        ...conversation.lastMessage,
        isDeleted: true,
        text: 'This message was deleted.',
        attachments: [],
        reactions: [],
      };
      void saveMessage(deleted);
      updateConversationPreview(deleted);
    };
    socket.on('conversation:message-notification', handleNotification);
    socket.on('conversation:message-edit', handleInactiveEdit);
    socket.on('conversation:message-delete', handleInactiveDelete);
    return () => {
      socket.off('conversation:message-notification', handleNotification);
      socket.off('conversation:message-edit', handleInactiveEdit);
      socket.off('conversation:message-delete', handleInactiveDelete);
    };
  }, [
    socket,
    currentUser?.id,
    saveMessage,
    sendReceipts,
    updateConversationPreview,
    refreshConversations,
  ]);

  // Reconcile background outbox deliveries with the open conversation. The
  // processor lives above this component, so it can keep sending while this
  // view is unmounted.
  useEffect(() => {
    const handleSent = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: Message; clientId?: string }>).detail;
      if (!detail?.message) return;
      const sent = detail.message;
      if (sent.conversationId && sent.conversationId === activeIdRef.current) {
        setMessages((previous) =>
          upsertMessage(
            previous.filter((message) => message.id !== `local-${detail.clientId}`),
            sent,
          ),
        );
      }
      updateConversationPreview(sent);
      if (detail.clientId) retryAssetsRef.current.delete(detail.clientId);
    };
    const handleFailed = (event: Event) => {
      const detail = (event as CustomEvent<{ clientId?: string; error?: string }>).detail;
      if (!detail?.clientId) return;
      setMessages((previous) =>
        previous.map((message) =>
          message.clientId === detail.clientId
            ? { ...message, localStatus: 'failed', localError: detail.error }
            : message,
        ),
      );
    };
    window.addEventListener(OUTBOX_MESSAGE_SENT_EVENT, handleSent);
    window.addEventListener(OUTBOX_MESSAGE_FAILED_EVENT, handleFailed);
    return () => {
      window.removeEventListener(OUTBOX_MESSAGE_SENT_EVENT, handleSent);
      window.removeEventListener(OUTBOX_MESSAGE_FAILED_EVENT, handleFailed);
    };
  }, [updateConversationPreview]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const previous = previousCountRef.current;
    previousCountRef.current = messages.length;
    if (prependingRef.current) {
      prependingRef.current = false;
      return;
    }
    if (messages.length === 0) return;
    if (previous === 0) {
      element.scrollTop = element.scrollHeight;
      shouldStickRef.current = true;
      scrollMetricsRef.current = {
        clientHeight: element.clientHeight,
        scrollTop: element.scrollTop,
      };
      return;
    }
    if (shouldStickRef.current) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const previousMetrics = scrollMetricsRef.current;
    const resizedWithoutScrolling =
      previousMetrics !== null &&
      element.clientHeight !== previousMetrics.clientHeight &&
      Math.abs(element.scrollTop - previousMetrics.scrollTop) < 1;
    scrollMetricsRef.current = {
      clientHeight: element.clientHeight,
      scrollTop: element.scrollTop,
    };
    if (resizedWithoutScrolling) return;

    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 140;
    shouldStickRef.current = nearBottom;
    if (nearBottom) setUnseenBelow(false);
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !keyboardOpen || !shouldStickRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      if (shouldStickRef.current) element.scrollTop = element.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [keyboardHeight, keyboardOpen, bottomInset]);

  const scrollToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({ top: element.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    shouldStickRef.current = true;
    setUnseenBelow(false);
  }, []);

  const jumpToMessage = useCallback(
    (messageId: string) => {
      if (!messagesRef.current.some((message) => message.id === messageId)) {
        showToast('That message is not loaded. Load earlier messages to view it.', 'info');
        return;
      }
      setHighlightedMessageId(messageId);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.requestAnimationFrame(() => {
        document.getElementById(`message-${messageId}`)?.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center',
        });
      });
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = window.setTimeout(() => setHighlightedMessageId(null), 1800);
    },
    [showToast],
  );

  const handleSelectConversation = (conversation: Conversation) => {
    previousSelectedIdRef.current = conversation.id;
    setActiveConversation(conversation);
    setShowMobileChat(true);
    setShowAttachments(false);
    setReplyTarget(null);
    setTypingUsers(new Map());
    setHighlightedMessageId(null);
    setUnseenBelow(false);
    shouldStickRef.current = true;
    if (document.visibilityState === 'visible' && conversation.unreadCount > 0) {
      saveConversation({ ...conversation, unreadCount: 0 });
    }
  };

  const reloadMessages = useCallback(() => {
    if (!activeConversation?.id) return;
    const conversationId = activeConversation.id;
    setMessagesLoading(true);
    setMessagesError('');
    loadMessages(conversationId, { limit: PAGE_SIZE }).then((cached) => {
      const sorted = [...cached].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      setMessages((previous) => mergeMessages(previous, sorted));
      setHasMore(sorted.length >= PAGE_SIZE);
      setMessagesLoading(false);
    }).catch((error) => {
      setMessagesError(error instanceof Error ? error.message : 'Unable to load messages.');
      setMessagesLoading(false);
    });
    void fetchMessages(conversationId, { limit: PAGE_SIZE })
      .then((server) => {
        const sorted = [...server].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
        setMessages((previous) => mergeMessages(previous, sorted));
        setHasMore(sorted.length >= PAGE_SIZE);
        setMessagesLoading(false);
        if (sorted.length > 0) {
          sendReceipts(
            conversationId,
            document.visibilityState === 'visible' ? 'read' : 'delivered',
            sorted,
          );
        }
      })
      .catch(() => {
        // Offline: the cache load above is the fallback.
      });
  }, [activeConversation?.id, loadMessages, fetchMessages, sendReceipts]);

  // Background sync writes straight to IndexedDB. Re-read the cache when it
  // completes so the inbox and open conversation reflect the synced data.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleSyncComplete = () => {
      void loadInboxFromCache();
      if (activeConversation?.id) reloadMessages();
    };
    window.addEventListener('zunari:messaging-synchronized', handleSyncComplete);
    return () =>
      window.removeEventListener('zunari:messaging-synchronized', handleSyncComplete);
  }, [activeConversation?.id, loadInboxFromCache, reloadMessages]);

  const handleLoadOlder = useCallback(async () => {
    if (!activeConversation || loadingOlder || !hasMore || messages.length === 0) return;
    const cursorMessage = messages.find((message) => !message.id.startsWith('local-'));
    if (!cursorMessage) {
      setHasMore(false);
      return;
    }
    const element = scrollRef.current;
    const previousHeight = element?.scrollHeight ?? 0;
    const previousTop = element?.scrollTop ?? 0;
    setLoadingOlder(true);

    try {
      let older: Message[];
      try {
        // The server page is authoritative and also backfills the cache.
        older = await fetchMessages(activeConversation.id, {
          before: cursorMessage.id,
          limit: PAGE_SIZE,
        });
      } catch {
        older = await loadOlderMessages(activeConversation.id, cursorMessage.id, PAGE_SIZE);
      }
      if (older.length === 0) {
        setHasMore(false);
        return;
      }
      const sorted = [...older].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      setMessages((previous) => mergeMessages(previous, sorted));
      setHasMore(sorted.length >= PAGE_SIZE);

      if (element) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            element.scrollTop = element.scrollHeight - previousHeight + previousTop;
          });
        });
      }
    } catch (error) {
      showToast(formatError(error, 'Unable to load earlier messages.'), 'error');
    } finally {
      setLoadingOlder(false);
    }
  }, [activeConversation?.id, loadingOlder, hasMore, messages, fetchMessages, loadOlderMessages, showToast]);

  const handleTextChange = (value: string) => {
    if (!activeConversation) return;
    setDrafts((previous) => ({ ...previous, [activeConversation.id]: value }));
    if (!value.trim()) {
      emitTypingStop();
      return;
    }
    if (!socket || !socket.connected) return;
    if (!typingActiveRef.current) {
      socket.emit('typing:start', { conversationId: activeConversation.id });
      typingActiveRef.current = true;
    }
    if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      socket.emit('typing:stop', { conversationId: activeConversation.id });
      typingActiveRef.current = false;
      typingTimerRef.current = null;
    }, TYPING_STOP_MS);
  };

  const handleSend = async () => {
    if (!activeConversation || !currentUser || sendingRef.current) return;
    const conversationId = activeConversation.id;
    const text = (drafts[conversationId] || '').trim();
    const ready = pendingAttachments.filter(
      (item) => item.status === 'ready' && item.assetId,
    );
    if (pendingAttachments.some((item) => item.status !== 'ready')) {
      showToast('Wait for uploads to finish, or remove failed attachments.', 'info');
      setShowAttachments(true);
      return;
    }
    if (!text && ready.length === 0) return;

    const clientId = generateId();
    const optimisticId = `local-${clientId}`;
    const createdAt = Date.now();
    const optimisticAttachments: MessageAttachment[] = ready.map((item) => ({
      id: item.localId,
      messageId: optimisticId,
      mediaAssetId: item.assetId || '',
      filename: item.name,
      mimeType: item.mimeType,
      byteSize: item.size,
      status: 'active',
      expiresAt: createdAt + 7 * 24 * 60 * 60 * 1000,
      createdAt,
      url: item.url || '',
    }));
    const reply = replyTarget;
    const optimistic: Message = {
      id: optimisticId,
      conversationId,
      senderId: currentUser.id,
      sender: currentUser,
      clientId,
      text,
      replyToMessageId: reply?.id ?? null,
      replyToMessage: reply
        ? {
            id: reply.id,
            senderId: reply.senderId ?? null,
            senderUsername: reply.sender?.username,
            text:
              reply.text ||
              (reply.attachments?.length ? 'Attachment' : 'Message'),
          }
        : null,
      createdAt,
      attachments: optimisticAttachments,
      reactions: [],
      receipts: [],
      localStatus: 'pending',
    };

    if (ready.length > 0) {
      retryAssetsRef.current.set(
        clientId,
        ready.map((item) => item.assetId as string),
      );
    }

    setMessages((previous) => [...previous, optimistic]);
    setDrafts((previous) => ({ ...previous, [conversationId]: '' }));
    setReplyTarget(null);
    setPendingAttachments((previous) => {
      previous.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
    setShowAttachments(false);
    emitTypingStop();
    shouldStickRef.current = true;
    sendingRef.current = true;
    setSending(true);

    if (!connected) {
      addToOutbox({
        clientId,
        conversationId,
        text,
        replyToMessageId: reply?.id,
        attachmentAssetIds: ready.length > 0 ? ready.map((item) => item.assetId as string) : undefined,
      });
      // Persist the optimistic message and conversation preview so a refresh
      // while offline does not silently drop the queued message.
      await saveMessage(optimistic);
      await saveConversation({
        ...activeConversation,
        lastMessage: optimistic,
        lastMessageAt: createdAt,
      });
      setMessages((previous) =>
        previous.map((item) =>
          item.id === optimisticId ? { ...item, localStatus: 'pending', localError: undefined } : item,
        ),
      );
      showToast('Message queued. Will send when reconnected.', 'info');
      sendingRef.current = false;
      setSending(false);
      return;
    }

    recordSendInitiated(clientId, conversationId);

    try {
      const response = await api.sendConversationMessage(conversationId, {
        text,
        clientId,
        replyToMessageId: reply?.id,
        attachmentAssetIds: ready.length > 0 ? ready.map((item) => item.assetId as string) : undefined,
      });
      recordTiming(clientId, 'serverReceived');
      recordTiming(clientId, 'databaseCommitted');

      setMessages((previous) => upsertMessage(previous, response.message));
      await saveMessage(response.message);
      await removeMessage(optimisticId);
      retryAssetsRef.current.delete(clientId);
      const updatedConversation = {
        ...activeConversation!,
        lastMessage: response.message,
        lastMessageAt: toMillis(response.message.createdAt),
      };
      setConversations((previous) =>
        sortConversations(
          previous.map((conversation) =>
            conversation.id === conversationId
              ? updatedConversation
              : conversation,
          ),
        ),
      );
      await saveConversation(updatedConversation);
    } catch (error) {
      const message = formatError(error, 'Message could not be sent.');
      addToOutbox({
        clientId,
        conversationId,
        text,
        replyToMessageId: reply?.id,
        attachmentAssetIds: ready.length > 0 ? ready.map((item) => item.assetId as string) : undefined,
      });
      const failedOptimistic: Message = {
        ...optimistic,
        localStatus: 'failed',
        localError: message,
      };
      await saveMessage(failedOptimistic);
      setMessages((previous) =>
        previous.map((item) =>
          item.id === optimisticId ? failedOptimistic : item,
        ),
      );
      showToast(message, 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  // Requeue through the single outbox processor instead of racing a second
  // direct API call. This prevents a manual retry from double-sending.
  const handleRetry = async (message: Message) => {
    if (!activeConversation || message.localStatus !== 'failed') return;
    const clientId = message.clientId || generateId();
    const attachmentAssetIds =
      retryAssetsRef.current.get(clientId) ??
      (message.attachments || []).map((attachment) => attachment.mediaAssetId);

    const pending: Message = {
      ...message,
      clientId,
      localStatus: 'pending',
      localError: undefined,
    };
    setMessages((previous) =>
      previous.map((item) => (item.id === message.id ? pending : item)),
    );
    await saveMessage(pending);

    addToOutbox({
      clientId,
      conversationId: activeConversation.id,
      text: message.text,
      replyToMessageId: message.replyToMessageId || undefined,
      attachmentAssetIds: attachmentAssetIds.length > 0 ? attachmentAssetIds : undefined,
    });
    retryMessage(clientId);

    if (!connected) {
      showToast('Retry queued. Will send when reconnected.', 'info');
    }
  };

  const handleEditMessage = async (messageId: string, text: string) => {
    if (!activeConversation) return;
    try {
      const response = await api.editConversationMessage(
        activeConversation.id,
        messageId,
        text,
      );
      setMessages((previous) => upsertMessage(previous, response.message));
      await saveMessage(response.message);
    } catch (error) {
      showToast(formatError(error, 'Unable to edit this message.'), 'error');
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!activeConversation) return;
    const target = messagesRef.current.find((message) => message.id === messageId);
    if (target?.localStatus) {
      if (target.clientId) {
        retryAssetsRef.current.delete(target.clientId);
        removeFromOutbox(target.clientId);
      }
      await removeMessage(messageId);
      setMessages((previous) => previous.filter((message) => message.id !== messageId));
      showToast('Unsent message discarded.', 'info');
      return;
    }
    try {
      await api.deleteConversationMessage(activeConversation.id, messageId);
      const deletedMessage: Message | undefined = target
        ? {
            ...target,
            isDeleted: true,
            text: 'This message was deleted.',
            attachments: [],
            reactions: [],
          }
        : undefined;
      setMessages((previous) =>
        previous.map((message) =>
          message.id === messageId
            ? deletedMessage ?? {
                ...message,
                isDeleted: true,
                text: 'This message was deleted.',
                attachments: [],
                reactions: [],
              }
            : message,
        ),
      );
      if (deletedMessage) await saveMessage(deletedMessage);
    } catch (error) {
      showToast(formatError(error, 'Unable to delete this message.'), 'error');
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!activeConversation || !currentUser) return;
    try {
      const response = await api.toggleMessageReaction(
        activeConversation.id,
        messageId,
        emoji,
      );
      const target = messagesRef.current.find((message) => message.id === messageId);
      if (!target) return;
      const reactions = (target.reactions || []).filter(
        (reaction) =>
          !(reaction.userId === currentUser.id && reaction.emoji === emoji),
      );
      const updated: Message = {
        ...target,
        reactions: response.added
          ? [
              ...reactions,
              {
                emoji,
                userId: currentUser.id,
                username: currentUser.username,
                createdAt: Date.now(),
              },
            ]
          : reactions,
      };
      setMessages((previous) =>
        previous.map((message) => (message.id === messageId ? updated : message)),
      );
      await saveMessage(updated);
    } catch (error) {
      showToast(formatError(error, 'Unable to update the reaction.'), 'error');
    }
  };

  const handleCopy = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      showToast('Message copied to clipboard.', 'success');
    } catch {
      showToast('The message could not be copied.', 'error');
    }
  };

  const handleOpenImage = (message: Message, attachment: MessageAttachment) => {
    const images: Array<{ id: string; url: string }> = [];
    messagesRef.current.forEach((item) => {
      (item.attachments || []).forEach((candidate) => {
        if (candidate.status === 'active' && isImageMime(candidate.mimeType) && candidate.url) {
          images.push({
            id: candidate.id,
            url: api.resolveFileUrl(candidate.url),
          });
        }
      });
    });
    const index = images.findIndex((image) => image.id === attachment.id);
    setLightbox({
      open: true,
      images: images.map((image) => image.url),
      downloadUrls: images.map((image) => image.url),
      index: index >= 0 ? index : 0,
    });
  };

  const handlePickFiles = (files: File[]) => {
    if (!activeConversation) return;
    const available = MAX_ATTACHMENTS - pendingAttachments.length;
    if (available <= 0) {
      showToast(`You can attach up to ${MAX_ATTACHMENTS} files per message.`, 'info');
      return;
    }
    const accepted: File[] = [];
    for (const file of files) {
      if (accepted.length >= available) break;
      if (file.size > MAX_ATTACHMENT_BYTES) {
        showToast(`${file.name} is larger than 10 MB.`, 'error');
        continue;
      }
      if (!supportsFileType(file.type)) {
        showToast(`${file.name} is not a supported attachment type.`, 'error');
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;

    const items = accepted.map<PendingMessageAttachment>((file) => ({
      localId: generateId(),
      file,
      name: file.name,
      mimeType: file.type,
      size: file.size,
      previewUrl: isImageMime(file.type) ? URL.createObjectURL(file) : undefined,
      status: 'uploading',
      progress: 0,
    }));
    setPendingAttachments((previous) => [...previous, ...items]);
    items.forEach((item) => void uploadAttachment(item.localId, item.file));
  };

  const uploadAttachment = async (localId: string, file: File) => {
    const controller = new AbortController();
    uploadControllersRef.current.set(localId, controller);
    try {
      const response = await api.uploadFile(file, 'message-attachment', {
        signal: controller.signal,
        onProgress: (progress) => {
          setPendingAttachments((previous) =>
            previous.map((item) =>
              item.localId === localId ? { ...item, progress } : item,
            ),
          );
        },
      });
      setPendingAttachments((previous) =>
        previous.map((item) =>
          item.localId === localId
            ? {
                ...item,
                status: 'ready',
                progress: 100,
                assetId: response.fileId,
                url: response.url,
                error: undefined,
              }
            : item,
        ),
      );
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return;
      }
      const message = formatError(error, 'Upload failed.');
      setPendingAttachments((previous) =>
        previous.map((item) =>
          item.localId === localId
            ? { ...item, status: 'failed', progress: 0, error: message }
            : item,
        ),
      );
      showToast(`${file.name}: ${message}`, 'error');
    } finally {
      uploadControllersRef.current.delete(localId);
    }
  };

  const handleCancelUpload = (localId: string) => {
    uploadControllersRef.current.get(localId)?.abort();
    uploadControllersRef.current.delete(localId);
    setPendingAttachments((previous) => {
      const target = previous.find((item) => item.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return previous.filter((item) => item.localId !== localId);
    });
  };

  const handleRetryUpload = (localId: string) => {
    const target = pendingAttachments.find((item) => item.localId === localId);
    if (!target || target.status !== 'failed') return;
    setPendingAttachments((previous) =>
      previous.map((item) =>
        item.localId === localId
          ? { ...item, status: 'uploading', progress: 0, error: undefined }
          : item,
      ),
    );
    void uploadAttachment(localId, target.file);
  };

  const handleRemoveAttachment = (localId: string) => {
    uploadControllersRef.current.get(localId)?.abort();
    uploadControllersRef.current.delete(localId);
    setPendingAttachments((previous) => {
      const target = previous.find((item) => item.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return previous.filter((item) => item.localId !== localId);
    });
  };

  const handleStartDirectChat = async (user: User) => {
    const response = await api.createConversation({ type: 'direct', recipientId: user.id });
    setActiveConversation(response.conversation);
    setShowMobileChat(true);
    await refreshConversations();
  };

  const handleCreateGroup = async (
    title: string,
    participantIds: string[],
    avatarUrl?: string,
  ) => {
    const response = await api.createConversation({
      type: 'group',
      title,
      participantIds,
      avatarUrl,
    });
    setActiveConversation(response.conversation);
    setShowMobileChat(true);
    await refreshConversations();
  };

  const handleUpdateConversation = async (data: { title?: string; avatarUrl?: string }) => {
    if (!activeConversation) return;
    const response = await api.updateConversation(activeConversation.id, data);
    setActiveConversation(response.conversation);
    await refreshConversations();
  };

  const handleAddParticipants = async (userIds: string[]) => {
    if (!activeConversation) return;
    await api.addParticipants(activeConversation.id, userIds);
    const response = await api.getConversation(activeConversation.id);
    setActiveConversation(response.conversation);
    await refreshConversations();
  };

  const handleRemoveParticipant = async (userId: string) => {
    if (!activeConversation) return;
    await api.removeParticipant(activeConversation.id, userId);
    const response = await api.getConversation(activeConversation.id);
    setActiveConversation(response.conversation);
    await refreshConversations();
  };

  const handleLeaveGroup = async () => {
    if (!activeConversation || !currentUser) return;
    const self = (activeConversation.participants || []).find(
      (participant) => participant.userId === currentUser.id && !participant.leftAt,
    );
    if (self?.role === 'owner') {
      setConfirmLeave(false);
      showToast('Transfer ownership to another member before leaving this group.', 'info');
      return;
    }
    await api.removeParticipant(activeConversation.id, currentUser.id);
    setShowGroupDetails(false);
    setConfirmLeave(false);
    setActiveConversation(null);
    setShowMobileChat(false);
    showToast('You left the group.', 'success');
    await refreshConversations();
  };

  const handleConfirmLeave = async () => {
    setLeaving(true);
    try {
      await handleLeaveGroup();
    } catch (error) {
      showToast(formatError(error, 'Unable to leave the group.'), 'error');
    } finally {
      setLeaving(false);
    }
  };

  const handleMarkRead = () => {
    if (!activeConversation) return;
    sendReceipts(activeConversation.id, 'read', messagesRef.current);
    setConversations((previous) =>
      previous.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, unreadCount: 0 }
          : conversation,
      ),
    );
  };

  const handleStartCall = async (type: 'voice' | 'video') => {
    if (!activeConversation || !currentUser) return;
    const isGroup = activeConversation.type === 'group';
    const direct = getDirectCounterpart(activeConversation, currentUser.id);
    const members = (activeConversation.participants || []).filter(
      (participant) => !participant.leftAt,
    ).length;
    setCallStarting(type);
    try {
      await startCall({
        conversationId: activeConversation.id,
        type,
        title: getConversationTitle(activeConversation, currentUser.id),
        subtitle: direct?.username ? `@${direct.username}` : undefined,
        avatarUrl: isGroup
          ? activeConversation.avatarUrl || undefined
          : direct?.avatarUrl,
        isGroup,
        participantCount: members,
      });
    } catch {
      // CallProvider reports the failure through a toast.
    } finally {
      setCallStarting(null);
    }
  };

  const contacts = useMemo(
    () => allUsers.filter((user) => user.id !== currentUser?.id),
    [allUsers, currentUser?.id],
  );

  const activeMembers = useMemo(
    () =>
      (activeConversation?.participants || []).filter(
        (participant) => !participant.leftAt,
      ),
    [activeConversation?.participants],
  );

  const isGroup = activeConversation?.type === 'group';
  const expectedRecipients = Math.max(1, activeMembers.length - 1);

  const filteredConversations = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return sortConversations(
      conversations.filter((conversation) => {
        if (inboxFilter === 'unread' && conversation.unreadCount <= 0) return false;
        if (inboxFilter === 'groups' && conversation.type !== 'group') return false;
        if (!term) return true;
        const title = getConversationTitle(conversation, currentUser?.id || '');
        const direct = getDirectCounterpart(conversation, currentUser?.id || '');
        const haystack = [
          title,
          direct?.username || '',
          direct?.name || '',
          conversation.lastMessage?.text || '',
          ...(conversation.participants || []).flatMap((participant) => [
            participant.user?.name || '',
            participant.user?.username || '',
          ]),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      }),
    );
  }, [conversations, inboxFilter, searchQuery, currentUser?.id]);

  const renderedMessages = useMemo<RenderedMessage[]>(() => {
    let previousMessage: Message | null = null;
    let previousDay = '';
    return messages.map((message) => {
      const day = new Date(toMillis(message.createdAt)).toDateString();
      const showDate = day !== previousDay;
      const sameSender = Boolean(
        previousMessage && previousMessage.senderId === message.senderId,
      );
      const gap = previousMessage
        ? toMillis(message.createdAt) - toMillis(previousMessage.createdAt)
        : Number.POSITIVE_INFINITY;
      const isOwn = message.senderId === currentUser?.id || Boolean(message.isSender);
      const continuation = Boolean(!showDate && sameSender && gap < 5 * 60 * 1000);
      const rendered: RenderedMessage = {
        message,
        showDate,
        dateLabel: showDate ? formatDateSeparator(message.createdAt) : '',
        showAvatar: !isOwn && !continuation,
        showName: Boolean(isGroup && !isOwn && !continuation),
        isContinuation: continuation,
      };
      previousMessage = message;
      previousDay = day;
      return rendered;
    });
  }, [messages, currentUser?.id, isGroup]);

  const typingNames = useMemo(() => Array.from(typingUsers.values()), [typingUsers]);
  const typingLabel = useMemo(() => typingLabelFor(typingNames), [typingNames]);
  const unreadTotal = useMemo(
    () => conversations.reduce((total, conversation) => total + (conversation.unreadCount || 0), 0),
    [conversations],
  );
  const inputText = activeConversation ? drafts[activeConversation.id] || '' : '';

  return (
    <div
      ref={messagesRootRef}
      className="flex h-full w-full overflow-hidden z-bg"
      style={{ paddingBottom: bottomInset }}
    >
      <aside
        className={`${
          showMobileChat ? 'hidden sm:flex' : 'flex'
        } w-full sm:w-[19rem] lg:w-[21.5rem] shrink-0 flex-col min-h-0 border-r z-border z-surface`}
        aria-label="Conversations"
      >
        <div className="shrink-0 px-3 pt-3 pb-2 border-b z-border z-safe-top">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="min-w-0">
              <h1 className="text-lg font-bold z-text z-display tracking-tight">Messages</h1>
              <p className="text-[10px] z-muted flex items-center gap-1.5 mt-0.5">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    backgroundColor: connected ? 'var(--z-success)' : 'var(--z-warning)',
                  }}
                />
                {connected ? 'Realtime connected' : 'Reconnecting to realtime…'}
                {unreadTotal > 0 ? ` · ${unreadTotal} unread` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setShowCreateGroup(true)}
                aria-label="Create group conversation"
                title="Create group"
                className="w-9 h-9 rounded-xl z-secondary hover:z-text hover:z-surface-2 flex items-center justify-center z-focus z-no-tap-highlight"
              >
                <Users className="w-4.5 h-4.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowNewMessage(true)}
                aria-label="Start new conversation"
                title="New message"
                className="w-9 h-9 rounded-xl z-accent-bg flex items-center justify-center z-focus z-no-tap-highlight z-shadow-soft"
              >
                <MessageSquarePlus className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 z-muted pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="z-input w-full rounded-xl pl-9 pr-8 py-2 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear conversation search"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md z-muted hover:z-text z-focus"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 mt-2" role="tablist" aria-label="Conversation filters">
            {(
              [
                ['all', 'All'],
                ['unread', 'Unread'],
                ['groups', 'Groups'],
              ] as Array<[InboxFilter, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={inboxFilter === value}
                onClick={() => setInboxFilter(value)}
                className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-colors z-focus ${
                  inboxFilter === value
                    ? 'z-surface-3 z-text'
                    : 'z-muted hover:z-text hover:z-surface-2'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto z-scroll" role="list" aria-label="Conversation list">
          {conversationsError && conversations.length === 0 ? (
            <div className="p-5 text-center">
              <AlertCircle className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--z-danger)' }} />
              <p className="text-sm font-semibold z-text">Unable to load messages</p>
              <p className="text-xs z-muted mt-1 leading-relaxed">{conversationsError}</p>
              <button
                type="button"
                onClick={() => void refreshConversations()}
                className="mt-3 h-9 px-3 rounded-xl text-xs font-semibold z-btn-secondary inline-flex items-center gap-1.5 z-focus"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Try again
              </button>
            </div>
          ) : conversationsLoading && conversations.length === 0 ? (
            <div className="p-3 space-y-2" aria-label="Loading conversations">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="flex items-center gap-3 px-1 py-2.5">
                  <div className="w-10 h-10 rounded-full z-skeleton shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-2/3 rounded z-skeleton" />
                    <div className="h-2.5 w-5/6 rounded z-skeleton" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="p-6 text-center">
              <Mail className="w-7 h-7 z-muted mx-auto mb-2" />
              <p className="text-sm font-semibold z-text">
                {searchQuery
                  ? 'No conversations found'
                  : inboxFilter === 'unread'
                    ? 'You are all caught up'
                    : inboxFilter === 'groups'
                      ? 'No group conversations yet'
                      : 'No conversations yet'}
              </p>
              <p className="text-xs z-muted mt-1 leading-relaxed">
                {searchQuery
                  ? 'Try a different name, username, or message.'
                  : 'Start a private conversation or create a group with the buttons above.'}
              </p>
              {!searchQuery && (
                <button
                  type="button"
                  onClick={() => setShowNewMessage(true)}
                  className="mt-3 h-9 px-3 rounded-xl text-xs font-semibold z-btn-primary z-focus inline-flex items-center gap-1.5"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" /> New message
                </button>
              )}
            </div>
          ) : (
            filteredConversations.map((conversation) => (
              <div role="listitem" key={conversation.id}>
                <ConversationListItem
                  conversation={conversation}
                  currentUserId={currentUser?.id || ''}
                  onlineUserIds={onlineUserIds}
                  isSelected={activeConversation?.id === conversation.id}
                  onSelect={handleSelectConversation}
                />
              </div>
            ))
          )}
        </div>

        {!connected && conversations.length > 0 && (
          <div className="shrink-0 border-t z-border px-3 py-2 flex items-center gap-2 text-[10px] z-muted">
            <WifiOff className="w-3.5 h-3.5" />
            Offline — messages will send when the connection returns.
          </div>
        )}
      </aside>

      <main
        className={`${showMobileChat ? 'flex' : 'hidden sm:flex'} flex-1 min-w-0 min-h-0 flex-col z-bg`}
        aria-label="Conversation"
      >
        {activeConversation && currentUser ? (
          <>
            <ConversationHeader
              conversation={activeConversation}
              currentUserId={currentUser.id}
              onlineUserIds={onlineUserIds}
              lastSeenByUser={lastSeenByUser}
              typingLabel={typingLabel || undefined}
              callStarting={callStarting}
              callBusy={callBusy}
              onBack={() => {
                setShowMobileChat(false);
                setActiveConversation(null);
              }}
              onOpenDetails={() => setShowGroupDetails(true)}
              onOpenProfile={(username) => onOpenProfile?.(username)}
              onStartCall={(type) => void handleStartCall(type)}
              onMarkRead={handleMarkRead}
              onLeaveGroup={() => setConfirmLeave(true)}
            />

            <div
              ref={scrollRef}
              onScroll={handleScroll}
              data-message-list
              className="flex-1 min-h-0 overflow-y-auto z-scroll px-3 sm:px-5 py-3"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              aria-label="Messages"
              style={{ minHeight: 0 }}
            >
              {messagesLoading ? (
                <div className="h-full flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2 z-muted">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-xs">Loading messages…</span>
                  </div>
                </div>
              ) : messagesError ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center max-w-xs">
                    <AlertCircle className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--z-danger)' }} />
                    <p className="text-sm font-semibold z-text">Unable to load messages</p>
                    <p className="text-xs z-muted mt-1 leading-relaxed">{messagesError}</p>
                    <button
                      type="button"
                      onClick={reloadMessages}
                      className="mt-3 h-9 px-3 rounded-xl text-xs font-semibold z-btn-secondary inline-flex items-center gap-1.5 z-focus"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Try again
                    </button>
                  </div>
                </div>
              ) : messages.length === 0 ? (
                <ConversationEmpty
                  conversation={activeConversation}
                  currentUserId={currentUser.id}
                  isOnline={
                    Boolean(getDirectCounterpart(activeConversation, currentUser.id)) &&
                    onlineUserIds.has(
                      getDirectCounterpart(activeConversation, currentUser.id)?.id || '',
                    )
                  }
                />
              ) : (
                <div className="max-w-3xl mx-auto w-full">
                  {hasMore && (
                    <div className="flex justify-center py-2">
                      <button
                        type="button"
                        onClick={() => void handleLoadOlder()}
                        disabled={loadingOlder}
                        className="h-8 px-3 rounded-full text-[11px] font-semibold z-surface-2 border z-border z-secondary hover:z-text inline-flex items-center gap-1.5 z-focus disabled:opacity-60"
                      >
                        {loadingOlder ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <ChevronUp className="w-3.5 h-3.5" />
                        )}
                        {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
                      </button>
                    </div>
                  )}

                  <VirtualizedMessageList
                    renderedMessages={renderedMessages}
                    scrollRef={scrollRef}
                    currentUserId={currentUser.id}
                    isGroup={Boolean(isGroup)}
                    expectedRecipients={expectedRecipients}
                    onReply={(message) => setReplyTarget(message)}
                    onEdit={(messageId, text) => void handleEditMessage(messageId, text)}
                    onDelete={(messageId) => void handleDeleteMessage(messageId)}
                    onReaction={(messageId, emoji) => void handleReaction(messageId, emoji)}
                    onRetry={(message) => void handleRetry(message)}
                    onCopy={(text) => void handleCopy(text)}
                    onOpenImage={handleOpenImage}
                    onJumpToMessage={jumpToMessage}
                    highlightedMessageId={highlightedMessageId}
                    estimatedItemHeight={140}
                    overscan={8}
                  />

                  {!hasMore && messages.length > 0 && (
                    <p className="text-center text-[10px] z-muted py-3">
                      Beginning of this conversation
                    </p>
                  )}
                </div>
              )}

              {typingNames.length > 0 && (
                <div className="max-w-3xl mx-auto w-full px-1 pt-2">
                  <div className="inline-flex items-center gap-1.5 rounded-full z-surface-2 border z-border px-2.5 py-1">
                    <span className="flex gap-0.5" aria-hidden="true">
                      <span className="w-1 h-1 rounded-full z-accent-bg z-typing-dot" />
                      <span className="w-1 h-1 rounded-full z-accent-bg z-typing-dot" style={{ animationDelay: '0.15s' }} />
                      <span className="w-1 h-1 rounded-full z-accent-bg z-typing-dot" style={{ animationDelay: '0.3s' }} />
                    </span>
                    <span className="text-[10px] z-muted">{typingLabel}</span>
                  </div>
                </div>
              )}

              {unseenBelow && (
                <div className="max-w-3xl mx-auto w-full px-1 pt-2 pb-1">
                  <button
                    type="button"
                    onClick={scrollToLatest}
                    aria-label="Jump to latest messages"
                    className="mx-auto inline-flex items-center gap-1.5 rounded-full z-surface-2 border z-border px-3 py-1.5 z-shadow-soft hover:z-surface-3 z-focus transition-all"
                  >
                    <span className="text-[11px] font-semibold z-accent">New messages</span>
                    <ArrowDown className="w-3.5 h-3.5 z-accent" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            <MessageComposer
              text={inputText}
              onTextChange={handleTextChange}
              onSend={() => void handleSend()}
              onOpenAttachments={() => setShowAttachments(true)}
              pendingAttachments={pendingAttachments}
              onRemoveAttachment={handleRemoveAttachment}
              onRetryAttachment={handleRetryUpload}
              replyTarget={replyTarget}
              onCancelReply={() => setReplyTarget(null)}
              sending={sending}
              uploading={pendingAttachments.some((item) => item.status === 'uploading')}
              disabled={!activeConversation}
              connected={connected}
              conversationName={getConversationTitle(activeConversation, currentUser.id)}
            />
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center px-6 text-center">
            <div className="w-16 h-16 rounded-2xl z-surface-2 border z-border flex items-center justify-center z-accent mb-4">
              <Mail className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-bold z-text z-display">Your messages</h2>
            <p className="text-sm z-secondary mt-1.5 max-w-xs leading-relaxed">
              Select a conversation, or start a private chat with someone new.
            </p>
            <button
              type="button"
              onClick={() => setShowNewMessage(true)}
              className="mt-4 h-10 px-4 rounded-xl text-sm font-semibold z-btn-primary z-focus inline-flex items-center gap-2"
            >
              <MessageSquarePlus className="w-4 h-4" /> New message
            </button>
          </div>
        )}
      </main>

      <NewMessageModal
        isOpen={showNewMessage}
        contacts={contacts}
        onClose={() => setShowNewMessage(false)}
        onSelectUser={handleStartDirectChat}
        onCreateGroup={() => setShowCreateGroup(true)}
      />

      {showCreateGroup && (
        <CreateGroupModal
          contacts={contacts}
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {showGroupDetails && activeConversation && currentUser && (
        <GroupDetailsModal
          conversation={activeConversation}
          currentUserId={currentUser.id}
          allUsers={allUsers}
          onClose={() => setShowGroupDetails(false)}
          onLeave={handleLeaveGroup}
          onAddParticipants={handleAddParticipants}
          onRemoveParticipant={handleRemoveParticipant}
          onUpdateConversation={handleUpdateConversation}
        />
      )}

      <AttachmentPicker
        isOpen={showAttachments}
        pending={pendingAttachments}
        onClose={() => setShowAttachments(false)}
        onPickFiles={handlePickFiles}
        onCancel={handleCancelUpload}
        onRetry={handleRetryUpload}
        onRemove={handleRemoveAttachment}
      />

      <ImageLightbox
        isOpen={lightbox.open}
        images={lightbox.images}
        downloadUrls={lightbox.downloadUrls}
        initialIndex={lightbox.index}
        onClose={() => setLightbox((previous) => ({ ...previous, open: false }))}
      />

      <ConfirmationDialog
        isOpen={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => void handleConfirmLeave()}
        title="Leave this group?"
        description="You will stop receiving new messages from this group. Your existing messages stay with the conversation."
        confirmLabel="Leave group"
        isDestructive
        isLoading={leaving}
      />
    </div>
  );
};

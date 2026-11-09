import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Mail,
  ArrowLeft,
  Users,
  Plus,
  Phone,
  Video,
  Info,
  Smile,
  Paperclip,
  X,
} from 'lucide-react';
import { User, Message, Conversation } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { UserBadges } from '../common/UserBadges.tsx';
import { EmptyState } from '../common/EmptyState.tsx';
import { io, type Socket } from 'socket.io-client';
import { getBackendApiUrl } from '../../config/backendUrl.ts';
import { MessageBubble } from './MessageBubble.tsx';
import { CreateGroupModal } from './CreateGroupModal.tsx';
import { GroupDetailsModal } from './GroupDetailsModal.tsx';
import { CallModal } from '../calling/CallModal.tsx';
import { IncomingCallBanner } from '../calling/IncomingCallBanner.tsx';

export const MessagesView: React.FC = () => {
  const { currentUser, allUsers } = useAuth();
  const { theme, accentBgClass } = useTheme();

  const contacts = allUsers.filter((u) => u.id !== currentUser?.id);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyTarget, setReplyTarget] = useState<Message | null>(null);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map()); // userId -> username
  const [showMobileChat, setShowMobileChat] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showGroupDetails, setShowGroupDetails] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Array<{ id: string; name: string }>>([]);

  // Active call state
  const [activeCall, setActiveCall] = useState<{
    callId: string;
    roomName: string;
    token: string;
    livekitUrl: string;
    type: 'voice' | 'video';
    title: string;
    isGroup: boolean;
  } | null>(null);

  const [incomingCall, setIncomingCall] = useState<{
    callId: string;
    roomName: string;
    type: 'voice' | 'video';
    caller: { name: string; username: string; avatarUrl: string };
    conversationId: string;
  } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Socket.IO connection
  useEffect(() => {
    if (!currentUser) return;
    const socket = io(getBackendApiUrl(), { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('presence:query', {}, (res: { onlineUserIds?: string[] }) => {
        if (res?.onlineUserIds) setOnlineUserIds(new Set(res.onlineUserIds));
      });
    });

    socket.on('presence:update', (data: { userId: string; isOnline: boolean }) => {
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (data.isOnline) next.add(data.userId);
        else next.delete(data.userId);
        return next;
      });
    });

    socket.on('call:incoming', (event: any) => {
      if (event.caller.id !== currentUser.id) {
        setIncomingCall({
          callId: event.callId,
          roomName: event.roomName,
          type: event.type,
          caller: event.caller,
          conversationId: event.conversationId,
        });
      }
    });

    socket.on('call:ended', () => {
      setActiveCall(null);
      setIncomingCall(null);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [currentUser?.id]);

  // Load conversations
  const fetchConversations = async () => {
    try {
      const res = await api.getConversations();
      setConversations(res.conversations || []);
      if (!activeConv && res.conversations?.length > 0) {
        setActiveConv(res.conversations[0]);
      }
    } catch (err) {
      console.warn('Failed to fetch conversations:', err);
    }
  };

  useEffect(() => {
    if (currentUser) {
      fetchConversations();
    }
  }, [currentUser?.id]);

  // Handle active conversation subscription & messages loading
  useEffect(() => {
    if (!activeConv || !currentUser) return;
    let active = true;

    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('conversation:join', { conversationId: activeConv.id });
    }

    const loadMessages = async () => {
      try {
        const res = await api.getConversationMessages(activeConv.id);
        if (active) {
          setMessages(res.messages || []);
          // Send read receipts for unread messages
          const unreadIds = (res.messages || [])
            .filter((m) => m.senderId !== currentUser.id)
            .map((m) => m.id);
          if (unreadIds.length > 0) {
            void api.sendReceipts(activeConv.id, 'read', unreadIds);
          }
        }
      } catch (err) {
        console.warn('Failed to load conversation messages:', err);
      }
    };

    loadMessages();

    // Event handlers
    const handleNewMessage = (msg: Message) => {
      if (msg.conversationId === activeConv.id) {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
        if (msg.senderId !== currentUser.id) {
          void api.sendReceipts(activeConv.id, 'read', [msg.id]);
        }
      }
      void fetchConversations();
    };

    const handleMessageEdit = (updatedMsg: Message) => {
      setMessages((prev) => prev.map((m) => (m.id === updatedMsg.id ? updatedMsg : m)));
    };

    const handleMessageDelete = (data: { conversationId: string; messageId: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.messageId ? { ...m, isDeleted: true, text: 'This message was deleted.' } : m,
        ),
      );
    };

    const handleTyping = (event: { conversationId: string; userId: string; username: string; isTyping: boolean }) => {
      if (event.conversationId !== activeConv.id || event.userId === currentUser.id) return;
      setTypingUsers((prev) => {
        const next = new Map(prev);
        if (event.isTyping) next.set(event.userId, event.username);
        else next.delete(event.userId);
        return next;
      });
    };

    const handleReceipt = (event: { conversationId: string; userId: string; messageIds: string[]; receiptType: string }) => {
      if (event.conversationId !== activeConv.id) return;
      setMessages((prev) =>
        prev.map((msg) => {
          if (event.messageIds.includes(msg.id)) {
            const receipts = msg.receipts || [];
            const existing = receipts.find((r) => r.userId === event.userId);
            const now = Date.now();
            const updatedReceipts = existing
              ? receipts.map((r) =>
                  r.userId === event.userId
                    ? { ...r, deliveredAt: r.deliveredAt || now, ...(event.receiptType === 'read' ? { readAt: now } : {}) }
                    : r,
                )
              : [...receipts, { userId: event.userId, deliveredAt: now, readAt: event.receiptType === 'read' ? now : null }];
            return { ...msg, receipts: updatedReceipts };
          }
          return msg;
        }),
      );
    };

    const handleReaction = (event: { conversationId: string; messageId: string; userId: string; emoji: string; added: boolean }) => {
      if (event.conversationId !== activeConv.id) return;
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === event.messageId) {
            const reactions = msg.reactions || [];
            const filtered = reactions.filter((r) => !(r.userId === event.userId && r.emoji === event.emoji));
            return {
              ...msg,
              reactions: event.added
                ? [...filtered, { emoji: event.emoji, userId: event.userId, createdAt: Date.now() }]
                : filtered,
            };
          }
          return msg;
        }),
      );
    };

    socket?.on('conversation:message', handleNewMessage);
    socket?.on('conversation:message-edit', handleMessageEdit);
    socket?.on('conversation:message-delete', handleMessageDelete);
    socket?.on('conversation:typing', handleTyping);
    socket?.on('conversation:receipt', handleReceipt);
    socket?.on('conversation:reaction', handleReaction);

    return () => {
      active = false;
      if (socket?.connected) {
        socket.emit('conversation:leave', { conversationId: activeConv.id });
      }
      socket?.off('conversation:message', handleNewMessage);
      socket?.off('conversation:message-edit', handleMessageEdit);
      socket?.off('conversation:message-delete', handleMessageDelete);
      socket?.off('conversation:typing', handleTyping);
      socket?.off('conversation:receipt', handleReceipt);
      socket?.off('conversation:reaction', handleReaction);
    };
  }, [activeConv?.id, currentUser?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);

  // Handle typing emissions
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    if (!socketRef.current || !activeConv) return;

    socketRef.current.emit('typing:start', { conversationId: activeConv.id });
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      socketRef.current?.emit('typing:stop', { conversationId: activeConv.id });
    }, 2000);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!inputText.trim() && pendingAttachments.length === 0) || !activeConv || sending) return;

    try {
      setSending(true);
      const res = await api.sendConversationMessage(activeConv.id, {
        text: inputText.trim(),
        replyToMessageId: replyTarget?.id,
        attachmentAssetIds: pendingAttachments.map((a) => a.id),
      });
      setMessages((prev) => (prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message]));
      setInputText('');
      setReplyTarget(null);
      setPendingAttachments([]);
      socketRef.current?.emit('typing:stop', { conversationId: activeConv.id });
      void fetchConversations();
    } catch (err) {
      console.warn('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingAttachment(true);
      const res = await api.uploadFile(file, 'message-attachment');
      setPendingAttachments((prev) => [...prev, { id: res.fileId, name: file.name }]);
    } catch (err: any) {
      alert(err?.message || 'Upload failed');
    } finally {
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleStartDirectChat = async (user: User) => {
    try {
      const res = await api.createConversation({ type: 'direct', recipientId: user.id });
      setActiveConv(res.conversation);
      setShowMobileChat(true);
      void fetchConversations();
    } catch (err) {
      console.warn('Failed to create direct conversation:', err);
    }
  };

  const handleCreateGroup = async (title: string, participantIds: string[]) => {
    const res = await api.createConversation({ type: 'group', title, participantIds });
    setActiveConv(res.conversation);
    setShowMobileChat(true);
    void fetchConversations();
  };

  const handleLeaveGroup = async () => {
    if (!activeConv || !currentUser) return;
    try {
      await api.removeParticipant(activeConv.id, currentUser.id);
      setShowGroupDetails(false);
      setActiveConv(null);
      void fetchConversations();
    } catch (err: any) {
      alert(err?.message || 'Failed to leave group');
    }
  };

  const handleAddParticipants = async (userIds: string[]) => {
    if (!activeConv) return;
    await api.addParticipants(activeConv.id, userIds);
    const updated = await api.getConversation(activeConv.id);
    setActiveConv(updated.conversation);
  };

  const handleRemoveParticipant = async (userId: string) => {
    if (!activeConv) return;
    await api.removeParticipant(activeConv.id, userId);
    const updated = await api.getConversation(activeConv.id);
    setActiveConv(updated.conversation);
  };

  // Header metadata
  const isGroup = activeConv?.type === 'group';
  const otherParticipant = !isGroup
    ? activeConv?.participants?.find((p) => p.userId !== currentUser?.id)?.user
    : null;
  const isDirectOnline = otherParticipant ? onlineUserIds.has(otherParticipant.id) : false;

  const headerBg =
    theme === 'dark'
      ? 'bg-[#090B10]/85 border-white/[0.08]'
      : theme === 'dim'
        ? 'bg-[#0F172A]/85 border-neutral-700'
        : 'bg-white/85 border-slate-200';

  return (
    <div className="flex h-[calc(100dvh-4rem-env(safe-area-inset-bottom,0px))] min-h-0 overflow-hidden sm:h-screen">
      {/* Left Conversations & Contacts List */}
      <div
        className={`${
          showMobileChat ? 'hidden sm:flex' : 'flex'
        } w-full sm:w-80 md:w-88 border-r border-white/[0.08] flex-col shrink-0`}
      >
        <div className={`sticky top-0 z-10 px-4 py-3 border-b ${headerBg} flex items-center justify-between`}>
          <h1 className="text-lg font-black tracking-tight text-white">Transmissions</h1>
          <button
            type="button"
            onClick={() => setShowCreateGroup(true)}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-300 hover:text-white transition-colors"
            title="Create group"
          >
            <Users className="w-4 h-4" />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto divide-y divide-white/[0.06] flex-1">
          {conversations.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-xs text-neutral-500 mb-3">No active transmissions.</p>
              <span className="text-xs font-semibold text-neutral-400 block mb-2">Start with a contact:</span>
              <div className="flex flex-col gap-1">
                {contacts.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => handleStartDirectChat(u)}
                    className="p-2 flex items-center gap-2 hover:bg-white/5 rounded-xl text-left"
                  >
                    <Avatar src={u.avatarUrl} name={u.name} size="sm" isOnline={onlineUserIds.has(u.id)} />
                    <span className="text-xs text-white truncate">{u.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            conversations.map((conv) => {
              const isSelected = activeConv?.id === conv.id;
              const isGrp = conv.type === 'group';
              const directUser = !isGrp
                ? conv.participants?.find((p) => p.userId !== currentUser?.id)?.user
                : null;
              const title = isGrp ? conv.title : directUser?.name || 'Direct Message';
              const subtitle = conv.lastMessage
                ? conv.lastMessage.text || (conv.lastMessage.attachments?.length ? 'Sent an attachment' : '')
                : 'No messages yet';
              const isOnline = directUser ? onlineUserIds.has(directUser.id) : false;

              return (
                <div
                  key={conv.id}
                  onClick={() => {
                    setActiveConv(conv);
                    setShowMobileChat(true);
                  }}
                  className={`p-3.5 flex items-center gap-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                  }`}
                >
                  {isGrp ? (
                    <div className="w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold text-sm shrink-0">
                      {conv.title?.slice(0, 2).toUpperCase() || 'GP'}
                    </div>
                  ) : (
                    <Avatar
                      src={directUser?.avatarUrl || ''}
                      name={directUser?.name || ''}
                      size="md"
                      isOnline={isOnline}
                    />
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm truncate flex items-center gap-1 text-white">
                        {title}
                        {directUser && <UserBadges verified={directUser.verified} isGold={directUser.isGold} size="sm" />}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-400 text-black">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-400 truncate mt-0.5">
                      {subtitle}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Chat Thread */}
      <div className={`${!showMobileChat ? 'hidden sm:flex' : 'flex'} flex-col flex-1 h-full min-w-0`}>
        {activeConv ? (
          <>
            {/* Header */}
            <div className={`px-3 py-2.5 sm:px-4 sm:py-3 border-b ${headerBg} flex items-center justify-between shrink-0`}>
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setShowMobileChat(false)}
                  className="sm:hidden p-1.5 -ml-1 text-neutral-400 hover:text-white"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                {isGroup ? (
                  <div
                    onClick={() => setShowGroupDetails(true)}
                    className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold text-xs shrink-0 cursor-pointer"
                  >
                    {activeConv.title?.slice(0, 2).toUpperCase() || 'GP'}
                  </div>
                ) : (
                  <Avatar
                    src={otherParticipant?.avatarUrl || ''}
                    name={otherParticipant?.name || ''}
                    size="sm"
                    isOnline={isDirectOnline}
                  />
                )}

                <div className="min-w-0">
                  <div className="font-bold text-sm flex items-center gap-1 text-white truncate">
                    {isGroup ? activeConv.title : otherParticipant?.name}
                    {otherParticipant && (
                      <UserBadges verified={otherParticipant.verified} isGold={otherParticipant.isGold} size="sm" />
                    )}
                  </div>
                  <div className="text-xs text-neutral-500 font-mono">
                    {isGroup
                      ? `${activeConv.participants?.filter((p) => !p.leftAt).length} members`
                      : isDirectOnline
                        ? 'Online'
                        : 'Offline'}
                  </div>
                </div>
              </div>

              {/* Call Controls & Group Info Action */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await (api as any).request('/calls/initiate', {
                        method: 'POST',
                        body: JSON.stringify({ conversationId: activeConv.id, type: 'voice' }),
                      });
                      setActiveCall({
                        callId: res.call.id,
                        roomName: res.call.roomName,
                        token: res.token,
                        livekitUrl: res.livekitUrl,
                        type: 'voice',
                        title: isGroup ? activeConv.title || 'Group Call' : otherParticipant?.name || 'Voice Call',
                        isGroup,
                      });
                    } catch (err: any) {
                      alert(err?.message || 'Failed to start call');
                    }
                  }}
                  className="p-2 text-neutral-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
                  title="Voice Call"
                >
                  <Phone className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await (api as any).request('/calls/initiate', {
                        method: 'POST',
                        body: JSON.stringify({ conversationId: activeConv.id, type: 'video' }),
                      });
                      setActiveCall({
                        callId: res.call.id,
                        roomName: res.call.roomName,
                        token: res.token,
                        livekitUrl: res.livekitUrl,
                        type: 'video',
                        title: isGroup ? activeConv.title || 'Group Call' : otherParticipant?.name || 'Video Call',
                        isGroup,
                      });
                    } catch (err: any) {
                      alert(err?.message || 'Failed to start video call');
                    }
                  }}
                  className="p-2 text-neutral-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
                  title="Video Call"
                >
                  <Video className="w-4 h-4" />
                </button>

                {isGroup && (
                  <button
                    type="button"
                    onClick={() => setShowGroupDetails(true)}
                    className="p-2 text-neutral-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
                    title="Group information"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Messages Area */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-3">
              {messages.length === 0 ? (
                <EmptyState
                  icon={<Mail className="w-6 h-6 text-cyan-400" />}
                  title="No messages yet"
                  description="Direct and group messages are encrypted and deliver in real-time."
                />
              ) : (
                messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    currentUserId={currentUser?.id || ''}
                    onReply={(target) => setReplyTarget(target)}
                    onEdit={(msgId, text) => void api.editConversationMessage(activeConv.id, msgId, text)}
                    onDelete={(msgId) => void api.deleteConversationMessage(activeConv.id, msgId)}
                    onReaction={(msgId, emoji) => void api.toggleMessageReaction(activeConv.id, msgId, emoji)}
                    accentBgClass={accentBgClass}
                  />
                ))
              )}

              {/* Typing indicators */}
              {typingUsers.size > 0 && (
                <div className="text-xs text-neutral-400 italic font-mono flex items-center gap-1.5 px-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" />
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.2s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce [animation-delay:0.4s]" />
                  </div>
                  <span>
                    {Array.from(typingUsers.values()).join(', ')} {typingUsers.size > 1 ? 'are' : 'is'} typing...
                  </span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Reply bar preview */}
            {replyTarget && (
              <div className="px-4 py-2 bg-white/[0.04] border-t border-white/10 flex items-center justify-between text-xs text-neutral-300">
                <div className="truncate">
                  <span className="font-semibold text-cyan-400">Replying to {replyTarget.replyToMessage?.senderUsername || 'message'}: </span>
                  <span className="italic">{replyTarget.text}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTarget(null)}
                  className="p-1 hover:text-white text-neutral-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Pending attachments preview */}
            {pendingAttachments.length > 0 && (
              <div className="px-4 py-2 bg-white/[0.04] border-t border-white/10 flex flex-wrap gap-2 text-xs">
                {pendingAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    <span className="truncate max-w-40">{att.name}</span>
                    <button
                      type="button"
                      onClick={() => setPendingAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                      className="hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Input Bar */}
            <form
              onSubmit={handleSend}
              className="shrink-0 p-2.5 sm:p-3 border-t border-white/[0.08] flex items-center gap-2 bg-[#090B10] pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] sm:pb-3"
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                accept="image/*,video/*,application/pdf"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAttachment}
                className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white cursor-pointer transition-colors"
                title="Attach media"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <input
                type="text"
                placeholder={uploadingAttachment ? 'Uploading attachment...' : 'Transmit message...'}
                value={inputText}
                onChange={handleInputChange}
                className="min-w-0 flex-1 bg-white/[0.05] border border-white/10 rounded-2xl px-3 sm:px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400"
              />

              <button
                type="submit"
                disabled={(!inputText.trim() && pendingAttachments.length === 0) || sending}
                className={`p-2.5 rounded-xl ${accentBgClass} text-black font-bold hover:brightness-110 disabled:opacity-40 cursor-pointer transition-all shadow-xs`}
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          <EmptyState
            icon={<Mail className="w-8 h-8 text-neutral-500" />}
            title="Select a transmission"
            description="Choose a conversation or contact to start messaging."
          />
        )}
      </div>

      {/* Modals */}
      {showCreateGroup && (
        <CreateGroupModal
          contacts={contacts}
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {showGroupDetails && activeConv && currentUser && (
        <GroupDetailsModal
          conversation={activeConv}
          currentUserId={currentUser.id}
          allUsers={allUsers}
          onClose={() => setShowGroupDetails(false)}
          onLeave={handleLeaveGroup}
          onAddParticipants={handleAddParticipants}
          onRemoveParticipant={handleRemoveParticipant}
        />
      )}

      {/* Incoming Call Notification Banner */}
      {incomingCall && (
        <IncomingCallBanner
          caller={incomingCall.caller}
          type={incomingCall.type}
          onAccept={async () => {
            try {
              const res = await (api as any).request(`/calls/${incomingCall.callId}/respond`, {
                method: 'POST',
                body: JSON.stringify({ action: 'accept' }),
              });
              setActiveCall({
                callId: incomingCall.callId,
                roomName: incomingCall.roomName,
                token: res.token,
                livekitUrl: res.livekitUrl,
                type: incomingCall.type,
                title: incomingCall.caller.name,
                isGroup: false,
              });
              setIncomingCall(null);
            } catch (err: any) {
              alert(err?.message || 'Failed to accept call');
            }
          }}
          onReject={async () => {
            try {
              await (api as any).request(`/calls/${incomingCall.callId}/respond`, {
                method: 'POST',
                body: JSON.stringify({ action: 'reject' }),
              });
              setIncomingCall(null);
            } catch (err: any) {
              console.warn(err);
            }
          }}
        />
      )}

      {/* Active Call Modal */}
      {activeCall && (
        <CallModal
          roomName={activeCall.roomName}
          token={activeCall.token}
          livekitUrl={activeCall.livekitUrl}
          title={activeCall.title}
          isGroup={activeCall.isGroup}
          onEndCall={async () => {
            try {
              await (api as any).request(`/calls/${activeCall.callId}/end`, {
                method: 'POST',
                body: '{}',
              });
            } catch (err) {
              console.warn(err);
            } finally {
              setActiveCall(null);
            }
          }}
        />
      )}
    </div>
  );
};

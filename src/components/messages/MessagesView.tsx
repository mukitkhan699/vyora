import React, { useState, useEffect, useRef } from 'react';
import { Send, Mail, ArrowLeft } from 'lucide-react';
import { User, Message } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { EmptyState } from '../common/EmptyState.tsx';

export const MessagesView: React.FC = () => {
  const { currentUser, allUsers } = useAuth();
  const { theme, accentBgClass } = useTheme();

  const contacts = allUsers.filter((u) => u.id !== currentUser?.id);
  const [selectedUser, setSelectedUser] = useState<User | null>(contacts[0] || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMobileChat, setShowMobileChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedUser) {
      api.getMessages(selectedUser.id)
        .then(setMessages)
        .catch(console.warn);
    }
  }, [selectedUser]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedUser || sending) return;

    try {
      setSending(true);
      const newMsg = await api.sendMessage(selectedUser.id, inputText.trim());
      setMessages((prev) => [...prev, newMsg]);
      setInputText('');
    } catch (e) {
      console.warn(e);
    } finally {
      setSending(false);
    }
  };

  const headerBg =
    theme === 'dark'
      ? 'bg-[#090B10]/85 border-white/[0.08]'
      : theme === 'dim'
        ? 'bg-[#0F172A]/85 border-neutral-700'
        : 'bg-white/85 border-slate-200';

  return (
    <div className="flex h-[calc(100vh-4rem)] sm:h-screen overflow-hidden">
      {/* Left Contacts List (hidden on mobile if chat is open) */}
      <div
        className={`${
          showMobileChat ? 'hidden sm:flex' : 'flex'
        } w-full sm:w-80 md:w-88 border-r border-white/[0.08] flex-col shrink-0`}
      >
        <div className={`sticky top-0 z-10 px-4 py-3 border-b ${headerBg}`}>
          <h1 className="text-lg font-black tracking-tight text-white">Messages</h1>
        </div>

        <div className="overflow-y-auto divide-y divide-white/[0.06] flex-1">
          {contacts.map((user) => {
            const isSelected = selectedUser?.id === user.id;
            return (
              <div
                key={user.id}
                onClick={() => {
                  setSelectedUser(user);
                  setShowMobileChat(true);
                }}
                className={`p-3.5 flex items-center gap-3 cursor-pointer transition-colors ${
                  isSelected ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <Avatar src={user.avatarUrl} name={user.name} size="md" isOnline={true} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm truncate flex items-center gap-1 text-white">
                      {user.name}
                      {user.verified && <Badge type={user.isGold ? 'gold' : 'blue'} size="sm" />}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-400 truncate font-mono">
                    @{user.username}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Chat Thread */}
      <div
        className={`${
          !showMobileChat ? 'hidden sm:flex' : 'flex'
        } flex-col flex-1 h-full min-w-0`}
      >
        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className={`px-4 py-3 border-b ${headerBg} flex items-center gap-3 shrink-0`}>
              {/* Mobile Back Button */}
              <button
                type="button"
                onClick={() => setShowMobileChat(false)}
                className="sm:hidden p-1.5 -ml-1 text-neutral-400 hover:text-white"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <Avatar src={selectedUser.avatarUrl} name={selectedUser.name} size="sm" isOnline={true} />
              <div className="min-w-0">
                <div className="font-bold text-sm flex items-center gap-1 text-white truncate">
                  {selectedUser.name}
                  {selectedUser.verified && (
                    <Badge type={selectedUser.isGold ? 'gold' : 'blue'} size="sm" />
                  )}
                </div>
                <div className="text-xs text-neutral-500 font-mono">@{selectedUser.username}</div>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {messages.length === 0 ? (
                <EmptyState
                  icon={<Mail className="w-6 h-6 text-cyan-400" />}
                  title={`Start a conversation with ${selectedUser.name}`}
                  description="Direct messages are private and deliver instantaneously."
                />
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`max-w-[78%] p-3 rounded-2xl text-sm leading-relaxed ${
                      msg.isSender
                        ? `${accentBgClass} text-black font-medium self-end rounded-br-xs shadow-xs`
                        : 'bg-[#181E2B] text-neutral-100 self-start rounded-bl-xs border border-white/10'
                    }`}
                  >
                    <p className="break-words">{msg.text}</p>
                    <span className="text-[10px] opacity-70 block text-right mt-1 font-mono">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            <form
              onSubmit={handleSend}
              className="p-3 border-t border-white/[0.08] flex items-center gap-2 bg-[#090B10]"
            >
              <input
                type="text"
                placeholder="Start a new message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 bg-white/[0.05] border border-white/10 rounded-2xl px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || sending}
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
            title="Select a conversation"
            description="Choose an account from the contact list to view transmissions and reply."
          />
        )}
      </div>
    </div>
  );
};

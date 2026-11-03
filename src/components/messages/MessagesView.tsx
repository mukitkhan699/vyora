import React, { useState, useEffect } from 'react';
import { Send, Mail, UserPlus } from 'lucide-react';
import { User, Message } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';

export const MessagesView: React.FC = () => {
  const { currentUser, allUsers } = useAuth();
  const { theme, accentBgClass } = useTheme();

  const contacts = allUsers.filter(u => u.id !== currentUser?.id);
  const [selectedUser, setSelectedUser] = useState<User | null>(contacts[0] || null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (selectedUser) {
      api.getMessages(selectedUser.id).then(setMessages).catch(console.warn);
    }
  }, [selectedUser]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedUser || sending) return;

    try {
      setSending(true);
      const newMsg = await api.sendMessage(selectedUser.id, inputText.trim());
      setMessages(prev => [...prev, newMsg]);
      setInputText('');
    } catch (e) {
      console.warn(e);
    } finally {
      setSending(false);
    }
  };

  const headerBg = theme === 'dark' ? 'bg-black/85 border-neutral-800' : theme === 'dim' ? 'bg-[#15202b]/85 border-neutral-700' : 'bg-white/85 border-neutral-200';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left Contacts List */}
      <div className="w-full sm:w-80 md:w-88 border-r border-neutral-800 flex flex-col shrink-0">
        <div className={`sticky top-0 z-10 px-4 py-3 border-b ${headerBg}`}>
          <h1 className="text-xl font-bold">Messages</h1>
        </div>

        <div className="overflow-y-auto divide-y divide-neutral-800/60 flex-1">
          {contacts.map(user => {
            const isSelected = selectedUser?.id === user.id;
            return (
              <div
                key={user.id}
                onClick={() => setSelectedUser(user)}
                className={`p-3.5 flex items-center gap-3 cursor-pointer transition-colors ${
                  isSelected ? 'bg-neutral-800/40' : 'hover:bg-neutral-900/40'
                }`}
              >
                <Avatar src={user.avatarUrl} name={user.name} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm truncate flex items-center gap-1">
                      {user.name}
                      {user.verified && <Badge type={user.isGold ? 'gold' : 'blue'} size="sm" />}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-400 truncate">@{user.username}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Chat Thread */}
      <div className="hidden sm:flex flex-col flex-1 h-full">
        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className={`px-4 py-3 border-b ${headerBg} flex items-center gap-3 shrink-0`}>
              <Avatar src={selectedUser.avatarUrl} name={selectedUser.name} size="sm" />
              <div>
                <div className="font-bold text-sm flex items-center gap-1">
                  {selectedUser.name}
                  {selectedUser.verified && <Badge type={selectedUser.isGold ? 'gold' : 'blue'} size="sm" />}
                </div>
                <div className="text-xs text-neutral-500">@{selectedUser.username}</div>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {messages.length === 0 ? (
                <div className="m-auto text-center text-neutral-500 text-sm">
                  Say hello to {selectedUser.name}! Direct messaging is fast and responsive.
                </div>
              ) : (
                messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`max-w-[75%] p-3 rounded-2xl text-sm leading-relaxed ${
                      msg.isSender
                        ? `${accentBgClass} text-white self-end rounded-br-xs`
                        : 'bg-neutral-800 text-neutral-200 self-start rounded-bl-xs'
                    }`}
                  >
                    <p>{msg.text}</p>
                    <span className="text-[10px] opacity-70 block text-right mt-1">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Input Bar */}
            <form onSubmit={handleSend} className="p-3 border-t border-neutral-800/80 flex items-center gap-2">
              <input
                type="text"
                placeholder="Start a new message"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                className="flex-1 bg-neutral-900 border border-neutral-800 rounded-full px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
              />
              <button
                type="submit"
                disabled={!inputText.trim() || sending}
                className={`p-2.5 rounded-full ${accentBgClass} text-white hover:opacity-90 disabled:opacity-40 cursor-pointer transition-opacity`}
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          <div className="m-auto text-center text-neutral-500">
            <Mail className="w-12 h-12 mx-auto mb-2 text-neutral-600" />
            <h3 className="text-lg font-bold text-neutral-300">Select a message</h3>
            <p className="text-sm">Choose from your existing conversations or start a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
};

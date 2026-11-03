import React, { useState, useEffect } from 'react';
import { Heart, Repeat2, UserPlus, MessageCircle, CheckCheck } from 'lucide-react';
import { Notification } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';

interface NotificationsViewProps {
  onPostClick?: (postId: string) => void;
  onUserClick?: (username: string) => void;
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  onPostClick,
  onUserClick,
}) => {
  const { refreshNotificationsCount } = useAuth();
  const { theme, accentBgClass } = useTheme();

  const [activeTab, setActiveTab] = useState<'all' | 'verified' | 'mentions'>('all');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const data = await api.getNotifications();
      setNotifications(data);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.markNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      refreshNotificationsCount();
    } catch (e) {
      console.warn(e);
    }
  };

  const filtered = notifications.filter(n => {
    if (activeTab === 'verified') return n.sender.verified;
    if (activeTab === 'mentions') return n.type === 'mention' || n.type === 'reply';
    return true;
  });

  const headerBg = theme === 'dark' ? 'bg-black/85 border-neutral-800' : theme === 'dim' ? 'bg-[#15202b]/85 border-neutral-700' : 'bg-white/85 border-neutral-200';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-md border-b ${headerBg}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-xl font-bold">Notifications</h1>
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-1.5 text-xs text-sky-400 hover:underline cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" />
            <span>Mark all read</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-t border-neutral-800/40">
          {(['all', 'verified', 'mentions'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-3 text-center text-sm font-bold capitalize relative hover:bg-neutral-800/20 cursor-pointer"
            >
              <span className={activeTab === tab ? 'text-white' : 'text-neutral-500'}>
                {tab}
              </span>
              {activeTab === tab && (
                <span className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-1 rounded-full ${accentBgClass}`} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Notifications List */}
      <div className="divide-y divide-neutral-800/60">
        {loading ? (
          <div className="p-12 flex justify-center text-neutral-500">
            <svg className="animate-spin h-6 w-6 text-sky-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-neutral-500 text-sm">
            No notifications in this tab yet.
          </div>
        ) : (
          filtered.map(notif => {
            let Icon = Heart;
            let iconColor = 'text-pink-500 fill-pink-500';
            let label = 'liked your post';

            if (notif.type === 'repost') {
              Icon = Repeat2;
              iconColor = 'text-emerald-500';
              label = 'reposted your post';
            } else if (notif.type === 'follow') {
              Icon = UserPlus;
              iconColor = 'text-sky-400';
              label = 'followed you';
            } else if (notif.type === 'reply') {
              Icon = MessageCircle;
              iconColor = 'text-sky-400';
              label = 'replied to you';
            }

            return (
              <div
                key={notif.id}
                onClick={() => {
                  if (notif.postId && onPostClick) onPostClick(notif.postId);
                  else if (onUserClick) onUserClick(notif.sender.username);
                }}
                className={`p-4 flex gap-4 hover:bg-white/[0.02] transition-colors cursor-pointer ${
                  !notif.read ? 'bg-sky-500/5' : ''
                }`}
              >
                <div className="w-8 flex justify-end shrink-0 pt-0.5">
                  <Icon className={`w-6 h-6 ${iconColor}`} />
                </div>

                <div className="flex-1">
                  <Avatar
                    src={notif.sender.avatarUrl}
                    name={notif.sender.name}
                    size="sm"
                    className="mb-2"
                  />
                  <div className="text-sm">
                    <span className="font-bold hover:underline">{notif.sender.name}</span>
                    {notif.sender.verified && (
                      <Badge type={notif.sender.isGold ? 'gold' : 'blue'} size="sm" className="ml-1" />
                    )}
                    <span className="text-neutral-400 ml-1.5">{label}</span>
                  </div>

                  {notif.postContent && (
                    <p className="text-xs text-neutral-500 mt-1 line-clamp-2 italic">
                      "{notif.postContent}"
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

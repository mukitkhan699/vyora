import React, { useState, useEffect } from 'react';
import { Heart, Repeat2, UserPlus, MessageCircle, CheckCheck, Bell } from 'lucide-react';
import { Notification } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { PostSkeleton } from '../common/LoadingSkeleton.tsx';
import { EmptyState } from '../common/EmptyState.tsx';

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
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      refreshNotificationsCount();
    } catch (e) {
      console.warn(e);
    }
  };

  const filtered = notifications.filter((n) => {
    if (activeTab === 'verified') return n.sender.verified;
    if (activeTab === 'mentions') return n.type === 'mention' || n.type === 'reply';
    return true;
  });

  const headerBg =
    theme === 'dark'
      ? 'bg-[#090B10]/85 border-white/[0.08]'
      : theme === 'dim'
        ? 'bg-[#0F172A]/85 border-neutral-700'
        : 'bg-white/85 border-slate-200';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${headerBg}`}>
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-black tracking-tight text-white">Notifications</h1>
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="flex items-center gap-1.5 text-xs text-cyan-400 hover:underline cursor-pointer"
          >
            <CheckCheck className="w-4 h-4" />
            <span>Mark all read</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-t border-white/[0.06]">
          {(['all', 'verified', 'mentions'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className="flex-1 py-3 text-center text-sm font-bold capitalize relative hover:bg-white/[0.03] cursor-pointer"
            >
              <span className={activeTab === tab ? 'text-white' : 'text-neutral-500'}>
                {tab}
              </span>
              {activeTab === tab && (
                <span
                  className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-16 h-0.75 rounded-full ${accentBgClass}`}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Notifications List */}
      <div className="divide-y divide-white/[0.06] flex-1">
        {loading ? (
          <div>
            <PostSkeleton />
            <PostSkeleton />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Bell className="w-6 h-6 text-neutral-400" />}
            title="No notifications yet"
            description="When someone likes or reposts your transmissions, you’ll see it here."
          />
        ) : (
          filtered.map((notif) => {
            let Icon = Heart;
            let iconColor = 'text-rose-500 fill-rose-500';
            let label = 'liked your post';

            if (notif.type === 'repost') {
              Icon = Repeat2;
              iconColor = 'text-emerald-400';
              label = 'reposted your post';
            } else if (notif.type === 'follow') {
              Icon = UserPlus;
              iconColor = 'text-cyan-400';
              label = 'followed you';
            } else if (notif.type === 'reply') {
              Icon = MessageCircle;
              iconColor = 'text-cyan-400';
              label = 'replied to you';
            }

            return (
              <div
                key={notif.id}
                onClick={() => {
                  if (notif.postId && onPostClick) onPostClick(notif.postId);
                  else if (onUserClick) onUserClick(notif.sender.username);
                }}
                className={`p-4 flex gap-3.5 hover:bg-white/[0.02] transition-colors cursor-pointer ${
                  !notif.read ? 'bg-cyan-500/[0.03]' : ''
                }`}
              >
                <div className="w-7 flex justify-end shrink-0 pt-0.5">
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <Avatar
                    src={notif.sender.avatarUrl}
                    name={notif.sender.name}
                    size="sm"
                    className="mb-2"
                  />
                  <div className="text-sm">
                    <span className="font-bold hover:underline text-white">
                      {notif.sender.name}
                    </span>
                    {notif.sender.verified && (
                      <Badge
                        type={notif.sender.isGold ? 'gold' : 'blue'}
                        size="sm"
                        className="ml-1"
                      />
                    )}
                    <span className="text-neutral-400 ml-1.5">{label}</span>
                  </div>

                  {notif.postContent && (
                    <p className="text-xs text-neutral-400 mt-1 line-clamp-2 italic">
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

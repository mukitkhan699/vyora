import React, { useState, useEffect } from 'react';
import { Bookmark, Sparkles } from 'lucide-react';
import { Post } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { PostCard } from '../feed/PostCard.tsx';
import { PostSkeleton } from '../common/LoadingSkeleton.tsx';
import { EmptyState } from '../common/EmptyState.tsx';

interface BookmarksViewProps {
  onPostClick: (post: Post) => void;
  onReplyClick: (post: Post) => void;
  onUserClick: (username: string) => void;
  onTagClick: (tag: string) => void;
}

export const BookmarksView: React.FC<BookmarksViewProps> = ({
  onPostClick,
  onReplyClick,
  onUserClick,
  onTagClick,
}) => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const [bookmarks, setBookmarks] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBookmarks();
  }, []);

  const fetchBookmarks = async () => {
    setLoading(true);
    try {
      const data = await api.getBookmarks();
      setBookmarks(data);
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
    }
  };

  const headerBg =
    theme === 'dark'
      ? 'bg-[#090B10]/85 border-white/[0.08]'
      : theme === 'dim'
        ? 'bg-[#0F172A]/85 border-neutral-700'
        : 'bg-white/85 border-slate-200';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-xl border-b ${headerBg} px-4 py-3`}>
        <h1 className="text-lg font-black tracking-tight text-white">Bookmarks</h1>
        {currentUser && (
          <p className="text-xs text-neutral-400 font-mono">@{currentUser.username}</p>
        )}
      </div>

      {/* Bookmarks List */}
      <div className="divide-y divide-white/[0.06] flex-1">
        {loading ? (
          <div>
            <PostSkeleton />
            <PostSkeleton />
          </div>
        ) : bookmarks.length === 0 ? (
          <EmptyState
            icon={<Bookmark className="w-6 h-6 text-cyan-400" />}
            title="Save posts for later"
            description="Don't let the good ones fly away! Bookmark posts to easily find them again in the future."
          />
        ) : (
          bookmarks.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onPostClick={onPostClick}
              onReplyClick={onReplyClick}
              onUserClick={onUserClick}
              onTagClick={onTagClick}
              onDeletePost={(id) => {
                setBookmarks((prev) => prev.filter((p) => p.id !== id));
              }}
            />
          ))
        )}
      </div>
    </div>
  );
};

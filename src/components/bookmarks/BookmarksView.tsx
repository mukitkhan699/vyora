import React, { useState, useEffect } from 'react';
import { Bookmark, Sparkles } from 'lucide-react';
import { Post } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { PostCard } from '../feed/PostCard.tsx';

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

  const headerBg = theme === 'dark' ? 'bg-black/85 border-neutral-800' : theme === 'dim' ? 'bg-[#15202b]/85 border-neutral-700' : 'bg-white/85 border-neutral-200';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <div className={`sticky top-0 z-20 backdrop-blur-md border-b ${headerBg} px-4 py-3`}>
        <h1 className="text-xl font-bold">Bookmarks</h1>
        {currentUser && <p className="text-xs text-neutral-500">@{currentUser.username}</p>}
      </div>

      {/* Bookmarks List */}
      <div className="divide-y divide-neutral-800/60 flex-1">
        {loading ? (
          <div className="p-12 flex justify-center text-neutral-500">
            <svg className="animate-spin h-6 w-6 text-sky-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="p-12 text-center text-neutral-500 flex flex-col items-center gap-2">
            <Bookmark className="w-10 h-10 text-neutral-600 mb-1" />
            <h3 className="font-bold text-lg text-neutral-300">Save posts for later</h3>
            <p className="text-sm max-w-sm">
              Don't let the good ones fly away! Bookmark posts to easily find them again in the future.
            </p>
          </div>
        ) : (
          bookmarks.map(post => (
            <PostCard
              key={post.id}
              post={post}
              onPostClick={onPostClick}
              onReplyClick={onReplyClick}
              onUserClick={onUserClick}
              onTagClick={onTagClick}
            />
          ))
        )}
      </div>
    </div>
  );
};

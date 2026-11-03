import React, { useState } from 'react';
import { 
  Heart, 
  Repeat2, 
  MessageCircle, 
  Bookmark, 
  Share, 
  BarChart2, 
  MoreHorizontal, 
  Trash2, 
  Check, 
  ExternalLink 
} from 'lucide-react';
import { Post } from '../../types/index.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { CdnImage } from '../common/CdnImage.tsx';
import { api } from '../../services/api.ts';

interface PostCardProps {
  post: Post;
  onPostClick?: (post: Post) => void;
  onReplyClick?: (post: Post) => void;
  onUserClick?: (username: string) => void;
  onTagClick?: (tag: string) => void;
  onDeletePost?: (postId: string) => void;
}

export const PostCard: React.FC<PostCardProps> = ({
  post,
  onPostClick,
  onReplyClick,
  onUserClick,
  onTagClick,
  onDeletePost,
}) => {
  const { currentUser } = useAuth();
  const { theme, accentTextClass } = useTheme();

  const [isLiked, setIsLiked] = useState(post.isLiked ?? false);
  const [likesCount, setLikesCount] = useState(post.likesCount);
  const [isReposted, setIsReposted] = useState(post.isReposted ?? false);
  const [repostsCount, setRepostsCount] = useState(post.repostsCount);
  const [isBookmarked, setIsBookmarked] = useState(post.isBookmarked ?? false);
  const [poll, setPoll] = useState(post.poll);
  const [showOptions, setShowOptions] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  const isAuthor = currentUser?.id === post.authorId;

  // Format relative timestamp
  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const diffMs = Date.now() - date.getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 60) return `${diffSec}s`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m`;
      const diffHrs = Math.floor(diffMin / 60);
      if (diffHrs < 24) return `${diffHrs}h`;
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const nextLiked = !isLiked;
      setIsLiked(nextLiked);
      setLikesCount(prev => nextLiked ? prev + 1 : Math.max(0, prev - 1));
      const res = await api.toggleLike(post.id);
      setIsLiked(res.isLiked);
      setLikesCount(res.likesCount);
    } catch (err) {
      console.warn('Like toggle failed:', err);
    }
  };

  const handleRepost = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const nextReposted = !isReposted;
      setIsReposted(nextReposted);
      setRepostsCount(prev => nextReposted ? prev + 1 : Math.max(0, prev - 1));
      const res = await api.toggleRepost(post.id);
      setIsReposted(res.isReposted);
      setRepostsCount(res.repostsCount);
    } catch (err) {
      console.warn('Repost toggle failed:', err);
    }
  };

  const handleBookmark = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setIsBookmarked(!isBookmarked);
      const res = await api.toggleBookmark(post.id);
      setIsBookmarked(res.isBookmarked);
    } catch (err) {
      console.warn('Bookmark toggle failed:', err);
    }
  };

  const handleVotePoll = async (e: React.MouseEvent, optionIndex: number) => {
    e.stopPropagation();
    if (!poll || poll.userVotedIndex !== undefined) return;
    try {
      const updated = await api.votePoll(post.id, optionIndex);
      if (updated.poll) setPoll(updated.poll);
    } catch (err) {
      console.warn('Poll voting failed:', err);
    }
  };

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(window.location.origin + `?post=${post.id}`);
    setCopiedToast(true);
    setShowOptions(false);
    setTimeout(() => setCopiedToast(false), 2000);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this post?')) {
      try {
        await api.deletePost(post.id);
        if (onDeletePost) onDeletePost(post.id);
      } catch (err) {
        alert('Failed to delete post');
      }
    }
  };

  // Render text with clickable #hashtags and @mentions
  const renderFormattedContent = (text: string) => {
    const tokens = text.split(/(\s+)/);
    return tokens.map((part, index) => {
      if (part.startsWith('#') && part.length > 1) {
        return (
          <span
            key={index}
            onClick={(e) => {
              e.stopPropagation();
              onTagClick?.(part);
            }}
            className={`${accentTextClass} hover:underline cursor-pointer font-semibold`}
          >
            {part}
          </span>
        );
      }
      if (part.startsWith('@') && part.length > 1) {
        return (
          <span
            key={index}
            onClick={(e) => {
              e.stopPropagation();
              onUserClick?.(part.slice(1));
            }}
            className={`${accentTextClass} hover:underline cursor-pointer font-semibold`}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const hoverBg = theme === 'light' ? 'hover:bg-slate-50' : 'hover:bg-cyan-500/[0.03]';
  const borderCol = theme === 'light' ? 'border-slate-200' : 'border-white/[0.06]';

  return (
    <article
      onClick={() => onPostClick?.(post)}
      className={`p-4 border-b ${borderCol} ${hoverBg} transition-colors cursor-pointer relative select-none`}
    >
      {/* Toast Feedback */}
      {copiedToast && (
        <div className="absolute top-2 right-4 bg-sky-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg z-20 flex items-center gap-1.5 animate-bounce">
          <Check className="w-3.5 h-3.5" />
          <span>Link copied to clipboard</span>
        </div>
      )}

      <div className="flex gap-3">
        {/* Author Avatar */}
        <Avatar
          src={post.author.avatarUrl}
          name={post.author.name}
          size="md"
          onClick={() => onUserClick?.(post.author.username)}
        />

        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5 truncate text-sm">
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onUserClick?.(post.author.username);
                }}
                className="font-bold hover:underline truncate cursor-pointer text-white"
              >
                {post.author.name}
              </span>
              {post.author.verified && (
                <Badge type={post.author.isGold ? 'gold' : 'blue'} size="sm" />
              )}
              <span className="text-neutral-500 truncate">@{post.author.username}</span>
              <span className="text-neutral-500">·</span>
              <span className="text-neutral-500 hover:underline shrink-0 text-xs">
                {formatTime(post.createdAt)}
              </span>
            </div>

            {/* Options menu */}
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowOptions(!showOptions);
                }}
                className="p-1.5 text-neutral-500 hover:text-sky-400 hover:bg-sky-500/10 rounded-full transition-colors cursor-pointer"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>

              {showOptions && (
                <div
                  className={`absolute right-0 top-full mt-1 w-48 ${
                    theme === 'dark' ? 'bg-black border-neutral-800' : 'bg-neutral-900 border-neutral-700'
                  } border rounded-2xl shadow-xl py-1.5 z-30`}
                >
                  <button
                    onClick={handleCopyLink}
                    className="w-full px-4 py-2 text-left text-xs text-neutral-300 hover:bg-neutral-800 flex items-center gap-2 cursor-pointer"
                  >
                    <Share className="w-3.5 h-3.5" /> Copy link to post
                  </button>
                  {isAuthor && (
                    <button
                      onClick={handleDelete}
                      className="w-full px-4 py-2 text-left text-xs text-red-400 hover:bg-neutral-800 flex items-center gap-2 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete post
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Replying indicator */}
          {post.replyToAuthor && (
            <div className="text-xs text-neutral-500 mb-1.5">
              Replying to <span className={accentTextClass}>@{post.replyToAuthor}</span>
            </div>
          )}

          {/* Post Text Content */}
          <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words text-neutral-200 mb-3">
            {renderFormattedContent(post.content)}
          </div>

          {/* Attached Media Grid with multi-CDN resolution */}
          {post.mediaUrls && post.mediaUrls.filter(u => u && u.trim()).length > 0 && (
            <div className={`grid gap-2 mb-3 rounded-2xl overflow-hidden border border-neutral-800/80 ${
              post.mediaUrls.filter(u => u && u.trim()).length === 1 ? 'grid-cols-1 max-h-96' : 'grid-cols-2 max-h-80'
            }`}>
              {post.mediaUrls.filter(u => u && u.trim()).map((url, i) => (
                <div key={i} className="relative overflow-hidden bg-neutral-900/60 max-h-80 flex items-center justify-center">
                  <CdnImage
                    src={url}
                    alt="Post media"
                    className="w-full h-full object-cover hover:scale-101 transition-transform duration-200"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Poll Component */}
          {poll && (
            <div className="my-3 p-3.5 bg-neutral-900/40 border border-neutral-800 rounded-2xl flex flex-col gap-2">
              {poll.options.map((opt, idx) => {
                const hasVoted = poll.userVotedIndex !== undefined;
                const percentage = poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
                const isSelected = poll.userVotedIndex === idx;

                return (
                  <div
                    key={opt.id}
                    onClick={(e) => !hasVoted && handleVotePoll(e, idx)}
                    className={`relative overflow-hidden rounded-xl border p-2.5 transition-all select-none ${
                      hasVoted
                        ? 'border-neutral-800 cursor-default'
                        : 'border-neutral-700 hover:border-sky-500 hover:bg-sky-500/5 cursor-pointer'
                    }`}
                  >
                    {/* Percentage Progress Bar */}
                    {hasVoted && (
                      <div
                        className={`absolute inset-y-0 left-0 ${
                          isSelected ? 'bg-sky-500/25' : 'bg-neutral-800/60'
                        } transition-all duration-500`}
                        style={{ width: `${percentage}%` }}
                      />
                    )}

                    <div className="relative flex items-center justify-between z-1 text-sm">
                      <span className={`font-medium ${isSelected ? 'font-bold text-sky-400' : 'text-neutral-200'}`}>
                        {opt.text}
                      </span>
                      {hasVoted && (
                        <span className="font-bold text-xs text-neutral-400">
                          {percentage}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              <div className="text-xs text-neutral-500 mt-1 flex items-center justify-between">
                <span>{poll.totalVotes.toLocaleString()} votes</span>
                <span>Poll active</span>
              </div>
            </div>
          )}

          {/* Quoted Post Embed */}
          {post.quotePost && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                onPostClick?.(post.quotePost!);
              }}
              className="my-3 p-3 border border-neutral-800 rounded-2xl hover:bg-white/[0.02] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Avatar src={post.quotePost.author.avatarUrl} name={post.quotePost.author.name} size="xs" />
                <span className="font-bold text-xs">{post.quotePost.author.name}</span>
                <span className="text-neutral-500 text-xs">@{post.quotePost.author.username}</span>
              </div>
              <p className="text-xs text-neutral-300 line-clamp-3">{post.quotePost.content}</p>
            </div>
          )}

          {/* Actions Bar */}
          <div className="flex items-center justify-between text-neutral-500 text-xs mt-2 -ml-2 max-w-md">
            {/* Reply */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (onReplyClick) onReplyClick(post);
              }}
              className="flex items-center gap-1.5 p-2 rounded-full hover:text-sky-400 hover:bg-sky-500/10 transition-colors group cursor-pointer"
            >
              <MessageCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span>{post.repliesCount || ''}</span>
            </button>

            {/* Repost */}
            <button
              type="button"
              onClick={handleRepost}
              className={`flex items-center gap-1.5 p-2 rounded-full hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors group cursor-pointer ${
                isReposted ? 'text-emerald-400' : ''
              }`}
            >
              <Repeat2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
              <span>{repostsCount || ''}</span>
            </button>

            {/* Like */}
            <button
              type="button"
              onClick={handleLike}
              className={`flex items-center gap-1.5 p-2 rounded-full hover:text-pink-500 hover:bg-pink-500/10 transition-colors group cursor-pointer ${
                isLiked ? 'text-pink-500 font-bold' : ''
              }`}
            >
              <Heart className={`w-4 h-4 group-hover:scale-120 transition-transform ${isLiked ? 'fill-current' : ''}`} />
              <span>{likesCount || ''}</span>
            </button>

            {/* Views */}
            <div className="flex items-center gap-1.5 p-2 text-neutral-500">
              <BarChart2 className="w-4 h-4" />
              <span>{post.viewsCount.toLocaleString()}</span>
            </div>

            {/* Bookmark & Share */}
            <div className="flex items-center">
              <button
                type="button"
                onClick={handleBookmark}
                className={`p-2 rounded-full hover:text-sky-400 hover:bg-sky-500/10 transition-colors group cursor-pointer ${
                  isBookmarked ? 'text-sky-400' : ''
                }`}
              >
                <Bookmark className={`w-4 h-4 group-hover:scale-110 transition-transform ${isBookmarked ? 'fill-current' : ''}`} />
              </button>

              <button
                type="button"
                onClick={handleCopyLink}
                className="p-2 rounded-full hover:text-sky-400 hover:bg-sky-500/10 transition-colors group cursor-pointer"
              >
                <Share className="w-4 h-4 group-hover:scale-110 transition-transform" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};

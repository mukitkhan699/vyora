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
  Link as LinkIcon
} from 'lucide-react';
import { Post } from '../../types/index.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { Badge } from '../common/Badge.tsx';
import { CdnImage } from '../common/CdnImage.tsx';
import { DropdownMenu } from '../common/DropdownMenu.tsx';
import { ConfirmationDialog } from '../common/ConfirmationDialog.tsx';
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
  const [copiedToast, setCopiedToast] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isAuthor = currentUser?.id === post.authorId;

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
      setLikesCount(prev => (nextLiked ? prev + 1 : Math.max(0, prev - 1)));
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
      setRepostsCount(prev => (nextReposted ? prev + 1 : Math.max(0, prev - 1)));
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

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.origin + `?post=${post.id}`);
    setCopiedToast(true);
    setTimeout(() => setCopiedToast(false), 2200);
  };

  const handleConfirmDelete = async () => {
    try {
      setIsDeleting(true);
      await api.deletePost(post.id);
      setIsDeleteDialogOpen(false);
      if (onDeletePost) onDeletePost(post.id);
    } catch (err) {
      alert('Failed to delete post');
    } finally {
      setIsDeleting(false);
    }
  };

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
            className={`${accentTextClass} hover:underline cursor-pointer font-medium`}
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
            className={`${accentTextClass} hover:underline cursor-pointer font-medium`}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const hoverBg = theme === 'light' ? 'hover:bg-slate-50' : 'hover:bg-white/[0.02]';
  const borderCol = theme === 'light' ? 'border-slate-200' : 'border-white/[0.06]';

  const dropdownItems = [
    {
      id: 'copy',
      label: 'Copy link to post',
      icon: <LinkIcon className="w-3.5 h-3.5" />,
      onClick: handleCopyLink,
    },
    ...(isAuthor
      ? [
          {
            id: 'delete',
            label: 'Delete post',
            icon: <Trash2 className="w-3.5 h-3.5" />,
            danger: true,
            onClick: () => setIsDeleteDialogOpen(true),
          },
        ]
      : []),
  ];

  return (
    <>
      <article
        onClick={() => onPostClick?.(post)}
        className={`p-4 border-b ${borderCol} ${hoverBg} transition-colors cursor-pointer relative select-none`}
      >
        {copiedToast && (
          <div className="absolute top-3 right-4 bg-cyan-500 text-black font-bold text-xs px-3 py-1.5 rounded-full shadow-lg z-20 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
            <Check className="w-3.5 h-3.5" />
            <span>Link copied to clipboard</span>
          </div>
        )}

        <div className="flex gap-3">
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
                <span className="text-neutral-500 truncate font-mono text-xs">
                  @{post.author.username}
                </span>
                <span className="text-neutral-500">·</span>
                <span className="text-neutral-500 hover:underline shrink-0 text-xs">
                  {formatTime(post.createdAt)}
                </span>
              </div>

              {/* Options menu */}
              <div onClick={(e) => e.stopPropagation()}>
                <DropdownMenu
                  trigger={
                    <button
                      type="button"
                      aria-label="More options"
                      className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded-full transition-colors cursor-pointer"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  }
                  items={dropdownItems}
                />
              </div>
            </div>

            {/* Replying indicator */}
            {post.replyToAuthor && (
              <div className="text-xs text-neutral-500 mb-1.5">
                Replying to <span className={accentTextClass}>@{post.replyToAuthor}</span>
              </div>
            )}

            {/* Post Text Content */}
            <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words text-neutral-100 mb-2.5 font-normal">
              {renderFormattedContent(post.content)}
            </div>

            {/* Attached Media Grid */}
            {post.mediaUrls && post.mediaUrls.filter((u) => u && u.trim()).length > 0 && (
              <div
                className={`grid gap-2 mb-3 rounded-2xl overflow-hidden border border-white/10 ${
                  post.mediaUrls.filter((u) => u && u.trim()).length === 1
                    ? 'grid-cols-1 max-h-96'
                    : 'grid-cols-2 max-h-80'
                }`}
              >
                {post.mediaUrls
                  .filter((u) => u && u.trim())
                  .map((url, i) => (
                    <div
                      key={i}
                      className="relative overflow-hidden bg-neutral-900/60 max-h-80 flex items-center justify-center"
                    >
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
              <div className="my-3 p-3.5 bg-white/[0.02] border border-white/10 rounded-2xl flex flex-col gap-2">
                {poll.options.map((opt, idx) => {
                  const hasVoted = poll.userVotedIndex !== undefined;
                  const percentage =
                    poll.totalVotes > 0 ? Math.round((opt.votes / poll.totalVotes) * 100) : 0;
                  const isSelected = poll.userVotedIndex === idx;

                  return (
                    <div
                      key={opt.id}
                      onClick={(e) => !hasVoted && handleVotePoll(e, idx)}
                      className={`relative overflow-hidden rounded-xl border p-2.5 transition-all select-none ${
                        hasVoted
                          ? 'border-white/[0.08] cursor-default'
                          : 'border-white/15 hover:border-cyan-400 hover:bg-cyan-400/[0.05] cursor-pointer'
                      }`}
                    >
                      {hasVoted && (
                        <div
                          className={`absolute inset-y-0 left-0 ${
                            isSelected ? 'bg-cyan-500/25' : 'bg-white/[0.06]'
                          } transition-all duration-500`}
                          style={{ width: `${percentage}%` }}
                        />
                      )}

                      <div className="relative flex items-center justify-between z-1 text-sm">
                        <span
                          className={`font-medium ${
                            isSelected ? 'font-bold text-cyan-300' : 'text-neutral-200'
                          }`}
                        >
                          {opt.text}
                        </span>
                        {hasVoted && (
                          <span className="font-bold text-xs text-neutral-400 font-mono">
                            {percentage}%
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="text-xs text-neutral-400 mt-1 flex items-center justify-between font-mono">
                  <span>{poll.totalVotes.toLocaleString()} votes</span>
                  <span>Active poll</span>
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
                className="my-3 p-3 border border-white/10 rounded-2xl hover:bg-white/[0.03] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Avatar
                    src={post.quotePost.author.avatarUrl}
                    name={post.quotePost.author.name}
                    size="xs"
                  />
                  <span className="font-bold text-xs">{post.quotePost.author.name}</span>
                  <span className="text-neutral-500 text-xs">
                    @{post.quotePost.author.username}
                  </span>
                </div>
                <p className="text-xs text-neutral-300 line-clamp-3">{post.quotePost.content}</p>
              </div>
            )}

            {/* Actions Bar */}
            <div className="flex items-center justify-between text-neutral-400 text-xs mt-2 -ml-2 max-w-md">
              {/* Reply */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onReplyClick) onReplyClick(post);
                }}
                className="flex items-center gap-1.5 p-2 rounded-full hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors group cursor-pointer"
                title="Reply"
              >
                <MessageCircle className="w-4 h-4 group-hover:scale-110 transition-transform" />
                <span>{post.repliesCount || ''}</span>
              </button>

              {/* Repost */}
              <button
                type="button"
                onClick={handleRepost}
                className={`flex items-center gap-1.5 p-2 rounded-full hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors group cursor-pointer ${
                  isReposted ? 'text-emerald-400 font-bold' : ''
                }`}
                title="Repost"
              >
                <Repeat2 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                <span>{repostsCount || ''}</span>
              </button>

              {/* Like */}
              <button
                type="button"
                onClick={handleLike}
                className={`flex items-center gap-1.5 p-2 rounded-full hover:text-rose-500 hover:bg-rose-500/10 transition-colors group cursor-pointer ${
                  isLiked ? 'text-rose-500 font-bold' : ''
                }`}
                title="Like"
              >
                <Heart
                  className={`w-4 h-4 group-hover:scale-110 transition-transform ${
                    isLiked ? 'fill-current' : ''
                  }`}
                />
                <span>{likesCount || ''}</span>
              </button>

              {/* Views */}
              <div className="flex items-center gap-1.5 p-2 text-neutral-500">
                <BarChart2 className="w-4 h-4" />
                <span className="font-mono text-[11px]">{post.viewsCount.toLocaleString()}</span>
              </div>

              {/* Bookmark & Share */}
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={handleBookmark}
                  className={`p-2 rounded-full hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors group cursor-pointer ${
                    isBookmarked ? 'text-cyan-400' : ''
                  }`}
                  title="Bookmark"
                >
                  <Bookmark
                    className={`w-4 h-4 group-hover:scale-110 transition-transform ${
                      isBookmarked ? 'fill-current' : ''
                    }`}
                  />
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyLink();
                  }}
                  className="p-2 rounded-full hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors group cursor-pointer"
                  title="Share link"
                >
                  <Share className="w-4 h-4 group-hover:scale-110 transition-transform" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </article>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
        title="Delete Post?"
        description="This can’t be undone and it will be removed from your profile, the timeline of any accounts that follow you, and from search results."
        confirmLabel="Delete"
        isDestructive={true}
        isLoading={isDeleting}
      />
    </>
  );
};

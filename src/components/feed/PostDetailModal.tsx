import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Post } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { PostCard } from './PostCard.tsx';
import { PostComposer } from './PostComposer.tsx';
import { Modal } from '../common/Modal.tsx';
import { PostSkeleton } from '../common/LoadingSkeleton.tsx';

interface PostDetailModalProps {
  postId: string | null;
  onClose: () => void;
  onUserClick?: (username: string) => void;
  onTagClick?: (tag: string) => void;
}

export const PostDetailModal: React.FC<PostDetailModalProps> = ({
  postId,
  onClose,
  onUserClick,
  onTagClick,
}) => {
  const [post, setPost] = useState<Post | null>(null);
  const [replies, setReplies] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!postId) {
      setPost(null);
      setReplies([]);
      return;
    }

    setLoading(true);
    api.getPostById(postId)
      .then((data) => {
        setPost(data.post);
        setReplies(data.replies || []);
      })
      .catch((err) => {
        console.warn('Failed to fetch post detail:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [postId]);

  if (!postId) return null;

  const handleReplyCreated = (newReply: Post) => {
    setReplies(prev => [...prev, newReply]);
    if (post) {
      setPost({
        ...post,
        repliesCount: (post.repliesCount || 0) + 1,
      });
    }
  };

  return (
    <Modal isOpen={Boolean(postId)} onClose={onClose} title="Post" maxWidth="max-w-2xl">
      <div className="flex flex-col -mx-5 -my-5">
        {loading ? (
          <div className="p-4">
            <PostSkeleton />
            <PostSkeleton />
          </div>
        ) : !post ? (
          <div className="p-12 text-center text-neutral-400">
            <h3 className="font-bold text-lg mb-1">Post not found</h3>
            <p className="text-sm">This post may have been deleted or is unavailable.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {/* Main Parent Post */}
            <PostCard
              post={post}
              onUserClick={onUserClick}
              onTagClick={onTagClick}
              onDeletePost={() => {
                onClose();
              }}
            />

            {/* Inline Reply Composer */}
            <div className="bg-white/[0.01]">
              <PostComposer
                replyToId={post.id}
                placeholder="Post your reply..."
                onPostCreated={handleReplyCreated}
              />
            </div>

            {/* Replies Thread */}
            {replies.length > 0 && (
              <div className="divide-y divide-white/[0.06]">
                {replies.map((reply) => (
                  <PostCard
                    key={reply.id}
                    post={reply}
                    onUserClick={onUserClick}
                    onTagClick={onTagClick}
                    onDeletePost={(deletedId) => {
                      setReplies(prev => prev.filter(r => r.id !== deletedId));
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Post } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { PostCard } from './PostCard.tsx';
import { PostComposer } from './PostComposer.tsx';
import { Modal } from '../common/Modal.tsx';
import { PostSkeleton } from '../common/LoadingSkeleton.tsx';
import { useApiQuery } from '../../hooks/useApiQuery.ts';

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
  const postQuery = useApiQuery<{ post: Post; replies: Post[] }>(
    `/posts/${postId ?? ''}`,
    () => postId ? api.getPostById(postId) : Promise.reject(new Error('A post ID is required.')),
    Boolean(postId),
  );
  const post = postQuery.data?.post ?? null;
  const replies = postQuery.data?.replies ?? [];
  const loading = Boolean(postId) && postQuery.isLoading;

  if (!postId) return null;

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

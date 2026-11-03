import React, { useState, useEffect } from 'react';
import { Post } from '../../types/index.ts';
import { api } from '../../services/api.ts';
import { Modal } from '../common/Modal.tsx';
import { PostCard } from './PostCard.tsx';
import { PostComposer } from './PostComposer.tsx';

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
    if (!postId) return;
    setLoading(true);
    api.getPostById(postId)
      .then((data) => {
        setPost(data.post);
        setReplies(data.replies);
      })
      .catch(console.warn)
      .finally(() => setLoading(false));
  }, [postId]);

  const handleReplyCreated = (newReply: Post) => {
    setReplies(prev => [...prev, newReply]);
    if (post) {
      setPost({ ...post, repliesCount: post.repliesCount + 1 });
    }
  };

  if (!postId) return null;

  return (
    <Modal isOpen={Boolean(postId)} onClose={onClose} title="Post Thread" maxWidth="max-w-2xl">
      {loading ? (
        <div className="p-8 flex justify-center text-neutral-500">
          <svg className="animate-spin h-6 w-6 text-sky-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : post ? (
        <div className="flex flex-col">
          {/* Main post */}
          <PostCard
            post={post}
            onUserClick={onUserClick}
            onTagClick={onTagClick}
          />

          {/* Reply composer */}
          <div className="border-b border-neutral-800">
            <PostComposer
              placeholder="Post your reply..."
              replyToId={post.id}
              onPostCreated={handleReplyCreated}
            />
          </div>

          {/* Replies thread */}
          <div className="divide-y divide-neutral-800/60">
            {replies.length === 0 ? (
              <div className="p-6 text-center text-sm text-neutral-500">
                No replies yet. Be the first to reply!
              </div>
            ) : (
              replies.map(rep => (
                <PostCard
                  key={rep.id}
                  post={rep}
                  onUserClick={onUserClick}
                  onTagClick={onTagClick}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="p-8 text-center text-neutral-400">Post not found</div>
      )}
    </Modal>
  );
};

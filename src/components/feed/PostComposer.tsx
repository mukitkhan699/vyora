import React, { useState, useRef, useEffect } from 'react';
import { 
  Image as ImageIcon,
  BarChart2, 
  Smile, 
  Globe, 
  X, 
  Plus, 
  Trash2, 
  Sparkles,
  UploadCloud
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { CdnImage } from '../common/CdnImage.tsx';
import { Button } from '../common/Button.tsx';
import { api } from '../../services/api.ts';
import { Post } from '../../types/index.ts';

interface PostComposerProps {
  placeholder?: string;
  replyToId?: string;
  quotePostId?: string;
  onPostCreated?: (newPost: Post) => void;
  onClose?: () => void;
  isModal?: boolean;
}

export const PostComposer: React.FC<PostComposerProps> = ({
  placeholder = "What is happening?",
  replyToId,
  quotePostId,
  onPostCreated,
  onClose,
  isModal = false,
}) => {
  const { currentUser, appConfig } = useAuth();
  const { theme, accentTextClass, accentBgClass } = useTheme();

  const [content, setContent] = useState('');
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [showPoll, setShowPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [showMediaPrompt, setShowMediaPrompt] = useState(false);
  const [mediaUrlInput, setMediaUrlInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [backendMediaPresets, setBackendMediaPresets] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxLength = appConfig?.maxPostLength || 280;

  useEffect(() => {
    api.getMediaCatalog().then(catalog => {
      if (catalog.attachments && catalog.attachments.length > 0) {
        setBackendMediaPresets(catalog.attachments);
      }
    }).catch(() => {
      // Backend handles fallback
    });
  }, []);

  const charactersLeft = maxLength - content.length;
  const isOverLimit = charactersLeft < 0;
  const isCloseToLimit = charactersLeft <= 20 && !isOverLimit;

  const progressPercent = Math.min(100, Math.max(0, (content.length / maxLength) * 100));
  const strokeDashoffset = 100 - progressPercent;

  const handleAddMediaUrl = () => {
    if (mediaUrlInput.trim()) {
      setMediaUrls(prev => [...prev, mediaUrlInput.trim()]);
      setMediaUrlInput('');
      setShowMediaPrompt(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const res = await api.uploadFile(file, 'post-image');
      setMediaUrls(prev => [...prev, res.url]);
      setShowMediaPrompt(false);
    } catch (err: any) {
      alert(err.message || 'File upload failed');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddPollOption = () => {
    if (pollOptions.length < 4) {
      setPollOptions(prev => [...prev, '']);
    }
  };

  const handlePollOptionChange = (idx: number, val: string) => {
    setPollOptions(prev => {
      const copy = [...prev];
      copy[idx] = val;
      return copy;
    });
  };

  const handleRemovePollOption = (idx: number) => {
    if (pollOptions.length > 2) {
      setPollOptions(prev => prev.filter((_, i) => i !== idx));
    }
  };

  const handleSubmit = async () => {
    if ((!content.trim() && mediaUrls.length === 0) || isOverLimit || isSubmitting) return;

    try {
      setIsSubmitting(true);
      const filteredPollOptions = showPoll 
        ? pollOptions.map(p => p.trim()).filter(Boolean)
        : undefined;

      const newPost = await api.createPost({
        content: content.trim(),
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined,
        pollOptions: filteredPollOptions && filteredPollOptions.length >= 2 ? filteredPollOptions : undefined,
        replyToId,
        quotePostId,
      });

      setContent('');
      setMediaUrls([]);
      setShowPoll(false);
      setPollOptions(['', '']);

      if (onPostCreated) onPostCreated(newPost);
      if (onClose) onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to publish post');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!currentUser) return null;

  return (
    <div className={`p-4 flex gap-3.5 ${!isModal ? 'border-b border-white/[0.08]' : ''}`}>
      <Avatar src={currentUser.avatarUrl} name={currentUser.name} size="md" />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Reply indicator */}
        {replyToId && (
          <div className="text-xs text-neutral-400 mb-2 font-mono">
            Replying to <span className={accentTextClass}>thread</span>
          </div>
        )}

        {/* Text Area */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder}
          rows={isModal ? 4 : 3}
          className="w-full bg-transparent resize-none border-none outline-none text-base sm:text-lg placeholder:text-neutral-500 text-neutral-100 focus:ring-0 leading-relaxed font-normal"
        />

        {/* Media Attachments Preview */}
        {mediaUrls.length > 0 && (
          <div className={`grid gap-2 my-2.5 rounded-2xl overflow-hidden ${
            mediaUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
          }`}>
            {mediaUrls.map((url, index) => (
              <div key={index} className="relative group max-h-64 rounded-xl overflow-hidden bg-neutral-900 border border-white/10">
                {url && <CdnImage src={url} alt="Attached media" className="w-full h-full object-cover" />}
                <button
                  type="button"
                  onClick={() => setMediaUrls(prev => prev.filter((_, i) => i !== index))}
                  className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-1.5 rounded-full transition-colors cursor-pointer"
                  title="Remove attachment"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Media Upload & URL Drawer */}
        {showMediaPrompt && (
          <div className="p-3.5 my-2 bg-[#121722] border border-white/10 rounded-2xl flex flex-col gap-2.5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-200 font-semibold">Attach media</span>
              <button
                type="button"
                onClick={() => setShowMediaPrompt(false)}
                className="text-neutral-400 hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                icon={<UploadCloud className="w-3.5 h-3.5 text-cyan-400" />}
              >
                {isUploading ? 'Uploading...' : 'Upload Image'}
              </Button>
              <span className="text-[11px] text-neutral-400">Direct upload or paste a link below</span>
            </div>

            <div className="flex gap-2 mt-1">
              <input
                type="url"
                value={mediaUrlInput}
                onChange={(e) => setMediaUrlInput(e.target.value)}
                placeholder="https://images.unsplash.com/..."
                className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-400"
              />
              <Button size="sm" onClick={handleAddMediaUrl}>Add Link</Button>
            </div>

            {backendMediaPresets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-neutral-400">
                <span className="text-neutral-500 font-mono text-[10px] uppercase">Presets:</span>
                {backendMediaPresets.map((presetUrl, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setMediaUrls(prev => [...prev, presetUrl]);
                      setShowMediaPrompt(false);
                    }}
                    className="text-cyan-400 hover:underline cursor-pointer"
                  >
                    Preset {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Poll Builder Drawer */}
        {showPoll && (
          <div className="my-2.5 p-3.5 bg-[#121722] border border-white/10 rounded-2xl flex flex-col gap-2.5 animate-in fade-in duration-150">
            <div className="flex items-center justify-between text-xs text-neutral-400 font-medium">
              <span>Poll Options (2-4 choices)</span>
              <button
                type="button"
                onClick={() => setShowPoll(false)}
                className="hover:text-white text-xs cursor-pointer text-rose-400"
              >
                Remove poll
              </button>
            </div>
            {pollOptions.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={`Choice ${idx + 1}`}
                  value={opt}
                  maxLength={25}
                  onChange={(e) => handlePollOptionChange(idx, e.target.value)}
                  className="flex-1 bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs sm:text-sm text-white outline-none focus:border-cyan-400"
                />
                {pollOptions.length > 2 && (
                  <button
                    type="button"
                    onClick={() => handleRemovePollOption(idx)}
                    className="p-1.5 text-neutral-500 hover:text-rose-400 cursor-pointer"
                    title="Remove choice"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
            {pollOptions.length < 4 && (
              <button
                type="button"
                onClick={handleAddPollOption}
                className={`flex items-center gap-1.5 text-xs font-semibold py-1.5 px-3 rounded-xl hover:bg-white/[0.06] w-fit cursor-pointer ${accentTextClass}`}
              >
                <Plus className="w-3.5 h-3.5" /> Add choice
              </button>
            )}
          </div>
        )}

        {/* Emoji Quick Drawer */}
        {showEmojiPicker && (
          <div className="flex flex-wrap gap-2 p-2.5 my-2 bg-[#121722] border border-white/10 rounded-2xl animate-in fade-in duration-150">
            {['🚀', '⚡️', '🔥', '✨', '❤️', '🙌', '💯', '🦾', '🌍', '📈', '🎯', '💡', '🎉', '👏'].map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  setContent(prev => prev + emoji);
                  setShowEmojiPicker(false);
                }}
                className="text-lg hover:scale-125 transition-transform cursor-pointer p-1"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {/* Audience Indicator */}
        <div className="flex items-center gap-1.5 text-xs text-cyan-400 font-medium mb-3 border-b border-white/[0.06] pb-3">
          <Globe className="w-3.5 h-3.5" />
          <span>Everyone can reply</span>
        </div>

        {/* Toolbar & Submit Action */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-cyan-400">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setShowMediaPrompt(!showMediaPrompt)}
              className="p-2 rounded-xl hover:bg-cyan-400/10 transition-colors cursor-pointer"
              title="Add image"
            >
              <ImageIcon className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setShowPoll(!showPoll)}
              className="p-2 rounded-xl hover:bg-cyan-400/10 transition-colors cursor-pointer"
              title="Add poll"
            >
              <BarChart2 className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-2 rounded-xl hover:bg-cyan-400/10 transition-colors cursor-pointer"
              title="Add emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            {content.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="relative w-6 h-6 flex items-center justify-center">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      className="stroke-neutral-800"
                      strokeWidth="3"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      strokeWidth="3"
                      strokeDasharray="100"
                      strokeDashoffset={strokeDashoffset}
                      className={`transition-all duration-150 ${
                        isOverLimit
                          ? 'stroke-rose-500'
                          : isCloseToLimit
                          ? 'stroke-amber-400'
                          : 'stroke-cyan-400'
                      }`}
                    />
                  </svg>
                </div>
                {charactersLeft <= 20 && (
                  <span className={`text-xs font-mono font-semibold ${isOverLimit ? 'text-rose-500' : 'text-amber-400'}`}>
                    {charactersLeft}
                  </span>
                )}
              </div>
            )}

            <Button
              size="sm"
              disabled={(!content.trim() && mediaUrls.length === 0) || isOverLimit || isSubmitting}
              isLoading={isSubmitting}
              onClick={handleSubmit}
              className="px-5 font-bold"
            >
              Post
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

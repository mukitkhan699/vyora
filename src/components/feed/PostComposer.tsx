import React, { useState, useRef, useEffect } from 'react';
import { 
  Image, 
  BarChart2, 
  Smile, 
  Globe, 
  X, 
  Plus, 
  Trash2, 
  Sparkles,
  Link as LinkIcon 
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
  placeholder = "Broadcast a transmission to VYORA...",
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

  // Load backend-provided media presets dynamically on mount
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

  // Progress circle metrics
  const progressPercent = Math.min(100, Math.max(0, (content.length / maxLength) * 100));
  const strokeDashoffset = 100 - progressPercent;

  const handleAddMediaUrl = () => {
    if (mediaUrlInput.trim()) {
      setMediaUrls(prev => [...prev, mediaUrlInput.trim()]);
      setMediaUrlInput('');
      setShowMediaPrompt(false);
    }
  };

  // Upload file directly to backend file storage & receive backend-generated file URL
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const res = await api.uploadFile(file);
      // The backend provides the file URL (/api/files/...)
      setMediaUrls(prev => [...prev, res.url]);
      setShowMediaPrompt(false);
    } catch (err: any) {
      alert(err.message || 'File upload failed to backend');
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
    <div className={`p-4 flex gap-3.5 ${!isModal ? 'border-b border-neutral-800/80' : ''}`}>
      <Avatar src={currentUser.avatarUrl} name={currentUser.name} size="md" />

      <div className="flex-1 flex flex-col">
        {/* Reply indicator */}
        {replyToId && (
          <div className="text-xs text-neutral-500 mb-2">
            Replying to <span className={accentTextClass}>thread</span>
          </div>
        )}

        {/* Text Input */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={placeholder}
          rows={isModal ? 4 : 3}
          className="w-full bg-transparent resize-none border-none outline-none text-base sm:text-lg placeholder:text-neutral-500 text-neutral-100 focus:ring-0 leading-relaxed"
        />

        {/* Media Attachments Preview */}
        {mediaUrls.length > 0 && (
          <div className={`grid gap-2 my-2 rounded-2xl overflow-hidden ${
            mediaUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
          }`}>
            {mediaUrls.map((url, index) => (
              <div key={index} className="relative group max-h-60 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800">
                {url && <CdnImage src={url} alt="Attached media" className="w-full h-full object-cover" />}
                <button
                  type="button"
                  onClick={() => setMediaUrls(prev => prev.filter((_, i) => i !== index))}
                  className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-1.5 rounded-full transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Media Upload & URL Drawer */}
        {showMediaPrompt && (
          <div className="p-3.5 my-2 bg-neutral-900/90 border border-neutral-800 rounded-xl flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-neutral-300 font-semibold">Backend File Upload & Media:</span>
              <button
                type="button"
                onClick={() => setShowMediaPrompt(false)}
                className="text-neutral-500 hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>

            {/* Direct Upload to Backend */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-950/80 border border-cyan-800/60 text-cyan-300 text-xs font-medium hover:bg-cyan-900/80 cursor-pointer disabled:opacity-50"
              >
                <Image className="w-3.5 h-3.5" />
                {isUploading ? 'Uploading to backend...' : 'Upload Image to Backend'}
              </button>
              <span className="text-[11px] text-neutral-500">Stored & served by backend</span>
            </div>

            <div className="flex items-center gap-2 text-xs text-neutral-500 my-0.5">
              <span className="h-[1px] flex-1 bg-neutral-800" />
              <span>or enter image URL</span>
              <span className="h-[1px] flex-1 bg-neutral-800" />
            </div>

            <div className="flex gap-2">
              <input
                type="url"
                value={mediaUrlInput}
                onChange={(e) => setMediaUrlInput(e.target.value)}
                placeholder="https://..."
                className="flex-1 bg-black border border-neutral-700 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
              />
              <Button size="sm" onClick={handleAddMediaUrl}>Add</Button>
            </div>

            {/* Quick Sample Media Presets from Backend */}
            {backendMediaPresets.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px] text-neutral-400">
                <span className="text-neutral-500">Backend CDN Presets:</span>
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
                    Image {i + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}


        {/* Poll Builder Drawer */}
        {showPoll && (
          <div className="my-3 p-3 bg-neutral-900/60 border border-neutral-800 rounded-2xl flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-neutral-400 font-semibold">
              <span>Poll Options (2-4)</span>
              <button
                type="button"
                onClick={() => setShowPoll(false)}
                className="hover:text-white cursor-pointer"
              >
                Remove poll
              </button>
            </div>
            {pollOptions.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder={`Option ${idx + 1}`}
                  value={opt}
                  maxLength={25}
                  onChange={(e) => handlePollOptionChange(idx, e.target.value)}
                  className="flex-1 bg-black border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-sky-500"
                />
                {pollOptions.length > 2 && (
                  <button
                    type="button"
                    onClick={() => handleRemovePollOption(idx)}
                    className="p-2 text-neutral-500 hover:text-red-400 cursor-pointer"
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
                className={`flex items-center gap-1.5 text-xs font-semibold py-1.5 px-3 rounded-lg hover:bg-neutral-800/80 w-fit cursor-pointer ${accentTextClass}`}
              >
                <Plus className="w-3.5 h-3.5" /> Add option
              </button>
            )}
          </div>
        )}

        {/* Emoji Quick Drawer */}
        {showEmojiPicker && (
          <div className="flex flex-wrap gap-2 p-2 my-2 bg-neutral-900/90 border border-neutral-800 rounded-xl">
            {['🚀', '⚡️', '🔥', '💻', '✨', '❤️', '🙌', '💯', '🦾', '🌍', '📈', '🎯', '💡', '🎉'].map((emoji) => (
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
        <div className="flex items-center gap-1.5 text-xs text-sky-400 font-semibold mb-3 border-b border-neutral-800/60 pb-3 cursor-pointer hover:opacity-90">
          <Globe className="w-3.5 h-3.5" />
          <span>Everyone can reply</span>
        </div>

        {/* Toolbar & Submit Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-0.5 text-sky-400">
            {/* File Upload / CDN URL button */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept="image/*"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => setShowMediaPrompt(!showMediaPrompt)}
              className="p-2 rounded-full hover:bg-sky-500/10 transition-colors cursor-pointer"
              title="Add image via CDN link or upload"
            >
              <Image className="w-5 h-5" />
            </button>

            {/* Poll Toggle */}
            <button
              type="button"
              onClick={() => setShowPoll(!showPoll)}
              className="p-2 rounded-full hover:bg-sky-500/10 transition-colors cursor-pointer"
              title="Add poll"
            >
              <BarChart2 className="w-5 h-5" />
            </button>

            {/* Emoji Quick Selector */}
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-2 rounded-full hover:bg-sky-500/10 transition-colors cursor-pointer"
              title="Insert emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Circular character count indicator */}
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
                          ? 'stroke-red-500'
                          : isCloseToLimit
                          ? 'stroke-amber-400'
                          : 'stroke-sky-500'
                      }`}
                    />
                  </svg>
                </div>
                {charactersLeft <= 20 && (
                  <span className={`text-xs font-semibold ${isOverLimit ? 'text-red-500' : 'text-amber-400'}`}>
                    {charactersLeft}
                  </span>
                )}
              </div>
            )}

            {/* Transmit button */}
            <Button
              size="sm"
              disabled={(!content.trim() && mediaUrls.length === 0) || isOverLimit || isSubmitting}
              isLoading={isSubmitting}
              onClick={handleSubmit}
              className="px-5 font-bold tracking-wide"
            >
              Transmit
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

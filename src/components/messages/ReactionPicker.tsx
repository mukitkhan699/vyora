import React from 'react';

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const COMMON_EMOJIS = ['👍', '❤️', '🔥', '😂', '🎉', '😮', '😢', '👏'];

export const ReactionPicker: React.FC<ReactionPickerProps> = ({ onSelect, onClose }) => {
  return (
    <div className="absolute bottom-full mb-1 z-30 flex items-center gap-1 bg-[#181E2B] border border-white/10 rounded-full px-2 py-1 shadow-lg animate-in fade-in zoom-in-95">
      {COMMON_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            onSelect(emoji);
            onClose();
          }}
          className="hover:scale-125 transition-transform p-1 text-base cursor-pointer"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};

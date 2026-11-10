import React, { useEffect, useRef, useState } from 'react';

interface ReactionPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  align?: 'left' | 'right';
}

const COMMON_EMOJIS = ['👍', '❤️', '🔥', '😂', '🎉', '😮', '😢', '👏'];

export const ReactionPicker: React.FC<ReactionPickerProps> = ({ onSelect, onClose, align = 'left' }) => {
  const ref = useRef<HTMLDivElement>(null);
  const buttonsRef = useRef<HTMLButtonElement[]>([]);

  useEffect(() => {
    const handleOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  useEffect(() => {
    const firstButton = buttonsRef.current[0];
    firstButton?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const buttons = buttonsRef.current;
    if (buttons.length === 0) return;

    let nextIndex = index;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        nextIndex = index < buttons.length - 1 ? index + 1 : 0;
        break;
      case 'ArrowLeft':
        event.preventDefault();
        nextIndex = index > 0 ? index - 1 : buttons.length - 1;
        break;
      case 'Home':
        event.preventDefault();
        nextIndex = 0;
        break;
      case 'End':
        event.preventDefault();
        nextIndex = buttons.length - 1;
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        return;
      default:
        return;
    }

    buttons[nextIndex]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Choose a reaction"
      className={`absolute bottom-full mb-2 z-30 flex items-center gap-0.5 z-surface border z-border rounded-full px-1.5 py-1 z-shadow z-pop-enter ${
        align === 'right' ? 'right-0' : 'left-0'
      }`}
    >
      {COMMON_EMOJIS.map((emoji, index) => (
        <button
          key={emoji}
          ref={(el) => { buttonsRef.current[index] = el as HTMLButtonElement; }}
          type="button"
          role="menuitem"
          onClick={() => onSelect(emoji)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          aria-label={`React with ${emoji}`}
          className="hover:scale-125 active:scale-95 transition-transform p-1 text-base cursor-pointer rounded-full z-focus"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { CdnImage } from './CdnImage.tsx';

interface AvatarProps {
  src?: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  isOnline?: boolean;
  onClick?: () => void;
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-20 h-20 text-2xl',
  '2xl': 'w-28 h-28 sm:w-32 sm:h-32 text-4xl',
};

const DOT_SIZE_MAP = {
  xs: 'w-1.5 h-1.5',
  sm: 'w-2 h-2',
  md: 'w-2.5 h-2.5',
  lg: 'w-3 h-3',
  xl: 'w-4 h-4',
  '2xl': 'w-5 h-5',
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 'md',
  className = '',
  isOnline,
  onClick,
}) => {
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    setHasError(false);
  }, [src]);

  const sizeClasses = SIZE_MAP[size] || SIZE_MAP.md;
  const dotClasses = DOT_SIZE_MAP[size] || DOT_SIZE_MAP.md;

  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'U';

  const imageSrc = !hasError && src?.trim() ? src.trim() : null;

  return (
    <div
      onClick={onClick}
      className={`relative inline-block shrink-0 ${onClick ? 'cursor-pointer hover:opacity-90 active:scale-95 transition-all' : ''}`}
    >
      <div
        className={`${sizeClasses} rounded-full overflow-hidden bg-neutral-800 border border-white/10 flex items-center justify-center font-bold text-neutral-200 select-none ${className}`}
      >
        {imageSrc ? (
          <CdnImage
            src={imageSrc}
            alt={name}
            className="w-full h-full object-cover"
            onError={() => setHasError(true)}
          />
        ) : (
          <span>{initials}</span>
        )}
      </div>

      {isOnline !== undefined && (
        <span
          className={`absolute bottom-0 right-0 rounded-full ring-2 ring-[#090B10] ${dotClasses} ${
            isOnline ? 'bg-emerald-500' : 'bg-neutral-500'
          }`}
          title={isOnline ? 'Online' : 'Offline'}
        />
      )}
    </div>
  );
};

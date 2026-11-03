import React from 'react';
import { CdnImage } from './CdnImage.tsx';

interface AvatarProps {
  src?: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  className?: string;
  onClick?: () => void;
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-20 h-20 text-2xl',
  '2xl': 'w-32 h-32 text-4xl',
};

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 'md',
  className = '',
  onClick,
}) => {
  const sizeClasses = SIZE_MAP[size] || SIZE_MAP.md;
  const initials = name
    .split(' ')
    .map(p => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'U';

  const defaultAvatar = `https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80`;

  return (
    <div
      onClick={onClick}
      className={`relative shrink-0 rounded-full overflow-hidden bg-neutral-800 flex items-center justify-center font-bold text-neutral-300 select-none ${sizeClasses} ${
        onClick ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''
      } ${className}`}
    >
      {src && src.trim() ? (
        <CdnImage
          src={src.trim()}
          alt={name}
          className="w-full h-full object-cover rounded-full"
          fallbackSrc={defaultAvatar}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
};

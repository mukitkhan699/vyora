import React from 'react';
import { Users } from 'lucide-react';
import { CdnImage } from '../common/CdnImage.tsx';

interface GroupAvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_MAP = {
  sm: 'w-8 h-8 text-[11px]',
  md: 'w-10 h-10 text-xs',
  lg: 'w-12 h-12 text-sm',
  xl: 'w-20 h-20 text-xl',
};

export const GroupAvatar: React.FC<GroupAvatarProps> = ({ name, src, size = 'md', className = '' }) => {
  const initials =
    name
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'GP';

  return (
    <div
      className={`${SIZE_MAP[size]} ${className} relative rounded-2xl overflow-hidden border z-border flex items-center justify-center font-bold z-accent shrink-0`}
      style={{ backgroundColor: 'var(--z-accent-soft)' }}
      aria-hidden="true"
    >
      {src ? (
        <CdnImage src={src} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="flex items-center gap-0.5">
          {initials}
        </span>
      )}
      <span className="absolute bottom-0.5 right-0.5 opacity-70">
        <Users className="w-2.5 h-2.5" />
      </span>
    </div>
  );
};

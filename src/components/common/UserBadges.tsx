import React from 'react';
import { Badge } from './Badge.tsx';

interface UserBadgesProps {
  verified?: boolean;
  isGold?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export const UserBadges: React.FC<UserBadgesProps> = ({
  verified,
  isGold,
  size = 'sm',
  className = '',
}) => {
  if (!verified && !isGold) return null;

  return (
    <span className={`inline-flex items-center gap-1 shrink-0 ${className}`}>
      {verified && <Badge type="blue" size={size} />}
      {isGold && <Badge type="gold" size={size} />}
    </span>
  );
};

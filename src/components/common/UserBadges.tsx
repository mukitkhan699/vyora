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
  const badgeType = isGold ? 'gold' : verified ? 'blue' : null;

  if (!badgeType) return null;

  return (
    <span className={`inline-flex items-center align-middle shrink-0 ${className}`}>
      <Badge type={badgeType} size={size} />
    </span>
  );
};

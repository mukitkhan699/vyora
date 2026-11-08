import React from 'react';
import { VerificationBadge } from './VerificationBadge.tsx';

interface UserBadgesProps {
  verified?: boolean;
  isGold?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24,
} as const;

export const UserBadges: React.FC<UserBadgesProps> = ({
  verified,
  isGold,
  size = 'sm',
  className = '',
}) => {
  const badgeType = isGold ? 'gold' : verified ? 'verified' : null;

  if (!badgeType) return null;

  return (
    <span className={`inline-flex items-center align-middle shrink-0 ${className}`}>
      <VerificationBadge type={badgeType} size={sizeMap[size]} />
    </span>
  );
};

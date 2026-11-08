import React from 'react';
import { Badge } from './Badge.tsx';

interface VerificationBadgeProps {
  type: 'verified' | 'gold';
  size?: number;
  className?: string;
}

export const VerificationBadge: React.FC<VerificationBadgeProps> = ({
  type,
  size = 16,
  className = '',
}) => {
  const badgeSize = size <= 14 ? 'sm' : size <= 16 ? 'md' : 'lg';

  return (
    <Badge
      type={type === 'verified' ? 'blue' : 'gold'}
      size={badgeSize}
      className={className}
    />
  );
};

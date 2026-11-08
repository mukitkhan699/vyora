import React from 'react';
import verifiedBadge from '../../assets/badges/zunari-blue-badge.png';
import goldBadge from '../../assets/badges/zunari-gold-badge.png';

interface VerificationBadgeProps {
  type: 'verified' | 'gold';
  size?: number;
  className?: string;
}

export const VerificationBadge: React.FC<VerificationBadgeProps> = ({
  type,
  size = 20,
  className = '',
}) => {
  const isVerified = type === 'verified';

  return (
    <img
      src={isVerified ? verifiedBadge : goldBadge}
      alt={isVerified ? 'Verified account' : 'Gold membership'}
      width={size}
      height={size}
      draggable={false}
      className={`inline-block shrink-0 select-none object-contain align-middle ${className}`}
    />
  );
};

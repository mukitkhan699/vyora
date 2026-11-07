import React from 'react';

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
  const verifiedPath = (
    <path
      d="M32 3 40 8 49 7 53 16 61 23 57 32 61 41 53 48 49 57 40 56 32 61 24 56 15 57 11 48 3 41 7 32 3 23 11 16 15 7 24 8Z"
      fill={type === 'verified' ? '#2589F5' : '#D6A52C'}
    />
  );

  const checkmarkPath = (
    <path
      d="m19 32 9 9 18-19"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      width={size}
      height={size}
      className={className}
      aria-label={type === 'verified' ? 'Verified account' : 'Gold membership'}
    >
      {verifiedPath}
      {checkmarkPath}
    </svg>
  );
};
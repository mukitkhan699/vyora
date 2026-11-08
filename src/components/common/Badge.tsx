import React from 'react';
import { VerificationBadge } from './VerificationBadge.tsx';

interface BadgeProps {
  type?: 'blue' | 'gold' | 'cyan' | 'gray' | 'violet' | 'amber' | 'emerald' | 'rose';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  children?: React.ReactNode;
}

const sizeMap = {
  xs: 16,
  sm: 18,
  md: 20,
  lg: 24,
} as const;

export const Badge: React.FC<BadgeProps> = ({
  type = 'cyan',
  size = 'md',
  className = '',
  children,
}) => {
  const pixelSize = sizeMap[size];

  // Use VerificationBadge for verified (blue) and gold types
  if (type === 'blue' || type === 'gold') {
    const badge = (
      <VerificationBadge
        type={type === 'blue' ? 'verified' : 'gold'}
        size={sizeMap[size]}
        className={className}
      />
    );

    if (!children) return badge;

    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        {badge}
        {children}
      </span>
    );
  }

  const fillHex: Record<string, string> = {
    blue: '#1d9bf0',
    gold: '#e7a32b',
    cyan: '#00f2fe',
    gray: '#71767b',
    violet: '#a855f7',
    amber: '#f59e0b',
    emerald: '#10b981',
    rose: '#f43f5e',
  };

  // Verification checkmark path for other badge types
  const verificationPath = (
    <path
      fillRule="evenodd"
      d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1.25 14.5l-4.5-4.5 1.43-1.43 3.07 3.07 5.93-5.93 1.43 1.43-7.36 7.36z"
      clipRule="evenodd"
    />
  );

  // Gold star badge for other gold uses (if needed)
  const goldStarPath = (
    <path
      fillRule="evenodd"
      d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L8.82 14.27l-5-4.87L11.09 2L12 2.01z"
      clipRule="evenodd"
    />
  );

  // Other badge types with text label
  if (children) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <svg
          viewBox="0 0 24 24"
          aria-label="Badge"
          className={`w-4 h-4 shrink-0 inline-block align-middle`}
          style={{ fill: fillHex[type] || fillHex.cyan }}
        >
          {verificationPath}
        </svg>
        {children}
      </span>
    );
  }

  // Standalone badge icons
  return (
    <svg
      viewBox="0 0 24 24"
      aria-label={type === 'cyan' ? 'Verified account' : 'Badge'}
      className={`w-4 h-4 shrink-0 inline-block align-middle ${className}`}
      style={{ fill: fillHex[type] || fillHex.cyan }}
    >
      {verificationPath}
    </svg>
  );
};
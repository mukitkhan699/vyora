import React, { useId } from 'react';

interface VerificationBadgeProps {
  type: 'verified' | 'gold';
  size?: number;
  className?: string;
}

const BLUE_BADGE_PATH =
  'M50 2 C61 2 65 13 72 17 C81 12 94 18 94 29 C94 38 98 42 98 50 C98 61 87 65 83 72 C88 81 82 94 71 94 C62 94 58 98 50 98 C39 98 35 87 28 83 C19 88 6 82 6 71 C6 62 2 58 2 50 C2 39 13 35 17 28 C12 19 18 6 29 6 C38 6 42 2 50 2 Z';

const GOLD_BADGE_PATH =
  'M50 2 L62 16 L91 12 L94 39 L99 50 L94 61 L91 88 L62 84 L50 98 L38 84 L9 88 L6 61 L1 50 L6 39 L9 12 L38 16 Z';

const CHECKMARK_PATH = 'M40 72 L19 51 L28 42 L40 54 L70 24 L81 35 Z';

export const VerificationBadge: React.FC<VerificationBadgeProps> = ({
  type,
  size = 20,
  className = '',
}) => {
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const maskId = `badge-mask-${instanceId}`;
  const gradientId = `badge-gold-${instanceId}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      role="img"
      aria-label={type === 'verified' ? 'Verified account' : 'Gold membership'}
      shapeRendering="geometricPrecision"
    >
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="100"
          height="100"
        >
          <rect x="0" y="0" width="100" height="100" fill="white" />
          <path d={CHECKMARK_PATH} fill="black" />
        </mask>
        {type === 'gold' && (
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFE66B" />
            <stop offset="45%" stopColor="#F1C40F" />
            <stop offset="100%" stopColor="#D99500" />
          </linearGradient>
        )}
      </defs>

      <path
        d={type === 'verified' ? BLUE_BADGE_PATH : GOLD_BADGE_PATH}
        fill={type === 'verified' ? '#1DA1F2' : `url(#${gradientId})`}
        mask={`url(#${maskId})`}
      />
    </svg>
  );
};

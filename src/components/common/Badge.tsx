import React from 'react';

interface BadgeProps {
  type?: 'blue' | 'gold' | 'cyan' | 'gray' | 'violet' | 'amber' | 'emerald' | 'rose';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  children?: React.ReactNode;
}

const sizeClassMap = {
  xs: 'w-3.5 h-3.5',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
} as const;

const ORIGINAL_BADGE_PATH =
  'M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.79-4-4-4-.495 0-.965.084-1.4.238C14.55 2.475 13.18 1.6 11.6 1.6c-1.58 0-2.95.875-3.6 2.148-.435-.154-.905-.238-1.4-.238-2.21 0-4 1.79-4 4 0 .495.084.965.238 1.4C1.575 9.55.7 10.92.7 12.5c0 1.58.875 2.95 2.148 3.6-.154.435-.238.905-.238 1.4 0 2.21 1.79 4 4 4 .495 0 .965-.084 1.4-.238 1.05 1.273 2.42 2.148 4 2.148 1.58 0 2.95-.875 3.6-2.148.435.154.905.238 1.4.238 2.21 0 4-1.79 4-4 0-.495-.084-.965-.238-1.4 1.273-1.05 2.148-2.42 2.148-4zM10.2 16.5l-3.5-3.5 1.4-1.4 2.1 2.1 5.3-5.3 1.4 1.4-6.7 6.7z';

export const Badge: React.FC<BadgeProps> = ({
  type = 'cyan',
  size = 'md',
  className = '',
  children,
}) => {
  const sizeClass = sizeClassMap[size];

  if (type === 'blue' || type === 'gold') {
    const badge = (
      <svg
        viewBox="0 0 24 24"
        aria-label={type === 'gold' ? 'Verified organization' : 'Verified account'}
        className={
          type === 'gold'
            ? `${sizeClass} fill-[#e7a32b] shrink-0 inline-block align-middle ${className}`
            : `${sizeClass} shrink-0 inline-block align-middle ${className}`
        }
        style={type === 'blue' ? { fill: '#1d9bf0' } : undefined}
      >
        <path d={ORIGINAL_BADGE_PATH} />
      </svg>
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
    cyan: '#00f2fe',
    gray: '#71767b',
    violet: '#a855f7',
    amber: '#f59e0b',
    emerald: '#10b981',
    rose: '#f43f5e',
  };

  const verificationPath = (
    <path
      fillRule="evenodd"
      d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-1.25 14.5l-4.5-4.5 1.43-1.43 3.07 3.07 5.93-5.93 1.43 1.43-7.36 7.36z"
      clipRule="evenodd"
    />
  );

  if (children) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <svg
          viewBox="0 0 24 24"
          aria-label="Badge"
          className="w-4 h-4 shrink-0 inline-block align-middle"
          style={{ fill: fillHex[type] || fillHex.cyan }}
        >
          {verificationPath}
        </svg>
        {children}
      </span>
    );
  }

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

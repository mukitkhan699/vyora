import React from 'react';

interface BadgeProps {
  type?: 'blue' | 'gold' | 'cyan' | 'gray' | 'violet' | 'amber' | 'emerald' | 'rose';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  children?: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ type = 'cyan', size = 'md', className = '', children }) => {
  const sizeClass = size === 'xs' ? 'w-2.5 h-2.5' : size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';

  if (type === 'gold') {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <svg
          viewBox="0 0 24 24"
          aria-label="Verified organization"
          className={`${sizeClass} fill-[#e7a32b] shrink-0 inline-block align-middle`}
        >
          <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.79-4-4-4-.495 0-.965.084-1.4.238C14.55 2.475 13.18 1.6 11.6 1.6c-1.58 0-2.95.875-3.6 2.148-.435-.154-.905-.238-1.4-.238-2.21 0-4 1.79-4 4 0 .495.084.965.238 1.4C1.575 9.55.7 10.92.7 12.5c0 1.58.875 2.95 2.148 3.6-.154.435-.238.905-.238 1.4 0 2.21 1.79 4 4 4 .495 0 .965-.084 1.4-.238 1.05 1.273 2.42 2.148 4 2.148 1.58 0 2.95-.875 3.6-2.148.435.154.905.238 1.4.238 2.21 0-4 1.79-4-4 0-.495-.084-.965-.238-1.4 1.273-1.05 2.148-2.42 2.148-4zM10.2 16.5l-3.5-3.5 1.4-1.4 2.1 2.1 5.3-5.3 1.4 1.4-6.7 6.7z" />
        </svg>
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

  if (children) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <svg
          viewBox="0 0 24 24"
          aria-label="Verified account"
          className={`${sizeClass} shrink-0 inline-block align-middle`}
          style={{ fill: fillHex[type] || fillHex.cyan }}
        >
          <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.79-4-4-4-.495 0-.965.084-1.4.238C14.55 2.475 13.18 1.6 11.6 1.6c-1.58 0-2.95.875-3.6 2.148-.435-.154-.905-.238-1.4-.238-2.21 0-4 1.79-4 4 0 .495.084.965.238 1.4C1.575 9.55.7 10.92.7 12.5c0 1.58.875 2.95 2.148 3.6-.154.435-.238.905-.238 1.4 0 2.21 1.79 4 4 4 .495 0 .965-.084 1.4-.238 1.05 1.273 2.42 2.148 4 2.148 1.58 0 2.95-.875 3.6-2.148.435.154.905.238 1.4.238 2.21 0-4 1.79-4-4 0-.495-.084-.965-.238-1.4 1.273-1.05 2.148-2.42 2.148-4zM10.2 16.5l-3.5-3.5 1.4-1.4 2.1 2.1 5.3-5.3 1.4 1.4-6.7 6.7z" />
        </svg>
        {children}
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      aria-label="Verified account"
      className={`${sizeClass} shrink-0 inline-block align-middle ${className}`}
      style={{ fill: fillHex[type] || fillHex.cyan }}
    >
      <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.79-4-4-4-.495 0-.965.084-1.4.238C14.55 2.475 13.18 1.6 11.6 1.6c-1.58 0-2.95.875-3.6 2.148-.435-.154-.905-.238-1.4-.238-2.21 0-4 1.79-4 4 0 .495.084.965.238 1.4C1.575 9.55.7 10.92.7 12.5c0 1.58.875 2.95 2.148 3.6-.154.435-.238.905-.238 1.4 0 2.21 1.79 4 4 4 .495 0 .965-.084 1.4-.238 1.05 1.273 2.42 2.148 4 2.148 1.58 0 2.95-.875 3.6-2.148.435.154.905.238 1.4.238 2.21 0-4 1.79-4-4 0-.495-.084-.965-.238-1.4 1.273-1.05 2.148-2.42 2.148-4zM10.2 16.5l-3.5-3.5 1.4-1.4 2.1 2.1 5.3-5.3 1.4 1.4-6.7 6.7z" />
    </svg>
  );
};
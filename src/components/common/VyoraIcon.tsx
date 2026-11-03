import React from 'react';

interface VyoraIconProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  glow?: boolean;
}

export const VyoraIcon: React.FC<VyoraIconProps> = ({
  size = 'md',
  className = '',
  glow = true,
}) => {
  const sizeMap = {
    sm: 'w-6 h-6',
    md: 'w-8 h-8',
    lg: 'w-10 h-10',
    xl: 'w-14 h-14',
  };

  const dim = sizeMap[size] || sizeMap.md;

  return (
    <div className={`relative inline-flex items-center justify-center shrink-0 ${dim} ${className}`}>
      {glow && (
        <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-purple-600/30 via-cyan-400/25 to-pink-500/20 blur-md animate-pulse" />
      )}
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-[0_0_14px_rgba(121,40,202,0.45)]"
      >
        <defs>
          <linearGradient id="vyoraGradientPrimary" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7928ca" />
            <stop offset="50%" stopColor="#9d4edd" />
            <stop offset="100%" stopColor="#00f2fe" />
          </linearGradient>
          <linearGradient id="vyoraGradientSecondary" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#00f2fe" />
            <stop offset="60%" stopColor="#4facfe" />
            <stop offset="100%" stopColor="#ff0080" />
          </linearGradient>
          <linearGradient id="coreStarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#c4b5fd" />
          </linearGradient>
        </defs>

        {/* Left Wing Facet */}
        <path
          d="M3.5 4.5h5.5l7 18.5-3.5 4.5L3.5 4.5z"
          fill="url(#vyoraGradientPrimary)"
        />

        {/* Right Wing Facet */}
        <path
          d="M28.5 4.5h-5.5l-7 18.5 3.5 4.5 9-23z"
          fill="url(#vyoraGradientSecondary)"
          opacity="0.95"
        />

        {/* Upper V-Bridge Accent */}
        <path
          d="M9 4.5h14l-3 4H12l-3-4z"
          fill="#00f2fe"
          opacity="0.8"
        />

        {/* Central Prismatic Diamond Core */}
        <polygon
          points="16,11 18.8,15.5 16,20 13.2,15.5"
          fill="url(#coreStarGrad)"
        />
        <circle cx="16" cy="15.5" r="1.2" fill="#00f2fe" />
      </svg>
    </div>
  );
};

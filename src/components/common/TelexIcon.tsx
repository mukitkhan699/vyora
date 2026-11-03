import React from 'react';

interface TelexIconProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  glow?: boolean;
}

export const TelexIcon: React.FC<TelexIconProps> = ({
  size = 'md',
  className = '',
  glow = false,
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
        <div className="absolute inset-0 rounded-full bg-cyan-400/20 blur-md animate-pulse" />
      )}
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-[0_0_12px_rgba(0,242,254,0.35)]"
      >
        <defs>
          <linearGradient id="telexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#00f2fe" />
            <stop offset="50%" stopColor="#4facfe" />
            <stop offset="100%" stopColor="#7f00ff" />
          </linearGradient>
          <linearGradient id="wingGrad" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#00f2fe" />
            <stop offset="100%" stopColor="#00c6ff" />
          </linearGradient>
        </defs>

        {/* Central Telegraph-T Structure */}
        <path
          d="M4 5h24v4H18.5v18h-5V9H4V5z"
          fill="url(#telexGrad)"
        />

        {/* Dynamic Electric 'X' Wings with Tele-transmission angles */}
        <path
          d="M20.5 10.5L28 27h-4.8l-5.1-11.2 2.4-5.3z"
          fill="url(#wingGrad)"
          opacity="0.95"
        />
        <path
          d="M11.5 10.5L4 27h4.8l5.1-11.2-2.4-5.3z"
          fill="url(#wingGrad)"
          opacity="0.95"
        />

        {/* Central Quantum Tele-Node Pulse */}
        <circle cx="16" cy="18" r="2.2" fill="#ffffff" />
        <circle cx="16" cy="18" r="4.2" stroke="#00f2fe" strokeWidth="0.8" opacity="0.6" />
      </svg>
    </div>
  );
};

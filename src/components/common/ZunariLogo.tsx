import React from 'react';

interface ZunariLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  glow?: boolean;
}

export const ZunariLogo: React.FC<ZunariLogoProps> = ({
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
      <img
        src={`${import.meta.env.BASE_URL}zunari-logo.jpg`}
        alt="Zunari"
        className="h-full w-full object-contain drop-shadow-[0_0_14px_rgba(121,40,202,0.45)]"
      />
    </div>
  );
};

import React from 'react';
import { useTheme } from '../../context/ThemeContext.tsx';

interface SkeletonProps {
  className?: string;
  variant?: 'rectangular' | 'circular' | 'text';
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  variant = 'rectangular',
  width,
  height,
}) => {
  const { theme } = useTheme();

  const variantClass = {
    circular: 'rounded-full',
    text: 'rounded h-3 my-1',
    rectangular: 'rounded-xl',
  }[variant];

  const shimmerBg = theme === 'light'
    ? 'bg-slate-200/80 animate-pulse'
    : 'bg-white/[0.06] animate-pulse';

  return (
    <div
      className={`${shimmerBg} ${variantClass} ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  );
};

export const PostSkeleton: React.FC = () => {
  return (
    <div className="p-4 border-b border-white/[0.06] flex gap-3 animate-pulse">
      <Skeleton variant="circular" width={40} height={40} className="shrink-0" />
      <div className="flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton variant="text" width={120} height={14} />
          <Skeleton variant="text" width={80} height={12} />
        </div>
        <Skeleton variant="text" width="90%" height={14} />
        <Skeleton variant="text" width="75%" height={14} />
        <Skeleton variant="rectangular" height={160} className="w-full mt-2" />
        <div className="flex justify-between max-w-md pt-2">
          <Skeleton variant="circular" width={24} height={24} />
          <Skeleton variant="circular" width={24} height={24} />
          <Skeleton variant="circular" width={24} height={24} />
          <Skeleton variant="circular" width={24} height={24} />
        </div>
      </div>
    </div>
  );
};

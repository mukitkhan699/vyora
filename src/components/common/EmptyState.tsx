import React from 'react';
import { Button } from './Button.tsx';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className = '',
}) => {
  return (
    <div className={`p-10 text-center flex flex-col items-center justify-center gap-3 ${className}`}>
      {icon && (
        <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-neutral-400 mb-1">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-bold text-neutral-200 tracking-tight">{title}</h3>
      {description && (
        <p className="text-sm text-neutral-400 max-w-sm leading-relaxed">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button size="sm" onClick={onAction} className="mt-2">
          {actionLabel}
        </Button>
      )}
    </div>
  );
};

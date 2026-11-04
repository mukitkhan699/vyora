import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './Button.tsx';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message = 'An unexpected error occurred while loading this section.',
  onRetry,
  className = '',
}) => {
  return (
    <div className={`p-8 rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] text-center flex flex-col items-center justify-center gap-2.5 my-4 ${className}`}>
      <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center">
        <AlertCircle className="w-5 h-5" />
      </div>
      <h3 className="text-base font-bold text-neutral-200">{title}</h3>
      <p className="text-xs text-neutral-400 max-w-sm leading-relaxed">{message}</p>
      {onRetry && (
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          icon={<RefreshCw className="w-3.5 h-3.5" />}
          className="mt-2 text-xs"
        >
          Try Again
        </Button>
      )}
    </div>
  );
};

import React from 'react';
import { useTheme } from '../../context/ThemeContext.tsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className = '',
  disabled,
  ...props
}) => {
  const { accentBgClass, accentGlowClass, accent, theme } = useTheme();

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs font-semibold',
    md: 'px-4 py-2 text-sm font-bold',
    lg: 'px-6 py-3 text-base font-bold',
  }[size];

  let variantClasses = '';
  if (variant === 'primary') {
    const isBright = accent === 'cyan' || accent === 'emerald' || accent === 'amber';
    variantClasses = `${accentBgClass} ${isBright ? 'text-black font-extrabold' : 'text-white font-bold'} ${accentGlowClass} hover:brightness-110 active:scale-[0.98]`;
  } else if (variant === 'secondary') {
    variantClasses = theme === 'light'
      ? 'bg-slate-900 text-white hover:bg-slate-800'
      : 'bg-white text-black hover:bg-slate-200';
  } else if (variant === 'outline') {
    variantClasses = theme === 'light'
      ? 'border border-slate-300 text-slate-800 hover:bg-slate-100'
      : 'border border-white/20 text-white hover:bg-white/[0.08]';
  } else if (variant === 'ghost') {
    variantClasses = theme === 'light'
      ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
      : 'text-neutral-400 hover:text-white hover:bg-neutral-800/40';
  } else if (variant === 'danger') {
    variantClasses = 'bg-red-500 text-white hover:bg-red-600';
  }

  return (
    <button
      disabled={disabled || isLoading}
      className={`rounded-full transition-all flex items-center justify-center gap-2 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {isLoading && (
        <svg className="animate-spin h-4 w-4 text-current" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      {children}
    </button>
  );
};

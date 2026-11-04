import React from 'react';
import { useTheme } from '../../context/ThemeContext.tsx';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const { accentBgClass, accentGlowClass, accent, theme } = useTheme();

  const sizeClasses = {
    xs: 'px-2.5 py-1 text-xs font-semibold gap-1.5 rounded-lg',
    sm: 'px-3.5 py-1.5 text-xs font-semibold gap-1.5 rounded-xl',
    md: 'px-4 py-2 text-sm font-bold gap-2 rounded-xl',
    lg: 'px-6 py-3 text-base font-bold gap-2.5 rounded-2xl',
  }[size];

  let variantClasses = '';
  if (variant === 'primary') {
    const isBright = accent === 'cyan' || accent === 'emerald' || accent === 'amber';
    variantClasses = `${accentBgClass} ${isBright ? 'text-black font-extrabold' : 'text-white font-bold'} ${accentGlowClass} hover:brightness-110 active:scale-[0.98]`;
  } else if (variant === 'secondary') {
    variantClasses = theme === 'light'
      ? 'bg-slate-900 text-white hover:bg-slate-800 active:scale-[0.98]'
      : 'bg-white/10 text-white hover:bg-white/15 border border-white/10 active:scale-[0.98]';
  } else if (variant === 'outline') {
    variantClasses = theme === 'light'
      ? 'border border-slate-300 text-slate-800 hover:bg-slate-100 active:scale-[0.98]'
      : 'border border-white/15 text-neutral-200 hover:bg-white/[0.08] hover:border-white/25 active:scale-[0.98]';
  } else if (variant === 'ghost') {
    variantClasses = theme === 'light'
      ? 'text-slate-700 hover:bg-slate-100 active:scale-[0.98]'
      : 'text-neutral-300 hover:bg-white/[0.08] hover:text-white active:scale-[0.98]';
  } else if (variant === 'danger') {
    variantClasses = 'bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25 active:scale-[0.98]';
  }

  return (
    <button
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center transition-all duration-150 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Loading...</span>
        </>
      ) : (
        <>
          {icon && <span className="shrink-0">{icon}</span>}
          {children}
        </>
      )}
    </button>
  );
};

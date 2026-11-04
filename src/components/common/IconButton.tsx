import React from 'react';
import { useTheme } from '../../context/ThemeContext.tsx';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  label: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'subtle' | 'outline' | 'filled';
  active?: boolean;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  active = false,
  className = '',
  ...props
}) => {
  const { theme, accentBgClass, accentTextClass } = useTheme();

  const sizeClasses = {
    xs: 'p-1 text-xs rounded-lg',
    sm: 'p-1.5 text-xs rounded-xl',
    md: 'p-2 text-sm rounded-xl',
    lg: 'p-2.5 text-base rounded-2xl',
  }[size];

  let variantClasses = '';
  if (variant === 'ghost') {
    variantClasses = theme === 'light'
      ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200'
      : 'text-neutral-400 hover:text-white hover:bg-white/[0.08] active:bg-white/[0.12]';
  } else if (variant === 'subtle') {
    variantClasses = theme === 'light'
      ? 'bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300'
      : 'bg-white/[0.06] text-neutral-300 hover:bg-white/[0.1] active:bg-white/[0.15]';
  } else if (variant === 'outline') {
    variantClasses = theme === 'light'
      ? 'border border-slate-200 text-slate-700 hover:bg-slate-100'
      : 'border border-white/10 text-neutral-300 hover:bg-white/[0.08] hover:border-white/20';
  } else if (variant === 'filled') {
    variantClasses = `${accentBgClass} text-black font-bold`;
  }

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${sizeClasses} ${variantClasses} ${
        active ? `${accentTextClass} font-bold` : ''
      } ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
};

import React from 'react';

interface CardProps {
  children?: React.ReactNode;
  className?: string;
  variant?: 'default' | 'bordered' | 'elevated';
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
}) => {
  const baseStyles = 'rounded-2xl bg-[#0a0f18]/90 backdrop-blur-xl';
  
  const variantStyles = {
    default: 'border border-white/[0.08]',
    bordered: 'border border-white/10',
    elevated: 'border border-white/[0.08] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]',
  };

  const paddingStyles = {
    none: '',
    sm: 'p-3',
    md: 'p-5',
    lg: 'p-6',
  };

  return (
    <div className={`${baseStyles} ${variantStyles[variant]} ${paddingStyles[padding]} ${className}`}>
      {children}
    </div>
  );
};
import React from 'react';
import { clsx } from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'green' | 'red' | 'cyan' | 'amber' | 'purple' | 'neutral' | 'demo';
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  onClick?: () => void;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  size = 'xs',
  className,
  onClick,
}) => {
  const baseClasses =
    'inline-flex items-center font-medium font-mono rounded tracking-tight transition-colors';

  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-[10px] leading-tight',
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
  };

  const variantClasses = {
    green: 'bg-emerald-950/70 text-emerald-400 border border-emerald-500/30',
    red: 'bg-rose-950/70 text-rose-400 border border-rose-500/30',
    cyan: 'bg-sky-950/70 text-sky-400 border border-sky-500/30',
    amber: 'bg-amber-950/70 text-amber-400 border border-amber-500/30',
    purple: 'bg-purple-950/70 text-purple-400 border border-purple-500/30',
    neutral: 'bg-slate-800 text-slate-300 border border-slate-700',
    demo: 'bg-amber-500/10 text-amber-400 border border-amber-500/40 hover:bg-amber-500/20 cursor-pointer',
  };

  return (
    <span
      onClick={onClick}
      className={clsx(
        baseClasses,
        sizeClasses[size],
        variantClasses[variant],
        onClick && 'cursor-pointer select-none',
        className
      )}
    >
      {children}
    </span>
  );
};

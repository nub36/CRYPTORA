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
    'inline-flex items-center font-medium font-mono rounded-md tracking-tight transition-all duration-150 select-none';

  const sizeClasses = {
    xs: 'px-1.5 py-0.5 text-[11px] leading-tight',
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
  };

  const variantClasses = {
    green: 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 shadow-sm shadow-emerald-950/30',
    red: 'bg-rose-950/60 text-rose-400 border border-rose-500/30 shadow-sm shadow-rose-950/30',
    cyan: 'bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-950/30',
    amber: 'bg-amber-950/60 text-amber-200 border border-amber-500/30 shadow-sm shadow-amber-950/30',
    purple: 'bg-violet-950/60 text-violet-300 border border-violet-500/30 shadow-sm shadow-violet-950/30',
    neutral: 'bg-slate-900/80 text-slate-300 border border-white/[0.08]',
    demo: 'bg-amber-500/10 text-amber-200 border border-amber-500/35 hover:bg-amber-500/20 cursor-pointer shadow-sm shadow-amber-950/20',
  };

  return (
    <span
      onClick={onClick}
      className={clsx(
        baseClasses,
        sizeClasses[size],
        variantClasses[variant],
        onClick && 'cursor-pointer hover:brightness-110 active:scale-95',
        className
      )}
    >
      {children}
    </span>
  );
};

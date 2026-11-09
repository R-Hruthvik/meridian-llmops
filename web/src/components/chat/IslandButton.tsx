'use client';

import { type ButtonHTMLAttributes, type ReactNode } from 'react';

export type IslandButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface IslandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  variant?: IslandButtonVariant;
}

const variantClasses: Record<IslandButtonVariant, string> = {
  primary: 'bg-sky-400 text-zinc-950 hover:bg-sky-300',
  secondary: 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-white/10',
  ghost: 'text-zinc-300 hover:text-white hover:bg-white/5',
};

export function IslandButton({
  children,
  icon,
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: IslandButtonProps) {
  return (
    <button
      type={type}
      className={`group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all focus-machined-accent disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
      {icon ? (
        <span className="w-6 h-6 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center transition-transform motion-safe:group-hover:translate-x-0.5 motion-safe:group-hover:-translate-y-0.5">
          {icon}
        </span>
      ) : null}
    </button>
  );
}

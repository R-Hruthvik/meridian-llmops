'use client';

import { type HTMLAttributes, type ReactNode } from 'react';

export interface DoubleBezelCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  active?: boolean;
}

export function DoubleBezelCard({
  children,
  className = '',
  innerClassName = '',
  active = false,
  ...props
}: DoubleBezelCardProps) {
  return (
    <div
      className={`relative p-1.5 rounded-2xl border transition-colors bg-white/[0.03] dark:bg-zinc-950/40 ${
        active ? 'border-sky-400/50' : 'border-white/10'
      } ${className}`}
      {...props}
    >
      <div
        className={`rounded-xl bg-zinc-900/90 dark:bg-zinc-900/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ${innerClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

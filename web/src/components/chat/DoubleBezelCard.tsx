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
      className={`relative p-1.5 rounded border border-hairline transition-colors bg-surface-raised ${
        active ? 'border-sky-400/50' : 'border-hairline'
      } ${className}`}
      {...props}
    >
      <div
        className={`rounded-sm bg-surface-raised p-4 border-t border-white/[80] dark:border-white/[8] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${innerClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

import React, { type ReactNode } from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva } from 'class-variance-authority';
import { cn, type AvatarShape, type AvatarSize, type AvatarTone } from '../design-tokens.js';

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden',
  {
    variants: {
      size: {
        sm: 'h-[var(--nimi-sizing-avatar-sm)] w-[var(--nimi-sizing-avatar-sm)] text-xs',
        md: 'h-[var(--nimi-sizing-avatar-md)] w-[var(--nimi-sizing-avatar-md)] text-sm',
        lg: 'h-[var(--nimi-sizing-avatar-lg)] w-[var(--nimi-sizing-avatar-lg)] text-base',
      },
      shape: {
        circle: 'rounded-full',
        rounded: 'rounded-[var(--nimi-radius-md)]',
      },
      tone: {
        neutral: 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)]',
        accent: 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]',
      },
    },
    defaultVariants: {
      size: 'md',
      shape: 'circle',
      tone: 'neutral',
    },
  },
);

function getInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

type AvatarProps = {
  src?: string | null;
  alt: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  tone?: AvatarTone;
  className?: string;
  fallbackClassName?: string;
  fallback?: ReactNode;
};

export function Avatar({
  src,
  alt,
  size = 'md',
  shape = 'circle',
  tone = 'neutral',
  className,
  fallbackClassName,
  fallback,
}: AvatarProps) {
  return (
    <AvatarPrimitive.Root className={cn(avatarVariants({ size, shape, tone }), className)}>
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className={cn('flex h-full w-full items-center justify-center font-medium', fallbackClassName)}
        delayMs={src ? 600 : 0}
      >
        {fallback ?? getInitial(alt)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

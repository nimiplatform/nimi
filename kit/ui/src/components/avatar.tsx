import React, { type ReactNode } from 'react';
import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cva } from 'class-variance-authority';
import { cn, type AvatarShape, type AvatarSize, type AvatarTone } from '../design-tokens.js';
import {
  getAvatarMonogram,
  resolveAvatarMeshPalette,
  type AvatarMeshPaletteId,
} from '../lib/avatar-mesh.js';

const avatarVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center overflow-hidden',
  {
    variants: {
      size: {
        sm: 'h-[var(--nimi-sizing-avatar-sm)] w-[var(--nimi-sizing-avatar-sm)] text-[length:var(--nimi-type-caption-size)]',
        md: 'h-[var(--nimi-sizing-avatar-md)] w-[var(--nimi-sizing-avatar-md)] text-[length:var(--nimi-type-body-size)]',
        lg: 'h-[var(--nimi-sizing-avatar-lg)] w-[var(--nimi-sizing-avatar-lg)] text-[length:var(--nimi-type-section-title-size)]',
      },
      shape: {
        circle: 'rounded-full',
        rounded: 'rounded-[var(--nimi-radius-md)]',
      },
      tone: {
        neutral: 'bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)]',
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

type AvatarProps = {
  src?: string | null;
  alt: string;
  seed?: string | null;
  meshPalette?: AvatarMeshPaletteId | null;
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
  seed,
  meshPalette,
  size = 'md',
  shape = 'circle',
  tone = 'neutral',
  className,
  fallbackClassName,
  fallback,
}: AvatarProps) {
  const palette = tone === 'neutral' ? resolveAvatarMeshPalette(seed ?? alt, meshPalette) : null;
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
        data-nimi-avatar-mesh={palette?.id}
        className={cn(
          'flex h-full w-full select-none items-center justify-center font-semibold tracking-[-0.02em]',
          fallbackClassName,
        )}
        delayMs={src ? 600 : undefined}
      >
        {fallback ?? getAvatarMonogram(alt)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

'use client';

import React, { type ComponentProps } from 'react';
import { Avatar } from '@nimiplatform/kit/ui';
import type { MediaDeliveryDto } from '@nimiplatform/kit/core/sdk-contract';
import { MediaImage } from './media-image.js';

export type MediaAvatarProps = Omit<ComponentProps<typeof Avatar>, 'src'> & {
  readonly delivery?: MediaDeliveryDto | null;
  readonly externalUrl?: string | null;
  readonly pixelSize?: number;
  readonly refresh?: () => Promise<MediaDeliveryDto | null>;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.media-delivery
export function MediaAvatar({ delivery, externalUrl, pixelSize, refresh, fallback, ...props }: MediaAvatarProps) {
  if (!delivery) return <Avatar {...props} src={externalUrl} fallback={fallback} />;
  // Keep Avatar's visual primitive, but avoid its single-src preloader issuing a
  // second format request before the responsive picture chooses its source.
  return <Avatar {...props} fallback={<MediaImage delivery={delivery} purpose="avatar" sizes={pixelSize ? `${pixelSize}px` : 'auto, 40px'} alt={props.alt}
    className="h-full w-full object-cover" refresh={refresh} fallback={fallback ?? (props.alt.trim().charAt(0).toUpperCase() || '?')} />} />;
}

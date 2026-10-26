'use client';

import React, { useLayoutEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import type { MediaDeliveryDto } from '@nimiplatform/kit/core/sdk-contract';
import { mediaDeliveryKey, selectMediaImage, type MediaImagePurpose } from './headless.js';

export type MediaImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'sizes' | 'onError'> & {
  readonly delivery?: MediaDeliveryDto | null;
  readonly externalUrl?: string | null;
  readonly purpose: MediaImagePurpose;
  readonly sizes: string;
  readonly maxPixelWidth?: number;
  readonly fallback?: ReactNode;
  readonly refresh?: () => Promise<MediaDeliveryDto | null>;
  readonly onUnavailable?: () => void;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.media-delivery
export function MediaImage({ delivery, externalUrl, purpose, sizes, maxPixelWidth, fallback, refresh, onUnavailable, alt = '', className, loading = 'lazy', decoding = 'async', ...props }: MediaImageProps) {
  const [override, setOverride] = useState<{ baseKey: string; value: MediaDeliveryDto } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const retried = useRef<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const baseKey = mediaDeliveryKey(delivery);
  const current = override && override.baseKey === baseKey ? override.value : delivery;
  const selection = selectMediaImage(current, purpose, maxPixelWidth);
  const external = current ? null : externalUrl;
  const key = `${mediaDeliveryKey(current)}:${external ?? ''}`;
  const retryKey = `${baseKey}:${external ?? ''}`;
  const unavailable = failed === key || (!selection && !external);
  const source = selection?.src ?? external ?? undefined;
  const measureEager = Boolean(selection) && loading === 'eager' && sizes.startsWith('auto');
  const canRequest = !measureEager || measuredWidth !== null;
  const layoutSizes = measureEager && measuredWidth !== null ? `${measuredWidth}px` : sizes;
  useLayoutEffect(() => {
    const node = imageRef.current;
    if (!measureEager || !node) return;
    const measure = () => { const width = node.getBoundingClientRect().width; if (width > 0) setMeasuredWidth(width); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return () => observer.disconnect();
  }, [measureEager, unavailable]);
  async function handleError(): Promise<void> {
    setFailed(key);
    if (retried.current === retryKey) { onUnavailable?.(); return; }
    retried.current = retryKey;
    if (refresh && current) {
      try {
        const next = await refresh();
        if (!next || next.resourceId !== current.resourceId) { onUnavailable?.(); return; }
        if (mediaDeliveryKey(next) !== mediaDeliveryKey(current)) { setOverride({ baseKey, value: next }); return; }
      } catch { onUnavailable?.(); return; }
    }
    // A valid public descriptor may be unchanged after a transport failure.
    // Retry its exact URL once; never add cache-busters, construct a new grant,
    // or fall back to original bytes. A second failure remains unavailable.
    setFailed(null);
    setReload((value) => value + 1);
  }
  if (unavailable) return <span className={className} role="img" aria-label={alt}>{fallback ?? null}</span>;
  return <picture key={`${key}:${reload}`} style={{ display: 'contents' }}>
    {canRequest ? selection?.sources.map((family) => <source key={family.type} type={family.type} srcSet={family.srcSet} sizes={layoutSizes} />) : null}
    <img {...props} crossOrigin={current ? 'anonymous' : props.crossOrigin} ref={imageRef} src={canRequest ? source : undefined} srcSet={canRequest ? selection?.srcSet : undefined} sizes={selection ? layoutSizes : undefined} width={props.width ?? selection?.width} height={props.height ?? selection?.height}
      alt={alt} className={className} loading={loading} decoding={decoding} onError={() => { void handleError(); }}
      onLoad={(event) => { retried.current = null; props.onLoad?.(event); }} />
  </picture>;
}

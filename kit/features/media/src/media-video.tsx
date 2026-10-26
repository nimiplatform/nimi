'use client';

import React, { useEffect, useRef, useState, type VideoHTMLAttributes } from 'react';
import type { MediaDeliveryDto } from '@nimiplatform/kit/core/sdk-contract';
import { mediaDeliveryKey } from './headless.js';

export type MediaVideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'src' | 'poster' | 'onError'> & {
  readonly delivery?: MediaDeliveryDto | null;
  readonly externalUrl?: string | null;
  readonly externalPosterUrl?: string | null;
  readonly refresh?: () => Promise<MediaDeliveryDto | null>;
  readonly onUnavailable?: () => void;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.media-delivery
export function MediaVideo({ delivery, externalUrl, externalPosterUrl, refresh, onUnavailable, preload = 'none', controls = true, ...props }: MediaVideoProps) {
  const node = useRef<HTMLVideoElement>(null);
  const [override, setOverride] = useState<{ baseKey: string; value: MediaDeliveryDto } | null>(null);
  const baseKey = mediaDeliveryKey(delivery);
  const current = override?.baseKey === baseKey ? override?.value ?? delivery : delivery;
  const sourceRef = useRef({ current, baseKey }); sourceRef.current = { current, baseKey };
  const src = current ? current.video?.hlsUrl : externalUrl;
  const key = mediaDeliveryKey(current);
  const callbacks = useRef({ refresh, onUnavailable }); callbacks.current = { refresh, onUnavailable };
  const resume = useRef({ time: 0, playing: false });
  const playbackIdentity = useRef<string | null>(null);
  const retried = useRef<string | null>(null);
  useEffect(() => {
    const { current, baseKey } = sourceRef.current;
    const video = node.current;
    const identity = current ? `${current.resourceId}:${current.contentVersion}` : src ?? null;
    if (playbackIdentity.current !== identity) resume.current = { time: 0, playing: false };
    playbackIdentity.current = identity;
    if (!video || !src) { callbacks.current.onUnavailable?.(); return; }
    let closed = false; let failed = false; let instance: import('hls.js').default | null = null;
    const recover = async () => {
      if (closed || failed) return; failed = true;
      resume.current = { time: video.readyState > 0 ? video.currentTime : resume.current.time, playing: !video.paused };
      if (current && callbacks.current.refresh && retried.current !== baseKey) {
        retried.current = baseKey;
        try {
          const next = await callbacks.current.refresh();
          if (!closed && next?.video && next.resourceId === current.resourceId && mediaDeliveryKey(next) !== key) {
            setOverride({ baseKey, value: next }); return;
          }
        } catch { /* Authorization and refresh remain with the containing read surface. */ }
      }
      if (!closed) callbacks.current.onUnavailable?.();
    };
    const loaded = () => { if (resume.current.time > 0) video.currentTime = resume.current.time; if (resume.current.playing) void video.play().catch(() => undefined); };
    video.addEventListener('loadedmetadata', loaded); video.addEventListener('error', recover);
    if (!current?.video || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      // A renewed native HLS source with preload=none needs the user's retained
      // play intent to begin loading; loadedmetadata then restores the position.
      if (resume.current.playing) void video.play().catch(() => undefined);
    }
    else {
      void import('hls.js').then(({ default: Hls }) => {
        if (closed) return;
        if (!Hls.isSupported()) { void recover(); return; }
        instance = new Hls({ autoStartLoad: false, capLevelToPlayerSize: true, maxBufferLength: 15, maxMaxBufferLength: 30 });
        instance.on(Hls.Events.ERROR, (_event, error) => { if (error.fatal) void recover(); });
        instance.on(Hls.Events.MEDIA_ATTACHED, () => instance?.loadSource(src));
        instance.on(Hls.Events.MANIFEST_PARSED, () => { if (!video.paused || resume.current.playing || preload !== 'none') instance?.startLoad(resume.current.time); });
        instance.attachMedia(video);
      }).catch(() => { void recover(); });
    }
    const play = () => {
      if (current?.video && Date.parse(current.video.expiresAt) <= Date.now() + 1000) { void recover(); return; }
      instance?.startLoad(video.currentTime);
    };
    const played = () => { retried.current = null; };
    video.addEventListener('playing', played);
    video.addEventListener('play', play);
    return () => {
      // A business read may renew the grant before it expires. Preserve the
      // same content's position/play intent across that update as well.
      if (video.readyState > 0)
        resume.current = { time: video.currentTime, playing: !video.paused && !video.ended };
      closed = true; instance?.destroy(); video.removeEventListener('playing', played); video.removeEventListener('play', play); video.removeEventListener('error', recover); video.removeEventListener('loadedmetadata', loaded); video.removeAttribute('src'); video.load();
    };
  }, [src, key, preload]);
  return <video {...props} ref={node} controls={controls} preload={preload} playsInline poster={current?.video?.posterUrl ?? externalPosterUrl ?? undefined} />;
}

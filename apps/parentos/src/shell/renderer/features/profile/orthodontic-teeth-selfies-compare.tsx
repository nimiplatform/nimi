import { useCallback, useEffect, useRef, useState } from 'react';
import {
  readOrthodonticPhotoBlob,
  type OrthodonticPhotoAttachmentRow,
  type OrthodonticPhotoSessionBundle,
} from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import type { CompareMode } from './orthodontic-teeth-selfies-header.js';
import { formatThumbLabel } from './orthodontic-teeth-selfies-shared.js';

// ── Compare view ────────────────────────────────────────────

export function CompareView({
  mode,
  a,
  b,
  aBundle,
  bBundle,
}: {
  mode: CompareMode;
  a: OrthodonticPhotoAttachmentRow | null;
  b: OrthodonticPhotoAttachmentRow | null;
  aBundle: OrthodonticPhotoSessionBundle | null;
  bBundle: OrthodonticPhotoSessionBundle | null;
}) {
  if (!a || !b) {
    return (
      <div
        style={{
          width: '100%',
          aspectRatio: '16 / 10',
          borderRadius: 18,
          border: '1px dashed var(--nimi-border-strong)',
          background: 'var(--nimi-surface-active)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--nimi-text-muted)',
          fontSize: 13,
          marginBottom: 10,
        }}
      >
        当前视角下两组照片不完整，先切换角度或拍一组补齐。
      </div>
    );
  }
  if (mode === 'split') {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          width: '100%',
          aspectRatio: '16 / 10',
          marginBottom: 10,
        }}
      >
        <PhotoTile attachment={a} role="之前" session={aBundle?.session ?? null} />
        <PhotoTile attachment={b} role="之后" session={bBundle?.session ?? null} />
      </div>
    );
  }
  return <CompareSlider a={a} b={b} aBundle={aBundle} bBundle={bBundle} />;
}

function CompareSlider({
  a,
  b,
  aBundle,
  bBundle,
}: {
  a: OrthodonticPhotoAttachmentRow;
  b: OrthodonticPhotoAttachmentRow;
  aBundle: OrthodonticPhotoSessionBundle | null;
  bBundle: OrthodonticPhotoSessionBundle | null;
}) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const onMove = useCallback((clientX: number) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
    setPos((x / rect.width) * 100);
  }, []);

  useEffect(() => {
    const move = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const x = 'touches' in e ? e.touches[0]?.clientX ?? null : e.clientX;
      if (x !== null) onMove(x);
    };
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, [onMove]);

  return (
    <div
      ref={ref}
      onMouseDown={(e) => {
        dragging.current = true;
        onMove(e.clientX);
      }}
      onTouchStart={(e) => {
        dragging.current = true;
        const x = e.touches[0]?.clientX;
        if (x !== undefined) onMove(x);
      }}
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 10',
        borderRadius: 18,
        overflow: 'hidden',
        background: 'var(--nimi-text-primary)',
        cursor: 'ew-resize',
        userSelect: 'none',
        boxShadow: '0 1px 2px rgba(15,23,42,0.05), 0 8px 24px rgba(15,23,42,0.08)',
        marginBottom: 10,
      }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        <PhotoTile attachment={b} role="之后" session={bBundle?.session ?? null} />
      </div>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          clipPath: `polygon(0 0, ${pos}% 0, ${pos}% 100%, 0 100%)`,
        }}
      >
        <PhotoTile attachment={a} role="之前" session={aBundle?.session ?? null} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${pos}%`,
          width: 2,
          background: 'rgba(255,255,255,0.9)',
          boxShadow: '0 0 0 1px rgba(15,23,42,0.15)',
          transform: 'translateX(-1px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: `${pos}%`,
          transform: 'translate(-50%, -50%)',
          width: 36,
          height: 36,
          borderRadius: 999,
          background: 'white',
          boxShadow: '0 2px 8px rgba(15,23,42,0.22), 0 0 0 1px rgba(15,23,42,0.06)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--nimi-text-secondary)',
          pointerEvents: 'none',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M5 3 L1 7 L5 11 M9 3 L13 7 L9 11"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

// ── Photo tile (lazy blob fetch) ──────────────────────────

interface PhotoTileProps {
  attachment: OrthodonticPhotoAttachmentRow;
  role: '之前' | '之后' | null;
  session: OrthodonticPhotoSessionBundle['session'] | null;
}

function PhotoTile({ attachment, role, session }: PhotoTileProps) {
  const dataUrl = usePhotoBlob(attachment.attachmentId, attachment.mimeType);
  const label = role
    ? `${role} · ${session ? formatThumbLabel(session) : ''}`
    : null;
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: 18,
        overflow: 'hidden',
        background: 'var(--nimi-surface-active)',
        boxShadow: '0 1px 2px rgba(15,23,42,0.05), 0 8px 24px rgba(15,23,42,0.08)',
      }}
    >
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={label ?? attachment.fileName}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--nimi-text-muted)',
            fontSize: 12,
          }}
        >
          加载中…
        </div>
      )}
      {label && (
        <div
          style={{
            position: 'absolute',
            left: 10,
            top: 10,
            padding: '3px 8px',
            borderRadius: 999,
            background: 'rgba(15,23,42,0.55)',
            color: 'white',
            fontSize: 10,
            letterSpacing: '0.04em',
            fontWeight: 500,
            backdropFilter: 'blur(6px)',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

// Wave E audit follow-up — bounded LRU. The cache is module-scoped so the
// same attachmentId rendered in the compare slider AND the thumbnail
// strip resolves to one fetch + one base64 buffer. Multi-child / multi-
// case navigation accumulates entries without an upper bound; cap at 80
// (≈ 40 sessions × 2 angles, comfortably above an album's working set)
// and evict the oldest entry on overflow via Map insertion order.
const PHOTO_CACHE_LIMIT = 80;
const __photoCache = new Map<string, string>();

function rememberPhotoBlob(attachmentId: string, url: string): void {
  if (__photoCache.has(attachmentId)) {
    // Re-insert at the tail so the touched entry is freshest in iteration
    // order. A LRU eviction policy without this loses the recency signal.
    __photoCache.delete(attachmentId);
  }
  __photoCache.set(attachmentId, url);
  while (__photoCache.size > PHOTO_CACHE_LIMIT) {
    const oldest = __photoCache.keys().next();
    if (oldest.done) break;
    __photoCache.delete(oldest.value);
  }
}

export function usePhotoBlob(attachmentId: string, mimeType: string): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(
    __photoCache.get(attachmentId) ?? null,
  );
  useEffect(() => {
    if (__photoCache.has(attachmentId)) {
      const cached = __photoCache.get(attachmentId)!;
      // Touch the cache so subsequent renders treat it as fresh.
      rememberPhotoBlob(attachmentId, cached);
      setDataUrl(cached);
      return;
    }
    let cancelled = false;
    readOrthodonticPhotoBlob(attachmentId)
      .then((base64) => {
        if (cancelled) return;
        const url = `data:${mimeType};base64,${base64}`;
        rememberPhotoBlob(attachmentId, url);
        setDataUrl(url);
      })
      .catch((err) => {
        catchLog('ortho', 'action:read-photo-blob-failed')(err);
      });
    return () => {
      cancelled = true;
    };
  }, [attachmentId, mimeType]);
  return dataUrl;
}


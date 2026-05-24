import { Surface } from '@nimiplatform/kit/ui';
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
        className="mb-2.5 grid w-full place-items-center rounded-2xl border border-dashed border-[var(--nimi-border-strong)] bg-[var(--nimi-surface-active)] text-[13px] text-[var(--nimi-text-muted)]"
        style={{
          aspectRatio: '16 / 10',
        }}
      >
        当前视角下两组照片不完整，先切换角度或拍一组补齐。
      </div>
    );
  }
  if (mode === 'split') {
    return (
      <div
        className="mb-2.5 grid w-full gap-2.5"
        style={{
          gridTemplateColumns: '1fr 1fr',
          aspectRatio: '16 / 10',
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
      className="relative mb-2.5 w-full cursor-ew-resize select-none overflow-hidden rounded-2xl bg-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-raised)]"
      style={{ aspectRatio: '16 / 10' }}
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
        className="absolute bottom-0 top-0 w-0.5 bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-base)]"
        style={{
          left: `${pos}%`,
          transform: 'translateX(-1px)',
        }}
      />
      <div
        className="pointer-events-none absolute grid h-9 w-9 place-items-center rounded-full bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)] shadow-[var(--nimi-elevation-floating)]"
        style={{
          top: '50%',
          left: `${pos}%`,
          transform: 'translate(-50%, -50%)',
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
    <Surface
      tone="card"
      material="glass-regular"
      elevation="raised"
      padding="none"
      className="relative h-full w-full overflow-hidden rounded-2xl"
      style={{
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
          className="absolute inset-0 grid place-items-center text-[12px] text-[var(--nimi-text-muted)]"
          style={{
          }}
        >
          加载中…
        </div>
      )}
      {label && (
        <div
          className="absolute left-2.5 top-2.5 rounded-full bg-[var(--nimi-surface-overlay)] px-2 py-[3px] text-[10px] font-medium tracking-[0.04em] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)]"
          style={{
          }}
        >
          {label}
        </div>
      )}
    </Surface>
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

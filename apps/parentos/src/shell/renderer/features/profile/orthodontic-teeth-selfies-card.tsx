import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import {
  deleteOrthodonticPhotoSession,
  listOrthodonticPhotoSessionBundles,
  type OrthodonticPhotoAngle,
  type OrthodonticPhotoAttachmentRow,
  type OrthodonticPhotoSessionBundle,
  readOrthodonticPhotoBlob,
} from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { S } from '../../app-shell/page-style.js';

interface Props {
  childId: string;
  caseId: string;
  /** Open the capture modal. The page-level controller owns its state. */
  onOpenCapture: () => void;
  /** Reload trigger — bumped by capture-saved / delete-saved. */
  reloadKey: number;
  onError: (msg: string | null) => void;
}

type CompareMode = 'slide' | 'split';

/**
 * Photo album with before/after compare. Pulls sessions + attachments from
 * the Rust bundle endpoint (single round-trip per case), lazy-loads JPEG
 * bytes through `readOrthodonticPhotoBlob` (the only admitted read channel
 * — `convertFileSrc` is forbidden per PO-ORTHO-012).
 *
 * Empty state shows when no sessions exist for the case. Each session
 * thumbnail can be assigned to the A or B slot of the compare view.
 */
export function OrthodonticTeethSelfiesCard({
  childId,
  caseId,
  onOpenCapture,
  reloadKey,
  onError,
}: Props) {
  const [bundles, setBundles] = useState<OrthodonticPhotoSessionBundle[] | null>(null);
  const [angle, setAngle] = useState<OrthodonticPhotoAngle>('front');
  const [mode, setMode] = useState<CompareMode>('slide');
  const [aSessionId, setASessionId] = useState<string | null>(null);
  const [bSessionId, setBSessionId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listOrthodonticPhotoSessionBundles({ caseId, childId })
      .then((rows) => {
        if (cancelled) return;
        setBundles(rows);
        // Seed A/B to the first + last session when both are unset.
        if (rows.length > 0) {
          setASessionId((prev) => prev ?? rows[0]!.session.sessionId);
          setBSessionId((prev) => prev ?? rows[rows.length - 1]!.session.sessionId);
        } else {
          setASessionId(null);
          setBSessionId(null);
        }
      })
      .catch((err) => {
        catchLog('ortho', 'action:list-photo-sessions-failed')(err);
        onError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, childId, reloadKey, onError]);

  const sessionsById = useMemo(() => {
    const m = new Map<string, OrthodonticPhotoSessionBundle>();
    for (const b of bundles ?? []) m.set(b.session.sessionId, b);
    return m;
  }, [bundles]);

  const aBundle = aSessionId ? sessionsById.get(aSessionId) ?? null : null;
  const bBundle = bSessionId ? sessionsById.get(bSessionId) ?? null : null;

  const pickAttachment = useCallback(
    (
      bundle: OrthodonticPhotoSessionBundle | null,
    ): OrthodonticPhotoAttachmentRow | null =>
      bundle?.attachments.find((a) => a.angle === angle) ?? null,
    [angle],
  );

  const aAttachment = pickAttachment(aBundle);
  const bAttachment = pickAttachment(bBundle);

  const handleDeleteSession = async (sessionId: string) => {
    if (!window.confirm('确定删除这组照片？文件会从本地相册同步移除，操作不可撤销。')) {
      return;
    }
    onError(null);
    try {
      await deleteOrthodonticPhotoSession({ sessionId, childId });
      // Force reload by re-fetching: simplest is to drop from state then refetch.
      setBundles((prev) => prev?.filter((b) => b.session.sessionId !== sessionId) ?? null);
      if (aSessionId === sessionId) setASessionId(null);
      if (bSessionId === sessionId) setBSessionId(null);
      setPickerFor(null);
    } catch (err) {
      catchLog('ortho', 'action:delete-photo-session-failed')(err);
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Surface
      as="section"
      material="glass-regular"
      padding="none"
      tone="card"
      className="rounded-[24px] p-7 shadow-[0_6px_18px_rgba(15,23,42,0.05)]"
    >
      <Header
        bundles={bundles}
        aSessionId={aSessionId}
        bSessionId={bSessionId}
        angle={angle}
        mode={mode}
        onAngleChange={setAngle}
        onModeChange={setMode}
      />
      <p
        style={{
          fontSize: 13,
          color: 'var(--nimi-text-secondary)',
          margin: '0 0 16px',
          lineHeight: 1.55,
        }}
      >
        每次换套或复诊时拍一组，看见这些天悄悄发生的变化。
      </p>

      {bundles === null && <Loading />}
      {bundles !== null && bundles.length === 0 && <EmptyState onCapture={onOpenCapture} />}
      {bundles !== null && bundles.length > 0 && (
        <>
          <CompareView
            mode={mode}
            a={aAttachment}
            b={bAttachment}
            aBundle={aBundle}
            bBundle={bBundle}
          />
          <SessionStrip
            bundles={bundles}
            angle={angle}
            aSessionId={aSessionId}
            bSessionId={bSessionId}
            pickerFor={pickerFor}
            onPickerToggle={(id) => setPickerFor((cur) => (cur === id ? null : id))}
            onAssignA={(id) => {
              setASessionId(id);
              if (bSessionId === id && aSessionId !== null) setBSessionId(aSessionId);
              setPickerFor(null);
            }}
            onAssignB={(id) => {
              setBSessionId(id);
              if (aSessionId === id && bSessionId !== null) setASessionId(bSessionId);
              setPickerFor(null);
            }}
            onDelete={(id) => void handleDeleteSession(id)}
            onCapture={onOpenCapture}
          />
        </>
      )}
    </Surface>
  );
}

// ── Header ─────────────────────────────────────────────────

function Header({
  bundles,
  aSessionId,
  bSessionId,
  angle,
  mode,
  onAngleChange,
  onModeChange,
}: {
  bundles: OrthodonticPhotoSessionBundle[] | null;
  aSessionId: string | null;
  bSessionId: string | null;
  angle: OrthodonticPhotoAngle;
  mode: CompareMode;
  onAngleChange: (a: OrthodonticPhotoAngle) => void;
  onModeChange: (m: CompareMode) => void;
}) {
  const count = bundles?.length ?? 0;
  const a = bundles?.find((b) => b.session.sessionId === aSessionId)?.session;
  const b = bundles?.find((bb) => bb.session.sessionId === bSessionId)?.session;
  const trayDelta =
    a?.trayIndex !== undefined && a.trayIndex !== null
      ? b?.trayIndex !== undefined && b.trayIndex !== null
        ? Math.abs(b.trayIndex - a.trayIndex)
        : null
      : null;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 6,
        flexWrap: 'wrap',
        gap: 10,
      }}
    >
      <div>
        <CapsLabel>影像档案</CapsLabel>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.01em',
              color: 'var(--nimi-text-primary)',
            }}
          >
            牙齿成长相册
          </span>
          {count > 0 && (
            <span style={{ fontSize: 13, color: 'var(--nimi-text-muted)' }}>
              {count} 组{trayDelta !== null ? ` · 已记录 ${trayDelta} 副变化` : ''}
            </span>
          )}
        </div>
      </div>
      {count > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Segmented<OrthodonticPhotoAngle>
            value={angle}
            options={[
              { id: 'front', label: '正面' },
              { id: 'side', label: '侧面' },
            ]}
            onChange={onAngleChange}
          />
          <Segmented<CompareMode>
            value={mode}
            options={[
              { id: 'slide', label: '叠加', title: '拖动分割线对比' },
              { id: 'split', label: '平铺', title: '左右并排' },
            ]}
            onChange={onModeChange}
          />
        </div>
      )}
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string; title?: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        padding: 3,
        borderRadius: 999,
        background: 'var(--nimi-surface-active)',
      }}
    >
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            title={o.title}
            onClick={() => onChange(o.id)}
            style={{
              padding: '5px 14px',
              borderRadius: 999,
              border: 0,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              background: active ? '#ffffff' : 'transparent',
              color: active ? 'var(--nimi-text-primary)' : 'var(--nimi-text-muted)',
              boxShadow: active ? '0 1px 3px rgba(15,23,42,0.1)' : 'none',
              transition: 'all 160ms',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Compare view ────────────────────────────────────────────

function CompareView({
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

function usePhotoBlob(attachmentId: string, mimeType: string): string | null {
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

// ── Thumbnail strip ────────────────────────────────────────

function SessionStrip({
  bundles,
  angle,
  aSessionId,
  bSessionId,
  pickerFor,
  onPickerToggle,
  onAssignA,
  onAssignB,
  onDelete,
  onCapture,
}: {
  bundles: OrthodonticPhotoSessionBundle[];
  angle: OrthodonticPhotoAngle;
  aSessionId: string | null;
  bSessionId: string | null;
  pickerFor: string | null;
  onPickerToggle: (id: string) => void;
  onAssignA: (id: string) => void;
  onAssignB: (id: string) => void;
  onDelete: (id: string) => void;
  onCapture: () => void;
}) {
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <CapsLabel>全部记录</CapsLabel>
        <button
          type="button"
          onClick={onCapture}
          style={{
            padding: '6px 12px',
            borderRadius: 999,
            border: '1px solid var(--nimi-border-subtle)',
            background: 'white',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--nimi-text-primary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            whiteSpace: 'nowrap',
          }}
        >
          + 拍一组新的
        </button>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 6,
        }}
      >
        {bundles.map((b) => {
          const att = b.attachments.find((a) => a.angle === angle) ?? b.attachments[0] ?? null;
          const isA = b.session.sessionId === aSessionId;
          const isB = b.session.sessionId === bSessionId;
          const role = isA && isB ? 'AB' : isA ? 'A' : isB ? 'B' : null;
          const open = pickerFor === b.session.sessionId;
          return (
            <div
              key={b.session.sessionId}
              style={{ flex: '0 0 116px', position: 'relative' }}
            >
              <button
                type="button"
                onClick={() => onPickerToggle(b.session.sessionId)}
                style={{
                  width: '100%',
                  padding: 0,
                  border: 0,
                  background: 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                <ThumbnailFrame attachment={att} role={role} highlight={open} />
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 11,
                    color: 'var(--nimi-text-secondary)',
                    fontWeight: 500,
                  }}
                >
                  {b.session.sessionDate}
                </div>
                {/* slate-400 — sub-muted tier kit lacks; kept inline so
                    thumbnail sub-label fades behind sessionDate. */}
                <div style={{ fontSize: 10, color: '#94a3b8' }}>
                  {formatThumbLabel(b.session)}
                </div>
              </button>
              {open && (
                <ThumbnailPicker
                  isA={isA}
                  isB={isB}
                  onAssignA={() => onAssignA(b.session.sessionId)}
                  onAssignB={() => onAssignB(b.session.sessionId)}
                  onDelete={() => onDelete(b.session.sessionId)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThumbnailFrame({
  attachment,
  role,
  highlight,
}: {
  attachment: OrthodonticPhotoAttachmentRow | null;
  role: 'A' | 'B' | 'AB' | null;
  highlight: boolean;
}) {
  const outline = role
    ? `2px solid ${S.accent}`
    : highlight
    ? '2px solid var(--nimi-text-secondary)'
    : '1px solid var(--nimi-border-subtle)';
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '1 / 1',
        borderRadius: 12,
        overflow: 'hidden',
        outline,
        outlineOffset: role || highlight ? '1px' : '0',
        transition: 'outline 160ms',
        background: 'var(--nimi-surface-active)',
      }}
    >
      {attachment ? (
        <ThumbnailImg attachment={attachment} />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            color: 'var(--nimi-text-muted)',
            fontSize: 11,
          }}
        >
          无照片
        </div>
      )}
      {role && (
        <span
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            padding: '2px 7px',
            borderRadius: 999,
            background: S.accent,
            color: 'var(--nimi-action-primary-text)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.06em',
          }}
        >
          {role}
        </span>
      )}
    </div>
  );
}

function ThumbnailImg({ attachment }: { attachment: OrthodonticPhotoAttachmentRow }) {
  const dataUrl = usePhotoBlob(attachment.attachmentId, attachment.mimeType);
  return dataUrl ? (
    <img
      src={dataUrl}
      alt={attachment.fileName}
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
        fontSize: 10,
      }}
    >
      …
    </div>
  );
}

function ThumbnailPicker({
  isA,
  isB,
  onAssignA,
  onAssignB,
  onDelete,
}: {
  isA: boolean;
  isB: boolean;
  onAssignA: () => void;
  onAssignB: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% - 32px)',
        left: '50%',
        transform: 'translate(-50%, 8px)',
        zIndex: 10,
        background: 'var(--nimi-text-primary)',
        color: 'white',
        borderRadius: 12,
        padding: 4,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 12px 32px rgba(15,23,42,0.28)',
        minWidth: 140,
      }}
    >
      <PickerOption disabled={isA} label="设为「之前」" onClick={onAssignA} />
      <PickerOption disabled={isB} label="设为「之后」" onClick={onAssignB} />
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.15)', margin: '2px 0' }} />
      <PickerOption danger label="删除这组照片" onClick={onDelete} />
    </div>
  );
}

function PickerOption({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onClick();
      }}
      disabled={disabled}
      style={{
        padding: '8px 12px',
        border: 0,
        background: 'transparent',
        color: disabled ? 'rgba(255,255,255,0.5)' : danger ? '#fda4af' : 'white',
        fontFamily: 'inherit',
        fontSize: 12,
        fontWeight: 500,
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        borderRadius: 8,
        transition: 'background 120ms',
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
      }}
    >
      {label}
    </button>
  );
}

// ── Empty / loading ────────────────────────────────────────

function EmptyState({ onCapture }: { onCapture: () => void }) {
  return (
    <div
      style={{
        padding: '32px 16px',
        borderRadius: 18,
        border: '1.5px dashed var(--nimi-border-strong)',
        textAlign: 'center',
        color: 'var(--nimi-text-muted)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div style={{ fontSize: 14 }}>还没有照片记录</div>
      <button
        type="button"
        onClick={onCapture}
        style={{
          padding: '10px 18px',
          borderRadius: 999,
          border: 0,
          background: S.accent,
          color: 'var(--nimi-action-primary-text)',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        + 拍一组
      </button>
    </div>
  );
}

function Loading() {
  return (
    <div
      style={{
        padding: 32,
        textAlign: 'center',
        color: 'var(--nimi-text-muted)',
        fontSize: 13,
      }}
    >
      加载中…
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function formatThumbLabel(session: OrthodonticPhotoSessionBundle['session']): string {
  if (session.note) return session.note;
  if (session.trayIndex !== null) return `第 ${session.trayIndex} 副`;
  return '一组照片';
}

function CapsLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--nimi-text-muted)',
      }}
    >
      {children}
    </div>
  );
}

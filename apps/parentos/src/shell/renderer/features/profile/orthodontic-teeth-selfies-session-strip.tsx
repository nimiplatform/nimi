import type { OrthodonticPhotoAngle, OrthodonticPhotoAttachmentRow, OrthodonticPhotoSessionBundle } from '../../bridge/sqlite-bridge.js';
import { S } from '../../app-shell/page-style.js';
import { usePhotoBlob } from './orthodontic-teeth-selfies-compare.js';
import { CapsLabel, formatThumbLabel } from './orthodontic-teeth-selfies-shared.js';

// ── Thumbnail strip ────────────────────────────────────────

export function SessionStrip({
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

export function EmptyState({ onCapture }: { onCapture: () => void }) {
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

export function Loading() {
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

import { Button, cn, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import type { OrthodonticPhotoAngle, OrthodonticPhotoAttachmentRow, OrthodonticPhotoSessionBundle } from '../../bridge/sqlite-bridge.js';
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
        <Button
          type="button"
          onClick={onCapture}
          tone="secondary"
          size="sm"
          className="whitespace-nowrap"
        >
          + 拍一组新的
        </Button>
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
              <Surface
                as="button"
                type="button"
                onClick={() => onPickerToggle(b.session.sessionId)}
                tone="panel"
                padding="none"
                material="solid"
                elevation="base"
                interactive
                className="w-full border-transparent bg-transparent text-left shadow-none"
              >
                <ThumbnailFrame attachment={att} role={role} highlight={open} />
                <div className="mt-1.5 text-[11px] font-medium text-[var(--nimi-text-secondary)]">
                  {b.session.sessionDate}
                </div>
                <div className="text-[10px] text-[var(--nimi-text-muted)]">
                  {formatThumbLabel(b.session)}
                </div>
              </Surface>
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
  return (
    <Surface
      tone="panel"
      material="solid"
      padding="none"
      elevation="base"
      active
      className={cn(
        'relative w-full overflow-hidden rounded-xl transition-colors',
        role
          ? 'border-2 border-[var(--nimi-action-primary-bg)]'
          : highlight
            ? 'border-2 border-[var(--nimi-text-secondary)]'
            : 'border border-[var(--nimi-border-subtle)]',
      )}
      style={{
        aspectRatio: '1 / 1',
      }}
    >
      {attachment ? (
        <ThumbnailImg attachment={attachment} />
      ) : (
        <div
          className="absolute inset-0 grid place-items-center text-[11px] text-[var(--nimi-text-muted)]"
        >
          无照片
        </div>
      )}
      {role && (
        <StatusBadge
          tone="info"
          className="absolute bottom-1.5 right-1.5 bg-[var(--nimi-action-primary-bg)] text-[10px] font-bold tracking-[0.06em] text-[var(--nimi-action-primary-text)]"
        >
          {role}
        </StatusBadge>
      )}
    </Surface>
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
      className="absolute inset-0 grid place-items-center text-[10px] text-[var(--nimi-text-muted)]"
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
    <Surface
      tone="overlay"
      material="solid"
      elevation="floating"
      padding="none"
      className="flex min-w-[140px] flex-col rounded-xl p-1"
      style={{
        position: 'absolute',
        top: 'calc(100% - 32px)',
        left: '50%',
        transform: 'translate(-50%, 8px)',
        zIndex: 10,
      }}
    >
      <PickerOption disabled={isA} label="设为「之前」" onClick={onAssignA} />
      <PickerOption disabled={isB} label="设为「之后」" onClick={onAssignB} />
      <div className="my-0.5 border-t border-[var(--nimi-border-subtle)]" />
      <PickerOption danger label="删除这组照片" onClick={onDelete} />
    </Surface>
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
    <Button
      type="button"
      onClick={() => {
        if (!disabled) onClick();
      }}
      disabled={disabled}
      tone={danger ? 'danger' : 'ghost'}
      size="sm"
      fullWidth
      className="justify-start rounded-lg px-3 py-2 text-left text-[12px] font-medium"
    >
      {label}
    </Button>
  );
}

// ── Empty / loading ────────────────────────────────────────

export function EmptyState({ onCapture }: { onCapture: () => void }) {
  return (
    <Surface
      tone="panel"
      material="solid"
      elevation="base"
      padding="none"
      className="flex flex-col items-center gap-3.5 rounded-2xl border-[1.5px] border-dashed border-[var(--nimi-border-strong)] px-4 py-8 text-center text-[var(--nimi-text-muted)]"
    >
      <div className="text-[14px]">还没有照片记录</div>
      <Button
        type="button"
        onClick={onCapture}
        tone="primary"
        size="md"
        className="text-[13px]"
      >
        + 拍一组
      </Button>
    </Surface>
  );
}

export function Loading() {
  return (
    <div
      className="text-center text-[13px] text-[var(--nimi-text-muted)]"
      style={{
        padding: 32,
      }}
    >
      加载中…
    </div>
  );
}

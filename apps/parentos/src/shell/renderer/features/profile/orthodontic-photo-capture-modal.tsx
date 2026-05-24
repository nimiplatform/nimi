import { Button, Surface, TextField } from '@nimiplatform/kit/ui';
import { useEffect, useRef, useState } from 'react';
import {
  attachOrthodonticPhoto,
  canonicalizePhotoMime,
  deleteOrthodonticPhotoSession,
  insertOrthodonticPhotoSession,
  MAX_PHOTO_BASE64_PAYLOAD_BYTES,
  type OrthodonticApplianceRow,
  type OrthodonticPhotoAngle,
  PhotoAngleAlreadyExistsError,
} from '../../bridge/sqlite-bridge.js';
import { isoNow, ulid } from '../../bridge/ulid.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';

interface Props {
  childId: string;
  caseId: string;
  /** Pin the session to this appliance when set (typically the clear-aligner). */
  appliance: OrthodonticApplianceRow | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string | null) => void;
}

interface SlotState {
  file: File | null;
  rawBytesPreview: string | null;
  base64: string | null;
}

const EMPTY_SLOT: SlotState = { file: null, rawBytesPreview: null, base64: null };

/**
 * Two-angle photo capture modal. Front + side slots each take one file
 * through a native picker, the renderer reads as base64, then
 * `attachOrthodonticPhoto` does the codec gate / unique-index dance.
 *
 * Session metadata (tray index, note) is set once for the whole capture.
 * Both slots are optional — saving with one slot filled is admitted, the
 * unfilled slot can be added later through this same modal.
 */
export function OrthodonticPhotoCaptureModal({
  childId,
  caseId,
  appliance,
  onClose,
  onSaved,
  onError,
}: Props) {
  const isClearAligner = appliance?.applianceType === 'clear-aligner';
  // Wave D audit follow-up (W-D-2): sessionId is generated ONCE per modal
  // mount, not on every submit. If a partial attach fails mid-flow, the
  // catch branch best-effort-deletes the session row (which cascades both
  // any successful attach + its file via the v18 trigger + Tauri command
  // two-phase delete), so re-submit starts from a clean slate. Without
  // this, an orphan session with one angle would survive every retry.
  const [sessionId] = useState(() => ulid());
  const [trayIndex, setTrayIndex] = useState<string>('');
  const [sessionDate, setSessionDate] = useState<string>(todayYmd());
  const [note, setNote] = useState<string>('');
  const [front, setFront] = useState<SlotState>(EMPTY_SLOT);
  const [side, setSide] = useState<SlotState>(EMPTY_SLOT);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setLocalError(null);
    onError(null);
    if (!sessionDate.trim()) {
      setLocalError('请填写拍摄日期');
      return;
    }
    if (!front.base64 && !side.base64) {
      setLocalError('至少选择一张照片（正面或侧面）');
      return;
    }
    let trayIndexNumber: number | null = null;
    if (trayIndex.trim() !== '') {
      const n = Number(trayIndex.trim());
      if (!Number.isInteger(n) || n < 1) {
        setLocalError('牙套序号必须为大于等于 1 的整数');
        return;
      }
      if (!isClearAligner) {
        setLocalError('牙套序号只在「隐形牙套」装置上有效');
        return;
      }
      trayIndexNumber = n;
    }

    setSubmitting(true);
    const now = isoNow();
    let sessionInserted = false;
    try {
      await insertOrthodonticPhotoSession({
        sessionId,
        childId,
        caseId,
        applianceId: appliance?.applianceId ?? null,
        trayIndex: trayIndexNumber,
        sessionDate: sessionDate.trim(),
        note: note.trim() === '' ? null : note.trim(),
        now,
      });
      sessionInserted = true;

      if (front.base64 && front.file) {
        await attachOne({
          angle: 'front',
          file: front.file,
          base64: front.base64,
          childId,
          sessionId,
          now,
        });
      }
      if (side.base64 && side.file) {
        await attachOne({
          angle: 'side',
          file: side.file,
          base64: side.base64,
          childId,
          sessionId,
          now,
        });
      }
      await onSaved();
    } catch (err) {
      const msg = formatCaptureError(err);
      catchLog('ortho', 'action:capture-photo-session-failed')(err);
      // Best-effort rollback: drop the half-built session so the next
      // submit re-creates a clean record. The v18 trigger + command-layer
      // two-phase delete will sweep any successful attach + its file.
      if (sessionInserted) {
        try {
          await deleteOrthodonticPhotoSession({ sessionId, childId });
        } catch (rollbackErr) {
          catchLog('ortho', 'action:capture-rollback-failed')(rollbackErr);
        }
      }
      setLocalError(msg);
      onError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="拍一组牙齿照片"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        zIndex: 100,
      }}
      className="bg-[var(--nimi-scrim-modal)]"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <Surface
        tone="overlay"
        material="glass-thick"
        elevation="modal"
        padding="lg"
        className="rounded-3xl"
        style={{
          width: 'min(520px, 92vw)',
          maxHeight: '90vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h3 className="m-0 text-[16px] font-semibold text-[var(--nimi-text-primary)]">
            拍一组牙齿照片
          </h3>
          <Button
            onClick={() => !submitting && onClose()}
            tone="ghost"
            size="sm"
            className="h-7 min-h-7 w-7 rounded-full px-0 text-[18px]"
            aria-label="关闭"
          >
            ×
          </Button>
        </header>

        {localError && (
          <Surface
            role="alert"
            tone="card"
            material="solid"
            elevation="base"
            padding="sm"
            className="rounded-xl border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,var(--nimi-border-subtle))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] text-[13px] text-[var(--nimi-status-danger)]"
          >
            {localError}
          </Surface>
        )}

        <PhotoSlot
          label="正面"
          slot={front}
          onChange={(s) => setFront(s)}
          onSlotError={setLocalError}
        />
        <PhotoSlot
          label="侧面"
          slot={side}
          onChange={(s) => setSide(s)}
          onSlotError={setLocalError}
        />

        <Field label="拍摄日期">
          <TextField
            type="date"
            value={sessionDate}
            onChange={(e) => setSessionDate(e.target.value)}
            className="w-full"
          />
        </Field>

        {isClearAligner && (
          <Field label="对应牙套序号（可选）">
            <TextField
              type="number"
              min={1}
              value={trayIndex}
              placeholder={appliance?.totalAligners ? `1 – ${appliance.totalAligners}` : '1+'}
              onChange={(e) => setTrayIndex(e.target.value)}
              className="w-full"
            />
          </Field>
        )}

        <Field label="备注（可选）">
          <TextField
            type="text"
            value={note}
            placeholder="复诊确认 / 治疗起点 / …"
            onChange={(e) => setNote(e.target.value)}
            className="w-full"
          />
        </Field>

        <footer
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
            marginTop: 8,
          }}
        >
          <Button
            onClick={() => onClose()}
            disabled={submitting}
            tone="ghost"
            size="md"
          >
            取消
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            tone="primary"
            size="md"
          >
            {submitting ? '保存中…' : '保存'}
          </Button>
        </footer>
      </Surface>
    </div>
  );
}

// ── Slot UI ───────────────────────────────────────────────

function PhotoSlot({
  label,
  slot,
  onChange,
  onSlotError,
}: {
  label: string;
  slot: SlotState;
  onChange: (s: SlotState) => void;
  onSlotError: (msg: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!slot.file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(slot.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [slot.file]);

  const handleFile = async (file: File) => {
    onSlotError(null);
    const canonicalized = canonicalizePhotoMime(file.type);
    if (!canonicalized) {
      onSlotError(`不支持的图片格式: ${file.type || '未知'}（仅支持 JPEG / PNG / WebP）`);
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      if (base64.length > MAX_PHOTO_BASE64_PAYLOAD_BYTES) {
        onSlotError(
          `照片太大（${formatMb(base64.length)}），请压缩到 ${formatMb(MAX_PHOTO_BASE64_PAYLOAD_BYTES)} 以内再上传`,
        );
        return;
      }
      onChange({ file, rawBytesPreview: null, base64 });
    } catch (err) {
      onSlotError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Surface
      tone="card"
      material="solid"
      elevation="base"
      padding="sm"
      className="border-dashed bg-[color-mix(in_srgb,var(--nimi-text-primary)_2%,var(--nimi-surface-card))]"
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'center',
      }}
    >
      <div
        className="rounded-xl bg-[var(--nimi-surface-active)] text-[var(--nimi-text-muted)]"
        style={{
          width: 64,
          height: 64,
          overflow: 'hidden',
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          fontSize: 11,
        }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={`${label} 预览`}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span>{label}</span>
        )}
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">
          {label}
        </div>
        {slot.file ? (
          <div
            className="text-[12px] text-[var(--nimi-text-muted)]"
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {slot.file.name}
          </div>
        ) : (
          <div className="text-[12px] text-[var(--nimi-text-muted)]">
            JPEG / PNG / WebP — 自动压缩到 1600px
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button
          onClick={() => inputRef.current?.click()}
          tone="secondary"
          size="sm"
          className="text-[12px]"
        >
          {slot.file ? '更换' : '选择照片'}
        </Button>
        {slot.file && (
          <Button
            onClick={() => {
              if (inputRef.current) inputRef.current.value = '';
              onChange(EMPTY_SLOT);
            }}
            tone="ghost"
            size="sm"
            className="text-[12px]"
          >
            清空
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </Surface>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="text-[12px] font-medium text-[var(--nimi-text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

// ── Helpers ────────────────────────────────────────────────

async function attachOne(params: {
  angle: OrthodonticPhotoAngle;
  file: File;
  base64: string;
  childId: string;
  sessionId: string;
  now: string;
}) {
  await attachOrthodonticPhoto({
    attachmentId: ulid(),
    childId: params.childId,
    sessionId: params.sessionId,
    fileName: params.file.name,
    rawMimeType: params.file.type,
    angle: params.angle,
    imageBase64: params.base64,
    now: params.now,
  });
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCaptureError(err: unknown): string {
  if (err instanceof PhotoAngleAlreadyExistsError) {
    return `该角度（${err.angle === 'front' ? '正面' : '侧面'}）已存在照片，请先删除现有附件再重新上传`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader 返回非字符串结果'));
        return;
      }
      // result is `data:mime;base64,<...>` — strip the prefix.
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

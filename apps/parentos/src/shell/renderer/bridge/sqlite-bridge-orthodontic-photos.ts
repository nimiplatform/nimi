/**
 * Typed Tauri bridge for the orthodontic photo session surface
 * (`PO-ORTHO-012`).
 *
 * This module is intentionally separated from `sqlite-bridge-orthodontic.ts`
 * because the photo flow lives behind a distinct PIPL boundary: image bytes
 * never leave the device, never enter an AI prompt, and never travel through
 * the generic `attachments` save / delete bridge. Rust enforces all three
 * invariants; this module makes them obvious at the call site.
 *
 * The generic `saveAttachment` / `deleteAttachment` exports in
 * `sqlite-bridge-records.ts` MUST NOT be used for photo-session attachments.
 * Rust will fail-close on the attempt (see `attachment_store.rs` post-B1),
 * but the renderer should reach for `attachOrthodonticPhoto` /
 * `deleteOrthodonticPhotoAttachment` instead so the type-checker, the
 * codebase reader, and the runtime all agree.
 *
 * Authority:
 *   spec/kernel/orthodontic-contract.md#PO-ORTHO-012
 *   src-tauri/src/orthodontic_photos.rs (Tauri commands)
 *   src-tauri/src/photos/mod.rs (codec gate)
 */

import { invoke } from '@tauri-apps/api/core';

// ── Admitted enums ────────────────────────────────────────────────────────

/** Admitted photo session angles (PO-ORTHO-012 v1). */
export type OrthodonticPhotoAngle = 'front' | 'side';

/**
 * IANA-conformant mime types admitted by the Rust codec gate. The renderer
 * MUST canonicalize inbound file-picker / drag-and-drop mime labels through
 * `canonicalizePhotoMime` before invoking `attachOrthodonticPhoto`.
 *
 * Source of truth: `photos::is_admitted_mime`. Output JPEG is always
 * `image/jpeg` (the Rust pipeline re-encodes); this set only governs the
 * decoder gate on the way in.
 */
export type AdmittedPhotoInputMime = 'image/jpeg' | 'image/png' | 'image/webp';

// ── Row shapes (mirror Rust serde camelCase output) ───────────────────────

export interface OrthodonticPhotoSessionRow {
  sessionId: string;
  childId: string;
  caseId: string;
  /** Pin to a specific appliance. Null when the session spans the whole case. */
  applianceId: string | null;
  /** Clear-aligner only; the tray number at capture time. */
  trayIndex: number | null;
  sessionDate: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrthodonticPhotoAttachmentRow {
  attachmentId: string;
  childId: string;
  sessionId: string;
  angle: OrthodonticPhotoAngle;
  /**
   * Absolute on-disk path under `${appLocalData}/parentos/photos/...`. The
   * renderer MUST NOT pass this back into Tauri's asset protocol or any
   * other read path — bytes must be retrieved via `readOrthodonticPhotoBlob`,
   * which validates the path is inside the owned photos root (PO-ORTHO-012).
   */
  filePath: string;
  fileName: string;
  /** Persisted mime is always `image/jpeg` after the Rust re-encode pipeline. */
  mimeType: string;
  createdAt: string;
}

export interface OrthodonticPhotoSessionBundle {
  session: OrthodonticPhotoSessionRow;
  attachments: OrthodonticPhotoAttachmentRow[];
}

// ── Renderer-side fail-close constants ────────────────────────────────────

/**
 * Maximum admitted base64 payload size for a single photo upload.
 *
 * 20 MB base64 ≈ 15 MB raw bytes ≈ a high-resolution phone photo. The Rust
 * codec gate decodes the entire bitmap in memory before downsampling, so
 * uncapped uploads can OOM the Tauri shell on lower-end machines. The cap
 * is enforced renderer-side (here) AND must remain admissible by the spec
 * (Wave B audit follow-up).
 */
export const MAX_PHOTO_BASE64_PAYLOAD_BYTES = 20 * 1024 * 1024;

// ── Pure helpers (used by Wave D capture flow) ────────────────────────────

/**
 * Canonicalize an inbound mime string against the PO-ORTHO-012 admitted set.
 *
 * File pickers / drag-and-drop / clipboard paste can emit non-IANA labels:
 * `image/jpg` (common), `image/pjpeg` (progressive variant from older
 * Windows), `image/x-png` (IE legacy), or even an empty string. The Rust
 * gate admits exactly `image/jpeg | image/png | image/webp` (Wave B audit
 * follow-up W2); canonicalize at the boundary so a capture form can fail
 * fast with a clear error before the bytes travel across the bridge.
 *
 * Returns `null` when the mime is outside the admitted set — callers MUST
 * surface a typed error rather than passing through, since the Rust side
 * will fail-close anyway with a less actionable message.
 */
export function canonicalizePhotoMime(
  raw: string | null | undefined,
): AdmittedPhotoInputMime | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  switch (trimmed) {
    case 'image/jpeg':
    case 'image/jpg':
    case 'image/pjpeg':
      return 'image/jpeg';
    case 'image/png':
    case 'image/x-png':
      return 'image/png';
    case 'image/webp':
      return 'image/webp';
    default:
      return null;
  }
}

/**
 * Typed error thrown by `attachOrthodonticPhoto` when the partial unique
 * index (or its W1 pre-check) rejects a (sessionId, angle) duplicate.
 *
 * The capture UI can `catch` and recognize this without brittle substring
 * matches against Rust's localizable error strings. Wave B audit follow-up
 * #2 — UI must distinguish "delete the existing angle first" from "system
 * error" so the user is not stuck retrying a doomed action.
 */
export class PhotoAngleAlreadyExistsError extends Error {
  readonly sessionId: string;
  readonly angle: OrthodonticPhotoAngle;
  readonly rustMessage: string;

  constructor(sessionId: string, angle: OrthodonticPhotoAngle, rustMessage: string) {
    super(`photo for angle "${angle}" already exists on session ${sessionId}`);
    this.name = 'PhotoAngleAlreadyExistsError';
    this.sessionId = sessionId;
    this.angle = angle;
    this.rustMessage = rustMessage;
  }
}

// ── Tauri invokers ────────────────────────────────────────────────────────

/**
 * Create a session row WITHOUT any attached photos. The renderer's normal
 * capture flow goes session → 1..2 attaches, so this is exported so the
 * capture modal can stage the session id, optimistically display the
 * empty session card, and then attach photos as they finish processing.
 *
 * Rust enforces the caseId/childId round-trip and the trayIndex /
 * clear-aligner pairing rule (PO-ORTHO-012).
 */
export function insertOrthodonticPhotoSession(params: {
  sessionId: string;
  childId: string;
  caseId: string;
  applianceId: string | null;
  trayIndex: number | null;
  sessionDate: string;
  note: string | null;
  now: string;
}) {
  return invoke<OrthodonticPhotoSessionRow>('insert_orthodontic_photo_session', params);
}

/** Edit session metadata (date / tray / note). Does NOT touch attachments. */
export function updateOrthodonticPhotoSession(params: {
  sessionId: string;
  trayIndex: number | null;
  sessionDate: string;
  note: string | null;
  now: string;
}) {
  return invoke<void>('update_orthodontic_photo_session', params);
}

/**
 * Attach a photo to an existing session: canonicalize the mime, validate
 * the base64 payload size, then hand the bytes to the Rust codec gate
 * (`attach_orthodontic_photo`). Rust does the decode/downsample/re-encode
 * + writes the JPEG + inserts the `attachments` row in one shot.
 *
 * Throws `PhotoAngleAlreadyExistsError` when the (sessionId, angle) pair
 * already has an attachment (Wave B audit W1). Throws a regular Error for
 * all other failure modes (mime / payload size / Rust codec / DB).
 */
export async function attachOrthodonticPhoto(params: {
  attachmentId: string;
  childId: string;
  sessionId: string;
  fileName: string;
  /**
   * Raw mime from the file picker / drag-and-drop. This wrapper canonicalizes
   * it through `canonicalizePhotoMime` before invoking, so the caller does
   * not need to pre-normalize (but `canonicalizePhotoMime` is exported for
   * UI-side validation if the form wants to disable the submit button).
   */
  rawMimeType: string;
  angle: OrthodonticPhotoAngle;
  imageBase64: string;
  now: string;
}): Promise<OrthodonticPhotoAttachmentRow> {
  const mimeType = canonicalizePhotoMime(params.rawMimeType);
  if (mimeType === null) {
    throw new Error(
      `unsupported photo mime "${params.rawMimeType}"; expected image/jpeg | image/png | image/webp (PO-ORTHO-012)`,
    );
  }
  if (params.imageBase64.length > MAX_PHOTO_BASE64_PAYLOAD_BYTES) {
    throw new Error(
      `photo payload exceeds the ${MAX_PHOTO_BASE64_PAYLOAD_BYTES.toLocaleString()}-byte base64 cap; downsize before upload`,
    );
  }
  try {
    return await invoke<OrthodonticPhotoAttachmentRow>('attach_orthodontic_photo', {
      attachmentId: params.attachmentId,
      childId: params.childId,
      sessionId: params.sessionId,
      fileName: params.fileName,
      mimeType,
      angle: params.angle,
      imageBase64: params.imageBase64,
      now: params.now,
    });
  } catch (err) {
    if (typeof err === 'string' && err.startsWith('photo for angle ')) {
      throw new PhotoAngleAlreadyExistsError(params.sessionId, params.angle, err);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * List every photo session for a given case bundled with its attachments.
 * One round-trip per case; sessions sorted ASC by sessionDate so the album
 * UI can render the growth timeline directly.
 */
export function listOrthodonticPhotoSessionBundles(params: { caseId: string; childId: string }) {
  return invoke<OrthodonticPhotoSessionBundle[]>(
    'list_orthodontic_photo_session_bundles',
    params,
  );
}

/**
 * Read raw JPEG bytes for one attachment as base64. The renderer should
 * wrap the returned string into a `data:image/jpeg;base64,...` URL for
 * `<img>` consumption. This is the **only** admitted read channel for
 * photo bytes — `convertFileSrc(filePath)` and the Tauri asset protocol
 * bypass the photos-root canonicalize check and MUST NOT be used.
 */
export function readOrthodonticPhotoBlob(attachmentId: string) {
  return invoke<string>('read_orthodontic_photo_blob', { attachmentId });
}

/**
 * Two-phase delete: collect attachment file paths, delete the session row
 * (the v18 `AFTER DELETE` trigger sweeps the attachments rows atomically),
 * then prune the on-disk session directory. Rust returns a typed error if
 * any file purge step fails — the DB state is already consistent at that
 * point, so the renderer should surface the error verbatim for manual
 * cleanup.
 */
export function deleteOrthodonticPhotoSession(params: { sessionId: string; childId: string }) {
  return invoke<void>('delete_orthodontic_photo_session', params);
}

/**
 * Delete a single attachment row + its on-disk file. The dedicated path
 * (vs the generic `deleteAttachment` in `sqlite-bridge-records.ts`)
 * guarantees the photo file is actually removed; the generic path lives
 * under `parentos/attachments/` and silently skips files under
 * `parentos/photos/` (this is the Wave B audit B1 mitigation, the Rust
 * side will fail-close on misuse).
 */
export function deleteOrthodonticPhotoAttachment(attachmentId: string) {
  return invoke<void>('delete_orthodontic_photo_attachment', { attachmentId });
}

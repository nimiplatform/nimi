import { useCallback, useEffect, useMemo, useState } from 'react';
import { Surface } from '@nimiplatform/kit/ui';
import {
  deleteOrthodonticPhotoSession,
  listOrthodonticPhotoSessionBundles,
  type OrthodonticPhotoAngle,
  type OrthodonticPhotoAttachmentRow,
  type OrthodonticPhotoSessionBundle,
} from '../../bridge/sqlite-bridge.js';
import { catchLog } from '../../infra/telemetry/catch-log.js';
import { CompareView } from './orthodontic-teeth-selfies-compare.js';
import { Header, type CompareMode } from './orthodontic-teeth-selfies-header.js';
import { EmptyState, Loading, SessionStrip } from './orthodontic-teeth-selfies-session-strip.js';

interface Props {
  childId: string;
  caseId: string;
  /** Open the capture modal. The page-level controller owns its state. */
  onOpenCapture: () => void;
  /** Reload trigger — bumped by capture-saved / delete-saved. */
  reloadKey: number;
  onError: (msg: string | null) => void;
}


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

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { desktopBridge, type NimiProductControlRecordProjection } from '@renderer/bridge';
import { ProductControlWorkflow } from '../../first-run/product-control-workflow.js';

/**
 * Non-ready first-run gate.
 *
 * The gate hosts the redesigned first-run onboarding wizard
 * (`ProductControlWorkflow`). The wizard is a full-window takeover that owns
 * its own chrome, so the gate panel only sources the product-control projection
 * and mounts the wizard. Per the first-run gate contract this gate renders ONLY
 * the product-control setup surface; no ordinary Home-adjacent surfaces.
 */

const FIRST_RUN_PRODUCT_CONTROL_REFRESH_MS = 3_000;

function useProductControlRecord(): {
  projection: NimiProductControlRecordProjection | null;
  setProjection: (projection: NimiProductControlRecordProjection) => void;
} {
  const [projection, setProjection] = useState<NimiProductControlRecordProjection | null>(null);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const projectReadFailure = (error: unknown): void => {
      const message = error instanceof Error ? error.message : 'product control record unavailable';
      setProjection((current) => {
        if (current) return { ...current, error: message };
        return {
          path: '',
          exists: false,
          state: 'repair_required',
          record: null,
          dataRootProposal: null,
          error: message,
        };
      });
    };
    const refreshProductControlRecord = async (): Promise<void> => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      try {
        const next = await desktopBridge.getProductControlRecord();
        if (!cancelled) setProjection(next);
      } catch (error) {
        if (!cancelled) {
          // A failed initial read fails closed onto `repair_required`. Later
          // refresh failures preserve the last projection and surface the error
          // on it, so a transient read failure does not mint a fake ready state.
          projectReadFailure(error);
        }
      } finally {
        refreshInFlightRef.current = false;
      }
    };

    void refreshProductControlRecord();
    const intervalId = window.setInterval(
      () => void refreshProductControlRecord(),
      FIRST_RUN_PRODUCT_CONTROL_REFRESH_MS,
    );
    window.addEventListener('focus', refreshProductControlRecord);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshProductControlRecord);
    };
  }, []);

  return { projection, setProjection };
}

type FirstRunGatePanelProps = {
  readonly onReadyForUse?: () => void;
};

export function FirstRunGatePanel(props: FirstRunGatePanelProps): ReactElement {
  const { projection, setProjection } = useProductControlRecord();
  const onReadyForUse = props.onReadyForUse;

  useEffect(() => {
    if (projection?.state === 'ready_for_use') {
      onReadyForUse?.();
    }
  }, [projection?.state, onReadyForUse]);

  const updateProjection = useCallback(
    (next: NimiProductControlRecordProjection): void => {
      setProjection(next);
      if (next.state === 'ready_for_use') {
        onReadyForUse?.();
      }
    },
    [onReadyForUse, setProjection],
  );

  return (
    <div data-testid="first-run-gate-panel" className="flex min-h-0 flex-1 flex-col">
      <ProductControlWorkflow projection={projection} onProjectionChange={updateProjection} />
    </div>
  );
}

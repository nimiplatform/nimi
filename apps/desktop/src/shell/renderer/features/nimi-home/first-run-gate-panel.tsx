import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { desktopBridge, type NimiProductControlRecordProjection } from '@renderer/bridge';
import { ProductControlWorkflow } from '../../first-run/product-control-workflow.js';

/**
 * Non-ready first-run gate.
 *
 * The gate hosts the redesigned first-run onboarding wizard
 * (`ProductControlWorkflow`). The wizard is a full-window takeover that owns
 * its own chrome — wordmark, Support entry, step indicator, and centered card
 * — so the gate panel only sources the product-control projection and mounts
 * the wizard. Per the first-run gate contract this gate renders ONLY the
 * product-control setup surface; no ordinary Home-adjacent surfaces.
 */

function useProductControlRecord(): {
  projection: NimiProductControlRecordProjection | null;
  setProjection: (projection: NimiProductControlRecordProjection) => void;
} {
  const [projection, setProjection] = useState<NimiProductControlRecordProjection | null>(null);

  useEffect(() => {
    let cancelled = false;
    void desktopBridge
      .getProductControlRecord()
      .then((next) => {
        if (!cancelled) setProjection(next);
      })
      .catch((error) => {
        if (!cancelled) {
          // A failed product-control read fails closed onto `repair_required`
          // — the wizard presents the calm repair terminal screen.
          setProjection({
            path: '',
            exists: false,
            state: 'repair_required',
            record: null,
            error: error instanceof Error ? error.message : 'product control record unavailable',
          });
        }
      });
    return () => {
      cancelled = true;
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

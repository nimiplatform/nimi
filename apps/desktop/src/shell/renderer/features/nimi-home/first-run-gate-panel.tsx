import { useEffect, useState, type ReactElement } from 'react';
import { desktopBridge, type ProductControlRecordProjection } from '@renderer/bridge';
import { ProductControlWorkflow } from '../../first-run/index.js';

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
  projection: ProductControlRecordProjection | null;
  setProjection: (projection: ProductControlRecordProjection) => void;
} {
  const [projection, setProjection] = useState<ProductControlRecordProjection | null>(null);

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

export function FirstRunGatePanel(): ReactElement {
  const { projection, setProjection } = useProductControlRecord();

  return (
    <div data-testid="first-run-gate-panel" className="flex min-h-0 flex-1 flex-col">
      <ProductControlWorkflow projection={projection} onProjectionChange={setProjection} />
    </div>
  );
}

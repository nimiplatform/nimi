import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import { ProductControlWorkflow } from '../../first-run/product-control-workflow.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context';

/**
 * Non-ready first-run gate.
 *
 * The gate hosts the redesigned first-run onboarding wizard
 * (`ProductControlWorkflow`). The wizard is a full-window takeover that owns
 * its own chrome, so the gate panel only sources the product-control projection
 * and mounts the wizard. Per the first-run gate contract this gate renders ONLY
 * the product-control setup surface; no ordinary Home-adjacent surfaces.
 */

function useProductControlRecord(): {
  projection: NimiProductControlRecordProjection | null;
  setProjection: (projection: NimiProductControlRecordProjection) => void;
} {
  const [projection, setProjection] = useState<NimiProductControlRecordProjection | null>(null);
  const bindings = useDesktopRendererBindings();

  useEffect(() => {
    return bindings.app.events.subscribeProductControlRecord((result) => {
      if (result.ok) {
        setProjection(result.projection);
        return;
      }
      setProjection((current) => {
        if (current) return { ...current, error: result.error };
        return {
          path: '',
          exists: false,
          state: 'repair_required',
          record: null,
          dataRootProposal: null,
          error: result.error,
        };
      });
    });
  }, [bindings]);

  return { projection, setProjection };
}

type FirstRunGatePanelProps = {
  readonly onReadyForUse?: () => void;
};

export function FirstRunGatePanel(props: FirstRunGatePanelProps): ReactElement {
  const bindings = useDesktopRendererBindings();
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
      <ProductControlWorkflow
        clock={bindings.clock}
        firstRun={bindings.app.commands.firstRun}
        projection={projection}
        onProjectionChange={updateProjection}
      />
    </div>
  );
}

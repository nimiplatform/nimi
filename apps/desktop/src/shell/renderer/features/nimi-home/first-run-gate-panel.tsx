import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import { useAppStore } from '../../app-shell/providers/app-store';
import { logoutAndClearSession, useLogoutSessionDependencies } from '../auth/logout.js';
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
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);
  const logoutDependencies = useLogoutSessionDependencies();
  const [signingOut, setSigningOut] = useState(false);
  const { projection, setProjection } = useProductControlRecord();
  const onReadyForUse = props.onReadyForUse;

  const signOut = useCallback(async (): Promise<void> => {
    setSigningOut(true);
    try {
      await logoutAndClearSession(
        { clearAuthSession, onFeedback: logoutDependencies.feedback },
        logoutDependencies.logout,
      );
    } finally {
      setSigningOut(false);
    }
  }, [clearAuthSession, logoutDependencies]);

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
    <div data-testid="first-run-gate-panel" className="relative flex min-h-0 flex-1 flex-col">
      <ProductControlWorkflow
        firstRun={bindings.app.commands.firstRun}
        projection={projection}
        onProjectionChange={updateProjection}
      />
      <Button
        type="button"
        tone="ghost"
        data-testid="first-run-account-sign-out"
        className="absolute bottom-4 right-6 z-20"
        disabled={signingOut}
        onClick={() => { void signOut(); }}
      >
        {t('Menu.logout', { defaultValue: 'Log out' })}
      </Button>
    </div>
  );
}

import { useCallback, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import type { NimiProductControlRecordProjection } from '@nimiplatform/sdk/runtime';
import { useAppStore } from '../../app-shell/providers/app-store';
import { logoutAndClearSession, useLogoutSessionDependencies } from '../auth/logout.js';
import { ProductControlWorkflow } from '../../first-run/product-control-workflow.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context';

type FirstRunGatePanelProps = {
  readonly projection: NimiProductControlRecordProjection;
  readonly onProjectionChange: () => void;
};

export function FirstRunGatePanel(props: FirstRunGatePanelProps): ReactElement {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const authStatus = useAppStore((state) => state.auth.status);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);
  const logoutDependencies = useLogoutSessionDependencies();
  const [signingOut, setSigningOut] = useState(false);
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

  return (
    <div data-testid="first-run-gate-panel" className="relative flex min-h-0 flex-1 flex-col">
      <ProductControlWorkflow
        firstRun={bindings.app.commands.firstRun}
        projection={props.projection}
        onProjectionChange={props.onProjectionChange}
      />
      {authStatus === 'authenticated' || authStatus === 'refresh-pending' ? (
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
      ) : null}
    </div>
  );
}

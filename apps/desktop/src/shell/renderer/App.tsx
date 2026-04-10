import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { AppProviders } from '@renderer/app-shell/providers/app-providers';
import { AppRoutes } from '@renderer/app-shell/routes/app-routes';
import { AppErrorBoundary } from '@renderer/infra/error-boundary/app-error-boundary';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { onI18nIssue } from '@renderer/i18n';
import { useMenuBarNavigationListener } from '@renderer/infra/menu-bar/menu-bar-navigation-listener';
import { useMenuBarRuntimeSync } from '@renderer/infra/menu-bar/menu-bar-runtime-sync';
import { useDesktopUpdatesBootstrap } from '@renderer/infra/bootstrap/desktop-updates';
import { useRuntimeHealthCoordinatorBootstrap } from '@renderer/features/runtime-config/runtime-health-coordinator';

const WEB_BOOTSTRAP_TIMEOUT_MS = 15000;
const DESKTOP_BOOTSTRAP_TIMEOUT_MS = 25000;

async function runBootstrapRuntime(): Promise<void> {
  const module = await import('@renderer/infra/bootstrap/runtime-bootstrap');
  await module.bootstrapRuntime();
}

function AppBoot() {
  const { t } = useTranslation();
  const shellMode = getShellFeatureFlags().mode;
  const setBootstrapError = useAppStore((state) => state.setBootstrapError);
  const setBootstrapReady = useAppStore((state) => state.setBootstrapReady);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const runtimeHealthBootstrapEnabled = shellMode === 'desktop' && bootstrapReady;

  useMenuBarNavigationListener();
  useRuntimeHealthCoordinatorBootstrap(runtimeHealthBootstrapEnabled);
  useMenuBarRuntimeSync();
  useDesktopUpdatesBootstrap(bootstrapReady);

  useEffect(() => {
    const flowId = createRendererFlowId('renderer-bootstrap');
    let settled = false;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    logRendererEvent({
      level: 'info',
      area: 'renderer-bootstrap',
      message: 'phase:bootstrap:start',
      flowId,
      details: {
        startedAt: new Date().toISOString(),
      },
    });

    const timeoutMs = shellMode === 'web'
      ? WEB_BOOTSTRAP_TIMEOUT_MS
      : DESKTOP_BOOTSTRAP_TIMEOUT_MS;
    timeoutId = setTimeout(() => {
      if (settled || cancelled) return;
      settled = true;
      if (shellMode === 'web') {
        setBootstrapReady(true);
        setBootstrapError(null);
        setStatusBanner({
          kind: 'warning',
          message: t('Bootstrap.webDegraded'),
        });
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:bootstrap:timeout-degraded',
          flowId,
          details: {
            timeoutMs,
            shellMode,
          },
        });
        return;
      }
      const message = t('Bootstrap.runtimeInitTimeout');
      setBootstrapReady(false);
      setBootstrapError(message);
      setStatusBanner({
        kind: 'error',
        message,
      });
      logRendererEvent({
        level: 'error',
        area: 'renderer-bootstrap',
        message: 'phase:bootstrap:timeout-failed',
        flowId,
        details: {
          timeoutMs,
          shellMode,
        },
      });
    }, timeoutMs);

    void runBootstrapRuntime()
      .then(() => {
        if (settled || cancelled) return;
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        setBootstrapReady(true);
        setBootstrapError(null);
        logRendererEvent({
          level: 'info',
          area: 'renderer-bootstrap',
          message: 'phase:bootstrap-watchdog:done',
          flowId,
        });
      })
      .catch((error) => {
        if (settled || cancelled) return;
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        const message = error instanceof Error ? error.message : String(error || 'bootstrap failed');
        setBootstrapError(message);
        setBootstrapReady(false);
        setStatusBanner({
          kind: 'error',
          message: `${t('Bootstrap.startFailedPrefix')}: ${message}`,
        });
        logRendererEvent({
          level: 'error',
          area: 'renderer-bootstrap',
          message: 'phase:bootstrap-watchdog:failed',
          flowId,
          details: {
            error: message,
          },
        });
      });

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [setBootstrapError, setBootstrapReady, setStatusBanner, t]);

  useEffect(() => {
    const unsubscribe = onI18nIssue((issue) => {
      logRendererEvent({
        level: issue.severity === 'error' ? 'error' : 'warn',
        area: 'i18n',
        message: issue.code,
        details: {
          key: issue.key,
          locale: issue.locale,
          namespace: issue.namespace,
          source: issue.source,
          chain: issue.chain,
        },
      });
    });
    return unsubscribe;
  }, []);

  return <AppRoutes />;
}

export default function App() {
  return (
    <AppProviders>
      <AppErrorBoundary>
        <AppBoot />
      </AppErrorBoundary>
    </AppProviders>
  );
}

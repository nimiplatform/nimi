import { E2E_IDS } from '../../testability/e2e-ids';
import {
  type DesktopMacosSmokeDriverDeps,
  type JsonObject,
} from './desktop-macos-smoke-shared';

function smokeDetailsFromError(error: unknown): JsonObject | undefined {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return undefined;
  }
  const details = (error as { smokeDetails?: unknown }).smokeDetails;
  return details && typeof details === 'object' && !Array.isArray(details)
    ? details as JsonObject
    : undefined;
}

export async function runDesktopMacosSmokeScenario(
  scenarioId: string,
  deps: DesktopMacosSmokeDriverDeps,
): Promise<void> {
  const steps: string[] = [];
  const record = (step: string) => {
    steps.push(step);
    deps.onStepStart?.(step, steps);
  };
  try {
    switch (scenarioId) {
      case 'boot.anonymous.login-screen':
        record('wait-login-screen');
        await deps.waitForTestId(E2E_IDS.loginScreen);
        record('verify-anonymous-sidebar-absent');
        await deps.waitForSelectorGone(`[data-testid="${E2E_IDS.shellSidebarRail}"]`, 500);
        record('verify-anonymous-main-shell-absent');
        await deps.waitForSelectorGone(`[data-testid="${E2E_IDS.mainShell}"]`, 500);
        record('verify-anonymous-chat-panel-absent');
        await deps.waitForSelectorGone(`[data-testid="${E2E_IDS.panel('chat')}"]`, 500);
        if (deps.currentHtml().includes('data-auth-mode="embedded"')) {
          record('open-embedded-email-login');
          await deps.clickByTestId(E2E_IDS.loginLogoTrigger);
          await deps.waitForTestId(E2E_IDS.loginEmailInput);
          record('open-alternative-login-panel');
          await deps.clickByTestId(E2E_IDS.loginAlternativeToggle);
          await deps.waitForTestId(E2E_IDS.loginAlternativePanel);
        }
        record('write-pass-report');
        await deps.writeReport({
          ok: true,
          steps,
          route: deps.currentRoute(),
          htmlSnapshot: deps.currentHtml(),
        });
        return;

      default:
        throw new Error(`unknown macOS smoke scenario: ${scenarioId}`);
    }
  } catch (error) {
    await deps.writeReport({
      ok: false,
      failedStep: steps[steps.length - 1] || 'bootstrap',
      steps,
      errorMessage: error instanceof Error ? error.message : String(error || 'unknown error'),
      errorName: error instanceof Error ? error.name : undefined,
      errorStack: error instanceof Error ? error.stack : undefined,
      errorCause: error instanceof Error ? String(error.cause || '') || undefined : undefined,
      route: deps.currentRoute(),
      htmlSnapshot: deps.currentHtml(),
      details: smokeDetailsFromError(error),
    });
    throw error;
  }
}

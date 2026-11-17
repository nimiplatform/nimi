import {
  runLocalHealthCheckCommandWithGuard,
  testSelectedConnectorCommand,
} from './runtime-config-provider-commands';
import type {
  RuntimeConfigPanelCommandsInput,
  TestConnectorCommandContext,
} from './runtime-config-command-context';
import { runRuntimeConfigAsyncGuard } from './runtime-config-runtime-ops';

export function createRuntimeConfigPanelCommands(input: RuntimeConfigPanelCommandsInput) {
  const runLocalHealthCheckAction = async () => {
    await runLocalHealthCheckCommandWithGuard(input.provider.health);
  };

  const runLocalHealthCheck = async () => {
    await runRuntimeConfigAsyncGuard(
      input.guard.checkingHealth,
      input.guard.setCheckingHealth,
      runLocalHealthCheckAction,
    );
  };

  const testSelectedConnector = async (setControlFeedback: TestConnectorCommandContext['setControlFeedback']) => {
    const context = { ...input.provider.testSelectedConnector, setControlFeedback };
    if (!context.selectedConnector) return;
    const { id, configurationVersion } = context.selectedConnector;
    await runRuntimeConfigAsyncGuard(
      input.guard.testingConnector,
      next => input.guard.setCheckingConnector(next ? { id, configurationVersion } : null),
      async () => {
        setControlFeedback(null);
        await testSelectedConnectorCommand(context);
      },
    );
  };

  return {
    runLocalHealthCheck,
    testSelectedConnector,
  };
}

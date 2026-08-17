import {
  runLocalHealthCheckCommandWithGuard,
  testSelectedConnectorCommand,
} from './runtime-config-provider-commands';
import type {
  RuntimeConfigPanelCommandsInput,
} from './runtime-config-command-context';
import { runRuntimeConfigAsyncGuard } from './runtime-config-runtime-ops';

export function createRuntimeConfigPanelCommands(input: RuntimeConfigPanelCommandsInput) {
  const runLocalHealthCheckAction = async () => {
    await runLocalHealthCheckCommandWithGuard(input.provider.health);
  };

  const testSelectedConnectorAction = async () => {
    await testSelectedConnectorCommand(input.provider.testSelectedConnector);
  };

  const runLocalHealthCheck = async () => {
    await runRuntimeConfigAsyncGuard(
      input.guard.checkingHealth,
      input.guard.setCheckingHealth,
      runLocalHealthCheckAction,
    );
  };

  const testSelectedConnector = async () => {
    await runRuntimeConfigAsyncGuard(
      input.guard.testingConnector,
      input.guard.setTestingConnector,
      testSelectedConnectorAction,
    );
  };

  return {
    runLocalHealthCheck,
    testSelectedConnector,
  };
}

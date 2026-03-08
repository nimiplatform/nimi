import {
  discoverLocalRuntimeModelsCommand,
  runLocalRuntimeHealthCheckCommandWithGuard,
  testSelectedConnectorCommand,
} from './runtime-config-provider-commands';
import type {
  RuntimeConfigPanelCommandsInput,
} from './runtime-config-command-context';
import { runRuntimeConfigAsyncGuard } from './runtime-config-runtime-ops';

export function createRuntimeConfigPanelCommands(input: RuntimeConfigPanelCommandsInput) {
  const discoverLocalRuntimeModelsAction = async () => {
    await discoverLocalRuntimeModelsCommand(input.provider.discover);
  };

  const runLocalRuntimeHealthCheckAction = async () => {
    await runLocalRuntimeHealthCheckCommandWithGuard(input.provider.health);
  };

  const testSelectedConnectorAction = async () => {
    await testSelectedConnectorCommand(input.provider.testSelectedConnector);
  };

  const discoverLocalRuntimeModels = async () => {
    await runRuntimeConfigAsyncGuard(
      input.guard.discovering,
      input.guard.setDiscovering,
      discoverLocalRuntimeModelsAction,
    );
  };

  const runLocalRuntimeHealthCheck = async () => {
    await runRuntimeConfigAsyncGuard(
      input.guard.checkingHealth,
      input.guard.setCheckingHealth,
      runLocalRuntimeHealthCheckAction,
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
    discoverLocalRuntimeModels,
    runLocalRuntimeHealthCheck,
    testSelectedConnector,
  };
}

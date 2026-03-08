import type {
  DiscoverProviderCommandContext,
  HealthProviderCommandContext,
  TestConnectorCommandContext,
} from './runtime-config-command-context';
import {
  markSelectedConnectorTestFailedCommand,
  runSelectedConnectorTestCommand,
} from './runtime-config-connector-test-command';
import { runDiscoverLocalRuntimeModelsCommand } from './runtime-config-connector-discover-command';
import { runLocalRuntimeHealthCheckCommand } from './runtime-config-connector-health-command';
import { formatRuntimeConfigErrorBanner } from './runtime-config-connector-error';

export async function discoverLocalRuntimeModelsCommand(input: DiscoverProviderCommandContext) {
  if (!input.state || input.discovering) return;
  try {
    await runDiscoverLocalRuntimeModelsCommand({
      state: input.state,
      updateState: input.updateState,
      setStatusBanner: input.setStatusBanner,
    });
  } catch (error) {
    input.setStatusBanner({
      kind: 'error',
      message: formatRuntimeConfigErrorBanner('LocalRuntime discovery failed', error),
    });
  }
}

export async function runLocalRuntimeHealthCheckCommandWithGuard(input: HealthProviderCommandContext) {
  if (!input.state || input.checkingHealth) return;
  try {
    await runLocalRuntimeHealthCheckCommand({
      state: input.state,
      updateState: input.updateState,
      setStatusBanner: input.setStatusBanner,
    });
  } catch (error) {
    input.setStatusBanner({
      kind: 'error',
      message: formatRuntimeConfigErrorBanner('Health check failed', error),
    });
  }
}

export async function testSelectedConnectorCommand(input: TestConnectorCommandContext) {
  if (!input.state || !input.selectedConnector || input.testingConnector) return;
  try {
    await runSelectedConnectorTestCommand({
      state: input.state,
      selectedConnector: input.selectedConnector,
      updateState: input.updateState,
      setStatusBanner: input.setStatusBanner,
    });
  } catch (error) {
    markSelectedConnectorTestFailedCommand({
      state: input.state,
      selectedConnector: input.selectedConnector,
      updateState: input.updateState,
      setStatusBanner: input.setStatusBanner,
      error,
    });
  }
}

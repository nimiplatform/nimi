import type {
  DiscoverProviderCommandContext,
  HealthProviderCommandContext,
  TestConnectorCommandContext,
} from './context';
import {
  markSelectedConnectorTestFailedCommand,
  runSelectedConnectorTestCommand,
} from '../domain/provider-connectors/connector-test-command';
import { runDiscoverLocalRuntimeModelsCommand } from '../domain/provider-connectors/discover-command';
import { runLocalRuntimeHealthCheckCommand } from '../domain/provider-connectors/health-command';

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
      message: `LocalRuntime discovery failed: ${error instanceof Error ? error.message : String(error || '')}`,
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
      message: `Health check failed: ${error instanceof Error ? error.message : String(error || '')}`,
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

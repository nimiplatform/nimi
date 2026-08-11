import assert from 'node:assert/strict';
import test from 'node:test';

import { createDesktopSimulatorRuntimeHealthCoordinator } from '../src/simulator/bindings.js';

test('Desktop Simulator exposes fail-closed Runtime health without crashing the renderer', async () => {
  const coordinator = createDesktopSimulatorRuntimeHealthCoordinator();

  assert.equal(coordinator.getSnapshot().started, false);
  await assert.rejects(
    coordinator.forceRefresh('simulator-test'),
    /DESKTOP_SIMULATOR_RUNTIME_HEALTH_UNADMITTED/u,
  );
  assert.equal(
    coordinator.getSnapshot().error,
    'DESKTOP_SIMULATOR_RUNTIME_HEALTH_UNADMITTED',
  );
  coordinator.stop();
});

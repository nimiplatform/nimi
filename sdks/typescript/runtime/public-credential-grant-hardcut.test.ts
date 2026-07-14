import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../core-client';
import { Runtime } from './index';

test('Runtime public surface has no credential-grant facade', () => {
  const transport: CoreTransport = {
    async unary() {
      throw new Error('transport must not be called while inspecting the surface');
    },
    async *serverStream() {
      throw new Error('transport must not be called while inspecting the surface');
    },
  };
  const runtime = new Runtime({ appId: 'sdk.public-authority-hardcut', transport });

  assert.equal('grants' in runtime, false);
  assert.equal('grants' in runtime.generated, false);
});

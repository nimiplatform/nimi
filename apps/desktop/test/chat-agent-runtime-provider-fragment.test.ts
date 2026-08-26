import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requireAgentTextDeltaFragment,
} from '../src/shell/renderer/features/chat/chat-agent-runtime-provider.js';

test('Agent runtime text delta preserves whitespace fragments exactly', () => {
  assert.equal(requireAgentTextDeltaFragment(' leading'), ' leading');
  assert.equal(requireAgentTextDeltaFragment('trailing '), 'trailing ');
  assert.equal(requireAgentTextDeltaFragment(' \n '), ' \n ');
  assert.equal(requireAgentTextDeltaFragment(''), '');
  assert.throws(
    () => requireAgentTextDeltaFragment({ text: 'not-a-fragment' }),
    /must be a string fragment/u,
  );
});

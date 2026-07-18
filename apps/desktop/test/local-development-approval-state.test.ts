import assert from 'node:assert/strict';
import test from 'node:test';

import { isRiskAcknowledgedForApproval } from '../src/shell/renderer/features/local-development/local-development-approval-state.js';

test('native risk acknowledgement is bound to exactly one approval request', () => {
  assert.equal(isRiskAcknowledgedForApproval('request-a', 'request-a'), true);
  assert.equal(isRiskAcknowledgedForApproval('request-a', 'request-b'), false);
  assert.equal(isRiskAcknowledgedForApproval('request-a', undefined), false);
  assert.equal(isRiskAcknowledgedForApproval('', ''), false);
});

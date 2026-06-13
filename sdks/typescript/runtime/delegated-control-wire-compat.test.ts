import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DelegatedApprovalDecision,
  DelegatedApprovalRequest,
  DelegatedApprovalRequestState,
  SubmitDelegatedApprovalDecisionRequest,
} from '../core-generated/runtime-protobuf/runtime/v1/delegated_control';

test('delegated approval protobuf json accepts pre-split approval enum names', () => {
  const request = DelegatedApprovalRequest.fromJson({
    state: 'DELEGATED_APPROVAL_REQUEST_STATE_APPROVED',
  });
  assert.equal(request.state, DelegatedApprovalRequestState.APPROVED_ONCE);

  const approveDecision = SubmitDelegatedApprovalDecisionRequest.fromJson({
    decision: 'DELEGATED_APPROVAL_DECISION_APPROVE',
  });
  assert.equal(approveDecision.decision, DelegatedApprovalDecision.APPROVED_ONCE);

  const rejectDecision = SubmitDelegatedApprovalDecisionRequest.fromJson({
    decision: 'DELEGATED_APPROVAL_DECISION_REJECT',
  });
  assert.equal(rejectDecision.decision, DelegatedApprovalDecision.REJECTED);
});

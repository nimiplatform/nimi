import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DelegatedApprovalDecision,
  DelegatedApprovalRequest,
  DelegatedApprovalRequestState,
  SubmitDelegatedApprovalDecisionRequest,
} from '../core-generated/runtime-protobuf/runtime/v1/delegated_control';

test('delegated approval protobuf json accepts only canonical approval enum names', () => {
  const request = DelegatedApprovalRequest.fromJson({
    state: 'DELEGATED_APPROVAL_REQUEST_STATE_APPROVED_ONCE',
  });
  assert.equal(request.state, DelegatedApprovalRequestState.APPROVED_ONCE);

  const approveDecision = SubmitDelegatedApprovalDecisionRequest.fromJson({
    decision: 'DELEGATED_APPROVAL_DECISION_APPROVED_ONCE',
  });
  assert.equal(approveDecision.decision, DelegatedApprovalDecision.APPROVED_ONCE);

  const rejectDecision = SubmitDelegatedApprovalDecisionRequest.fromJson({
    decision: 'DELEGATED_APPROVAL_DECISION_REJECTED',
  });
  assert.equal(rejectDecision.decision, DelegatedApprovalDecision.REJECTED);
});

test('delegated approval protobuf json rejects retired approval enum aliases', () => {
  assert.throws(() => DelegatedApprovalRequest.fromJson({
    state: 'DELEGATED_APPROVAL_REQUEST_STATE_APPROVED',
  }));
  assert.throws(() => SubmitDelegatedApprovalDecisionRequest.fromJson({
    decision: 'DELEGATED_APPROVAL_DECISION_APPROVE',
  }));
  assert.throws(() => SubmitDelegatedApprovalDecisionRequest.fromJson({
    decision: 'DELEGATED_APPROVAL_DECISION_REJECT',
  }));
});

package account

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const testWorkspaceID = "workspace-1"

func testMaterialWithWorkspace(accountID string, accessToken string, refreshToken string, workspaceID string) AccountMaterial {
	material := testMaterial(accountID, accessToken, refreshToken)
	material.WorkspaceMemberships = []*runtimev1.WorkspaceMembershipProjection{
		{
			WorkspaceId:        workspaceID,
			MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE,
			RealmEnvironmentId: material.RealmEnvironmentID,
			ObservedAt:         timestamppb.New(time.Now().UTC()),
			DisplayMetadata:    map[string]string{"name": "Workspace One"},
		},
	}
	return material
}

func completeWorkspaceLogin(t *testing.T, svc *Service) {
	t.Helper()
	begin, err := svc.BeginLogin(context.Background(), &runtimev1.BeginLoginRequest{Caller: desktopAccountControlCaller()})
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	complete, err := svc.CompleteLogin(context.Background(), &runtimev1.CompleteLoginRequest{
		Caller:         desktopAccountControlCaller(),
		LoginAttemptId: begin.GetLoginAttemptId(),
		Code:           "auth-code",
		State:          begin.GetState(),
		Nonce:          begin.GetNonce(),
	})
	if err != nil {
		t.Fatalf("CompleteLogin: %v", err)
	}
	if !complete.GetAccepted() {
		t.Fatalf("workspace login failed: %+v", complete)
	}
}

func newWorkspaceService(t *testing.T, opts ...Option) *Service {
	t.Helper()
	allOpts := []Option{
		WithLoginExchanger(staticExchanger{material: testMaterialWithWorkspace("acct-1", "access-1", "refresh-1", testWorkspaceID)}),
	}
	allOpts = append(allOpts, opts...)
	return newHarnessService(t, nil, allOpts...)
}

func issueWorkspaceBinding(t *testing.T, svc *Service, scopes ...string) *runtimev1.IssueWorkspaceBindingResponse {
	t.Helper()
	if len(scopes) == 0 {
		scopes = []string{"runtime.knowledge.read"}
	}
	resp, err := svc.IssueWorkspaceBinding(context.Background(), &runtimev1.IssueWorkspaceBindingRequest{
		Caller:      firstPartyCaller(),
		WorkspaceId: testWorkspaceID,
		Scopes:      scopes,
		TtlSeconds:  600,
	})
	if err != nil {
		t.Fatalf("IssueWorkspaceBinding: %v", err)
	}
	if !resp.GetAccepted() || resp.GetBindingId() == "" || resp.GetAttachment() == nil || resp.GetRelation() == nil {
		t.Fatalf("workspace binding issue failed: %+v", resp)
	}
	return resp
}

func resolveWorkspace(t *testing.T, svc *Service, attachment *runtimev1.WorkspaceBindingAttachment, caller *runtimev1.AccountCaller, targetWorkspaceID string, scopes ...string) WorkspaceBindingResolveResult {
	t.Helper()
	return svc.ResolveWorkspaceBinding(context.Background(), WorkspaceBindingResolveRequest{
		Caller:            caller,
		Attachment:        attachment,
		TargetWorkspaceID: targetWorkspaceID,
		RequiredScopes:    scopes,
		KnowledgeAction:   "test.knowledge.action",
	})
}

func cloneTestWorkspaceAttachment(in *runtimev1.WorkspaceBindingAttachment) *runtimev1.WorkspaceBindingAttachment {
	return cloneWorkspaceAttachment(in)
}

func TestWorkspaceMembershipProjectionAndIssueResolveAllow(t *testing.T) {
	svc := newWorkspaceService(t)
	completeWorkspaceLogin(t, svc)

	status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus: %v", err)
	}
	memberships := status.GetAccountProjection().GetWorkspaceMemberships()
	if len(memberships) != 1 || memberships[0].GetWorkspaceId() != testWorkspaceID || memberships[0].GetMembershipState() != runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE {
		t.Fatalf("workspace membership projection missing: %+v", status.GetAccountProjection())
	}

	issued := issueWorkspaceBinding(t, svc, "runtime.knowledge.admin")
	attachment := issued.GetAttachment()
	relation := issued.GetRelation()
	if attachment.GetBindingId() != relation.GetBindingId() ||
		attachment.GetRuntimeAppId() != firstPartyCaller().GetAppId() ||
		attachment.GetAppInstanceId() != firstPartyCaller().GetAppInstanceId() ||
		attachment.GetWorkspaceId() != testWorkspaceID ||
		relation.GetDeviceId() != firstPartyCaller().GetDeviceId() ||
		relation.GetAccountId() != "acct-1" ||
		relation.GetPurpose() != runtimev1.WorkspaceBindingPurpose_WORKSPACE_BINDING_PURPOSE_KNOWLEDGE_CONSUME ||
		relation.GetState() != runtimev1.WorkspaceBindingState_WORKSPACE_BINDING_STATE_ACTIVE {
		t.Fatalf("workspace binding relation/attachment not authority-shaped: attachment=%+v relation=%+v", attachment, relation)
	}

	for _, required := range []string{"runtime.knowledge.admin", "runtime.knowledge.write", "runtime.knowledge.read"} {
		result := resolveWorkspace(t, svc, attachment, firstPartyCaller(), testWorkspaceID, required)
		if result.Decision != WorkspaceBindingAllow || result.Reason != runtimev1.ReasonCode_ACTION_EXECUTED {
			t.Fatalf("admin binding should cover %s, result=%+v", required, result)
		}
	}
}

func TestIssueWorkspaceBindingFailsClosedWithoutActiveMembership(t *testing.T) {
	oldObservedAt := timestamppb.New(time.Now().UTC().Add(-workspaceMembershipProjectionMaxAge - time.Minute))
	for _, tc := range []struct {
		name       string
		membership *runtimev1.WorkspaceMembershipProjection
	}{
		{name: "missing"},
		{
			name: "unknown",
			membership: &runtimev1.WorkspaceMembershipProjection{
				WorkspaceId:        testWorkspaceID,
				MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_UNKNOWN,
				RealmEnvironmentId: "realm-local",
			},
		},
		{
			name: "suspended",
			membership: &runtimev1.WorkspaceMembershipProjection{
				WorkspaceId:        testWorkspaceID,
				MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_SUSPENDED,
				RealmEnvironmentId: "realm-local",
			},
		},
		{
			name: "realm_environment_mismatch",
			membership: &runtimev1.WorkspaceMembershipProjection{
				WorkspaceId:        testWorkspaceID,
				MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE,
				RealmEnvironmentId: "realm-other",
			},
		},
		{
			name: "missing_observed_at",
			membership: &runtimev1.WorkspaceMembershipProjection{
				WorkspaceId:        testWorkspaceID,
				MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE,
				RealmEnvironmentId: "realm-local",
			},
		},
		{
			name: "stale_observed_at",
			membership: &runtimev1.WorkspaceMembershipProjection{
				WorkspaceId:        testWorkspaceID,
				MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE,
				RealmEnvironmentId: "realm-local",
				ObservedAt:         oldObservedAt,
			},
		},
		{
			name: "future_observed_at",
			membership: &runtimev1.WorkspaceMembershipProjection{
				WorkspaceId:        testWorkspaceID,
				MembershipState:    runtimev1.WorkspaceMembershipState_WORKSPACE_MEMBERSHIP_STATE_ACTIVE,
				RealmEnvironmentId: "realm-local",
				ObservedAt:         timestamppb.New(time.Now().UTC().Add(time.Minute)),
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			material := testMaterial("acct-1", "access-1", "refresh-1")
			if tc.membership != nil {
				material.WorkspaceMemberships = []*runtimev1.WorkspaceMembershipProjection{tc.membership}
			}
			svc := newHarnessService(t, nil, WithLoginExchanger(staticExchanger{material: material}))
			completeWorkspaceLogin(t, svc)
			resp, err := svc.IssueWorkspaceBinding(context.Background(), &runtimev1.IssueWorkspaceBindingRequest{
				Caller:      firstPartyCaller(),
				WorkspaceId: testWorkspaceID,
				Scopes:      []string{"runtime.knowledge.read"},
			})
			if err != nil {
				t.Fatalf("IssueWorkspaceBinding: %v", err)
			}
			if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE {
				t.Fatalf("workspace issue must fail closed without active membership: %+v", resp)
			}
		})
	}
}

func TestIssueWorkspaceBindingRejectsMalformedWorkspaceRequest(t *testing.T) {
	for _, tc := range []struct {
		name        string
		workspaceID string
		scopes      []string
	}{
		{name: "missing_workspace", scopes: []string{"runtime.knowledge.read"}},
		{name: "missing_scopes", workspaceID: testWorkspaceID},
		{name: "unknown_scope", workspaceID: testWorkspaceID, scopes: []string{"runtime.knowledge.fly"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newWorkspaceService(t)
			completeWorkspaceLogin(t, svc)
			resp, err := svc.IssueWorkspaceBinding(context.Background(), &runtimev1.IssueWorkspaceBindingRequest{
				Caller:      firstPartyCaller(),
				WorkspaceId: tc.workspaceID,
				Scopes:      tc.scopes,
			})
			if err != nil {
				t.Fatalf("IssueWorkspaceBinding: %v", err)
			}
			if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_WORKSPACE_BINDING_MALFORMED {
				t.Fatalf("malformed workspace issue must fail closed: %+v", resp)
			}
		})
	}
}

func TestIssueWorkspaceBindingRejectsMissingRuntimeDeviceIdentity(t *testing.T) {
	caller := firstPartyCaller()
	caller.DeviceId = ""
	registry := testAppRegistry(t, caller)
	svc := newWorkspaceService(t, WithAppRegistry(registry))
	completeWorkspaceLogin(t, svc)

	resp, err := svc.IssueWorkspaceBinding(context.Background(), &runtimev1.IssueWorkspaceBindingRequest{
		Caller:      caller,
		WorkspaceId: testWorkspaceID,
		Scopes:      []string{"runtime.knowledge.read"},
	})
	if err != nil {
		t.Fatalf("IssueWorkspaceBinding: %v", err)
	}
	if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED {
		t.Fatalf("missing device identity must fail closed: %+v", resp)
	}
}

func TestWorkspaceResolverIgnoresKnowledgeContextAppAndSubjectProof(t *testing.T) {
	svc := newWorkspaceService(t)
	completeWorkspaceLogin(t, svc)
	issued := issueWorkspaceBinding(t, svc, "runtime.knowledge.read")
	forgedContext := &runtimev1.KnowledgeRequestContext{
		AppId:            "forged.app",
		SubjectUserId:    "forged-subject",
		WorkspaceBinding: issued.GetAttachment(),
	}
	result := resolveWorkspace(t, svc, forgedContext.GetWorkspaceBinding(), firstPartyCaller(), testWorkspaceID, "runtime.knowledge.read")
	if result.Decision != WorkspaceBindingAllow || result.Reason != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("resolver must ignore KnowledgeRequestContext app_id/subject_user_id and use AccountCaller: %+v", result)
	}
}

func TestWorkspaceBindingResolverRejectsStaleMembershipProjection(t *testing.T) {
	svc := newWorkspaceService(t)
	completeWorkspaceLogin(t, svc)
	issued := issueWorkspaceBinding(t, svc, "runtime.knowledge.read")

	svc.mu.Lock()
	svc.material.WorkspaceMemberships[0].ObservedAt = timestamppb.New(time.Now().UTC().Add(-workspaceMembershipProjectionMaxAge - time.Minute))
	svc.mu.Unlock()

	result := resolveWorkspace(t, svc, issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, "runtime.knowledge.read")
	if result.Decision != WorkspaceBindingDenyAccountUnavailable || result.Reason != runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE {
		t.Fatalf("stale membership projection must fail closed at consume time: %+v", result)
	}
	second := resolveWorkspace(t, svc, issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, "runtime.knowledge.read")
	if second.Decision != WorkspaceBindingDenyRevoked {
		t.Fatalf("stale membership projection must revoke before later allow: %+v", second)
	}
}

func TestDaemonRestartWithStaleMembershipProjectionCannotIssueWorkspaceBinding(t *testing.T) {
	material := testMaterialWithWorkspace("acct-1", "access-1", "refresh-1", testWorkspaceID)
	material.WorkspaceMemberships[0].ObservedAt = timestamppb.New(time.Now().UTC().Add(-workspaceMembershipProjectionMaxAge - time.Minute))
	svc := newHarnessService(t, &memoryCustody{material: material, has: true})

	status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus: %v", err)
	}
	if status.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED {
		t.Fatalf("account recovery should remain account-scoped: %+v", status)
	}
	resp, err := svc.IssueWorkspaceBinding(context.Background(), &runtimev1.IssueWorkspaceBindingRequest{
		Caller:      firstPartyCaller(),
		WorkspaceId: testWorkspaceID,
		Scopes:      []string{"runtime.knowledge.read"},
	})
	if err != nil {
		t.Fatalf("IssueWorkspaceBinding: %v", err)
	}
	if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE {
		t.Fatalf("stale recovered membership must not issue workspace binding: %+v", resp)
	}
}

func TestWorkspaceBindingResolverNegativeMatrix(t *testing.T) {
	otherCaller := &runtimev1.AccountCaller{
		AppId:         "nimi.sidecar",
		AppInstanceId: "sidecar-1",
		DeviceId:      "device-1",
		Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_LOCAL_FIRST_PARTY_APP,
	}
	for _, tc := range []struct {
		name     string
		setup    func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string)
		expected WorkspaceBindingDecision
		reason   runtimev1.ReasonCode
	}{
		{
			name: "missing_attachment",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				return nil, firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyMissingAttachment,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_MISSING,
		},
		{
			name: "malformed_attachment",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				attachment := cloneTestWorkspaceAttachment(issued.GetAttachment())
				attachment.WorkspaceId = ""
				return attachment, firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyMalformedAttachment,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_MALFORMED,
		},
		{
			name: "not_found",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				svc.mu.Lock()
				svc.workspaceBindings = make(map[string]workspaceBindingRecord)
				svc.mu.Unlock()
				return issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyNotFound,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_NOT_FOUND,
		},
		{
			name: "revoked",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				resp, err := svc.RevokeWorkspaceBinding(context.Background(), &runtimev1.RevokeWorkspaceBindingRequest{Caller: firstPartyCaller(), BindingId: issued.GetBindingId()})
				if err != nil || !resp.GetAccepted() {
					t.Fatalf("RevokeWorkspaceBinding: resp=%+v err=%v", resp, err)
				}
				return issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyRevoked,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_REVOKED,
		},
		{
			name: "expired",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				svc.mu.Lock()
				record := svc.workspaceBindings[issued.GetBindingId()]
				record.relation.ExpiresAt = timestamppb.New(time.Now().UTC().Add(-time.Second))
				svc.workspaceBindings[issued.GetBindingId()] = record
				svc.mu.Unlock()
				return issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyExpired,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_EXPIRED,
		},
		{
			name: "replay",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				attachment := cloneTestWorkspaceAttachment(issued.GetAttachment())
				attachment.AppInstanceId = "desktop-replayed"
				return attachment, firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyReplay,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_REPLAY,
		},
		{
			name: "purpose_mismatch",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				svc.mu.Lock()
				record := svc.workspaceBindings[issued.GetBindingId()]
				record.relation.Purpose = runtimev1.WorkspaceBindingPurpose_WORKSPACE_BINDING_PURPOSE_UNSPECIFIED
				svc.workspaceBindings[issued.GetBindingId()] = record
				svc.mu.Unlock()
				return issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyCallerMismatch,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_CALLER_MISMATCH,
		},
		{
			name: "account_unavailable",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				svc.mu.Lock()
				svc.state = runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_REAUTH_REQUIRED
				svc.mu.Unlock()
				return issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyAccountUnavailable,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE,
		},
		{
			name: "caller_mismatch",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				return issued.GetAttachment(), otherCaller, testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyCallerMismatch,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_CALLER_MISMATCH,
		},
		{
			name: "workspace_mismatch",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				return issued.GetAttachment(), firstPartyCaller(), "workspace-2", []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyWorkspaceMismatch,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_WORKSPACE_MISMATCH,
		},
		{
			name: "env_mismatch",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				svc.mu.Lock()
				svc.material.RealmEnvironmentID = "realm-other"
				svc.mu.Unlock()
				return issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyEnvMismatch,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_ENV_DEVICE_MISMATCH,
		},
		{
			name: "device_mismatch",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				caller := firstPartyCaller()
				caller.DeviceId = "device-other"
				svc.registry = testAppRegistry(t, caller)
				return issued.GetAttachment(), caller, testWorkspaceID, []string{"runtime.knowledge.read"}
			},
			expected: WorkspaceBindingDenyDeviceMismatch,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_ENV_DEVICE_MISMATCH,
		},
		{
			name: "scope_missing",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				return issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, []string{"runtime.knowledge.write"}
			},
			expected: WorkspaceBindingDenyScopeMissing,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_SCOPE_MISSING,
		},
		{
			name: "required_scope_empty",
			setup: func(t *testing.T, svc *Service, issued *runtimev1.IssueWorkspaceBindingResponse) (*runtimev1.WorkspaceBindingAttachment, *runtimev1.AccountCaller, string, []string) {
				return issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, nil
			},
			expected: WorkspaceBindingDenyScopeMissing,
			reason:   runtimev1.ReasonCode_WORKSPACE_BINDING_SCOPE_MISSING,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			registry := testAppRegistry(t, firstPartyCaller(), otherCaller)
			svc := newWorkspaceService(t, WithAppRegistry(registry))
			completeWorkspaceLogin(t, svc)
			issued := issueWorkspaceBinding(t, svc, "runtime.knowledge.read")
			attachment, caller, target, scopes := tc.setup(t, svc, issued)
			result := resolveWorkspace(t, svc, attachment, caller, target, scopes...)
			if result.Decision != tc.expected || result.Reason != tc.reason {
				t.Fatalf("decision mismatch: got %+v want decision=%s reason=%s", result, tc.expected, tc.reason)
			}
		})
	}
}

func TestDeviceMismatchInvalidatesWorkspaceBinding(t *testing.T) {
	otherDeviceCaller := firstPartyCaller()
	otherDeviceCaller.DeviceId = "device-other"
	svc := newWorkspaceService(t)
	completeWorkspaceLogin(t, svc)
	issued := issueWorkspaceBinding(t, svc, "runtime.knowledge.read")

	svc.registry = testAppRegistry(t, otherDeviceCaller)
	mismatch := resolveWorkspace(t, svc, issued.GetAttachment(), otherDeviceCaller, testWorkspaceID, "runtime.knowledge.read")
	if mismatch.Decision != WorkspaceBindingDenyDeviceMismatch || mismatch.Reason != runtimev1.ReasonCode_WORKSPACE_BINDING_ENV_DEVICE_MISMATCH {
		t.Fatalf("device mismatch should deny with typed reason: %+v", mismatch)
	}
	svc.registry = testAppRegistry(t, firstPartyCaller())
	original := resolveWorkspace(t, svc, issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, "runtime.knowledge.read")
	if original.Decision != WorkspaceBindingDenyRevoked {
		t.Fatalf("device mismatch must invalidate binding before later allow: %+v", original)
	}
}

func TestAccountExpiryInvalidatesWorkspaceBindings(t *testing.T) {
	svc := newWorkspaceService(t)
	completeWorkspaceLogin(t, svc)
	issued := issueWorkspaceBinding(t, svc, "runtime.knowledge.read")

	svc.mu.Lock()
	svc.material.AccessTokenExpires = time.Now().UTC().Add(-time.Second)
	svc.mu.Unlock()

	result := resolveWorkspace(t, svc, issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, "runtime.knowledge.read")
	if result.Decision != WorkspaceBindingDenyAccountUnavailable || result.Reason != runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE {
		t.Fatalf("expired account material must fail closed: %+v", result)
	}
	second := resolveWorkspace(t, svc, issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, "runtime.knowledge.read")
	if second.Decision != WorkspaceBindingDenyRevoked {
		t.Fatalf("account expiry must revoke binding before later allow: %+v", second)
	}

	resp, err := svc.IssueWorkspaceBinding(context.Background(), &runtimev1.IssueWorkspaceBindingRequest{
		Caller:      firstPartyCaller(),
		WorkspaceId: testWorkspaceID,
		Scopes:      []string{"runtime.knowledge.read"},
	})
	if err != nil {
		t.Fatalf("IssueWorkspaceBinding after expiry: %v", err)
	}
	if resp.GetAccepted() || resp.GetReasonCode() != runtimev1.ReasonCode_WORKSPACE_BINDING_ACCOUNT_UNAVAILABLE {
		t.Fatalf("issue after account expiry must fail closed: %+v", resp)
	}
}

func TestWorkspaceMembershipDisplayMetadataIsRedacted(t *testing.T) {
	material := testMaterialWithWorkspace("acct-1", "access-1", "refresh-1", testWorkspaceID)
	material.WorkspaceMemberships[0].DisplayMetadata = map[string]string{
		"name":            "Workspace One",
		"subject_user_id": "user-secret",
		"access_token":    "token-secret",
		"jwt":             "jwt-secret",
		"proof":           "proof-secret",
	}
	svc := newHarnessService(t, nil, WithLoginExchanger(staticExchanger{material: material}))
	completeWorkspaceLogin(t, svc)

	status, err := svc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus: %v", err)
	}
	metadata := status.GetAccountProjection().GetWorkspaceMemberships()[0].GetDisplayMetadata()
	if metadata["name"] != "Workspace One" {
		t.Fatalf("redacted display metadata should keep display name: %+v", metadata)
	}
	for _, forbidden := range []string{"subject_user_id", "access_token", "jwt", "proof"} {
		if _, ok := metadata[forbidden]; ok {
			t.Fatalf("workspace membership metadata leaked forbidden key %q: %+v", forbidden, metadata)
		}
	}
}

func TestDaemonRestartRecoversAccountButInvalidatesWorkspaceBindings(t *testing.T) {
	custody := &memoryCustody{}
	beforeRestart := newHarnessService(t, custody, WithLoginExchanger(staticExchanger{material: testMaterialWithWorkspace("acct-1", "access-1", "refresh-1", testWorkspaceID)}))
	completeWorkspaceLogin(t, beforeRestart)
	issued := issueWorkspaceBinding(t, beforeRestart, "runtime.knowledge.read")

	afterRestart := newHarnessService(t, custody)
	status, err := afterRestart.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{Caller: firstPartyCaller()})
	if err != nil {
		t.Fatalf("GetAccountSessionStatus: %v", err)
	}
	if status.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED ||
		len(status.GetAccountProjection().GetWorkspaceMemberships()) != 1 {
		t.Fatalf("restart should recover account and membership projection, got %+v", status)
	}
	result := resolveWorkspace(t, afterRestart, issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, "runtime.knowledge.read")
	if result.Decision != WorkspaceBindingDenyNotFound || result.Reason != runtimev1.ReasonCode_WORKSPACE_BINDING_NOT_FOUND {
		t.Fatalf("workspace binding must not survive daemon restart: %+v", result)
	}
}

func TestWorkspaceBindingRevocationAndMembershipLoss(t *testing.T) {
	svc := newWorkspaceService(t)
	completeWorkspaceLogin(t, svc)
	issued := issueWorkspaceBinding(t, svc, "runtime.knowledge.read")

	refreshMaterial := testMaterialWithWorkspace("acct-1", "access-2", "refresh-2", "workspace-2")
	svc.refresher = staticRefresher{material: refreshMaterial}
	refresh, err := svc.refreshAccountSessionInternal(context.Background(), true)
	if err != nil {
		t.Fatalf("private refresh: %v", err)
	}
	if !refresh.accepted {
		t.Fatalf("refresh failed: %+v", refresh)
	}
	result := resolveWorkspace(t, svc, issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, "runtime.knowledge.read")
	if result.Decision != WorkspaceBindingDenyRevoked || result.Reason != runtimev1.ReasonCode_WORKSPACE_BINDING_REVOKED {
		t.Fatalf("membership loss must revoke old workspace binding, result=%+v", result)
	}
}

func TestLogoutAndSwitchRevokeWorkspaceBindings(t *testing.T) {
	for _, tc := range []struct {
		name string
		act  func(*Service) error
	}{
		{
			name: "logout",
			act: func(svc *Service) error {
				resp, err := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
				if err != nil {
					return err
				}
				if !resp.GetAccepted() {
					t.Fatalf("logout not accepted: %+v", resp)
				}
				return nil
			},
		},
		{
			name: "switch",
			act: func(svc *Service) error {
				resp, err := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
				if err != nil {
					return err
				}
				if !resp.GetAccepted() {
					t.Fatalf("switch not accepted: %+v", resp)
				}
				return nil
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newWorkspaceService(t)
			completeWorkspaceLogin(t, svc)
			issued := issueWorkspaceBinding(t, svc)
			if err := tc.act(svc); err != nil {
				t.Fatal(err)
			}
			result := resolveWorkspace(t, svc, issued.GetAttachment(), firstPartyCaller(), testWorkspaceID, "runtime.knowledge.read")
			if result.Decision != WorkspaceBindingDenyRevoked || result.Reason != runtimev1.ReasonCode_WORKSPACE_BINDING_REVOKED {
				t.Fatalf("workspace binding must be revoked after %s: %+v", tc.name, result)
			}
		})
	}
}

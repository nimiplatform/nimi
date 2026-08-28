package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type bundledAvatarTestProjectionProvider struct {
	accountID string
	available bool
}

func (p bundledAvatarTestProjectionProvider) AuthenticatedRuntimeProjection(context.Context) (*runtimev1.AccountProjection, bool) {
	if !p.available && p.accountID == "" {
		return nil, false
	}
	return &runtimev1.AccountProjection{AccountId: p.accountID}, true
}

func bundledAvatarTestPrincipalContext(capability string, accountID string, invalidated <-chan struct{}) context.Context {
	principal := protectedprincipal.New(
		bundledavatar.AppID, bundledavatar.ProfileID, capability,
		&runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: "realm-test"},
		1, [32]byte{1}, invalidated,
	)
	return protectedprincipal.With(context.Background(), principal)
}

func desktopAccountProductTestPrincipalContext(accountID string, invalidated <-chan struct{}) context.Context {
	principal := protectedprincipal.NewDesktopAccountProduct(
		&runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: "realm-test"},
		7, [32]byte{2}, invalidated,
	)
	return protectedprincipal.With(context.Background(), principal)
}

func TestDesktopAccountProductIdentityRejectsWrongOwnerAndInvalidation(t *testing.T) {
	t.Parallel()
	svc := &Service{}
	invalidated := make(chan struct{})
	callContext := desktopAccountProductTestPrincipalContext("account-current", invalidated)
	requestContext := &runtimev1.AgentRequestContext{
		AppId: "nimi.desktop", SubjectUserId: "account-current", OwnerUserId: "account-current",
		RuntimeSourceRef: "runtime-source", LocalAgentRef: "local-agent:runtime-current",
	}
	identity, err := localAgentIdentityFromContext(requestContext)
	if err != nil {
		t.Fatalf("identity: %v", err)
	}
	if err := svc.authorizeBundledAvatarIdentity(callContext, requestContext, identity, "runtime.agent.write"); err != nil {
		t.Fatalf("current-account identity should be authorized: %v", err)
	}
	requestContext.OwnerUserId = "account-other"
	requestContext.SubjectUserId = "account-other"
	identity, err = localAgentIdentityFromContext(requestContext)
	if err != nil {
		t.Fatalf("wrong-owner identity shape: %v", err)
	}
	if err := svc.authorizeBundledAvatarIdentity(callContext, requestContext, identity, "runtime.agent.write"); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("wrong owner must fail before domain mutation, got %v", err)
	}
	close(invalidated)
	if err := svc.revalidateProtectedAccountIdentity(callContext, identity); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("account generation invalidation must remain protected and fail closed, got %v", err)
	}
}

func TestM1DesktopAccountRuntimeAgentOwnershipMatrix(t *testing.T) {
	svc := newRuntimeAgentTestService(t)
	currentAgentID := testMaterializeLocalAgent(t, svc, "account-current", "m1-current-agent")
	otherAgentID := testMaterializeLocalAgent(t, svc, "account-other", "m1-other-agent")
	callContext := desktopAccountProductTestPrincipalContext("account-current", make(chan struct{}))
	selector := func() *runtimev1.AgentRequestContext { return &runtimev1.AgentRequestContext{AppId: "nimi.desktop"} }
	assertWrongOwner := func(t *testing.T, err error) {
		t.Helper()
		if status.Code(err) != codes.NotFound {
			t.Fatalf("wrong-owner call did not fail closed before domain work: %v", err)
		}
	}

	t.Run("GetAgentState", func(t *testing.T) {
		_, err := svc.GetAgentState(callContext, &runtimev1.GetAgentStateRequest{Context: selector(), AgentId: otherAgentID})
		assertWrongOwner(t, err)
		response, err := svc.GetAgentState(callContext, &runtimev1.GetAgentStateRequest{Context: selector(), AgentId: currentAgentID})
		if err != nil || response.GetState() == nil {
			t.Fatalf("current owner state=%+v err=%v", response, err)
		}
	})
	t.Run("ListPendingHooks", func(t *testing.T) {
		_, err := svc.ListPendingHooks(callContext, &runtimev1.ListPendingHooksRequest{Context: selector(), AgentId: otherAgentID})
		assertWrongOwner(t, err)
		if _, err := svc.ListPendingHooks(callContext, &runtimev1.ListPendingHooksRequest{Context: selector(), AgentId: currentAgentID}); err != nil {
			t.Fatalf("current owner list hooks: %v", err)
		}
	})
	t.Run("UpdateAgentState", func(t *testing.T) {
		mutation := []*runtimev1.AgentStateMutation{{Mutation: &runtimev1.AgentStateMutation_SetDyadicContext{SetDyadicContext: &runtimev1.AgentStateSetDyadicContext{UserId: "account-current"}}}}
		_, err := svc.UpdateAgentState(callContext, &runtimev1.UpdateAgentStateRequest{Context: selector(), AgentId: otherAgentID, Mutations: mutation})
		assertWrongOwner(t, err)
		if _, err := svc.UpdateAgentState(callContext, &runtimev1.UpdateAgentStateRequest{Context: selector(), AgentId: currentAgentID, Mutations: mutation}); err != nil {
			t.Fatalf("current owner update state: %v", err)
		}
	})
	t.Run("EnableAutonomy", func(t *testing.T) {
		_, err := svc.EnableAutonomy(callContext, &runtimev1.EnableAutonomyRequest{Context: selector(), AgentId: otherAgentID})
		assertWrongOwner(t, err)
		before, err := svc.GetAgent(callContext, &runtimev1.GetAgentRequest{Context: selector(), AgentId: currentAgentID})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := svc.SetAutonomyConfig(callContext, &runtimev1.SetAutonomyConfigRequest{Context: selector(), AgentId: currentAgentID, ExpectedAutonomyRevision: proto.Uint64(before.GetAgent().GetAutonomy().GetRevision()), Config: &runtimev1.AgentAutonomyConfig{Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW, DailyTokenBudget: 100, MaxTokensPerHook: 10}}); err != nil {
			t.Fatalf("prepare current owner autonomy: %v", err)
		}
		response, err := svc.EnableAutonomy(callContext, &runtimev1.EnableAutonomyRequest{Context: selector(), AgentId: currentAgentID})
		if err != nil || !response.GetAutonomy().GetEnabled() {
			t.Fatalf("current owner enable=%+v err=%v", response, err)
		}
	})
	t.Run("DisableAutonomy", func(t *testing.T) {
		_, err := svc.DisableAutonomy(callContext, &runtimev1.DisableAutonomyRequest{Context: selector(), AgentId: otherAgentID})
		assertWrongOwner(t, err)
		response, err := svc.DisableAutonomy(callContext, &runtimev1.DisableAutonomyRequest{Context: selector(), AgentId: currentAgentID})
		if err != nil || response.GetAutonomy().GetEnabled() {
			t.Fatalf("current owner disable=%+v err=%v", response, err)
		}
	})
	t.Run("SetAutonomyConfig", func(t *testing.T) {
		config := &runtimev1.AgentAutonomyConfig{Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW, DailyTokenBudget: 100, MaxTokensPerHook: 10}
		_, err := svc.SetAutonomyConfig(callContext, &runtimev1.SetAutonomyConfigRequest{Context: selector(), AgentId: otherAgentID, ExpectedAutonomyRevision: proto.Uint64(1), Config: config})
		assertWrongOwner(t, err)
		before, err := svc.GetAgent(callContext, &runtimev1.GetAgentRequest{Context: selector(), AgentId: currentAgentID})
		if err != nil {
			t.Fatal(err)
		}
		response, err := svc.SetAutonomyConfig(callContext, &runtimev1.SetAutonomyConfigRequest{Context: selector(), AgentId: currentAgentID, ExpectedAutonomyRevision: proto.Uint64(before.GetAgent().GetAutonomy().GetRevision()), Config: config})
		if err != nil || response.GetAutonomy().GetConfig().GetDailyTokenBudget() != 100 {
			t.Fatalf("current owner config=%+v err=%v", response, err)
		}
	})
	t.Run("SetAutonomyConfigAtomicCAS", func(t *testing.T) {
		before, err := svc.GetAgent(callContext, &runtimev1.GetAgentRequest{Context: selector(), AgentId: currentAgentID})
		if err != nil {
			t.Fatal(err)
		}
		revision := before.GetAgent().GetAutonomy().GetRevision()
		request := &runtimev1.SetAutonomyConfigRequest{
			Context: selector(), AgentId: currentAgentID,
			Config:                   &runtimev1.AgentAutonomyConfig{Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_MEDIUM, DailyTokenBudget: 500, MaxTokensPerHook: 50},
			ExpectedAutonomyRevision: proto.Uint64(revision), Enabled: proto.Bool(true),
		}
		response, err := svc.SetAutonomyConfig(callContext, request)
		if err != nil || !response.GetAutonomy().GetEnabled() || response.GetAutonomy().GetRevision() != revision+1 {
			t.Fatalf("first-party autonomy CAS=%+v err=%v", response, err)
		}
		_, err = svc.SetAutonomyConfig(callContext, &runtimev1.SetAutonomyConfigRequest{
			Context: selector(), AgentId: currentAgentID, Config: request.GetConfig(),
			ExpectedAutonomyRevision: proto.Uint64(revision), Enabled: proto.Bool(false),
		})
		if status.Code(err) != codes.Aborted {
			t.Fatalf("stale first-party autonomy CAS code=%s err=%v", status.Code(err), err)
		}
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AGENT_AUTONOMY_REVISION_CONFLICT {
			t.Fatalf("stale first-party autonomy reason=%s ok=%v", reason, ok)
		}
	})
	t.Run("CancelHook", func(t *testing.T) {
		_, err := svc.CancelHook(callContext, &runtimev1.CancelHookRequest{Context: selector(), AgentId: otherAgentID, IntentId: "missing-m1"})
		assertWrongOwner(t, err)
		_, err = svc.CancelHook(callContext, &runtimev1.CancelHookRequest{Context: selector(), AgentId: currentAgentID, IntentId: "missing-m1"})
		if status.Code(err) != codes.NotFound {
			t.Fatalf("current owner did not reach hook domain: %v", err)
		}
	})
}

func TestBundledAvatarIdentityBindsToProtectedPrincipalAccount(t *testing.T) {
	t.Parallel()
	svc := &Service{}
	callContext := bundledAvatarTestPrincipalContext("runtime.agent.read", "account-current", make(chan struct{}))
	requestContext := &runtimev1.AgentRequestContext{
		AppId: bundledavatar.AppID, SubjectUserId: "account-current", OwnerUserId: "account-current",
		RuntimeSourceRef: "runtime-source", LocalAgentRef: "local-agent:runtime-current",
	}
	identity, err := localAgentIdentityFromContext(requestContext)
	if err != nil {
		t.Fatalf("identity: %v", err)
	}
	if err := svc.authorizeBundledAvatarIdentity(callContext, requestContext, identity, "runtime.agent.read"); err != nil {
		t.Fatalf("principal account identity should be authorized: %v", err)
	}

	requestContext.OwnerUserId = "account-other"
	requestContext.SubjectUserId = "account-other"
	identity, err = localAgentIdentityFromContext(requestContext)
	if err != nil {
		t.Fatalf("cross-account identity shape: %v", err)
	}
	if err := svc.authorizeBundledAvatarIdentity(callContext, requestContext, identity, "runtime.agent.read"); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("cross-account selector must fail closed, got %v", err)
	}
}

func TestBundledAvatarIdentityRejectsInvalidatedPrincipal(t *testing.T) {
	t.Parallel()
	svc := &Service{}
	invalidated := make(chan struct{})
	callContext := bundledAvatarTestPrincipalContext("runtime.agent.turn.read", "account-current", invalidated)
	requestContext := &runtimev1.AgentRequestContext{
		AppId: bundledavatar.AppID, SubjectUserId: "account-current", OwnerUserId: "account-current",
		RuntimeSourceRef: "runtime-source", LocalAgentRef: "local-agent:runtime-current",
	}
	identity, err := localAgentIdentityFromContext(requestContext)
	if err != nil {
		t.Fatalf("identity: %v", err)
	}
	close(invalidated)
	if err := svc.revalidateBundledAvatarIdentity(callContext, identity); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("generation invalidation must revoke the active identity, got %v", err)
	}
}

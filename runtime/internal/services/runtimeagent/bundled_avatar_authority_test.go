package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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

func TestBundledAvatarIdentityRejectsScopedBindingAndInvalidatedPrincipal(t *testing.T) {
	t.Parallel()
	svc := &Service{}
	invalidated := make(chan struct{})
	callContext := bundledAvatarTestPrincipalContext("runtime.agent.turn.read", "account-current", invalidated)
	requestContext := &runtimev1.AgentRequestContext{
		AppId: bundledavatar.AppID, SubjectUserId: "account-current", OwnerUserId: "account-current",
		RuntimeSourceRef: "runtime-source", LocalAgentRef: "local-agent:runtime-current",
		ScopedBinding: &runtimev1.ScopedRuntimeBindingAttachment{},
	}
	identity, err := localAgentIdentityFromContext(requestContext)
	if err != nil {
		t.Fatalf("identity: %v", err)
	}
	if err := svc.authorizeBundledAvatarIdentity(callContext, requestContext, identity, "runtime.agent.turn.read"); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("bundled Avatar scoped binding must be rejected, got %v", err)
	}

	close(invalidated)
	if err := svc.revalidateBundledAvatarIdentity(callContext, identity); status.Code(err) != codes.Unauthenticated {
		t.Fatalf("generation invalidation must revoke the active identity, got %v", err)
	}
}

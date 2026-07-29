package localappkernel

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestAgentHandleEnsureAccountScopeIsStablePersistentAndPartitionScoped(t *testing.T) {
	ctx := context.Background()
	identity, err := ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "local-app.db")
	kernel, err := OpenSQLite(ctx, path, identity, Options{Random: bytes.NewReader(bytes.Repeat([]byte{0x4a}, 64))})
	if err != nil {
		t.Fatal(err)
	}
	principal, err := kernel.Principals().Create(ctx, CreatePrincipalInput{
		Kind: PrincipalKindDevelopment, AppID: "com.example.app",
		DevelopmentAuthorizationID: "dev-auth:selector", CanonicalProjectFileID: "file-id:selector",
	})
	if err != nil {
		t.Fatal(err)
	}
	accountScopeDigest := AgentAccountScopeDigest("account-one")
	issued, err := kernel.AgentHandles().EnsureAccountScope(ctx, EnsureAccountScopeAgentHandleInput{
		AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", OwnerSelectorDigest: accountScopeDigest, LocalAgentID: "local-agent-one",
	})
	if err != nil {
		t.Fatal(err)
	}
	if issued.Handle == "local-agent-one" || issued.Handle == "" || issued.OwnerSelectorDigest != accountScopeDigest || issued.OwnerSelectorDigest == issued.LocalAgentID {
		t.Fatalf("Agent handle is not opaque or account scoped: %+v", issued)
	}
	reissued, err := kernel.AgentHandles().EnsureAccountScope(ctx, EnsureAccountScopeAgentHandleInput{
		AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", OwnerSelectorDigest: accountScopeDigest, LocalAgentID: "local-agent-one",
	})
	if err != nil {
		t.Fatal(err)
	}
	if reissued.Handle != issued.Handle || reissued.OwnerSelectorDigest != accountScopeDigest {
		t.Fatalf("idempotent ensure returned a different handle: first=%+v second=%+v", issued, reissued)
	}
	if _, err := kernel.AgentHandles().EnsureAccountScope(ctx, EnsureAccountScopeAgentHandleInput{
		AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", OwnerSelectorDigest: AgentAccountScopeDigest("account-two"), LocalAgentID: "local-agent-one",
	}); !errors.Is(err, ErrPartitionMismatch) {
		t.Fatalf("cross-account scope digest error = %v", err)
	}
	if _, err := kernel.AgentHandles().Resolve(ctx, ResolveAgentHandleInput{
		Handle: "local-agent-one", AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("app-authored raw localAgentId error = %v", err)
	}
	for name, input := range map[string]ResolveAgentHandleInput{
		"account": {
			Handle: issued.Handle, AccountID: "account-two",
			LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact",
		},
		"principal": {
			Handle: issued.Handle, AccountID: "account-one",
			LocalAppPrincipalID: "different-principal", PermissionID: "agents.interact",
		},
		"permission": {
			Handle: issued.Handle, AccountID: "account-one",
			LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "different.permission",
		},
	} {
		if _, err := kernel.AgentHandles().Resolve(ctx, input); !errors.Is(err, ErrPartitionMismatch) {
			t.Fatalf("cross-%s resolve error = %v", name, err)
		}
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenSQLite(ctx, path, identity, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopened.Close() }()
	resolved, err := reopened.AgentHandles().Resolve(ctx, ResolveAgentHandleInput{
		Handle: issued.Handle, AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact",
	})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.LocalAgentID != "local-agent-one" || resolved.OwnerSelectorDigest != accountScopeDigest {
		t.Fatalf("resolved Agent handle = %+v", resolved)
	}
}

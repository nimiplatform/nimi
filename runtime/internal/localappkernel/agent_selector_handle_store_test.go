package localappkernel

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestAgentSelectorHandleIsOpaquePersistentAndFiveBindingScoped(t *testing.T) {
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
	issued, err := kernel.AgentSelectorHandles().Issue(ctx, IssueAgentSelectorHandleInput{
		AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID,
		PermissionID: "agents.interact", LocalAgentID: "local-agent-one",
	})
	if err != nil {
		t.Fatal(err)
	}
	if issued.Handle == "local-agent-one" || issued.Handle == "" || issued.OwnerSelectorDigest == "" || issued.OwnerSelectorDigest == issued.LocalAgentID {
		t.Fatalf("selector handle is not opaque: %+v", issued)
	}
	if _, err := kernel.AgentSelectorHandles().Resolve(ctx, ResolveAgentSelectorHandleInput{
		Handle: "local-agent-one", AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("app-authored raw localAgentId error = %v", err)
	}
	if _, err := kernel.AgentSelectorHandles().Resolve(ctx, ResolveAgentSelectorHandleInput{
		Handle: issued.Handle, AccountID: "account-two", LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact",
	}); !errors.Is(err, ErrPartitionMismatch) {
		t.Fatalf("cross-account resolve error = %v", err)
	}
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenSQLite(ctx, path, identity, Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = reopened.Close() }()
	resolved, err := reopened.AgentSelectorHandles().Resolve(ctx, ResolveAgentSelectorHandleInput{
		Handle: issued.Handle, AccountID: "account-one", LocalAppPrincipalID: principal.LocalAppPrincipalID, PermissionID: "agents.interact",
	})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.LocalAgentID != "local-agent-one" || resolved.OwnerSelectorDigest != issued.OwnerSelectorDigest {
		t.Fatalf("resolved selector = %+v", resolved)
	}
}

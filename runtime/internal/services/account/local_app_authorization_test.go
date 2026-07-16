package account

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type localAppAuthorizationResolver struct {
	binding    LocalAppCallerBinding
	generation uint64
	err        error
}

func (resolver *localAppAuthorizationResolver) ResolveLocalAppSession(_ context.Context, generation uint64) (LocalAppCallerBinding, error) {
	resolver.generation = generation
	return resolver.binding, resolver.err
}

func TestAuthorizeLocalAppOperationRequiresExactLiveCapability(t *testing.T) {
	service := newHarnessService(t, nil)
	completeLogin(t, service)
	_, generation, ok := service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("runtime account context is unavailable")
	}
	resolver := &localAppAuthorizationResolver{binding: localAppCallerBindingFixture(t, generation)}
	service.SetLocalAppSessionResolver(resolver)

	decision, err := service.AuthorizeLocalAppOperation(context.Background(), LocalAppOperationReadArtifactBytes)
	if err != nil {
		t.Fatalf("authorize local-app artifact operation: %v", err)
	}
	if resolver.generation != generation || decision.TrustClass != LocalAppTrustClassDevelopment ||
		decision.AuthorizationID != resolver.binding.AuthorizationID || decision.PermissionScope != "data.scope.read#runtime.artifacts" {
		t.Fatalf("unexpected local-app decision: %+v", decision)
	}

	resolver.binding.Capabilities = []string{"file.read.scoped#app-local-drafts"}
	if _, err := service.AuthorizeLocalAppOperation(context.Background(), LocalAppOperationReadArtifactBytes); !errors.Is(err, ErrLocalAppOperationNotAdmitted) {
		t.Fatalf("missing capability must fail closed, got %v", err)
	}
	resolver.binding.Capabilities = []string{"data.scope.read#runtime.artifacts"}
	resolver.binding.AuthorizationGeneration++
	if _, err := service.AuthorizeLocalAppOperation(context.Background(), LocalAppOperationReadArtifactBytes); err != nil {
		t.Fatalf("current exact authorization generation should be re-resolved, got %v", err)
	}
}

func TestAuthorizeLocalAppCallerFailsClosedOnResolverAndAccountInvalidation(t *testing.T) {
	service := newHarnessService(t, nil)
	completeLogin(t, service)
	resolver := &localAppAuthorizationResolver{err: errors.New("revoked")}
	service.SetLocalAppSessionResolver(resolver)
	if _, err := service.AuthorizeLocalAppCaller(context.Background()); !errors.Is(err, ErrLocalAppCallerUnauthorized) {
		t.Fatalf("resolver failure err = %v", err)
	}
	resolver.err = ErrLocalAppProcessMismatch
	if _, err := service.AuthorizeLocalAppCaller(context.Background()); !errors.Is(err, ErrLocalAppProcessMismatch) {
		t.Fatalf("process mismatch err = %v", err)
	}
	logout, err := service.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !logout.GetAccepted() {
		t.Fatalf("logout = (%+v, %v)", logout, err)
	}
	if _, err := service.AuthorizeLocalAppCaller(context.Background()); !errors.Is(err, ErrLocalAppAccountChanged) {
		t.Fatalf("logout authorization err = %v", err)
	}
}

func TestAuthorizeLocalAppCallerRejectsMissingOSUserAnchor(t *testing.T) {
	service := newHarnessService(t, nil)
	completeLogin(t, service)
	_, generation, ok := service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("runtime account context is unavailable")
	}
	resolver := &localAppAuthorizationResolver{binding: localAppCallerBindingFixture(t, generation)}
	service.SetLocalAppSessionResolver(resolver)
	resolver.binding.LocalOSUserAnchor = ""
	if _, err := service.AuthorizeLocalAppCaller(context.Background()); !errors.Is(err, ErrLocalAppCallerUnauthorized) {
		t.Fatalf("missing OS-user anchor err = %v", err)
	}
}

func localAppCallerBindingFixture(t testing.TB, generation uint64) LocalAppCallerBinding {
	t.Helper()
	hostDigest := accountLocalAppIdentifier(0x71)
	projectRoot := filepath.Clean(t.TempDir())
	return LocalAppCallerBinding{
		LocalOSUserAnchor:    "windows-sid:S-1-5-21-test",
		SessionID:            accountLocalAppIdentifier(0x72),
		AppID:                "sample.nimi.app",
		HostExecutableDigest: hostDigest,
		AccountGeneration:    generation,
		RuntimeBootEpoch:     accountLocalAppIdentifier(0x73),
		Process: protectedlocal.ProcessTuple{
			OS: protectedlocal.OSWindows, PID: 7101, CreationMarker: "development-start-1",
			OSLoginSession: "login-dev-1", SecurityPrincipal: "user-dev-1",
			CanonicalExecutableIdentity: "development-file-1",
			CanonicalExecutablePath:     filepath.Join(projectRoot, "electron.exe"),
			ExecutableDigest:            hostDigest, ExecutableTrustSetID: protectedlocal.WindowsLocalDevelopmentTrustSetID,
		},
		ExpiresAt:               time.Now().Add(time.Minute),
		TrustClass:              LocalAppTrustClassDevelopment,
		AuthorizationID:         accountLocalAppIdentifier(0x74),
		AuthorizationGeneration: 3,
		ProjectRoot:             projectRoot,
		CapabilityFingerprint:   accountLocalAppIdentifier(0x75),
		Capabilities:            []string{"data.scope.read#runtime.artifacts"},
		LocalAppPrincipalID:     "lap_v1_authorization-fixture",
		LocalAppRecordID:        "lar_v1_authorization-fixture",
		ProvenanceRevision:      1,
		ProjectGeneration:       1,
		PayloadDigest:           "payload-digest:authorization-fixture",
	}
}

func accountLocalAppIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

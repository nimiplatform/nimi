package account

import (
	"context"
	"errors"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

type installedAuthorizationResolver struct {
	binding    InstalledCallerBinding
	generation uint64
	err        error
}

func (resolver *installedAuthorizationResolver) ResolveInstalledSession(_ context.Context, generation uint64) (InstalledCallerBinding, error) {
	resolver.generation = generation
	return resolver.binding, resolver.err
}

func TestAuthorizeInstalledCallerUsesCurrentAccountGeneration(t *testing.T) {
	service := newHarnessService(t, nil)
	completeLogin(t, service)
	_, generation, ok := service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("runtime account context is unavailable")
	}
	release := accountInstalledIdentifier(0x31)
	resolver := &installedAuthorizationResolver{binding: InstalledCallerBinding{
		SessionID:         accountInstalledIdentifier(0x21),
		AppID:             "world.nimi.app",
		ReleaseDigest:     release,
		AccountGeneration: generation,
		RuntimeBootEpoch:  accountInstalledIdentifier(0x41),
		Process: protectedlocal.ProcessTuple{
			OS: protectedlocal.OSWindows, PID: 4101, CreationMarker: "installed-start-1",
			OSLoginSession: "login-1", SecurityPrincipal: "user-1",
			CanonicalExecutableIdentity: "installed-file-1", ExecutableDigest: release,
			ExecutableTrustSetID: "installed-release-policy",
		},
		ExpiresAt: time.Now().Add(time.Minute),
	}}
	service.SetInstalledSessionResolver(resolver)
	decision, err := service.AuthorizeInstalledCaller(context.Background())
	if err != nil {
		t.Fatalf("authorize installed caller: %v", err)
	}
	if resolver.generation != generation || decision.AccountGeneration != generation || decision.AccountID != "acct-1" || decision.AppID != "world.nimi.app" || decision.ReleaseDigest != release {
		t.Fatalf("unexpected decision: %+v resolver_generation=%d", decision, resolver.generation)
	}
	if _, err := service.AuthorizeInstalledOperation(context.Background(), InstalledOperationReadArtifactBytes); !errors.Is(err, ErrInstalledOperationNotAdmitted) {
		t.Fatalf("unadmitted artifact operation err = %v", err)
	}
}

func TestAuthorizeInstalledCallerFailsClosedOnResolverOrAccountInvalidation(t *testing.T) {
	service := newHarnessService(t, nil)
	completeLogin(t, service)
	service.SetInstalledSessionResolver(&installedAuthorizationResolver{err: errors.New("revoked")})
	if _, err := service.AuthorizeInstalledCaller(context.Background()); !errors.Is(err, ErrInstalledCallerUnauthorized) {
		t.Fatalf("resolver failure err = %v", err)
	}
	logout, err := service.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
	if err != nil || !logout.GetAccepted() {
		t.Fatalf("logout = (%+v, %v)", logout, err)
	}
	if _, err := service.AuthorizeInstalledCaller(context.Background()); !errors.Is(err, ErrInstalledCallerUnauthorized) {
		t.Fatalf("logout authorization err = %v", err)
	}
}

func accountInstalledIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

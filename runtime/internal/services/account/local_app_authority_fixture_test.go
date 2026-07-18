package account

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
)

type localAppAuthorityFixture struct {
	service  *Service
	kernel   *localappkernel.Kernel
	resolver *localAppAuthorizationResolver
	now      time.Time
}

func newLocalAppAuthorityFixture(t *testing.T) *localAppAuthorityFixture {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Second)
	sid, err := localappkernel.ValidateVerifiedInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatalf("validate test SID: %v", err)
	}
	kernel, err := localappkernel.OpenSQLite(context.Background(), filepath.Join(t.TempDir(), "local-app-kernel.db"), sid, localappkernel.Options{Now: func() time.Time { return now }})
	if err != nil {
		t.Fatalf("open local-app kernel: %v", err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	principal, err := kernel.Principals().Create(context.Background(), localappkernel.CreatePrincipalInput{
		Kind: localappkernel.PrincipalKindDevelopment, AppID: "sample.nimi.app",
		DevelopmentAuthorizationID: "development-authorization-1", CanonicalProjectFileID: "project-file-1",
	})
	if err != nil {
		t.Fatalf("create local-app principal: %v", err)
	}
	record, err := kernel.Records().Create(context.Background(), localappkernel.CreateRecordInput{
		LocalAppPrincipalID: principal.LocalAppPrincipalID, TrustClass: localappkernel.TrustClassLocalDevelopment,
		ProvenanceAttestationRefs: []string{"development-attestation:1"}, ProvenanceRevision: 1,
		ActiveReleaseOrProjectIdentityRef: "project-identity:1", InstallOrProjectGeneration: 1,
		ActiveCapabilityFingerprint: "capability-fingerprint:1", ExecutionProfileRef: "execution-profile:1",
		HostExecutableDigest: "host-digest:1", PayloadRootDigest: "payload-digest:1", LifecycleState: localappkernel.LifecycleStateActive,
	})
	if err != nil {
		t.Fatalf("create local-app record: %v", err)
	}
	service := newHarnessService(t, nil, WithClock(func() time.Time { return now }), WithLocalAppKernel(kernel))
	completeLogin(t, service)
	_, generation, ok := service.AuthenticatedRuntimeSecurityContext(context.Background())
	if !ok {
		t.Fatal("authenticated account context unavailable")
	}
	binding := localAppCallerBindingFixture(t, generation)
	binding.LocalAppPrincipalID = principal.LocalAppPrincipalID
	binding.LocalAppRecordID = record.LocalAppRecordID
	binding.ProvenanceRevision = record.ProvenanceRevision
	binding.ProjectGeneration = record.InstallOrProjectGeneration
	binding.PayloadDigest = record.PayloadRootDigest
	binding.Capabilities = nil
	resolver := &localAppAuthorizationResolver{binding: binding}
	service.SetLocalAppSessionResolver(resolver)
	return &localAppAuthorityFixture{service: service, kernel: kernel, resolver: resolver, now: now}
}

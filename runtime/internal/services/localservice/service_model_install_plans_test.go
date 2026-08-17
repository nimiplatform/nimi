package localservice

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/metadata"
)

type modelInstallPlanDesktopVerifier struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (verifier modelInstallPlanDesktopVerifier) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return verifier.peers, nil
}

type modelInstallPlanDesktopLiveness struct {
	revoked chan struct{}
	once    sync.Once
}

func newModelInstallPlanDesktopLiveness() *modelInstallPlanDesktopLiveness {
	return &modelInstallPlanDesktopLiveness{revoked: make(chan struct{})}
}

func (liveness *modelInstallPlanDesktopLiveness) Revoked() <-chan struct{} {
	return liveness.revoked
}

func (liveness *modelInstallPlanDesktopLiveness) Close() error {
	liveness.once.Do(func() { close(liveness.revoked) })
	return nil
}

func TestModelInstallPlanCannotCrossProtectedDesktopConnections(t *testing.T) {
	first := establishModelInstallPlanDesktopConnection(t, 0x31)
	second := establishModelInstallPlanDesktopConnection(t, 0x32)

	firstContext := modelInstallPlanProtectedContext(first)
	secondContext := modelInstallPlanProtectedContext(second)
	service := &Service{heldModelInstallPlans: make(map[string]heldModelInstallPlan)}
	plan := &runtimev1.LocalInstallPlanDescriptor{PlanId: "plan-protected-connection-owner"}
	service.holdModelInstallPlan(firstContext, plan)

	if _, err := service.takeModelInstallPlan(secondContext, plan.GetPlanId()); !errors.Is(err, errModelInstallPlanOwner) {
		t.Fatalf("second verified Desktop connection consumed first connection's plan: %v", err)
	}
	owned, err := service.takeModelInstallPlan(firstContext, plan.GetPlanId())
	if err != nil {
		t.Fatalf("owning verified Desktop connection could not consume its plan: %v", err)
	}
	if owned.GetPlanId() != plan.GetPlanId() {
		t.Fatalf("consumed plan id = %q, want %q", owned.GetPlanId(), plan.GetPlanId())
	}
}

func TestModelInstallPlanOwnerKeyKeepsUnprotectedContextFallback(t *testing.T) {
	ctx := authn.WithIdentity(context.Background(), &authn.Identity{
		SubjectUserID: "same-user",
		SessionID:     "same-account-session",
	})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-nimi-app-id", "desktop",
		"x-nimi-app-instance-id", "same-desktop-instance",
		"x-nimi-caller-id", "same-caller",
	))
	want := strings.Join([]string{
		"same-user",
		"same-account-session",
		"desktop",
		"same-desktop-instance",
		"same-caller",
	}, "\x00")
	if got := modelInstallPlanOwnerKey(ctx); got != want {
		t.Fatalf("unprotected identity and metadata owner key = %q, want %q", got, want)
	}
	if got := modelInstallPlanOwnerKey(context.Background()); got != "runtime-local-owner" {
		t.Fatalf("plain context owner key = %q, want runtime-local-owner", got)
	}
}

func establishModelInstallPlanDesktopConnection(t *testing.T, connectionByte byte) *protectedlocal.Connection {
	t.Helper()
	peers := protectedlocal.VerifiedDesktopPeers{
		Client: protectedlocal.ProcessTuple{
			OS:                          protectedlocal.OSWindows,
			PID:                         4101,
			CreationMarker:              "desktop-start",
			OSLoginSession:              "logon-9",
			SecurityPrincipal:           "interactive-user",
			CanonicalExecutableIdentity: "desktop-file-identity",
			ExecutableDigest:            modelInstallPlanIdentifier(0x11),
			ExecutableTrustSetID:        "synthetic-desktop-test-trust-set",
		},
		Server: protectedlocal.ProcessTuple{
			OS:                          protectedlocal.OSWindows,
			PID:                         5101,
			CreationMarker:              "runtime-start",
			OSLoginSession:              "service-session",
			SecurityPrincipal:           "runtime-service",
			CanonicalExecutableIdentity: "runtime-file-identity",
			ExecutableDigest:            modelInstallPlanIdentifier(0x12),
			ExecutableTrustSetID:        "synthetic-runtime-test-trust-set",
		},
		ClientLiveness:     newModelInstallPlanDesktopLiveness(),
		RuntimeBootEpoch:   modelInstallPlanIdentifier(0x13),
		EndpointInstanceID: modelInstallPlanIdentifier(0x14),
		TranscriptNonce:    modelInstallPlanIdentifier(0x15),
	}
	connection, err := protectedlocal.EstablishDesktopConnection(
		context.Background(),
		modelInstallPlanDesktopVerifier{peers: peers},
		bytes.NewReader(bytes.Repeat([]byte{connectionByte}, protectedlocal.IdentifierBytes)),
	)
	if err != nil {
		t.Fatalf("establish verified Desktop connection: %v", err)
	}
	t.Cleanup(connection.Revoke)
	return connection
}

func modelInstallPlanProtectedContext(connection *protectedlocal.Connection) context.Context {
	ctx := authn.WithIdentity(context.Background(), &authn.Identity{
		SubjectUserID: "same-user",
		SessionID:     "same-account-session",
	})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-nimi-app-id", "desktop",
		"x-nimi-app-instance-id", "same-desktop-instance",
		"x-nimi-caller-id", "same-caller",
	))
	return protectedlocal.ContextWithDesktopConnection(ctx, connection)
}

func modelInstallPlanIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

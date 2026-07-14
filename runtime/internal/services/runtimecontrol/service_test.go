package runtimecontrol

import (
	"bytes"
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type restartTestVerifier struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (verifier restartTestVerifier) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return verifier.peers, nil
}

type restartTestLiveness struct{ revoked chan struct{} }

func (liveness *restartTestLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *restartTestLiveness) Close() error             { return nil }

func TestRequestRuntimeRestartRequiresLiveBootScopedDesktopSessionAndTriggersOnce(t *testing.T) {
	boot := restartTestIdentifier(0x11)
	peers := protectedlocal.VerifiedDesktopPeers{
		Client:             restartTestProcess(101, "interactive-user", 0x21),
		Server:             restartTestProcess(202, "runtime-service", 0x31),
		ClientLiveness:     &restartTestLiveness{revoked: make(chan struct{})},
		RuntimeBootEpoch:   boot,
		EndpointInstanceID: restartTestIdentifier(0x41),
		TranscriptNonce:    restartTestIdentifier(0x51),
	}
	connection, err := protectedlocal.EstablishDesktopConnection(
		context.Background(),
		restartTestVerifier{peers: peers},
		bytes.NewReader(bytes.Repeat([]byte{0x61}, protectedlocal.IdentifierBytes*4)),
	)
	if err != nil {
		t.Fatalf("establish Desktop connection: %v", err)
	}
	manager, err := protectedlocal.NewDesktopSessionManager(
		boot,
		bytes.NewReader(bytes.Repeat([]byte{0x71}, protectedlocal.IdentifierBytes*4)),
	)
	if err != nil {
		t.Fatalf("create Desktop session manager: %v", err)
	}
	calls := 0
	service := New(manager, func() bool {
		calls++
		return calls == 1
	})

	if _, err := service.RequestRuntimeRestart(context.Background(), &runtimev1.RequestRuntimeRestartRequest{}); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("plain context restart error = %v, want PermissionDenied", err)
	}
	if calls != 0 {
		t.Fatalf("unauthorized restart invoked callback %d times", calls)
	}

	ctx := protectedlocal.ContextWithDesktopConnection(context.Background(), connection)
	if _, err := manager.Open(ctx); err != nil {
		t.Fatalf("open Desktop session: %v", err)
	}
	ack, err := service.RequestRuntimeRestart(ctx, &runtimev1.RequestRuntimeRestartRequest{})
	if err != nil || !ack.GetAccepted() || ack.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("authorized restart = (%+v, %v)", ack, err)
	}
	if _, err := service.RequestRuntimeRestart(ctx, &runtimev1.RequestRuntimeRestartRequest{}); status.Code(err) != codes.Aborted {
		t.Fatalf("duplicate restart error = %v, want Aborted", err)
	}
	if calls != 2 {
		t.Fatalf("restart requester calls = %d, want 2 with second rejected by requester", calls)
	}
}

func restartTestIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func restartTestProcess(pid uint32, principal string, digest byte) protectedlocal.ProcessTuple {
	return protectedlocal.ProcessTuple{
		OS:                          protectedlocal.OSWindows,
		PID:                         pid,
		CreationMarker:              "creation-marker",
		OSLoginSession:              "session-1",
		SecurityPrincipal:           principal,
		CanonicalExecutableIdentity: "file-identity",
		ExecutableDigest:            restartTestIdentifier(digest),
		ExecutableTrustSetID:        "trust-set",
	}
}

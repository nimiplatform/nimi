package account

import (
	"bytes"
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"google.golang.org/grpc/metadata"
)

type accountTestDesktopVerifier struct {
	peers protectedlocal.VerifiedDesktopPeers
}

func (verifier accountTestDesktopVerifier) VerifyDesktopPeers(context.Context) (protectedlocal.VerifiedDesktopPeers, error) {
	return verifier.peers, nil
}

type accountTestDesktopLiveness struct {
	revoked chan struct{}
}

func (liveness *accountTestDesktopLiveness) Revoked() <-chan struct{} { return liveness.revoked }
func (liveness *accountTestDesktopLiveness) Close() error             { return nil }

func accountTestIdentifier(value byte) protectedlocal.Identifier {
	var identifier protectedlocal.Identifier
	for index := range identifier {
		identifier[index] = value
	}
	return identifier
}

func accountTestProcess(pid uint32, principal string, executable string, digest byte) protectedlocal.ProcessTuple {
	return protectedlocal.ProcessTuple{
		OS:                          protectedlocal.OSWindows,
		PID:                         pid,
		CreationMarker:              executable + "-creation",
		OSLoginSession:              "interactive-logon-1",
		SecurityPrincipal:           principal,
		CanonicalExecutableIdentity: executable,
		ExecutableDigest:            accountTestIdentifier(digest),
		ExecutableTrustSetID:        executable + "-trust-v1",
	}
}

func protectedDesktopAccountContext(t *testing.T) context.Context {
	t.Helper()
	connection, err := protectedlocal.EstablishDesktopConnection(
		context.Background(),
		accountTestDesktopVerifier{peers: protectedlocal.VerifiedDesktopPeers{
			Client:             accountTestProcess(101, "interactive-user", "nimi-desktop", 0x11),
			Server:             accountTestProcess(202, "runtime-service", "nimi-runtime", 0x22),
			ClientLiveness:     &accountTestDesktopLiveness{revoked: make(chan struct{})},
			RuntimeBootEpoch:   accountTestIdentifier(0x33),
			EndpointInstanceID: accountTestIdentifier(0x44),
			TranscriptNonce:    accountTestIdentifier(0x55),
		}},
		bytes.NewReader(bytes.Repeat([]byte{0x66}, protectedlocal.IdentifierBytes)),
	)
	if err != nil {
		t.Fatalf("establish protected Desktop account context: %v", err)
	}
	return protectedlocal.ContextWithDesktopConnection(context.Background(), connection)
}

func TestDesktopAccountHostRequiresProtectedDesktopOrigin(t *testing.T) {
	svc := newProductionHarnessService(t, &memoryCustody{})
	caller := desktopAccountControlCaller()

	if reason, ok := svc.validateDesktopAccountHost(protectedDesktopAccountContext(t), caller); !ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_ACTION_EXECUTED {
		t.Fatalf("protected Desktop account origin rejected: ok=%v reason=%v", ok, reason)
	}

	legacyEnvelope := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-source-host", "desktop-tauri-account-host",
		"x-nimi-app-id", caller.GetAppId(),
		"x-nimi-app-instance-id", caller.GetAppInstanceId(),
		"x-nimi-device-id", caller.GetDeviceId(),
		"x-nimi-session-id", "desktop-runtime-session",
		"x-nimi-session-token", "desktop-runtime-session-token",
	))
	if reason, ok := svc.validateDesktopAccountHost(legacyEnvelope, caller); ok || reason != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_ENVELOPE_MISMATCH {
		t.Fatalf("metadata/session envelope must not establish Desktop account origin: ok=%v reason=%v", ok, reason)
	}
}

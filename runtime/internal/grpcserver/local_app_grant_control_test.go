package grpcserver

import (
	"bytes"
	"context"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestLocalAppGrantControlBridgeBindsToExactDesktopSession(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	ctx := protectedlocal.ContextWithDesktopConnection(context.Background(), connection)
	if _, err := manager.Open(ctx); err != nil {
		t.Fatalf("open Desktop session: %v", err)
	}
	bridge := newLocalAppGrantControlBridge(manager)
	requestID := bytes.Repeat([]byte{0x41}, 32)
	challengeID := bytes.Repeat([]byte{0x42}, 32)
	challenge := accountservice.LocalAppGrantChallengeBinding{
		RequestID: requestID, PresenceChallengeID: challengeID,
		LocalOSUserAnchor: "sid-anchor", AccountID: "account-a", AccountGeneration: 3,
		LocalAppPrincipalID: "principal-a", LocalAppRecordID: "record-a",
		ProvenanceRevision: 2, ProjectGeneration: 4, SessionID: protectedTestIdentifier(0x43),
		OperationID: "runtime_agent.conversation.open", ResourceImpactDigest: "fingerprint-a",
		PolicyRevision: 1, IssuedAt: time.Now().UTC(), ExpiresAt: time.Now().UTC().Add(time.Minute),
	}
	controlRef, err := bridge.BindLocalAppGrantChallenge(context.Background(), challenge)
	if err != nil || controlRef == "" {
		t.Fatalf("bind challenge: ref=%q err=%v", controlRef, err)
	}
	if _, found, err := bridge.PendingLocalAppGrantChallenge(context.Background()); err == nil || found {
		t.Fatalf("plain context reconstructed control authority: found=%v err=%v", found, err)
	}
	pending, found, err := bridge.PendingLocalAppGrantChallenge(ctx)
	if err != nil || !found || !bytes.Equal(pending.RequestID, requestID) || !bytes.Equal(pending.PresenceChallengeID, challengeID) {
		t.Fatalf("pending challenge: found=%v pending=%+v err=%v", found, pending, err)
	}
	pending.RequestID[0] ^= 0xff
	again, found, err := bridge.PendingLocalAppGrantChallenge(ctx)
	if err != nil || !found || !bytes.Equal(again.RequestID, requestID) {
		t.Fatalf("pending challenge alias leaked: found=%v err=%v", found, err)
	}
	bridge.CompleteLocalAppGrantChallenge(requestID)
	if _, found, err := bridge.PendingLocalAppGrantChallenge(ctx); err != nil || found {
		t.Fatalf("completed challenge remained pending: found=%v err=%v", found, err)
	}
}

func TestLocalAppGrantControlBridgeExpiresPendingChallenge(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	ctx := protectedlocal.ContextWithDesktopConnection(context.Background(), connection)
	if _, err := manager.Open(ctx); err != nil {
		t.Fatal(err)
	}
	bridge := newLocalAppGrantControlBridge(manager)
	challenge := accountservice.LocalAppGrantChallengeBinding{
		RequestID: bytes.Repeat([]byte{0x51}, 32), PresenceChallengeID: bytes.Repeat([]byte{0x52}, 32),
		ExpiresAt: time.Now().UTC().Add(-time.Second), IssuedAt: time.Now().UTC().Add(-time.Minute),
	}
	if _, err := bridge.BindLocalAppGrantChallenge(context.Background(), challenge); err != nil {
		t.Fatal(err)
	}
	if _, found, err := bridge.PendingLocalAppGrantChallenge(ctx); err != nil || found {
		t.Fatalf("expired challenge projected: found=%v err=%v", found, err)
	}
}

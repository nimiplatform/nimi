package connector

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/proto"
)

type observedConnectorAuditWriter struct {
	*runtimepersistence.Backend
	armed   atomic.Bool
	once    sync.Once
	entered chan struct{}
}

func (b *observedConnectorAuditWriter) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	return b.Backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if b.armed.Load() {
			b.once.Do(func() { close(b.entered) })
		}
		return fn(tx)
	})
}

func TestChatGPTPlanDeleteSerializesReauthorizationBeforeAuditWriter(t *testing.T) {
	revoking, release := make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	finishRevoke := func() { releaseOnce.Do(func() { close(release) }) }
	defer finishRevoke()
	renewer := &fakeChatGPTPlanRenewer{revokeErrFor: func(string) error {
		close(revoking)
		<-release
		return nil
	}}
	svc, clock := newChatGPTPlanTestService(t, renewer)
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "audit.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	writer := &observedConnectorAuditWriter{Backend: backend, entered: make(chan struct{})}
	svc.audit, err = auditlog.Open(writer, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	ctx := userContext("user-1")
	created, err := svc.CreateConnector(ctx, &runtimev1.CreateConnectorRequest{Provider: ChatGPTPlanProvider,
		AuthKind: runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED, ProviderAuthProfile: ChatGPTPlanAuthProfile,
		CredentialJson: testChatGPTPlanAuthorization(t, clock.Now(), nil)})
	if err != nil {
		t.Fatal(err)
	}
	id := created.GetConnector().GetConnectorId()
	writer.armed.Store(true)
	type deleteOutcome struct {
		response *runtimev1.DeleteConnectorResponse
		err      error
	}
	deleted := make(chan deleteOutcome, 1)
	go func() {
		response, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{ConnectorId: id})
		deleted <- deleteOutcome{response, err}
	}()
	select {
	case <-revoking:
	case <-time.After(2 * time.Second):
		t.Fatal("deletion did not reach revocation")
	}
	credential := testChatGPTPlanAuthorization(t, clock.Now(), func(value map[string]any) { value["refresh_token"] = "refresh-after-revoke" })
	updated := make(chan error, 1)
	go func() {
		_, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, CredentialJson: proto.String(credential)})
		updated <- err
	}()
	// The former ordering let Update occupy this writer while waiting for the
	// revocation lock, then store a token after the last revocation attempt.
	select {
	case <-writer.entered:
		t.Error("reauthorization entered the audit writer during revocation")
	case <-time.After(100 * time.Millisecond):
	}
	finishRevoke()
	select {
	case result := <-deleted:
		if result.err != nil || !result.response.GetAck().GetOk() || result.response.GetAck().GetActionHint() != "" {
			t.Fatalf("delete result: %v %v", result.response, result.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("delete and reauthorization deadlocked")
	}
	select {
	case err := <-updated:
		if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND {
			t.Fatalf("late authorization was not refused after deletion: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("late authorization did not finish")
	}
	if len(renewer.revoked) != 1 || renewer.revoked[0] != testChatGPTPlanClientID+"|refresh-1" {
		t.Fatalf("unexpected revoked sessions: %v", renewer.revoked)
	}
	if _, found, err := svc.store.Get(id); err != nil || found {
		t.Fatalf("deleted connector survived: found=%v err=%v", found, err)
	}
}

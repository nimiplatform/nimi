package connector

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestJobOutboundSharesActualConnectorMutationGuard(t *testing.T) {
	for _, mutationFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "mutation-first", false: "handoff-first"}[mutationFirst], func(t *testing.T) {
			store := newTestStore(t)
			created, err := store.Create(ConnectorRecord{ConnectorID: "job-connector", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "owner", Provider: "openai", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE}, "original-key")
			if err != nil {
				t.Fatal(err)
			}
			captured, ref, err := store.CaptureCredentialCustody(created.ConnectorID, "job-original")
			if err != nil {
				t.Fatal(err)
			}
			captured.CredentialCustodyRef = ref
			disabled := runtimev1.ConnectorStatus_CONNECTOR_STATUS_DISABLED
			mutate := func() error {
				_, err := store.Update(created.ConnectorID, ConnectorMutations{Status: &disabled})
				return err
			}
			if mutationFirst {
				if err := mutate(); err != nil {
					t.Fatal(err)
				}
				called := false
				err := store.BeginJobOutbound(context.Background(), "job-original", "owner", captured, func() error { called = true; return nil })
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_CONNECTOR_DISABLED || called {
					t.Fatalf("mutation did not reject handoff: %v", err)
				}
				return
			}
			entered, release := make(chan struct{}), make(chan struct{})
			admitted, mutated := make(chan error, 1), make(chan error, 1)
			go func() {
				admitted <- store.BeginJobOutbound(context.Background(), "job-original", "owner", captured, func() error { close(entered); <-release; return nil })
			}()
			<-entered
			go func() { mutated <- mutate() }()
			select {
			case err := <-mutated:
				close(release)
				t.Fatalf("mutation overtook the transport handoff: %v", err)
			case <-time.After(20 * time.Millisecond):
			}
			close(release)
			if err := <-admitted; err != nil {
				t.Fatal(err)
			}
			if err := <-mutated; err != nil {
				t.Fatal(err)
			}
			if err := store.BeginJobOutbound(context.Background(), "job-original", "owner", captured, func() error { t.Error("second IO borrowed the first admission"); return nil }); err == nil {
				t.Fatal("next IO was admitted")
			}
		})
	}
}

func TestJobCredentialOpeningNeverFallsBackFromOriginalCustody(t *testing.T) {
	store := newTestStore(t)
	created, err := store.Create(ConnectorRecord{ConnectorID: "original", Kind: runtimev1.ConnectorKind_CONNECTOR_KIND_REMOTE_MANAGED, OwnerType: runtimev1.ConnectorOwnerType_CONNECTOR_OWNER_TYPE_REALM_USER, OwnerID: "owner", Provider: "openai", Status: runtimev1.ConnectorStatus_CONNECTOR_STATUS_ACTIVE}, "original-key")
	if err != nil {
		t.Fatal(err)
	}
	captured, ref, err := store.CaptureCredentialCustody(created.ConnectorID, "job-original")
	if err != nil {
		t.Fatal(err)
	}
	captured.CredentialCustodyRef = ref
	if _, err := store.OpenJobCredential(context.Background(), "another-job", "owner", captured); err == nil {
		t.Fatal("foreign Job opened original custody")
	}
	if err := store.ReleaseCredentialCustody(ref); err != nil {
		t.Fatal(err)
	}
	if _, err := store.OpenJobCredential(context.Background(), "job-original", "owner", captured); err == nil {
		t.Fatal("missing original custody fell back to current secret")
	}
}

package runtimeagent

import (
	"context"
	"database/sql"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/appactivity"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type activityTestRegistrations struct{}

func (activityTestRegistrations) ActivitySource(context.Context, string) (appactivity.SourceFacts, error) {
	return appactivity.SourceFacts{AppID: "nimi.test", DisplayName: "Test", Active: true}, nil
}

// Runs a competing owner commit just before the publication acquires its
// transaction, after any nontransactional admission or handle resolution.
type activityInterleavingBackend struct {
	*runtimepersistence.Backend
	beforeWrite func()
}

func (backend *activityInterleavingBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	if before := backend.beforeWrite; before != nil {
		backend.beforeWrite = nil
		before()
	}
	return backend.Backend.WriteTx(ctx, fn)
}

func TestAppActivityAgentLifecycleIsCheckedInThePublicationTransaction(t *testing.T) {
	for _, lifecycle := range []string{"terminating", "deleted"} {
		t.Run(lifecycle, func(t *testing.T) {
			ctx := context.Background()
			backend, err := runtimepersistence.Open(slog.Default(), filepath.Join(t.TempDir(), "local-state.json"))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = backend.Close() })
			agent := &runtimev1.LocalAgentRecord{
				LocalAgentRef: "activity-agent", OwnerUserId: "account-1", DisplayName: "Mira",
				LifecycleStatus: runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
			}
			agentJSON, err := protojson.Marshal(agent)
			if err != nil {
				t.Fatal(err)
			}
			store := cognitionmemory.NewStore(backend)
			if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
				if _, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES(?, ?)`, agent.GetLocalAgentRef(), string(agentJSON)); err != nil {
					return err
				}
				_, err := store.CreateAgentBindingTx(tx, agent.GetLocalAgentRef(), "memory-subject", true)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			owner := &Service{agents: map[string]*agentEntry{agent.GetLocalAgentRef(): {Agent: agent}}}
			interleaving := &activityInterleavingBackend{Backend: backend}
			activity := appactivity.New(appactivity.Options{Backend: interleaving, Agents: owner, Registrations: activityTestRegistrations{}})
			t.Cleanup(func() { _ = activity.Close() })
			decision := localAppReferenceDecision(1, "account-1")
			decision.Operation = localappop.OperationAppActivityPut
			decision.OperationCapability = appactivity.AppAccessDomain
			decision.ExpiresAt = time.Now().Add(time.Hour)
			publicationCtx := accountservice.ContextWithAuthorizedLocalAppDecision(ctx, decision)
			request := &runtimev1.PutAppActivityRequest{
				Key: "draft-1", Revision: 1, Kind: runtimev1.AppActivityKind_APP_ACTIVITY_KIND_TODO,
				TodoState: runtimev1.AppActivityTodoState_APP_ACTIVITY_TODO_STATE_OPEN,
				Title:     "Review draft", ObjectRef: "draft:1", ActivityType: "com.example.review.v1",
				OccurredAt: timestamppb.Now(), AgentHandle: mintLocalAppAgentHandle(decision, agent.GetLocalAgentRef()),
			}
			if response, err := activity.PutAppActivity(publicationCtx, request); err != nil || response.GetRecord().GetAgent() == nil {
				t.Fatalf("initial active Agent publication failed: %+v %v", response, err)
			}
			interleaving.beforeWrite = func() {
				if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
					termination := cognitionmemory.NewTerminationService(store, nil)
					if _, err := termination.PrepareAgentTerminationTx(tx, agent.GetLocalAgentRef(), "activity-termination", memoryv1.DeleteReasonAgentTermination); err != nil {
						return err
					}
					if lifecycle == "deleted" {
						if _, err := tx.Exec(`DELETE FROM runtime_local_agent WHERE local_agent_ref = ?`, agent.GetLocalAgentRef()); err != nil {
							return err
						}
					}
					_, err := appactivity.RemoveAgentActivityTx(ctx, tx, agent.GetLocalAgentRef(), time.Now())
					return err
				}); err != nil {
					t.Fatal(err)
				}
			}
			request.Revision = 2
			if response, err := activity.PutAppActivity(publicationCtx, request); err == nil || response != nil {
				t.Fatalf("Agent association restored after %s: %+v %v", lifecycle, response, err)
			}
			var associated int
			if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_app_activity_record WHERE agent_local_ref != ''`).Scan(&associated); err != nil || associated != 0 {
				t.Fatalf("cleanup was undone: count=%d err=%v", associated, err)
			}
			// The same durable fence also suppresses a previously prepared
			// Runtime-origin turn hook, even if in-memory flags still look active.
			hook, published := owner.appActivityTurnTxHook(&publicChatAnchorState{OwnerUserID: "account-1", LocalAgentRef: agent.GetLocalAgentRef()}, "committed-turn", time.Now())
			if err := backend.WriteTx(ctx, hook); err != nil || *published {
				t.Fatalf("Runtime turn published through Agent fence: published=%v err=%v", *published, err)
			}
		})
	}
}

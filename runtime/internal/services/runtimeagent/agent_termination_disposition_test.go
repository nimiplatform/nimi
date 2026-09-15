package runtimeagent

import (
	"context"
	"errors"
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAgentTerminationRetriesCognitionDeletedCleanup(t *testing.T) {
	for _, restart := range []bool{false, true} {
		t.Run(map[bool]string{false: "retry", true: "restart"}[restart], func(t *testing.T) {
			ctx := context.Background()
			path := filepath.Join(t.TempDir(), "state.json")
			svc, owner, closeFirst := openRuntimeAgentTestCompositionWithOwner(t, path)
			const source = "audit-cognition-deleted-retry"
			localRef := testRuntimeAgentLocalRef(source)
			if _, err := materializeRealmSourceTestAgent(t, svc, ctx, &realmSourceTestAgentInput{Context: testRuntimeAgentIdentityContext(source)}); err != nil {
				closeFirst()
				t.Fatal(err)
			}
			bank := seedCognitionMemoryForTerminationTest(t, svc, localRef, "I prefer jasmine tea")
			cleanupCalls := 0
			// An execution owner may transiently refuse disposal; no real user data or
			// external backend is used. The second call would complete normally.
			svc.cognitionMemoryStore.SetAgentEmbeddingDisposer(func(context.Context, string) error {
				cleanupCalls++
				if cleanupCalls == 1 {
					return errors.New("injected one-shot payload owner unavailable")
				}
				return nil
			})
			req := &runtimev1.TerminateAgentRequest{Context: testRuntimeAgentIdentityContext(source), Reason: "audit recoverable disposal"}
			if _, err := svc.TerminateAgent(ctx, req); err == nil {
				closeFirst()
				t.Fatal("first injected cleanup failure was not surfaced")
			}
			var phase string
			if err := svc.backend.DB().QueryRow(`SELECT phase FROM runtime_cognition_memory_termination WHERE local_agent_ref = ?`, localRef).Scan(&phase); err != nil || phase != "cognition_deleted" {
				closeFirst()
				t.Fatalf("phase=%s %v", phase, err)
			}
			if _, err := owner.ListMemories(ctx, bank, true); !memoryv1.IsOutcome(err, memoryv1.OutcomeConflict) {
				closeFirst()
				t.Fatalf("Core deletion did not commit: %v", err)
			}
			if restart {
				closeFirst()
				var closeSecond func()
				svc, _, closeSecond = openRuntimeAgentTestCompositionWithOwner(t, path)
				defer closeSecond()
			} else {
				defer closeFirst()
			}
			if _, err := svc.TerminateAgent(ctx, req); err != nil {
				t.Fatalf("resume persisted disposition: %v", err)
			}
			if err := svc.backend.DB().QueryRow(`SELECT phase FROM runtime_cognition_memory_termination WHERE local_agent_ref = ?`, localRef).Scan(&phase); err != nil || phase != "completed" {
				t.Fatalf("phase=%s error=%v", phase, err)
			}
			if !restart && cleanupCalls != 2 {
				t.Fatalf("cleanup retried %d times", cleanupCalls)
			}
		})
	}
}

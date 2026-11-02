package runtimeagent

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func TestMaterializeRealmSourceConcurrentDifferentRequestsKeepOnePartner(t *testing.T) {
	for _, kind := range []string{"world-character", "persona-character"} {
		t.Run(kind, func(t *testing.T) {
			svc, _, closeService := openRealmSourceMaterializationServiceTest(t, kind)
			defer closeService()
			ctx, request := realmSourceMaterializationServiceTestRequest(t, kind, "first")
			const count = 5
			responses := make([]*runtimev1.MaterializeRealmSourceResponse, count)
			errs := make([]error, count)
			var wg sync.WaitGroup
			for i := range responses {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					req := proto.Clone(request).(*runtimev1.MaterializeRealmSourceRequest)
					req.RequestId = fmt.Sprintf("independent-request-%d", i)
					responses[i], errs[i] = svc.MaterializeRealmSource(ctx, req)
				}(i)
			}
			wg.Wait()
			created := 0
			for i, response := range responses {
				if errs[i] != nil {
					t.Fatal(errs[i])
				}
				if response.GetReasonCode() == runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE {
					created++
				} else if response.GetReasonCode() != runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_REQUEST_CONFLICT || response.GetLocalAgentRef() != "" {
					t.Fatalf("duplicate result = %+v", response)
				}
			}
			if created != 1 {
				t.Fatalf("created %d partners", created)
			}
			assertRealmSourceMaterializationGlobalProductRows(t, svc, 1, 1)
		})
	}
}

func TestSameCharacterCanBelongToDifferentAccounts(t *testing.T) {
	svc, _, closeService := openRealmSourceMaterializationServiceTest(t, "persona-character")
	defer closeService()
	ctx, req := realmSourceMaterializationServiceTestRequest(t, "persona-character", "first-account")
	first, err := svc.MaterializeRealmSource(ctx, req)
	assertRealmSourceMaterializationSuccess(t, first, err, "persona-character")
	req.RequestId = "second-account"
	req.Context.SubjectUserId, req.Context.OwnerUserId = "another-account", "another-account"
	second, err := svc.MaterializeRealmSource(sourceMaterializationTransportTestContext("another-account"), req)
	assertRealmSourceMaterializationSuccess(t, second, err, "persona-character")
	if first.LocalAgentRef == second.LocalAgentRef {
		t.Fatal("accounts shared a partner")
	}
	assertRealmSourceMaterializationGlobalProductRows(t, svc, 2, 2)
}

func TestRestoreRefusesPrecutDuplicatePartnersWithoutDeletingThem(t *testing.T) {
	svc, _, closeService := openRealmSourceMaterializationServiceTest(t, "persona-character")
	defer closeService()
	ctx, req := realmSourceMaterializationServiceTestRequest(t, "persona-character", "first")
	first, err := svc.MaterializeRealmSource(ctx, req)
	assertRealmSourceMaterializationSuccess(t, first, err, "persona-character")
	snapshot, found, err := svc.realmSourceSnapshotStoreV2.sourceSnapshot(ctx, first.LocalAgentRef)
	if err != nil || !found {
		t.Fatalf("snapshot: %v", err)
	}
	// Model an actual pre-cut database: independent local identity, valid
	// immutable snapshot and provenance, but the same source Character.
	snapshot.LocalAgentRef = realmSourceMaterializationProductTestLocalAgentRef("precut-duplicate")
	agent := proto.Clone(svc.agents[first.LocalAgentRef].Agent).(*runtimev1.LocalAgentRecord)
	agent.LocalAgentRef = snapshot.LocalAgentRef
	agent.SourceContextStatus = localAgentSourceContextStatusV2(snapshot)
	raw, err := protojson.Marshal(agent)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES (?, ?)`, agent.LocalAgentRef, string(raw)); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_life(local_agent_ref, life_json) SELECT ?, life_json FROM runtime_local_agent_life WHERE local_agent_ref = ?`, agent.LocalAgentRef, first.LocalAgentRef); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_state_projection(local_agent_ref, state_json) SELECT ?, state_json FROM runtime_local_agent_state_projection WHERE local_agent_ref = ?`, agent.LocalAgentRef, first.LocalAgentRef); err != nil {
			return err
		}
		return persistLocalAgentSourceSnapshotV2Tx(tx, snapshot)
	}); err != nil {
		t.Fatal(err)
	}
	restored, err := NewWithBackend(nil, filepath.Join(filepath.Dir(svc.backend.Path()), "local-state.json"), svc.backend)
	if restored != nil {
		restored.Close()
	}
	if err == nil || !strings.Contains(err.Error(), "duplicate_character_partners_cleanup_required") {
		t.Fatalf("restore: %v", err)
	}
	for _, ref := range []string{first.LocalAgentRef, agent.LocalAgentRef} {
		for _, table := range []string{"runtime_local_agent", "runtime_local_agent_source_snapshot_v2", "runtime_local_agent_source_provenance_v3"} {
			if count := runtimeAgentRowCount(t, svc, table, "local_agent_ref", ref); count != 1 {
				t.Fatalf("restore removed %s from %s", ref, table)
			}
		}
	}
}

func TestCharacterUniquenessSurvivesRestartAndNonActiveLifecycle(t *testing.T) {
	for _, state := range []runtimev1.AgentLifecycleStatus{
		runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_INITIALIZING,
		runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_SUSPENDED,
		runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATING,
	} {
		t.Run(state.String(), func(t *testing.T) {
			svc, _, closeService := openRealmSourceMaterializationServiceTest(t, "persona-character")
			defer closeService()
			ctx, req := realmSourceMaterializationServiceTestRequest(t, "persona-character", "initial")
			first, err := svc.MaterializeRealmSource(ctx, req)
			assertRealmSourceMaterializationSuccess(t, first, err, "persona-character")
			restarted, err := NewWithBackend(nil, filepath.Join(filepath.Dir(svc.backend.Path()), "local-state.json"), svc.backend)
			if err != nil {
				t.Fatal(err)
			}
			defer restarted.Close()
			restarted.agents[first.LocalAgentRef].Agent.LifecycleStatus = state
			verified := verifiedRealmSourceMaterializationVectorV3(t, "persona-character")
			prepared, _, err := restarted.prepareRealmSourceMaterializationProductV3(context.Background(), req.Context.OwnerUserId, realmSourceMaterializationProductTestLocalAgentRef("second"), verified)
			if err != nil {
				t.Fatal(err)
			}
			err = restarted.backend.WriteTx(context.Background(), prepared.commitTx)
			prepared.rolledBack()
			if sourceMaterializationV3FailureCode(err) != sourceMaterializationFailureRequestConflictV3 {
				t.Fatalf("duplicate: %v", err)
			}
			assertRealmSourceMaterializationGlobalProductRows(t, restarted, 1, 1)
		})
	}
}

func TestStableCharacterIdentityExcludesRevisionButIncludesSourceOwnership(t *testing.T) {
	for _, kind := range []string{"world-character", "persona-character"} {
		ref := sourceMaterializationProtoRefV3(sourceMaterializationReferenceSourceRefV3(kind))
		next := proto.Clone(ref).(*runtimev1.CharacterSourceRefV3)
		if world := next.GetWorldCharacter(); world != nil {
			world.SourceHash = "changed"
			if !sameMaterializedCharacter(ref, next) {
				t.Fatal("revision created a Character")
			}
			world.WorldEntityRef.EntityId = "another-entity"
		} else {
			next.GetPersonaCharacter().SourceHash = "changed"
			if !sameMaterializedCharacter(ref, next) {
				t.Fatal("revision created a Character")
			}
			next.GetPersonaCharacter().OwnerAccountId = "another-author"
		}
		if sameMaterializedCharacter(ref, next) {
			t.Fatal("distinct Character ownership merged")
		}
	}
}

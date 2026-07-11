package runtimeagent

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestLocalAgentSourceSnapshotCharacterAndPersonaRoundTripAcrossRestart(t *testing.T) {
	for _, kind := range []string{"worldCharacter", "realmPersona"} {
		t.Run(kind, func(t *testing.T) {
			statePath := filepath.Join(t.TempDir(), "state.json")
			svc, closeFirst := openSourceMaterializationTransportTestService(t, statePath)
			candidate := sourceMaterializationTransportTestCandidate(t, kind, "packet-snapshot-"+kind)
			localAgentRef := sourceMaterializationTransportTestLocalAgentRef(kind)
			capturedAt := time.Date(2026, 7, 10, 9, 0, 0, 123000000, time.UTC)
			snapshot, err := finalizeLocalAgentSourceSnapshotV1(candidate, localAgentRef, capturedAt)
			if err != nil {
				t.Fatalf("finalizeLocalAgentSourceSnapshotV1: %v", err)
			}
			if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
				if err := insertSourceMaterializationTestAgentTx(tx, snapshot, sourceMaterializationTransportTestAccount); err != nil {
					return err
				}
				return insertLocalAgentSourceSnapshotTx(tx, snapshot)
			}); err != nil {
				t.Fatalf("persist source snapshot: %v", err)
			}
			loaded, found, err := svc.sourceMaterializationRepo.sourceSnapshot(context.Background(), localAgentRef)
			if err != nil || !found {
				t.Fatalf("sourceSnapshot: found=%v err=%v", found, err)
			}
			if loaded.SnapshotHash != snapshot.SnapshotHash || loaded.CapturedAt != snapshot.CapturedAt {
				t.Fatalf("loaded snapshot mismatch: loaded=%+v snapshot=%+v", loaded, snapshot)
			}
			var persistedJSON string
			if err := svc.backend.DB().QueryRow(`SELECT typed_snapshot_json FROM runtime_local_agent_source_snapshot WHERE local_agent_ref = ?`, localAgentRef).Scan(&persistedJSON); err != nil {
				t.Fatalf("read typed source snapshot JSON: %v", err)
			}
			for _, forbidden := range []string{"packetProof", "challengeId", "challengeDigest", "intendedRuntimeAudience", "nonce", "expiresAt", "controlBytes", "chunkBytes", "uploadId"} {
				if strings.Contains(persistedJSON, `"`+forbidden+`"`) {
					t.Fatalf("persisted source snapshot contains forbidden %s", forbidden)
				}
			}
			status := localAgentSourceContextStatus(loaded)
			if !status.GetReady() || status.GetState() != runtimev1.AgentLocalSourceContextState_AGENT_LOCAL_SOURCE_CONTEXT_STATE_READY || status.GetLocalAgentRef() != localAgentRef || status.GetSnapshotHash() != snapshot.SnapshotHash || len(status.GetCoverageSections()) == 0 {
				t.Fatalf("bounded source status = %+v", status)
			}
			closeFirst()

			restarted, closeRestarted := openSourceMaterializationTransportTestService(t, statePath)
			defer closeRestarted()
			rehydrated, found, err := restarted.sourceMaterializationRepo.sourceSnapshot(context.Background(), localAgentRef)
			if err != nil || !found || rehydrated.SnapshotHash != snapshot.SnapshotHash {
				t.Fatalf("rehydrated source snapshot: found=%v hash=%q err=%v", found, rehydrated.SnapshotHash, err)
			}
		})
	}
}

func TestLocalAgentSourceSnapshotProvenanceIsOneToManyForSameSemanticSource(t *testing.T) {
	svc, closeService := openSourceMaterializationTransportTestService(t, filepath.Join(t.TempDir(), "state.json"))
	defer closeService()
	firstCandidate := sourceMaterializationTransportTestCandidate(t, "realmPersona", "packet-provenance-1")
	secondCandidate := sourceMaterializationTransportTestCandidate(t, "realmPersona", "packet-provenance-2")
	first, err := finalizeLocalAgentSourceSnapshotV1(firstCandidate, sourceMaterializationTransportTestLocalAgentRef("provenance-1"), time.Date(2026, 7, 10, 9, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	second, err := finalizeLocalAgentSourceSnapshotV1(secondCandidate, sourceMaterializationTransportTestLocalAgentRef("provenance-2"), time.Date(2026, 7, 10, 9, 1, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if first.SnapshotHash != second.SnapshotHash || first.LocalAgentRef == second.LocalAgentRef {
		t.Fatalf("semantic snapshot identity mismatch: first=%+v second=%+v", first, second)
	}
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		for _, snapshot := range []localAgentSourceSnapshotV1{first, second} {
			if err := insertSourceMaterializationTestAgentTx(tx, snapshot, sourceMaterializationTransportTestAccount); err != nil {
				return err
			}
			if err := insertLocalAgentSourceSnapshotTx(tx, snapshot); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatalf("persist provenance snapshots: %v", err)
	}
	sourceRef := sourceMaterializationProtoRef(first.SourceRef)
	indexed, err := svc.sourceMaterializationRepo.sourceSnapshotsByProvenance(context.Background(), sourceRef, first.MaterializationContextHash)
	if err != nil {
		t.Fatalf("sourceSnapshotsByProvenance: %v", err)
	}
	if len(indexed) != 2 || indexed[0].SnapshotHash != indexed[1].SnapshotHash || indexed[0].LocalAgentRef == indexed[1].LocalAgentRef {
		t.Fatalf("1:N provenance projection = %+v", indexed)
	}
}

func TestLocalAgentSourceSnapshotIsImmutableAndCorruptionFailsRestart(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "state.json")
	svc, closeFirst := openSourceMaterializationTransportTestService(t, statePath)
	candidate := sourceMaterializationTransportTestCandidate(t, "worldCharacter", "packet-corruption")
	snapshot, err := finalizeLocalAgentSourceSnapshotV1(candidate, sourceMaterializationTransportTestLocalAgentRef("corruption"), time.Date(2026, 7, 10, 9, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if err := insertSourceMaterializationTestAgentTx(tx, snapshot, sourceMaterializationTransportTestAccount); err != nil {
			return err
		}
		return insertLocalAgentSourceSnapshotTx(tx, snapshot)
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.backend.DB().Exec(`UPDATE runtime_local_agent_source_snapshot SET snapshot_hash = ? WHERE local_agent_ref = ?`, strings.Repeat("0", 64), snapshot.LocalAgentRef); err == nil || !strings.Contains(err.Error(), "immutable") {
		t.Fatalf("immutable snapshot update error = %v", err)
	}
	if _, err := svc.backend.DB().Exec(`DROP TRIGGER runtime_local_agent_source_snapshot_no_update`); err != nil {
		t.Fatalf("drop immutable trigger for corruption fixture: %v", err)
	}
	if _, err := svc.backend.DB().Exec(`UPDATE runtime_local_agent_source_snapshot SET snapshot_hash = ? WHERE local_agent_ref = ?`, strings.Repeat("0", 64), snapshot.LocalAgentRef); err != nil {
		t.Fatalf("seed corrupted snapshot: %v", err)
	}
	closeFirst()

	memorySvc, err := memoryservice.New(nil, config.Config{LocalStatePath: statePath, AIHTTPTimeoutSeconds: 2})
	if err != nil {
		t.Fatalf("memory.New after corruption: %v", err)
	}
	defer func() { _ = memorySvc.Close() }()
	if restarted, err := New(nil, statePath, memorySvc); err == nil {
		restarted.Close()
		t.Fatal("corrupted source snapshot was admitted on restart")
	} else if !strings.Contains(err.Error(), "column binding mismatch") {
		t.Fatalf("restart corruption error = %v", err)
	}
}

func TestLocalAgentSourceSnapshotProvenanceCorruptionFailsRestart(t *testing.T) {
	mutations := map[string]func(*testing.T, *Service, localAgentSourceSnapshotV1){
		"missing": func(t *testing.T, svc *Service, snapshot localAgentSourceSnapshotV1) {
			t.Helper()
			if _, err := svc.backend.DB().Exec(`DELETE FROM runtime_local_agent_source_provenance WHERE local_agent_ref = ?`, snapshot.LocalAgentRef); err != nil {
				t.Fatalf("delete source provenance: %v", err)
			}
		},
		"mismatched": func(t *testing.T, svc *Service, snapshot localAgentSourceSnapshotV1) {
			t.Helper()
			if _, err := svc.backend.DB().Exec(`DROP TRIGGER runtime_local_agent_source_provenance_no_update`); err != nil {
				t.Fatalf("drop provenance immutable trigger for corruption fixture: %v", err)
			}
			if _, err := svc.backend.DB().Exec(`UPDATE runtime_local_agent_source_provenance SET snapshot_hash = ? WHERE local_agent_ref = ?`, strings.Repeat("0", 64), snapshot.LocalAgentRef); err != nil {
				t.Fatalf("corrupt source provenance: %v", err)
			}
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			statePath := filepath.Join(t.TempDir(), "state.json")
			svc, closeFirst := openSourceMaterializationTransportTestService(t, statePath)
			candidate := sourceMaterializationTransportTestCandidate(t, "worldCharacter", "packet-provenance-corruption-"+name)
			snapshot, err := finalizeLocalAgentSourceSnapshotV1(candidate, sourceMaterializationTransportTestLocalAgentRef("provenance-corruption-"+name), time.Date(2026, 7, 10, 9, 0, 0, 0, time.UTC))
			if err != nil {
				t.Fatal(err)
			}
			if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
				if err := insertSourceMaterializationTestAgentTx(tx, snapshot, sourceMaterializationTransportTestAccount); err != nil {
					return err
				}
				return insertLocalAgentSourceSnapshotTx(tx, snapshot)
			}); err != nil {
				t.Fatal(err)
			}
			mutate(t, svc, snapshot)
			closeFirst()

			memorySvc, err := memoryservice.New(nil, config.Config{LocalStatePath: statePath, AIHTTPTimeoutSeconds: 2})
			if err != nil {
				t.Fatalf("memory.New after provenance corruption: %v", err)
			}
			defer func() { _ = memorySvc.Close() }()
			if restarted, err := New(nil, statePath, memorySvc); err == nil {
				restarted.Close()
				t.Fatal("corrupted source provenance was admitted on restart")
			} else if !strings.Contains(err.Error(), "provenance") {
				t.Fatalf("restart provenance corruption error = %v", err)
			}
		})
	}
}

func sourceMaterializationTransportTestCandidate(t *testing.T, kind string, packetID string) localAgentSourceSnapshotCandidateV1 {
	t.Helper()
	begin, components := sourceMaterializationNormalizeFixture(t, kind, packetID)
	normalized, err := verifyAndNormalizeSourceMaterializationV2(begin, components)
	if err != nil {
		t.Fatalf("normalize source materialization fixture: %v", err)
	}
	return localAgentSourceSnapshotCandidateV1{Normalized: *normalized, CompilerCompatibilityVersion: localAgentSourceCompilerCompatibilityV1}
}

func sourceMaterializationTransportTestLocalAgentRef(suffix string) string {
	digest := sourceMaterializationBytesDigest([]byte("local-agent:" + suffix))
	return runtimeGeneratedLocalAgentRefPrefix + digest[:32]
}

func sourceMaterializationProtoRef(sourceRef sourceMaterializationSourceRefV2) *runtimev1.SourceMaterializationSourceRef {
	kind, _ := sourceMaterializationProtoKind(sourceRef.Kind)
	return &runtimev1.SourceMaterializationSourceRef{Kind: kind, WorldId: sourceRef.WorldID, SourceId: sourceRef.SourceID, SourceContentHash: sourceRef.SourceContentHash}
}

func insertSourceMaterializationTestAgentTx(tx *sql.Tx, snapshot localAgentSourceSnapshotV1, accountID string) error {
	sourceRef := sourceMaterializationProtoRef(snapshot.SourceRef)
	now, _ := time.Parse(time.RFC3339Nano, snapshot.CapturedAt)
	agent := &runtimev1.AgentRecord{
		AgentId:             snapshot.LocalAgentRef,
		LocalAgentRef:       snapshot.LocalAgentRef,
		OwnerUserId:         accountID,
		RuntimeSourceRef:    runtimeSourceRefForMaterialization(sourceRef),
		DisplayName:         snapshot.SourceRef.SourceID,
		LifecycleStatus:     runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE,
		SourceContextStatus: localAgentSourceContextStatus(snapshot),
		CreatedAt:           timestamppb.New(now),
		UpdatedAt:           timestamppb.New(now),
	}
	state := &runtimev1.AgentStateProjection{ExecutionState: runtimev1.AgentExecutionState_AGENT_EXECUTION_STATE_IDLE, Attributes: map[string]string{}, UpdatedAt: timestamppb.New(now)}
	agentJSON, err := protojson.Marshal(agent)
	if err != nil {
		return err
	}
	stateJSON, err := protojson.Marshal(state)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES (?, ?)`, snapshot.LocalAgentRef, string(agentJSON)); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO runtime_local_agent_state_projection(local_agent_ref, state_json) VALUES (?, ?)`, snapshot.LocalAgentRef, string(stateJSON)); err != nil {
		return err
	}
	return nil
}

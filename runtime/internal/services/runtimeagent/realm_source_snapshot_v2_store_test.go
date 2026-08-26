package runtimeagent

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func TestRealmSourceSnapshotV2StoreReloadsOfficialVectorsAcrossRestart(t *testing.T) {
	for _, vectorName := range []string{"world-character", "persona-character"} {
		vectorName := vectorName
		t.Run(vectorName, func(t *testing.T) {
			statePath := filepath.Join(t.TempDir(), "runtime-state.json")
			svc, localAgentRef, closeService := persistRealmSourceSnapshotV2StoreTestProduct(t, statePath, vectorName)

			store, err := newRealmSourceSnapshotV2Store(svc.backend.DB())
			if err != nil {
				t.Fatal(err)
			}
			if err := store.validatePersistedSnapshots(context.Background()); err != nil {
				t.Fatalf("validate live SnapshotV2 store: %v", err)
			}
			before, found, err := store.sourceSnapshot(context.Background(), localAgentRef)
			if err != nil || !found {
				t.Fatalf("load live SnapshotV2: found=%v err=%v", found, err)
			}
			beforeHash := realmSourceSnapshotV2StoreTestPartitionHash(t, before)

			closeService()
			reopened, err := runtimepersistence.Open(
				slog.New(slog.NewTextHandler(io.Discard, nil)), statePath,
			)
			if err != nil {
				t.Fatalf("reopen Runtime persistence: %v", err)
			}
			defer func() {
				if err := reopened.Close(); err != nil {
					t.Errorf("close reopened Runtime persistence: %v", err)
				}
			}()
			restartStore, err := newRealmSourceSnapshotV2Store(reopened.DB())
			if err != nil {
				t.Fatal(err)
			}
			if err := restartStore.validatePersistedSnapshots(context.Background()); err != nil {
				t.Fatalf("restart SnapshotV2 validation: %v", err)
			}
			after, found, err := restartStore.sourceSnapshot(context.Background(), localAgentRef)
			if err != nil || !found {
				t.Fatalf("restart SnapshotV2 load: found=%v err=%v", found, err)
			}
			if after.SnapshotHash != before.SnapshotHash || !sourceMaterializationV3CanonicalEqual(after.Semantic.SourceRef, before.Semantic.SourceRef) {
				t.Fatalf("restart changed frozen SnapshotV2 identity: before=%+v after=%+v", before.Semantic.SourceRef, after.Semantic.SourceRef)
			}
			if afterHash := realmSourceSnapshotV2StoreTestPartitionHash(t, after); afterHash != beforeHash {
				t.Fatalf("restart changed source partition hash: before=%s after=%s", beforeHash, afterHash)
			}
		})
	}
}

func TestRealmSourceSnapshotV2StoreRejectsHashAndProvenanceTamper(t *testing.T) {
	t.Run("typed snapshot hash", func(t *testing.T) {
		statePath := filepath.Join(t.TempDir(), "runtime-state.json")
		svc, localAgentRef, closeService := persistRealmSourceSnapshotV2StoreTestProduct(t, statePath, "world-character")
		defer closeService()
		if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
			var typed []byte
			if err := tx.QueryRow(`SELECT typed_snapshot_json FROM runtime_local_agent_source_snapshot_v2 WHERE local_agent_ref = ?`, localAgentRef).Scan(&typed); err != nil {
				return err
			}
			snapshot, err := decodeLocalAgentSourceSnapshotV2(typed)
			if err != nil {
				return err
			}
			snapshot.SnapshotHash = strings.Repeat("f", 64)
			tampered, err := canonicalizeSourceMaterializationRealmV3(snapshot)
			if err != nil {
				return err
			}
			for _, trigger := range []string{
				"runtime_local_agent_source_snapshot_v2_no_update",
				"runtime_local_agent_source_provenance_v3_no_update",
			} {
				if _, err := tx.Exec(`DROP TRIGGER ` + trigger); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(`UPDATE runtime_local_agent_source_snapshot_v2 SET snapshot_hash = ?, typed_snapshot_json = ? WHERE local_agent_ref = ?`, snapshot.SnapshotHash, tampered, localAgentRef); err != nil {
				return err
			}
			_, err = tx.Exec(`UPDATE runtime_local_agent_source_provenance_v3 SET snapshot_hash = ? WHERE local_agent_ref = ?`, snapshot.SnapshotHash, localAgentRef)
			return err
		}); err != nil {
			t.Fatalf("inject SnapshotV2 hash tamper: %v", err)
		}
		store, err := newRealmSourceSnapshotV2Store(svc.backend.DB())
		if err != nil {
			t.Fatal(err)
		}
		if _, found, err := store.sourceSnapshot(context.Background(), localAgentRef); err == nil || found {
			t.Fatalf("hash-tampered SnapshotV2 loaded: found=%v err=%v", found, err)
		}
	})

	t.Run("provenance key", func(t *testing.T) {
		statePath := filepath.Join(t.TempDir(), "runtime-state.json")
		svc, localAgentRef, closeService := persistRealmSourceSnapshotV2StoreTestProduct(t, statePath, "persona-character")
		defer closeService()
		if err := svc.backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
			if _, err := tx.Exec(`DROP TRIGGER runtime_local_agent_source_provenance_v3_no_update`); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE runtime_local_agent_source_provenance_v3 SET provenance_key = ? WHERE local_agent_ref = ?`, strings.Repeat("e", 64), localAgentRef)
			return err
		}); err != nil {
			t.Fatalf("inject provenance tamper: %v", err)
		}
		store, err := newRealmSourceSnapshotV2Store(svc.backend.DB())
		if err != nil {
			t.Fatal(err)
		}
		if _, found, err := store.sourceSnapshot(context.Background(), localAgentRef); err == nil || found {
			t.Fatalf("provenance-tampered SnapshotV2 loaded: found=%v err=%v", found, err)
		}
		if err := store.validatePersistedSnapshots(context.Background()); err == nil {
			t.Fatal("restart gate admitted provenance-tampered SnapshotV2")
		}
	})
}

func persistRealmSourceSnapshotV2StoreTestProduct(t *testing.T, statePath, vectorName string) (*Service, string, func()) {
	t.Helper()
	svc, closeService := openSourceMaterializationTransportTestService(t, statePath)
	verified := verifiedRealmSourceMaterializationVectorV3(t, vectorName)
	localAgentRef := realmSourceMaterializationProductTestLocalAgentRef("store-v2-" + vectorName)
	prepared, _, err := svc.prepareRealmSourceMaterializationProductV3(
		context.Background(), verified.Packet.MaterializerAccountID, localAgentRef, verified,
	)
	if err != nil {
		closeService()
		t.Fatalf("prepare Realm source product: %v", err)
	}
	if err := svc.backend.WriteTx(context.Background(), prepared.commitTx); err != nil {
		prepared.rolledBack()
		closeService()
		t.Fatalf("commit Realm source product: %v", err)
	}
	prepared.committed()
	return svc, localAgentRef, closeService
}

func realmSourceSnapshotV2StoreTestPartitionHash(t *testing.T, snapshot localAgentSourceSnapshotV2) string {
	t.Helper()
	partition, err := projectLocalAgentSourcePartitionV1(snapshot)
	if err != nil {
		t.Fatalf("project SnapshotV2 source partition: %v", err)
	}
	return partition.PartitionHash
}

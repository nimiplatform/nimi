package runtimepersistence

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/realmsourcecontract"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeinstance"
)

func TestBackendFailsClosedWithoutHealthyBackup(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, dbFileName)
	if err := os.WriteFile(dbPath, []byte("not-a-sqlite-db"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(memory.db): %v", err)
	}

	backend, err := Open(nil, filepath.Join(dir, "local-state.json"))
	if err == nil {
		_ = backend.Close()
		t.Fatal("expected corrupted sqlite open to fail without backup")
	}
}

func TestBackendRestoresNewestHealthyBackup(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO memory_meta(key, value) VALUES ('restore_probe', 'restored') ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
		return err
	}); err != nil {
		t.Fatalf("WriteTx(restore_probe): %v", err)
	}
	healthyBackup, err := backend.BackupNow(context.Background())
	if err != nil {
		t.Fatalf("BackupNow: %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	corruptBackup := filepath.Join(filepath.Dir(healthyBackup), "memory-corrupt.db")
	if err := os.WriteFile(corruptBackup, []byte("corrupt-backup"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(corrupt backup): %v", err)
	}
	later := time.Now().Add(time.Minute)
	if err := os.Chtimes(corruptBackup, later, later); err != nil {
		t.Fatalf("os.Chtimes(corrupt backup): %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, dbFileName), []byte("corrupt-primary"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(corrupt primary): %v", err)
	}

	backend, err = Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(restored): %v", err)
	}
	defer func() {
		if err := backend.Close(); err != nil {
			t.Fatalf("Close(restored): %v", err)
		}
	}()

	var value string
	if err := backend.DB().QueryRow(`SELECT value FROM memory_meta WHERE key = 'restore_probe'`).Scan(&value); err != nil {
		t.Fatalf("QueryRow(restore_probe): %v", err)
	}
	if value != "restored" {
		t.Fatalf("expected restored probe value, got %q", value)
	}
}

func TestBackendRuntimeLocalAgentSchemaIgnoresRetiredTables(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`CREATE TABLE runtime_agent_agent (
				agent_id TEXT PRIMARY KEY,
				agent_json TEXT NOT NULL
			)`); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_agent_agent(agent_id, agent_json) VALUES ('agent-old', '{"retired":true}')`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES ('local-agent:user-new:agent-old', '{"current":true}')`)
		return err
	}); err != nil {
		t.Fatalf("WriteTx(seed tables): %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close(seed): %v", err)
	}

	backend, err = Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(reopen): %v", err)
	}
	defer func() {
		if err := backend.Close(); err != nil {
			t.Fatalf("Close(reopen): %v", err)
		}
	}()

	if !tableExists(t, backend.DB(), "runtime_agent_agent") {
		t.Fatal("expected retired runtime_agent_agent table to remain outside current schema")
	}
	var retiredJSON string
	if err := backend.DB().QueryRow(`SELECT agent_json FROM runtime_agent_agent WHERE agent_id = 'agent-old'`).Scan(&retiredJSON); err != nil {
		t.Fatalf("QueryRow(retired runtime_agent_agent): %v", err)
	}
	if retiredJSON != `{"retired":true}` {
		t.Fatalf("expected retired row to be untouched, got %q", retiredJSON)
	}
	var localAgentRef string
	var agentJSON string
	if err := backend.DB().QueryRow(`SELECT local_agent_ref, agent_json FROM runtime_local_agent`).Scan(&localAgentRef, &agentJSON); err != nil {
		t.Fatalf("QueryRow(runtime_local_agent): %v", err)
	}
	if localAgentRef != "local-agent:user-new:agent-old" {
		t.Fatalf("expected current local_agent_ref row, got %q", localAgentRef)
	}
	if agentJSON != `{"current":true}` {
		t.Fatalf("expected current runtime local agent row, got %q", agentJSON)
	}
}

func TestBackendFreshSchemaUsesRealmSourceMaterializationV3Only(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	backend, err := Open(nil, filepath.Join(dir, "local-state.json"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() {
		if err := backend.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
	}()

	assertRealmSourceMaterializationEpochV3(t, backend.DB())
	assertCurrentRealmSourceMaterializationObjects(t, backend.DB())
	assertRetiredRealmSourceMaterializationObjectsAbsent(t, backend.DB())
}

func TestBackendRealmSourceMaterializationV3ResetIsScopedAndIdempotent(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", filepath.Join(dir, "runtime.lock"))
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(seed): %v", err)
	}
	if err := seedCurrentRealmSourceMaterializationState(backend); err != nil {
		_ = backend.Close()
		t.Fatalf("seedCurrentRealmSourceMaterializationState: %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close(seed): %v", err)
	}

	db, err := openSQLite(filepath.Join(dir, dbFileName), true, true)
	if err != nil {
		t.Fatalf("openSQLite(legacy seed): %v", err)
	}
	legacySeed := []string{
		`UPDATE runtime_local_agent_meta SET value = 'v2' WHERE key = 'realm_source_materialization_contract_epoch'`,
		`CREATE TABLE runtime_source_materialization_challenge (challenge_id TEXT PRIMARY KEY)`,
		`CREATE TABLE runtime_source_materialization_nonce_replay (id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES runtime_source_materialization_challenge(challenge_id))`,
		`CREATE TABLE runtime_source_materialization_upload (upload_id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES runtime_source_materialization_challenge(challenge_id))`,
		`CREATE TABLE runtime_source_materialization_chunk (id TEXT PRIMARY KEY, upload_id TEXT NOT NULL REFERENCES runtime_source_materialization_upload(upload_id))`,
		`CREATE TABLE runtime_source_materialization_nonce (id TEXT PRIMARY KEY)`,
		`CREATE TABLE runtime_local_agent_source_snapshot (local_agent_ref TEXT PRIMARY KEY)`,
		`CREATE TABLE runtime_local_agent_source_provenance (local_agent_ref TEXT PRIMARY KEY REFERENCES runtime_local_agent_source_snapshot(local_agent_ref))`,
		`CREATE TRIGGER runtime_local_agent_source_snapshot_no_update BEFORE UPDATE ON runtime_local_agent_source_snapshot BEGIN SELECT RAISE(ABORT, 'retired snapshot immutable'); END`,
		`CREATE TRIGGER runtime_local_agent_source_provenance_no_update BEFORE UPDATE ON runtime_local_agent_source_provenance BEGIN SELECT RAISE(ABORT, 'retired provenance immutable'); END`,
		`INSERT INTO runtime_source_materialization_challenge(challenge_id) VALUES ('legacy-challenge')`,
		`INSERT INTO runtime_source_materialization_nonce_replay(id, challenge_id) VALUES ('legacy-replay', 'legacy-challenge')`,
		`INSERT INTO runtime_source_materialization_upload(upload_id, challenge_id) VALUES ('legacy-upload', 'legacy-challenge')`,
		`INSERT INTO runtime_source_materialization_chunk(id, upload_id) VALUES ('legacy-chunk', 'legacy-upload')`,
		`INSERT INTO runtime_local_agent_source_snapshot(local_agent_ref) VALUES ('legacy-agent')`,
		`INSERT INTO runtime_local_agent_source_provenance(local_agent_ref) VALUES ('legacy-agent')`,
		`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES ('legacy-agent', '{"runtimeSourceRef":"runtime-source:worldCharacter:legacy-world:legacy-character:legacy-hash"}')`,
		`INSERT INTO runtime_local_agent_state_projection(local_agent_ref, state_json) VALUES ('legacy-agent', '{}')`,
		`INSERT INTO runtime_local_agent_hook(local_agent_ref, hook_id, status, hook_json) VALUES ('legacy-agent', 'legacy-hook', 1, '{}')`,
		`INSERT INTO runtime_local_agent_event_log(sequence, local_agent_ref, event_type, event_json) VALUES (91, 'legacy-agent', 1, '{}')`,
		`INSERT INTO runtime_local_agent_behavioral_posture(local_agent_ref, status_text, truth_basis_json, posture_json, updated_at) VALUES ('legacy-agent', 'legacy', '{}', '{}', '2026-07-18T00:00:00Z')`,
		`INSERT INTO runtime_agent_ai_config(agent_instance_id, revision, config_json, updated_at, updated_by_app_id) VALUES ('legacy-agent', 1, '{}', '2026-07-18T00:00:00Z', 'test')`,
		`INSERT INTO memory_bank(locator_key, scope, bank_id, bank_json) VALUES ('agent-core::legacy-agent', 1, 'legacy-bank', '{}')`,
		`INSERT INTO memory_record(memory_id, locator_key, kind, canonical_class, record_json) VALUES ('legacy-memory', 'agent-core::legacy-agent', 1, 1, '{}')`,
		`INSERT INTO runtime_local_agent_review_run(review_run_id, local_agent_ref, bank_locator_key, status, prepared_outcomes_json, created_at, updated_at) VALUES ('legacy-review', 'legacy-agent', 'agent-core::legacy-agent', 'pending', '{}', '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')`,
		`INSERT INTO runtime_local_agent_review_followup(bank_locator_key, review_run_id, completed_at) VALUES ('agent-core::legacy-agent', 'legacy-review', '2026-07-18T00:00:00Z')`,
		`INSERT INTO runtime_local_agent_source_snapshot_v2(local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at, packet_id, packet_hash, realm_issuer, signing_key_fingerprint, source_kind, source_id, world_id, source_hash, world_content_hash, coverage_hash, materialization_context_hash, payload_hash, ordered_component_set_hash, closure_set_manifest_hash, normalization_version, compiler_compatibility_version, typed_snapshot_json) VALUES ('legacy-agent', 2, 'legacy-snapshot', '2026-07-18T00:00:00Z', 'legacy-packet', 'legacy-packet-hash', 'legacy-issuer', 'legacy-key', 'WORLD_CHARACTER', 'legacy-source', 'legacy-world', 'legacy-source-hash', 'legacy-world-hash', 'legacy-coverage', 'legacy-context', 'legacy-payload', 'legacy-components', 'legacy-closure', 'normalization-v3', 'compiler-v3', '{}')`,
		`INSERT INTO runtime_local_agent_source_provenance_v3(provenance_key, local_agent_ref, snapshot_hash, materialization_context_hash) VALUES ('legacy-provenance', 'legacy-agent', 'legacy-snapshot', 'legacy-context')`,
		`INSERT INTO runtime_realm_source_materialization_attempt_v3(materializer_account_id, request_id, intent_digest, source_ref_json, runtime_instance_id, challenge_id, challenge_digest, intended_runtime_audience, challenge_issued_at, challenge_expires_at, state, packet_hash, local_agent_ref, source_context_status, created_at, updated_at) VALUES ('legacy-account', 'legacy-request', 'legacy-intent', '{}', 'legacy-runtime', 'legacy-v3-challenge', 'legacy-v3-challenge-digest', 'legacy-audience', '2026-07-18T00:00:00Z', '2026-07-18T00:05:00Z', 'committed', 'legacy-v3-packet-hash', 'legacy-agent', X'01', '2026-07-18T00:00:00Z', '2026-07-18T00:00:01Z')`,
		`INSERT INTO runtime_realm_source_materialization_replay_v3(runtime_instance_id, issuer, replay_binding_hash, nonce_digest, packet_hash, materializer_account_id, request_id, first_seen_at, expires_at) VALUES ('legacy-runtime', 'legacy-issuer', 'legacy-replay-binding', 'legacy-nonce-digest', 'legacy-v3-packet-hash', 'legacy-account', 'legacy-request', '2026-07-18T00:00:00Z', '2026-07-18T00:05:00Z')`,
		`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('public_chat_surface_version', '7') ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('public_chat_surface_state', '{"version":7,"savedAt":"2026-07-18T00:00:00Z","anchors":[{"conversationAnchorId":"legacy-anchor","localAgentRef":"legacy-agent"},{"conversationAnchorId":"current-anchor","localAgentRef":"local-agent:account:world"}],"followUps":[{"conversationAnchorId":"legacy-anchor"}],"avatarLiveInstances":[]}') ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
		`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('public_chat_anchor_metadata:legacy-anchor', '{}')`,
	}
	for _, stmt := range legacySeed {
		if _, err := db.Exec(stmt); err != nil {
			_ = db.Close()
			t.Fatalf("seed retired Realm source materialization state: %v", err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatalf("Close(legacy seed): %v", err)
	}

	backend, err = Open(nil, localStatePath)
	if err == nil {
		_ = backend.Close()
		t.Fatal("expected ordinary startup to refuse pre-v3 state")
	}
	if !errors.Is(err, ErrRealmSourceMaterializationDataResetRequired) {
		t.Fatalf("Open(pre-v3) error = %v, want reset-required", err)
	}

	dryRun, err := ResetRealmSourceMaterializationV3(context.Background(), RealmSourceMaterializationResetOptions{
		DataRoot: dir,
		DryRun:   true,
	})
	if err != nil {
		t.Fatalf("ResetRealmSourceMaterializationV3(dry-run): %v", err)
	}
	if dryRun.Mode != "DRY_RUN" || dryRun.EpochBefore != "v2" || dryRun.EpochAfter != "v2" {
		t.Fatalf("unexpected dry-run report: %+v", dryRun)
	}
	if dryRun.Counts["affectedLocalAgents"] != 1 || dryRun.RawTransportResidue != 2 {
		t.Fatalf("unexpected dry-run inventory: %+v", dryRun)
	}
	if _, err := os.Stat(filepath.Join(dir, realmSourceMaterializationResetLeaseName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("dry-run must not create reset lease, stat error = %v", err)
	}

	reset, err := ResetRealmSourceMaterializationV3(context.Background(), RealmSourceMaterializationResetOptions{
		DataRoot:     dir,
		Confirmation: RealmSourceMaterializationResetConfirmation,
	})
	if err != nil {
		t.Fatalf("ResetRealmSourceMaterializationV3: %v", err)
	}
	if reset.Mode != "RESET" || reset.EpochBefore != "v2" || reset.EpochAfter != "v3" || reset.RawTransportResidue != 0 {
		t.Fatalf("unexpected reset report: %+v", reset)
	}
	if _, err := os.Stat(filepath.Join(dir, realmSourceMaterializationResetLeaseName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("reset lease residue, stat error = %v", err)
	}

	backend, err = Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(after explicit reset): %v", err)
	}
	assertRealmSourceMaterializationEpochV3(t, backend.DB())
	assertCurrentRealmSourceMaterializationObjects(t, backend.DB())
	assertRetiredRealmSourceMaterializationObjectsAbsent(t, backend.DB())
	assertCurrentRealmSourceMaterializationState(t, backend.DB())
	for _, check := range []struct {
		query string
		args  []any
	}{
		{`SELECT COUNT(*) FROM runtime_local_agent WHERE local_agent_ref = ?`, []any{"legacy-agent"}},
		{`SELECT COUNT(*) FROM memory_bank WHERE locator_key = ?`, []any{"agent-core::legacy-agent"}},
		{`SELECT COUNT(*) FROM runtime_local_agent_meta WHERE key = ?`, []any{"public_chat_anchor_metadata:legacy-anchor"}},
	} {
		var count int
		if err := backend.DB().QueryRow(check.query, check.args...).Scan(&count); err != nil {
			t.Fatalf("read reset residue: %v", err)
		}
		if count != 0 {
			t.Fatalf("expected reset residue count 0 for %q, got %d", check.query, count)
		}
	}
	var chatState string
	if err := backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'public_chat_surface_state'`).Scan(&chatState); err != nil {
		t.Fatalf("read public chat state after reset: %v", err)
	}
	if strings.Contains(chatState, "legacy-agent") || strings.Contains(chatState, "legacy-anchor") || !strings.Contains(chatState, "current-anchor") {
		t.Fatalf("public chat reset was not scoped: %s", chatState)
	}
	var chatVersion string
	if err := backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'public_chat_surface_version'`).Scan(&chatVersion); err != nil {
		t.Fatalf("read public chat version after reset: %v", err)
	}
	if chatVersion != "8" || !strings.Contains(chatState, `"version":8`) {
		t.Fatalf("public chat reset version mismatch: meta=%s state=%s", chatVersion, chatState)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close(after explicit reset): %v", err)
	}

	noop, err := ResetRealmSourceMaterializationV3(context.Background(), RealmSourceMaterializationResetOptions{
		DataRoot:     dir,
		Confirmation: RealmSourceMaterializationResetConfirmation,
	})
	if err != nil {
		t.Fatalf("ResetRealmSourceMaterializationV3(idempotent): %v", err)
	}
	if noop.Mode != "NOOP" {
		t.Fatalf("expected idempotent reset NOOP, got %+v", noop)
	}
}

func TestBackendRealmSourceMaterializationV3ResetFindsLegacyAgentWithoutRetiredTables(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", filepath.Join(dir, "runtime.lock"))
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(seed): %v", err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES (?, ?)`,
			"legacy-agent-without-retired-tables",
			`{"runtimeSourceRef":"runtime-source:personaCharacter:legacy-world:legacy-persona:legacy-hash"}`,
		); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('public_chat_surface_version', '3') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('public_chat_surface_state', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
			`{"version":3,"savedAt":"2026-07-18T00:00:00Z","anchors":[],"followUps":[{"conversationAnchorId":"orphan-legacy-anchor","agentId":"legacy-agent-without-retired-tables"}],"avatarLiveInstances":[{"conversationAnchorId":"orphan-legacy-anchor","agentId":"legacy-agent-without-retired-tables","localAgentRef":"legacy-agent-without-retired-tables"}]}`,
		)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('public_chat_anchor_metadata:orphan-legacy-anchor', '{}')`)
		return err
	}); err != nil {
		_ = backend.Close()
		t.Fatalf("seed legacy Runtime source LocalAgent: %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close(seed): %v", err)
	}
	db, err := openSQLite(filepath.Join(dir, dbFileName), true, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DELETE FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationEpochMetaKey); err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	backend, err = Open(nil, localStatePath)
	if err == nil {
		_ = backend.Close()
		t.Fatal("ordinary startup admitted a legacy Runtime source LocalAgent without retired tables")
	}
	if !errors.Is(err, ErrRealmSourceMaterializationDataResetRequired) {
		t.Fatalf("Open legacy-only error = %v, want reset-required", err)
	}

	releaseRuntime, err := runtimeinstance.AcquireLock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ResetRealmSourceMaterializationV3(context.Background(), RealmSourceMaterializationResetOptions{
		DataRoot: dir, Confirmation: RealmSourceMaterializationResetConfirmation,
	}); err == nil || !strings.Contains(err.Error(), "runtime instance lock already held") {
		_ = releaseRuntime()
		t.Fatalf("reset did not share the live Runtime lease: %v", err)
	}
	if err := releaseRuntime(); err != nil {
		t.Fatal(err)
	}

	report, err := ResetRealmSourceMaterializationV3(context.Background(), RealmSourceMaterializationResetOptions{
		DataRoot: dir, Confirmation: RealmSourceMaterializationResetConfirmation,
	})
	if err != nil {
		t.Fatalf("ResetRealmSourceMaterializationV3: %v", err)
	}
	if report.Mode != "RESET" || report.Counts["legacyRuntimeSourceAgents"] != 1 || report.Counts["retiredObjects"] != 0 {
		t.Fatalf("unexpected legacy-only reset report: %+v", report)
	}
	backend, err = Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(after legacy-only reset): %v", err)
	}
	defer func() { _ = backend.Close() }()
	var remaining int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_local_agent WHERE local_agent_ref = 'legacy-agent-without-retired-tables'`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("legacy-only reset residue = %d", remaining)
	}
	var chatState string
	if err := backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'public_chat_surface_state'`).Scan(&chatState); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(chatState, "legacy-agent-without-retired-tables") || !strings.Contains(chatState, `"version":4`) {
		t.Fatalf("orphan public chat dependency survived reset: %s", chatState)
	}
	var orphanMetadata int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_local_agent_meta WHERE key = 'public_chat_anchor_metadata:orphan-legacy-anchor'`).Scan(&orphanMetadata); err != nil {
		t.Fatal(err)
	}
	if orphanMetadata != 0 {
		t.Fatalf("orphan public chat anchor metadata survived reset: %d", orphanMetadata)
	}
}

func TestBackendRealmSourceMaterializationV3ResetRemovesOnlyStaleSnapshotCompatibility(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", filepath.Join(dir, "runtime.lock"))
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := seedCurrentRealmSourceMaterializationState(backend); err != nil {
		_ = backend.Close()
		t.Fatal(err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES ('stale-compat-agent', '{"runtimeSourceRef":"runtime-source:realm-v3:personaCharacter:world-id:stale-source:stale-hash"}')`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_local_agent_source_snapshot_v2(
			local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at, packet_id, packet_hash,
			realm_issuer, signing_key_fingerprint, source_kind, source_id, world_id, source_hash,
			world_content_hash, coverage_hash, materialization_context_hash, payload_hash,
			ordered_component_set_hash, closure_set_manifest_hash, normalization_version,
			compiler_compatibility_version, typed_snapshot_json
		) VALUES (
			'stale-compat-agent', 2, 'stale-snapshot', '2026-07-18T00:00:00Z', 'stale-packet', 'stale-packet-hash',
			'realm-issuer', 'key-fingerprint', 'PERSONA_CHARACTER', 'stale-source', 'world-id', 'stale-source-hash',
			'world-content-hash', 'coverage-hash', 'context-hash', 'payload-hash',
			'component-set-hash', 'closure-set-hash', ?, 'realm-character-v3 ', '{}'
		)`, realmsourcecontract.NormalizationVersion)
		return err
	}); err != nil {
		_ = backend.Close()
		t.Fatal(err)
	}
	if err := backend.Close(); err != nil {
		t.Fatal(err)
	}

	backend, err = Open(nil, localStatePath)
	if err == nil {
		_ = backend.Close()
		t.Fatal("ordinary startup admitted stale compiler compatibility")
	}
	if !errors.Is(err, ErrRealmSourceMaterializationDataResetRequired) || !strings.Contains(err.Error(), "stale_snapshots=1") {
		t.Fatalf("unexpected stale compatibility startup error: %v", err)
	}
	report, err := ResetRealmSourceMaterializationV3(context.Background(), RealmSourceMaterializationResetOptions{
		DataRoot: dir, Confirmation: RealmSourceMaterializationResetConfirmation,
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.Counts["staleSnapshotCompatibilityRecords"] != 1 || report.Counts["affectedLocalAgents"] != 1 {
		t.Fatalf("unexpected stale compatibility reset report: %+v", report)
	}
	backend, err = Open(nil, localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = backend.Close() }()
	assertCurrentRealmSourceMaterializationState(t, backend.DB())
	var staleRows int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_local_agent WHERE local_agent_ref = 'stale-compat-agent'`).Scan(&staleRows); err != nil {
		t.Fatal(err)
	}
	if staleRows != 0 {
		t.Fatalf("stale compatibility LocalAgent residue = %d", staleRows)
	}
}

func TestBackendRealmSourceMaterializationV3InventoryRejectsConflictingRuntimeSourceRefEncodings(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES (?, ?)`,
			"conflicting-source-agent",
			`{"runtimeSourceRef":"runtime-source:worldCharacter:world:character:hash","runtime_source_ref":"runtime-source:personaCharacter:world:persona:hash"}`,
		)
		return err
	}); err != nil {
		_ = backend.Close()
		t.Fatal(err)
	}
	if err := backend.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(nil, localStatePath)
	if err == nil {
		_ = reopened.Close()
		t.Fatal("conflicting Runtime source identity did not fail closed")
	}
	if !strings.Contains(err.Error(), "conflicting runtimeSourceRef encodings") {
		t.Fatalf("unexpected conflicting Runtime source identity error: %v", err)
	}
	if _, err := ResetRealmSourceMaterializationV3(context.Background(), RealmSourceMaterializationResetOptions{
		DataRoot: dir, DryRun: true,
	}); err == nil || !strings.Contains(err.Error(), "conflicting runtimeSourceRef encodings") {
		t.Fatalf("reset inventory admitted conflicting Runtime source identity: %v", err)
	}
}

func TestBackendRealmSourceMaterializationV3ResetRollsBackOnError(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("NIMI_RUNTIME_LOCK_PATH", filepath.Join(dir, "runtime.lock"))
	localStatePath := filepath.Join(dir, "local-state.json")
	backend, err := Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("Open(seed): %v", err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_agent_ai_config(agent_instance_id, revision, config_json, updated_at, updated_by_app_id) VALUES ('unrelated-agent', 7, '{}', '2026-07-18T00:00:00Z', 'test')`)
		return err
	}); err != nil {
		_ = backend.Close()
		t.Fatalf("WriteTx(unrelated seed): %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close(seed): %v", err)
	}

	db, err := openSQLite(filepath.Join(dir, dbFileName), true, true)
	if err != nil {
		t.Fatalf("openSQLite(failure seed): %v", err)
	}
	failureSeed := []string{
		`UPDATE runtime_local_agent_meta SET value = 'v2' WHERE key = 'realm_source_materialization_contract_epoch'`,
		`CREATE TABLE runtime_source_materialization_chunk (id TEXT PRIMARY KEY)`,
		`INSERT INTO runtime_source_materialization_chunk(id) VALUES ('must-rollback')`,
		`CREATE VIEW runtime_source_materialization_nonce_replay AS SELECT id FROM runtime_source_materialization_chunk`,
	}
	for _, stmt := range failureSeed {
		if _, err := db.Exec(stmt); err != nil {
			_ = db.Close()
			t.Fatalf("seed failing migration: %v", err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatalf("Close(failure seed): %v", err)
	}

	_, err = ResetRealmSourceMaterializationV3(context.Background(), RealmSourceMaterializationResetOptions{
		DataRoot:     dir,
		Confirmation: RealmSourceMaterializationResetConfirmation,
	})
	if err == nil {
		t.Fatal("expected Realm source materialization reset failure to fail closed")
	}

	db, err = openSQLite(filepath.Join(dir, dbFileName), false, true)
	if err != nil {
		t.Fatalf("openSQLite(rollback verify): %v", err)
	}
	defer func() {
		if err := db.Close(); err != nil {
			t.Fatalf("Close(rollback verify): %v", err)
		}
	}()
	if !schemaObjectExists(t, db, "table", "runtime_source_materialization_chunk") {
		t.Fatal("expected retired chunk table drop to roll back")
	}
	if !schemaObjectExists(t, db, "view", "runtime_source_materialization_nonce_replay") {
		t.Fatal("expected failing legacy view to remain after rollback")
	}
	var epoch string
	if err := db.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationEpochMetaKey).Scan(&epoch); err != nil {
		t.Fatalf("QueryRow(epoch after rollback): %v", err)
	}
	if epoch != "v2" {
		t.Fatalf("expected epoch write to roll back to v2, got %q", epoch)
	}
	var revision int
	if err := db.QueryRow(`SELECT revision FROM runtime_agent_ai_config WHERE agent_instance_id = 'unrelated-agent'`).Scan(&revision); err != nil {
		t.Fatalf("QueryRow(unrelated state): %v", err)
	}
	if revision != 7 {
		t.Fatalf("expected unrelated Runtime state to remain unchanged, got revision %d", revision)
	}
}

func TestBackendSerializesWritesWhileReadsProceed(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	backend, err := Open(nil, filepath.Join(dir, "local-state.json"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() {
		if err := backend.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
	}()

	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS write_probe (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO write_probe(id, value) VALUES (1, 0)`)
		return err
	}); err != nil {
		t.Fatalf("WriteTx(init probe): %v", err)
	}

	const writers = 24
	const readers = 8
	var wg sync.WaitGroup
	errCh := make(chan error, writers+readers)
	for idx := 0; idx < writers; idx++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errCh <- backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
				_, err := tx.Exec(`UPDATE write_probe SET value = value + 1 WHERE id = 1`)
				return err
			})
		}()
	}
	for idx := 0; idx < readers; idx++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			deadline := time.Now().Add(300 * time.Millisecond)
			for time.Now().Before(deadline) {
				var value int
				if err := backend.DB().QueryRow(`SELECT value FROM write_probe WHERE id = 1`).Scan(&value); err != nil {
					errCh <- err
					return
				}
				time.Sleep(5 * time.Millisecond)
			}
			errCh <- nil
		}()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatalf("unexpected concurrent access error: %v", err)
		}
	}

	var value int
	if err := backend.DB().QueryRow(`SELECT value FROM write_probe WHERE id = 1`).Scan(&value); err != nil {
		t.Fatalf("QueryRow(final value): %v", err)
	}
	if value != writers {
		t.Fatalf("expected serialized write count %d, got %d", writers, value)
	}
}

func tableExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&count); err != nil {
		t.Fatalf("QueryRow(table exists %s): %v", name, err)
	}
	return count > 0
}

func schemaObjectExists(t *testing.T, db *sql.DB, kind, name string) bool {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE type = ? AND name = ?`, kind, name).Scan(&count); err != nil {
		t.Fatalf("QueryRow(schema object exists %s %s): %v", kind, name, err)
	}
	return count > 0
}

func assertRealmSourceMaterializationEpochV3(t *testing.T, db *sql.DB) {
	t.Helper()
	var epoch string
	if err := db.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationEpochMetaKey).Scan(&epoch); err != nil {
		t.Fatalf("QueryRow(Realm source materialization epoch): %v", err)
	}
	if epoch != realmSourceMaterializationEpochV3 {
		t.Fatalf("expected Realm source materialization epoch %q, got %q", realmSourceMaterializationEpochV3, epoch)
	}
}

func assertCurrentRealmSourceMaterializationObjects(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, object := range currentRealmSourceMaterializationObjects() {
		if !schemaObjectExists(t, db, object.kind, object.name) {
			t.Errorf("expected current Realm source materialization %s %s", object.kind, object.name)
		}
	}
}

func assertRetiredRealmSourceMaterializationObjectsAbsent(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, name := range retiredRealmSourceMaterializationTriggers() {
		if schemaObjectExists(t, db, "trigger", name) {
			t.Errorf("retired Realm source materialization trigger %s remains", name)
		}
	}
	for _, name := range retiredRealmSourceMaterializationTables() {
		if schemaObjectExists(t, db, "table", name) {
			t.Errorf("retired Realm source materialization table %s remains", name)
		}
	}
}

func seedCurrentRealmSourceMaterializationState(backend *Backend) error {
	return backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		stmts := []string{
			`INSERT INTO runtime_agent_ai_config(agent_instance_id, revision, config_json, updated_at, updated_by_app_id) VALUES ('unrelated-agent', 7, '{}', '2026-07-18T00:00:00Z', 'test')`,
			`INSERT INTO runtime_local_agent(local_agent_ref, agent_json) VALUES ('local-agent:account:world', '{"runtimeSourceRef":"runtime-source:realm-v3:worldCharacter:world-id:source-id:source-hash"}')`,
			`INSERT INTO runtime_local_agent_source_snapshot_v2(
				local_agent_ref, snapshot_schema_version, snapshot_hash, captured_at, packet_id, packet_hash,
				realm_issuer, signing_key_fingerprint, source_kind, source_id, world_id, source_hash,
				world_content_hash, coverage_hash, materialization_context_hash, payload_hash,
				ordered_component_set_hash, closure_set_manifest_hash, normalization_version,
				compiler_compatibility_version, typed_snapshot_json
			) VALUES (
				'local-agent:account:world', 2, 'snapshot-hash', '2026-07-18T00:00:00Z', 'packet-id', 'packet-hash',
				'realm-issuer', 'key-fingerprint', 'WORLD_CHARACTER', 'source-id', 'world-id', 'source-hash',
				'world-content-hash', 'coverage-hash', 'context-hash', 'payload-hash',
				'component-set-hash', 'closure-set-hash', '` + realmsourcecontract.NormalizationVersion + `', '` + realmsourcecontract.CompilerCompatibilityVersion + `', '{}'
			)`,
			`INSERT INTO runtime_local_agent_source_provenance_v3(provenance_key, local_agent_ref, snapshot_hash, materialization_context_hash)
			 VALUES ('provenance-key', 'local-agent:account:world', 'snapshot-hash', 'context-hash')`,
			`INSERT INTO runtime_realm_source_materialization_attempt_v3(
				materializer_account_id, request_id, intent_digest, source_ref_json, runtime_instance_id,
				challenge_id, challenge_digest, intended_runtime_audience, challenge_issued_at,
				challenge_expires_at, state, packet_hash, local_agent_ref, source_context_status,
				created_at, updated_at
			) VALUES (
				'account-id', 'request-id', 'intent-digest', '{}', 'runtime-instance',
				'challenge-id', 'challenge-digest', 'runtime-audience', '2026-07-18T00:00:00Z',
				'2026-07-18T00:05:00Z', 'committed', 'packet-hash', 'local-agent:account:world', X'01',
				'2026-07-18T00:00:00Z', '2026-07-18T00:00:01Z'
			)`,
			`INSERT INTO runtime_realm_source_materialization_replay_v3(
				runtime_instance_id, issuer, replay_binding_hash, nonce_digest, packet_hash,
				materializer_account_id, request_id, first_seen_at, expires_at
			) VALUES (
				'runtime-instance', 'realm-issuer', 'replay-binding-hash', 'nonce-digest', 'packet-hash',
				'account-id', 'request-id', '2026-07-18T00:00:00Z', '2026-07-18T00:05:00Z'
			)`,
		}
		for _, stmt := range stmts {
			if _, err := tx.Exec(stmt); err != nil {
				return err
			}
		}
		return nil
	})
}

func assertCurrentRealmSourceMaterializationState(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, table := range []string{
		"runtime_realm_source_materialization_attempt_v3",
		"runtime_realm_source_materialization_replay_v3",
		"runtime_local_agent_source_snapshot_v2",
		"runtime_local_agent_source_provenance_v3",
	} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
			t.Fatalf("QueryRow(current state %s): %v", table, err)
		}
		if count != 1 {
			t.Errorf("expected one preserved row in %s, got %d", table, count)
		}
	}
	var revision int
	if err := db.QueryRow(`SELECT revision FROM runtime_agent_ai_config WHERE agent_instance_id = 'unrelated-agent'`).Scan(&revision); err != nil {
		t.Fatalf("QueryRow(unrelated state): %v", err)
	}
	if revision != 7 {
		t.Errorf("expected unrelated Runtime state revision 7, got %d", revision)
	}
	var normalizationVersion string
	var compilerCompatibilityVersion string
	if err := db.QueryRow(`SELECT normalization_version, compiler_compatibility_version
		FROM runtime_local_agent_source_snapshot_v2 WHERE local_agent_ref = 'local-agent:account:world'`).Scan(
		&normalizationVersion, &compilerCompatibilityVersion,
	); err != nil {
		t.Fatalf("QueryRow(current source compatibility): %v", err)
	}
	if normalizationVersion != realmsourcecontract.NormalizationVersion || compilerCompatibilityVersion != realmsourcecontract.CompilerCompatibilityVersion {
		t.Fatalf("current source compatibility drifted: normalization=%q compiler=%q", normalizationVersion, compilerCompatibilityVersion)
	}
}

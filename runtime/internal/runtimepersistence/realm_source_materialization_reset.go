package runtimepersistence

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/realmsourcecontract"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeinstance"
)

const (
	RealmSourceMaterializationResetConfirmation = "RESET SOURCE MATERIALIZATION V2 FOR REALM V3"
	realmSourceMaterializationResetLeaseName    = ".realm-source-materialization-v3-reset.lease"
)

type RealmSourceMaterializationResetOptions struct {
	DataRoot     string
	DryRun       bool
	Confirmation string
}

type RealmSourceMaterializationResetReport struct {
	SchemaVersion          string           `json:"schemaVersion"`
	Mode                   string           `json:"mode"`
	EpochBefore            string           `json:"epochBefore"`
	EpochAfter             string           `json:"epochAfter"`
	AffectedLocalAgentRefs []string         `json:"affectedLocalAgentRefs"`
	Counts                 map[string]int64 `json:"counts"`
	RawTransportResidue    int64            `json:"rawTransportResidue"`
	OrphanResidue          int64            `json:"orphanResidue"`
}

type realmSourceMaterializationResetInventory struct {
	epoch               string
	retired             []string
	localAgentRefs      []string
	currentV3AgentRefs  []string
	memoryBankKeys      []string
	publicChatAnchorIDs []string
	counts              map[string]int64
}

type realmSourceMaterializationRuntimeAgentRefs struct {
	legacy    []string
	currentV3 []string
}

type realmSourceMaterializationQueryer interface {
	Query(query string, args ...any) (*sql.Rows, error)
	QueryRow(query string, args ...any) *sql.Row
}

type realmSourceMaterializationResetTableBinding struct {
	table  string
	column string
}

// ResetRealmSourceMaterializationV3 is the only admitted pre-v3 transition.
// It operates on an explicitly named local Runtime data root while Runtime is
// offline, inventories before mutation, and commits the complete scoped delete
// plus epoch write in one SQLite transaction.
func ResetRealmSourceMaterializationV3(ctx context.Context, options RealmSourceMaterializationResetOptions) (report RealmSourceMaterializationResetReport, resultErr error) {
	if ctx == nil {
		ctx = context.Background()
	}
	dataRoot, databaseFile, err := validateRealmSourceMaterializationResetTarget(options.DataRoot)
	if err != nil {
		return report, err
	}
	if !options.DryRun && strings.TrimSpace(options.Confirmation) != RealmSourceMaterializationResetConfirmation {
		return report, fmt.Errorf("Realm source materialization reset confirmation mismatch")
	}

	var releaseRuntimeLock func() error
	if !options.DryRun {
		releaseRuntimeLock, err = runtimeinstance.AcquireLock()
		if err != nil {
			return report, fmt.Errorf("acquire offline Runtime lease for Realm source materialization reset: %w", err)
		}
		defer func() {
			if releaseErr := releaseRuntimeLock(); releaseErr != nil {
				resultErr = errors.Join(resultErr, fmt.Errorf("release offline Runtime lease: %w", releaseErr))
			}
		}()
	}

	var releaseLease func() error
	if !options.DryRun {
		releaseLease, err = acquireRealmSourceMaterializationResetLease(dataRoot)
		if err != nil {
			return report, err
		}
		defer func() {
			if releaseErr := releaseLease(); releaseErr != nil {
				resultErr = errors.Join(resultErr, releaseErr)
			}
		}()
	}

	db, err := openRealmSourceMaterializationResetDatabase(databaseFile, options.DryRun)
	if err != nil {
		return report, err
	}
	defer func() {
		if closeErr := db.Close(); closeErr != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("close Realm source materialization reset database: %w", closeErr))
		}
	}()

	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: options.DryRun})
	if err != nil {
		return report, fmt.Errorf("begin Realm source materialization reset transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	inventory, err := inspectRealmSourceMaterializationResetTx(tx)
	if err != nil {
		return report, err
	}
	report = realmSourceMaterializationResetReport(inventory, options.DryRun)
	if options.DryRun {
		if report.Mode == "NOOP" {
			if err := verifyRealmSourceMaterializationResetTx(tx, nil, nil, nil); err != nil {
				return report, err
			}
		}
		if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
			return report, fmt.Errorf("close Realm source materialization reset dry run: %w", err)
		}
		return report, nil
	}
	if inventory.epoch == realmSourceMaterializationEpochV3 && len(inventory.retired) == 0 && len(inventory.localAgentRefs) == 0 {
		report.Mode = "NOOP"
		if err := verifyRealmSourceMaterializationResetTx(tx, nil, nil, nil); err != nil {
			return report, err
		}
		if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
			return report, fmt.Errorf("close idempotent Realm source materialization reset: %w", err)
		}
		return report, nil
	}
	if inventory.epoch != "missing" && inventory.epoch != "v1" && inventory.epoch != "v2" && inventory.epoch != realmSourceMaterializationEpochV3 {
		return report, fmt.Errorf("unsupported Realm source materialization epoch %q", inventory.epoch)
	}
	if inventory.epoch == "missing" && len(inventory.currentV3AgentRefs) > 0 && len(inventory.localAgentRefs) == 0 && len(inventory.retired) == 0 {
		return report, fmt.Errorf("Realm source materialization v3 agents exist without contract epoch")
	}

	deletedCounts, err := executeRealmSourceMaterializationResetTx(ctx, tx, inventory.localAgentRefs, inventory.memoryBankKeys)
	if err != nil {
		return report, err
	}
	for key, value := range deletedCounts {
		report.Counts[key] += value
	}
	if err := writeRealmSourceMaterializationV3EpochTx(tx); err != nil {
		return report, err
	}
	if err := verifyRealmSourceMaterializationResetTx(tx, inventory.localAgentRefs, inventory.memoryBankKeys, inventory.publicChatAnchorIDs); err != nil {
		return report, err
	}
	if err := tx.Commit(); err != nil {
		return report, fmt.Errorf("commit Realm source materialization reset: %w", err)
	}
	report.Mode = "RESET"
	report.EpochAfter = realmSourceMaterializationEpochV3
	report.RawTransportResidue = 0
	report.OrphanResidue = 0
	return report, nil
}

func validateRealmSourceMaterializationResetTarget(raw string) (string, string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || !filepath.IsAbs(trimmed) {
		return "", "", fmt.Errorf("Realm source materialization reset data root must be an explicit absolute path")
	}
	clean := filepath.Clean(trimmed)
	if filepath.Dir(clean) == clean {
		return "", "", fmt.Errorf("Realm source materialization reset refuses a filesystem root")
	}
	info, err := os.Lstat(clean)
	if err != nil {
		return "", "", fmt.Errorf("inspect Realm source materialization reset data root: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return "", "", fmt.Errorf("Realm source materialization reset data root must be a real directory")
	}
	resolved, err := filepath.EvalSymlinks(clean)
	if err != nil {
		return "", "", fmt.Errorf("resolve Realm source materialization reset data root: %w", err)
	}
	databaseFile := filepath.Join(resolved, dbFileName)
	databaseInfo, err := os.Lstat(databaseFile)
	if err != nil {
		return "", "", fmt.Errorf("inspect Realm source materialization reset database: %w", err)
	}
	if databaseInfo.Mode()&os.ModeSymlink != 0 || !databaseInfo.Mode().IsRegular() {
		return "", "", fmt.Errorf("Realm source materialization reset database must be a regular file")
	}
	return resolved, databaseFile, nil
}

func acquireRealmSourceMaterializationResetLease(dataRoot string) (func() error, error) {
	leasePath := filepath.Join(dataRoot, realmSourceMaterializationResetLeaseName)
	lease, err := os.OpenFile(leasePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, fmt.Errorf("acquire exclusive Realm source materialization reset lease: %w", err)
	}
	if _, err := fmt.Fprintf(lease, "pid=%d\nstarted_at=%s\n", os.Getpid(), time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		_ = lease.Close()
		_ = os.Remove(leasePath)
		return nil, fmt.Errorf("write Realm source materialization reset lease: %w", err)
	}
	if err := lease.Sync(); err != nil {
		_ = lease.Close()
		_ = os.Remove(leasePath)
		return nil, fmt.Errorf("sync Realm source materialization reset lease: %w", err)
	}
	return func() error {
		closeErr := lease.Close()
		removeErr := os.Remove(leasePath)
		if closeErr != nil || removeErr != nil {
			return fmt.Errorf("release Realm source materialization reset lease: %w", errors.Join(closeErr, removeErr))
		}
		return nil
	}, nil
}

func openRealmSourceMaterializationResetDatabase(path string, readOnly bool) (*sql.DB, error) {
	if readOnly {
		dsn := fmt.Sprintf("file:%s?mode=ro&_pragma=query_only(ON)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(%d)", path, defaultBusyTimeoutMS)
		db, err := sql.Open(dbDriverName, dsn)
		if err != nil {
			return nil, fmt.Errorf("open Realm source materialization reset dry-run database: %w", err)
		}
		db.SetMaxOpenConns(1)
		if err := db.Ping(); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("verify Realm source materialization reset dry-run database: %w", err)
		}
		return db, nil
	}
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(ON)&_pragma=busy_timeout(%d)&_pragma=synchronous(FULL)&_txlock=exclusive", path, defaultBusyTimeoutMS)
	db, err := sql.Open(dbDriverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("open exclusive Realm source materialization reset database: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("verify exclusive Realm source materialization reset database: %w", err)
	}
	return db, nil
}

func inspectRealmSourceMaterializationResetTx(tx *sql.Tx) (realmSourceMaterializationResetInventory, error) {
	inventory := realmSourceMaterializationResetInventory{epoch: "missing", counts: map[string]int64{}}
	metaExists, err := resetSchemaObjectExistsTx(tx, "runtime_local_agent_meta")
	if err != nil {
		return inventory, err
	}
	if metaExists {
		err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationEpochMetaKey).Scan(&inventory.epoch)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return inventory, fmt.Errorf("read Realm source materialization reset epoch: %w", err)
		}
		if errors.Is(err, sql.ErrNoRows) {
			inventory.epoch = "missing"
		}
	}

	for _, name := range append(retiredRealmSourceMaterializationTriggers(), retiredRealmSourceMaterializationTables()...) {
		exists, err := resetSchemaObjectExistsTx(tx, name)
		if err != nil {
			return inventory, err
		}
		if !exists {
			continue
		}
		inventory.retired = append(inventory.retired, name)
		inventory.counts["retiredObjects"]++
		if strings.Contains(name, "snapshot") || strings.Contains(name, "provenance") || strings.Contains(name, "chunk") || strings.Contains(name, "upload") || strings.Contains(name, "challenge") || strings.Contains(name, "nonce") {
			if count, err := resetTableRowCountTx(tx, name); err == nil {
				inventory.counts[name] = count
			}
		}
	}
	refs, err := collectRetiredRealmSourceLocalAgentRefsTx(tx)
	if err != nil {
		return inventory, err
	}
	runtimeRefs, err := collectRealmSourceMaterializationRuntimeAgentRefs(tx)
	if err != nil {
		return inventory, err
	}
	staleSnapshotRefs, err := collectPreV3RealmSourceSnapshotRefs(tx)
	if err != nil {
		return inventory, err
	}
	affectedRefs := append(append([]string(nil), refs...), runtimeRefs.legacy...)
	affectedRefs = append(affectedRefs, staleSnapshotRefs...)
	refSet := resetStringSet(affectedRefs)
	inventory.localAgentRefs = make([]string, 0, len(refSet))
	for ref := range refSet {
		inventory.localAgentRefs = append(inventory.localAgentRefs, ref)
	}
	sort.Strings(inventory.localAgentRefs)
	inventory.currentV3AgentRefs = append([]string(nil), runtimeRefs.currentV3...)
	inventory.memoryBankKeys, err = collectAgentScopedMemoryBankKeysTx(tx, inventory.localAgentRefs)
	if err != nil {
		return inventory, err
	}
	inventory.publicChatAnchorIDs, err = collectAffectedPublicChatAnchorIDsTx(tx, inventory.localAgentRefs)
	if err != nil {
		return inventory, err
	}
	inventory.counts["affectedLocalAgents"] = int64(len(inventory.localAgentRefs))
	inventory.counts["legacyRuntimeSourceAgents"] = int64(len(runtimeRefs.legacy))
	inventory.counts["staleSnapshotCompatibilityRecords"] = int64(len(staleSnapshotRefs))
	inventory.counts["currentV3RuntimeSourceAgents"] = int64(len(runtimeRefs.currentV3))
	inventory.counts["agentScopedMemoryBanks"] = int64(len(inventory.memoryBankKeys))
	inventory.counts["publicChatAnchors"] = int64(len(inventory.publicChatAnchorIDs))
	sort.Strings(inventory.retired)
	return inventory, nil
}

func realmSourceMaterializationResetReport(inventory realmSourceMaterializationResetInventory, dryRun bool) RealmSourceMaterializationResetReport {
	mode := "RESET_REQUIRED"
	epochAfter := realmSourceMaterializationEpochV3
	if dryRun {
		mode = "DRY_RUN"
		epochAfter = inventory.epoch
	}
	if inventory.epoch == realmSourceMaterializationEpochV3 && len(inventory.retired) == 0 && len(inventory.localAgentRefs) == 0 {
		mode = "NOOP"
		epochAfter = realmSourceMaterializationEpochV3
	}
	counts := make(map[string]int64, len(inventory.counts))
	for key, value := range inventory.counts {
		counts[key] = value
	}
	return RealmSourceMaterializationResetReport{
		SchemaVersion:          "nimi.runtime.realm-source-materialization-reset/v1",
		Mode:                   mode,
		EpochBefore:            inventory.epoch,
		EpochAfter:             epochAfter,
		AffectedLocalAgentRefs: append([]string(nil), inventory.localAgentRefs...),
		Counts:                 counts,
		RawTransportResidue:    inventory.counts[retiredSourceChunkTable] + inventory.counts[retiredSourceUploadTable],
	}
}

func realmSourceMaterializationResetMemoryBindings() []realmSourceMaterializationResetTableBinding {
	return []realmSourceMaterializationResetTableBinding{
		{table: "memory_record_fts", column: "locator_key"},
		{table: "memory_record_embedding", column: "locator_key"},
		{table: "memory_replication_backlog", column: "locator_key"},
		{table: "memory_narrative", column: "bank_locator_key"},
		{table: "memory_narrative_embedding", column: "locator_key"},
		{table: "memory_narrative_alias", column: "bank_locator_key"},
		{table: "narrative_source", column: "bank_locator_key"},
		{table: "memory_relation", column: "bank_locator_key"},
		{table: "memory_recall_feedback_event", column: "bank_locator_key"},
		{table: "memory_recall_feedback_summary", column: "bank_locator_key"},
		{table: "agent_truth", column: "bank_locator_key"},
		{table: "truth_source", column: "bank_locator_key"},
		{table: "memory_review_commit", column: "bank_locator_key"},
		{table: "memory_review_checkpoint", column: "bank_locator_key"},
		{table: "runtime_local_agent_review_followup", column: "bank_locator_key"},
		{table: "memory_record", column: "locator_key"},
		{table: "memory_bank", column: "locator_key"},
	}
}

func realmSourceMaterializationResetAgentBindings() []realmSourceMaterializationResetTableBinding {
	return []realmSourceMaterializationResetTableBinding{
		{table: "runtime_realm_source_materialization_attempt_v3", column: "local_agent_ref"},
		{table: "runtime_local_agent_source_provenance_v3", column: "local_agent_ref"},
		{table: "runtime_local_agent_source_snapshot_v2", column: "local_agent_ref"},
		{table: "runtime_agent_ai_config", column: "agent_instance_id"},
		{table: "runtime_local_agent_behavioral_posture", column: "local_agent_ref"},
		{table: "runtime_local_agent_review_run", column: "local_agent_ref"},
		{table: "runtime_local_agent_hook", column: "local_agent_ref"},
		{table: "runtime_local_agent_event_log", column: "local_agent_ref"},
		{table: "runtime_local_agent_state_projection", column: "local_agent_ref"},
		{table: "runtime_local_agent", column: "local_agent_ref"},
	}
}

func executeRealmSourceMaterializationResetTx(ctx context.Context, tx *sql.Tx, localAgentRefs, bankKeys []string) (map[string]int64, error) {
	counts := map[string]int64{}
	counts["agentScopedMemoryBanks"] = int64(len(bankKeys))

	if err := pruneAffectedPublicChatStateTx(tx, localAgentRefs, counts); err != nil {
		return nil, err
	}
	for _, target := range realmSourceMaterializationResetMemoryBindings() {
		deleted, err := deleteResetRowsByValuesTx(ctx, tx, target.table, target.column, bankKeys)
		if err != nil {
			return nil, err
		}
		counts[target.table] += deleted
	}

	if exists, err := resetSchemaObjectExistsTx(tx, "runtime_realm_source_materialization_attempt_v3"); err != nil {
		return nil, err
	} else if exists && len(localAgentRefs) > 0 {
		placeholders := resetSQLPlaceholders(len(localAgentRefs))
		args := resetStringsToAny(localAgentRefs)
		if replayExists, err := resetSchemaObjectExistsTx(tx, "runtime_realm_source_materialization_replay_v3"); err != nil {
			return nil, err
		} else if replayExists {
			result, err := tx.ExecContext(ctx, `DELETE FROM runtime_realm_source_materialization_replay_v3
				WHERE (materializer_account_id, request_id) IN (
					SELECT materializer_account_id, request_id FROM runtime_realm_source_materialization_attempt_v3
					WHERE local_agent_ref IN (`+placeholders+`)
				)`, args...)
			if err != nil {
				return nil, fmt.Errorf("delete affected Realm source replay rows: %w", err)
			}
			counts["runtime_realm_source_materialization_replay_v3"], _ = result.RowsAffected()
		}
	}

	for _, target := range realmSourceMaterializationResetAgentBindings() {
		deleted, err := deleteResetRowsByValuesTx(ctx, tx, target.table, target.column, localAgentRefs)
		if err != nil {
			return nil, err
		}
		counts[target.table] += deleted
	}

	for _, name := range retiredRealmSourceMaterializationTriggers() {
		if _, err := tx.ExecContext(ctx, "DROP TRIGGER IF EXISTS "+name); err != nil {
			return nil, fmt.Errorf("drop retired Realm source materialization trigger %s: %w", name, err)
		}
	}
	for _, name := range retiredRealmSourceMaterializationTables() {
		if _, err := tx.ExecContext(ctx, "DROP TABLE IF EXISTS "+name); err != nil {
			return nil, fmt.Errorf("drop retired Realm source materialization table %s: %w", name, err)
		}
	}
	return counts, nil
}

func writeRealmSourceMaterializationV3EpochTx(tx *sql.Tx) error {
	exists, err := resetSchemaObjectExistsTx(tx, "runtime_local_agent_meta")
	if err != nil {
		return err
	}
	if !exists {
		return fmt.Errorf("Realm source materialization reset target is not a Runtime database")
	}
	if _, err := tx.Exec(`
		INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value
	`, realmSourceMaterializationEpochMetaKey, realmSourceMaterializationEpochV3); err != nil {
		return fmt.Errorf("write Realm source materialization v3 epoch: %w", err)
	}
	return nil
}

func verifyRealmSourceMaterializationResetTx(tx *sql.Tx, localAgentRefs, bankKeys, publicChatAnchorIDs []string) error {
	var epoch string
	if err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationEpochMetaKey).Scan(&epoch); err != nil {
		return fmt.Errorf("read back Realm source materialization reset epoch: %w", err)
	}
	if epoch != realmSourceMaterializationEpochV3 {
		return fmt.Errorf("read back Realm source materialization reset epoch: got %q", epoch)
	}
	for _, name := range append(retiredRealmSourceMaterializationTriggers(), retiredRealmSourceMaterializationTables()...) {
		exists, err := resetSchemaObjectExistsTx(tx, name)
		if err != nil {
			return err
		}
		if exists {
			return fmt.Errorf("retired Realm source materialization object %s remains after reset", name)
		}
	}
	for _, target := range realmSourceMaterializationResetAgentBindings() {
		remaining, err := countResetRowsByValuesTx(tx, target.table, target.column, localAgentRefs)
		if err != nil {
			return err
		}
		if remaining != 0 {
			return fmt.Errorf("Realm source materialization reset left %d affected rows in %s", remaining, target.table)
		}
	}
	for _, target := range realmSourceMaterializationResetMemoryBindings() {
		remaining, err := countResetRowsByValuesTx(tx, target.table, target.column, bankKeys)
		if err != nil {
			return err
		}
		if remaining != 0 {
			return fmt.Errorf("Realm source materialization reset left %d affected rows in %s", remaining, target.table)
		}
	}
	runtimeRefs, err := collectRealmSourceMaterializationRuntimeAgentRefs(tx)
	if err != nil {
		return err
	}
	if len(runtimeRefs.legacy) != 0 {
		return fmt.Errorf("Realm source materialization reset left %d legacy Runtime source LocalAgents", len(runtimeRefs.legacy))
	}
	staleSnapshotRefs, err := collectPreV3RealmSourceSnapshotRefs(tx)
	if err != nil {
		return err
	}
	if len(staleSnapshotRefs) != 0 {
		return fmt.Errorf("Realm source materialization reset left %d stale snapshot compatibility records", len(staleSnapshotRefs))
	}
	if err := verifyAffectedPublicChatStateAbsentTx(tx, localAgentRefs, publicChatAnchorIDs); err != nil {
		return err
	}
	if err := verifyRealmSourceMaterializationReplayOrphansAbsentTx(tx); err != nil {
		return err
	}
	if err := verifyRealmSourceMaterializationForeignKeysTx(tx); err != nil {
		return err
	}
	return nil
}

func verifyAffectedPublicChatStateAbsentTx(tx *sql.Tx, localAgentRefs, anchorIDs []string) error {
	exists, err := resetSchemaObjectExistsTx(tx, "runtime_local_agent_meta")
	if err != nil || !exists {
		return err
	}
	needles := resetStringSet(append(append([]string(nil), localAgentRefs...), anchorIDs...))
	if len(needles) > 0 {
		var raw string
		err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'public_chat_surface_state'`).Scan(&raw)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("read back public chat state after Realm source reset: %w", err)
		}
		if err == nil {
			var state any
			if err := json.Unmarshal([]byte(raw), &state); err != nil {
				return fmt.Errorf("decode public chat state after Realm source reset: %w", err)
			}
			if resetJSONContainsExactString(state, needles) {
				return fmt.Errorf("Realm source materialization reset left affected public chat state")
			}
		}
	}
	for _, anchorID := range anchorIDs {
		var count int64
		if err := tx.QueryRow(`SELECT COUNT(*) FROM runtime_local_agent_meta WHERE key = ?`, "public_chat_anchor_metadata:"+anchorID).Scan(&count); err != nil {
			return fmt.Errorf("read back public chat anchor metadata after Realm source reset: %w", err)
		}
		if count != 0 {
			return fmt.Errorf("Realm source materialization reset left public chat metadata for anchor %q", anchorID)
		}
	}
	return nil
}

func verifyRealmSourceMaterializationReplayOrphansAbsentTx(tx *sql.Tx) error {
	for _, table := range []string{"runtime_realm_source_materialization_attempt_v3", "runtime_realm_source_materialization_replay_v3"} {
		exists, err := resetSchemaObjectExistsTx(tx, table)
		if err != nil {
			return err
		}
		if !exists {
			return nil
		}
	}
	var count int64
	if err := tx.QueryRow(`SELECT COUNT(*)
		FROM runtime_realm_source_materialization_replay_v3 replay
		LEFT JOIN runtime_realm_source_materialization_attempt_v3 attempt
		  ON attempt.materializer_account_id = replay.materializer_account_id
		 AND attempt.request_id = replay.request_id
		WHERE attempt.request_id IS NULL`).Scan(&count); err != nil {
		return fmt.Errorf("verify Realm source replay orphan residue: %w", err)
	}
	if count != 0 {
		return fmt.Errorf("Realm source materialization reset left %d replay orphan rows", count)
	}
	return nil
}

func verifyRealmSourceMaterializationForeignKeysTx(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		return fmt.Errorf("verify Realm source reset foreign keys: %w", err)
	}
	defer func() { _ = rows.Close() }()
	if rows.Next() {
		var table string
		var rowID any
		var parent string
		var foreignKeyID int
		if err := rows.Scan(&table, &rowID, &parent, &foreignKeyID); err != nil {
			return fmt.Errorf("scan Realm source reset foreign-key residue: %w", err)
		}
		return fmt.Errorf("Realm source materialization reset left foreign-key residue in %s parent %s key %d", table, parent, foreignKeyID)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("verify Realm source reset foreign keys: %w", err)
	}
	return nil
}

func collectRetiredRealmSourceLocalAgentRefsTx(tx *sql.Tx) ([]string, error) {
	seen := map[string]struct{}{}
	for _, table := range []string{retiredSourceSnapshotTable, retiredSourceProvenanceTable} {
		exists, err := resetSchemaObjectExistsTx(tx, table)
		if err != nil {
			return nil, err
		}
		if !exists {
			continue
		}
		rows, err := tx.Query("SELECT local_agent_ref FROM " + table)
		if err != nil {
			return nil, fmt.Errorf("inventory retired source LocalAgents from %s: %w", table, err)
		}
		for rows.Next() {
			var ref string
			if err := rows.Scan(&ref); err != nil {
				_ = rows.Close()
				return nil, fmt.Errorf("scan retired source LocalAgent from %s: %w", table, err)
			}
			if ref = strings.TrimSpace(ref); ref != "" {
				seen[ref] = struct{}{}
			}
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	refs := make([]string, 0, len(seen))
	for ref := range seen {
		refs = append(refs, ref)
	}
	sort.Strings(refs)
	return refs, nil
}

func collectRealmSourceMaterializationRuntimeAgentRefs(queryer realmSourceMaterializationQueryer) (realmSourceMaterializationRuntimeAgentRefs, error) {
	result := realmSourceMaterializationRuntimeAgentRefs{}
	exists, err := resetSchemaObjectExists(queryer, "runtime_local_agent")
	if err != nil || !exists {
		return result, err
	}
	rows, err := queryer.Query(`SELECT local_agent_ref, agent_json FROM runtime_local_agent ORDER BY local_agent_ref`)
	if err != nil {
		return result, fmt.Errorf("inventory Runtime source LocalAgents: %w", err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var localAgentRef string
		var agentJSON string
		if err := rows.Scan(&localAgentRef, &agentJSON); err != nil {
			return result, fmt.Errorf("scan Runtime source LocalAgent: %w", err)
		}
		var identity struct {
			RuntimeSourceRef       string `json:"runtimeSourceRef"`
			LegacyRuntimeSourceRef string `json:"runtime_source_ref"`
		}
		if err := json.Unmarshal([]byte(agentJSON), &identity); err != nil {
			return result, fmt.Errorf("decode Runtime LocalAgent %q identity during source reset inventory: %w", localAgentRef, err)
		}
		runtimeSourceRef := strings.TrimSpace(identity.RuntimeSourceRef)
		legacyRuntimeSourceRef := strings.TrimSpace(identity.LegacyRuntimeSourceRef)
		if runtimeSourceRef != "" && legacyRuntimeSourceRef != "" && runtimeSourceRef != legacyRuntimeSourceRef {
			return result, fmt.Errorf("Runtime LocalAgent %q has conflicting runtimeSourceRef encodings", localAgentRef)
		}
		if runtimeSourceRef == "" {
			runtimeSourceRef = legacyRuntimeSourceRef
		}
		if !strings.HasPrefix(runtimeSourceRef, realmsourcecontract.RuntimeSourceRefPrefix) {
			continue
		}
		localAgentRef = strings.TrimSpace(localAgentRef)
		if localAgentRef == "" {
			return result, fmt.Errorf("Runtime source LocalAgent has an empty local_agent_ref")
		}
		if strings.HasPrefix(runtimeSourceRef, realmsourcecontract.RuntimeSourceRefV3Prefix) {
			result.currentV3 = append(result.currentV3, localAgentRef)
			continue
		}
		result.legacy = append(result.legacy, localAgentRef)
	}
	if err := rows.Err(); err != nil {
		return result, fmt.Errorf("inventory Runtime source LocalAgents: %w", err)
	}
	return result, nil
}

func collectPreV3RealmSourceSnapshotRefs(queryer realmSourceMaterializationQueryer) ([]string, error) {
	exists, err := resetSchemaObjectExists(queryer, "runtime_local_agent_source_snapshot_v2")
	if err != nil || !exists {
		return nil, err
	}
	rows, err := queryer.Query(`SELECT local_agent_ref, snapshot_schema_version, normalization_version, compiler_compatibility_version
		FROM runtime_local_agent_source_snapshot_v2 ORDER BY local_agent_ref`)
	if err != nil {
		return nil, fmt.Errorf("inventory Realm source snapshot compatibility: %w", err)
	}
	defer func() { _ = rows.Close() }()
	refs := make([]string, 0)
	for rows.Next() {
		var localAgentRef string
		var snapshotSchemaVersion int64
		var normalizationVersion string
		var compilerCompatibilityVersion string
		if err := rows.Scan(&localAgentRef, &snapshotSchemaVersion, &normalizationVersion, &compilerCompatibilityVersion); err != nil {
			return nil, fmt.Errorf("scan Realm source snapshot compatibility: %w", err)
		}
		if snapshotSchemaVersion == 2 && normalizationVersion == realmsourcecontract.NormalizationVersion &&
			compilerCompatibilityVersion == realmsourcecontract.CompilerCompatibilityVersion {
			continue
		}
		localAgentRef = strings.TrimSpace(localAgentRef)
		if localAgentRef == "" {
			return nil, fmt.Errorf("pre-v3 Realm source snapshot has an empty local_agent_ref")
		}
		refs = append(refs, localAgentRef)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inventory Realm source snapshot compatibility: %w", err)
	}
	return refs, nil
}

func collectAgentScopedMemoryBankKeysTx(tx *sql.Tx, refs []string) ([]string, error) {
	exists, err := resetSchemaObjectExistsTx(tx, "memory_bank")
	if err != nil || !exists || len(refs) == 0 {
		return nil, err
	}
	seen := map[string]struct{}{}
	for _, ref := range refs {
		core := "agent-core::" + ref
		dyadic := "agent-dyadic::" + ref + "::"
		rows, err := tx.Query(`SELECT locator_key FROM memory_bank WHERE locator_key = ? OR substr(locator_key, 1, length(?)) = ?`, core, dyadic, dyadic)
		if err != nil {
			return nil, fmt.Errorf("inventory agent-scoped memory for %s: %w", ref, err)
		}
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				_ = rows.Close()
				return nil, err
			}
			seen[key] = struct{}{}
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys, nil
}

func collectAffectedPublicChatAnchorIDsTx(tx *sql.Tx, refs []string) ([]string, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	exists, err := resetSchemaObjectExistsTx(tx, "runtime_local_agent_meta")
	if err != nil || !exists {
		return nil, err
	}
	var raw string
	err = tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'public_chat_surface_state'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read public chat anchors for Realm source reset inventory: %w", err)
	}
	var state struct {
		Anchors []struct {
			ConversationAnchorID string `json:"conversationAnchorId"`
			AgentID              string `json:"agentId"`
			LocalAgentRef        string `json:"localAgentRef"`
		} `json:"anchors"`
		FollowUps []struct {
			ConversationAnchorID string `json:"conversationAnchorId"`
			AgentID              string `json:"agentId"`
		} `json:"followUps"`
		AvatarLiveInstances []struct {
			ConversationAnchorID string `json:"conversationAnchorId"`
			AgentID              string `json:"agentId"`
			LocalAgentRef        string `json:"localAgentRef"`
		} `json:"avatarLiveInstances"`
	}
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return nil, fmt.Errorf("decode public chat anchors for Realm source reset inventory: %w", err)
	}
	refSet := resetStringSet(refs)
	seen := map[string]struct{}{}
	addAnchorID := func(raw string) error {
		anchorID := strings.TrimSpace(raw)
		if anchorID == "" {
			return fmt.Errorf("affected public chat dependency has an empty conversationAnchorId")
		}
		seen[anchorID] = struct{}{}
		return nil
	}
	for _, anchor := range state.Anchors {
		_, affectedLocalRef := refSet[strings.TrimSpace(anchor.LocalAgentRef)]
		_, affectedAgentID := refSet[strings.TrimSpace(anchor.AgentID)]
		if !affectedLocalRef && !affectedAgentID {
			continue
		}
		if err := addAnchorID(anchor.ConversationAnchorID); err != nil {
			return nil, err
		}
	}
	for _, followUp := range state.FollowUps {
		if _, affected := refSet[strings.TrimSpace(followUp.AgentID)]; !affected {
			continue
		}
		if err := addAnchorID(followUp.ConversationAnchorID); err != nil {
			return nil, err
		}
	}
	for _, avatar := range state.AvatarLiveInstances {
		_, affectedLocalRef := refSet[strings.TrimSpace(avatar.LocalAgentRef)]
		_, affectedAgentID := refSet[strings.TrimSpace(avatar.AgentID)]
		if !affectedLocalRef && !affectedAgentID {
			continue
		}
		if err := addAnchorID(avatar.ConversationAnchorID); err != nil {
			return nil, err
		}
	}
	anchorIDs := make([]string, 0, len(seen))
	for anchorID := range seen {
		anchorIDs = append(anchorIDs, anchorID)
	}
	sort.Strings(anchorIDs)
	return anchorIDs, nil
}

func pruneAffectedPublicChatStateTx(tx *sql.Tx, refs []string, counts map[string]int64) error {
	if len(refs) == 0 {
		return nil
	}
	exists, err := resetSchemaObjectExistsTx(tx, "runtime_local_agent_meta")
	if err != nil || !exists {
		return err
	}
	var raw string
	err = tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = 'public_chat_surface_state'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read public chat state for Realm source reset: %w", err)
	}

	var state map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return fmt.Errorf("decode public chat state for Realm source reset: %w", err)
	}
	refSet := resetStringSet(refs)
	removedAnchorIDs := map[string]struct{}{}
	anchors, changed, err := filterResetJSONArray(state["anchors"], func(item map[string]any) bool {
		ref, _ := item["localAgentRef"].(string)
		if _, remove := refSet[strings.TrimSpace(ref)]; !remove {
			return false
		}
		if anchorID, _ := item["conversationAnchorId"].(string); strings.TrimSpace(anchorID) != "" {
			removedAnchorIDs[strings.TrimSpace(anchorID)] = struct{}{}
		}
		return true
	})
	if err != nil {
		return fmt.Errorf("filter public chat anchors for Realm source reset: %w", err)
	}
	state["anchors"] = anchors
	removeStrings := make(map[string]struct{}, len(refSet)+len(removedAnchorIDs))
	for value := range refSet {
		removeStrings[value] = struct{}{}
	}
	for value := range removedAnchorIDs {
		removeStrings[value] = struct{}{}
	}
	for _, key := range []string{"followUps", "avatarLiveInstances"} {
		filtered, collectionChanged, err := filterResetJSONArray(state[key], func(item map[string]any) bool {
			if !resetJSONContainsExactString(item, removeStrings) {
				return false
			}
			if anchorID, _ := item["conversationAnchorId"].(string); strings.TrimSpace(anchorID) != "" {
				anchorID = strings.TrimSpace(anchorID)
				removedAnchorIDs[anchorID] = struct{}{}
				removeStrings[anchorID] = struct{}{}
			}
			return true
		})
		if err != nil {
			return fmt.Errorf("filter public chat %s for Realm source reset: %w", key, err)
		}
		state[key] = filtered
		changed = changed || collectionChanged
	}
	if !changed {
		return nil
	}
	var version uint64
	if err := json.Unmarshal(state["version"], &version); err != nil {
		return fmt.Errorf("decode public chat version for Realm source reset: %w", err)
	}
	if version == ^uint64(0) {
		return fmt.Errorf("public chat version overflow during Realm source reset")
	}
	version++
	state["version"] = json.RawMessage(strconv.FormatUint(version, 10))
	state["savedAt"] = json.RawMessage(strconvQuote(time.Now().UTC().Format(time.RFC3339Nano)))
	updated, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("encode public chat state for Realm source reset: %w", err)
	}
	result, err := tx.Exec(`UPDATE runtime_local_agent_meta SET value = ? WHERE key = 'public_chat_surface_state'`, string(updated))
	if err != nil {
		return fmt.Errorf("write public chat state for Realm source reset: %w", err)
	}
	counts["publicChatStateRows"], _ = result.RowsAffected()
	if _, err := tx.Exec(`
		INSERT INTO runtime_local_agent_meta(key, value) VALUES ('public_chat_surface_version', ?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value
	`, strconv.FormatUint(version, 10)); err != nil {
		return fmt.Errorf("write public chat version for Realm source reset: %w", err)
	}
	for anchorID := range removedAnchorIDs {
		result, err := tx.Exec(`DELETE FROM runtime_local_agent_meta WHERE key = ?`, "public_chat_anchor_metadata:"+anchorID)
		if err != nil {
			return fmt.Errorf("delete public chat anchor metadata for Realm source reset: %w", err)
		}
		deleted, _ := result.RowsAffected()
		counts["publicChatAnchorMetadataRows"] += deleted
	}
	return nil
}

func strconvQuote(value string) []byte {
	encoded, _ := json.Marshal(value)
	return encoded
}

func filterResetJSONArray(raw json.RawMessage, remove func(map[string]any) bool) (json.RawMessage, bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return json.RawMessage("[]"), false, nil
	}
	var items []map[string]any
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, false, err
	}
	retained := make([]map[string]any, 0, len(items))
	changed := false
	for _, item := range items {
		if remove(item) {
			changed = true
			continue
		}
		retained = append(retained, item)
	}
	encoded, err := json.Marshal(retained)
	return encoded, changed, err
}

func resetJSONContainsExactString(value any, needles map[string]struct{}) bool {
	switch typed := value.(type) {
	case string:
		_, ok := needles[typed]
		return ok
	case []any:
		for _, item := range typed {
			if resetJSONContainsExactString(item, needles) {
				return true
			}
		}
	case map[string]any:
		for _, item := range typed {
			if resetJSONContainsExactString(item, needles) {
				return true
			}
		}
	}
	return false
}

func resetStringSet(values []string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			set[value] = struct{}{}
		}
	}
	return set
}

func resetSchemaObjectExists(queryer realmSourceMaterializationQueryer, name string) (bool, error) {
	var count int
	if err := queryer.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE name = ?`, name).Scan(&count); err != nil {
		return false, fmt.Errorf("inspect Realm source reset schema object %s: %w", name, err)
	}
	return count > 0, nil
}

func resetSchemaObjectExistsTx(tx *sql.Tx, name string) (bool, error) {
	return resetSchemaObjectExists(tx, name)
}

func resetTableRowCountTx(tx *sql.Tx, table string) (int64, error) {
	var count int64
	if err := tx.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil {
		return 0, fmt.Errorf("count Realm source reset table %s: %w", table, err)
	}
	return count, nil
}

func deleteResetRowsByValuesTx(ctx context.Context, tx *sql.Tx, table, column string, values []string) (int64, error) {
	if len(values) == 0 {
		return 0, nil
	}
	exists, err := resetSchemaObjectExistsTx(tx, table)
	if err != nil || !exists {
		return 0, err
	}
	result, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE "+column+" IN ("+resetSQLPlaceholders(len(values))+")", resetStringsToAny(values)...)
	if err != nil {
		return 0, fmt.Errorf("delete Realm source reset rows from %s: %w", table, err)
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("count deleted Realm source reset rows from %s: %w", table, err)
	}
	return deleted, nil
}

func countResetRowsByValuesTx(tx *sql.Tx, table, column string, values []string) (int64, error) {
	if len(values) == 0 {
		return 0, nil
	}
	exists, err := resetSchemaObjectExistsTx(tx, table)
	if err != nil || !exists {
		return 0, err
	}
	var count int64
	if err := tx.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE "+column+" IN ("+resetSQLPlaceholders(len(values))+")", resetStringsToAny(values)...).Scan(&count); err != nil {
		return 0, fmt.Errorf("read back Realm source reset rows from %s: %w", table, err)
	}
	return count, nil
}

func resetSQLPlaceholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimSuffix(strings.Repeat("?,", count), ",")
}

func resetStringsToAny(values []string) []any {
	args := make([]any, len(values))
	for index, value := range values {
		args[index] = value
	}
	return args
}

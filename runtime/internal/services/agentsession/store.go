package agentsession

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/services/cognitionmemory"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	_ "modernc.org/sqlite"
)

const sessionsSchemaVersion = 2

var (
	errSessionNotFound           = errors.New("work session not found")
	errSessionConflict           = errors.New("work session state conflict")
	errLeaseConflict             = errors.New("body carrier lease conflict")
	errTombstoneFence            = errors.New("pending purge or invalidate tombstones must be drained first")
	errSubmissionPayloadConflict = errors.New("idempotent submission payload mismatch")
	errAttentionScopeConflict    = errors.New("attention id belongs to a different account or work session")
	errBodyNamespaceMismatch     = errors.New("work session does not belong to caller body namespace or device")
)

// Store manages the physically isolated sessions.db (WAL + synchronous=FULL)
// with a single-writer pool and a concurrent read-only pool for FTS5 BM25
// routing queries outside write transactions.
// @nimi-authority: rule.nimi.runtime.agent-participation.r001
type Store struct {
	path    string
	writeDB *sql.DB
	readDB  *sql.DB

	hbMu           sync.RWMutex
	liveHeartbeats map[string]time.Time
}

func OpenStore(dbPath string) (*Store, error) {
	trimmed := strings.TrimSpace(dbPath)
	if trimmed == "" {
		return nil, fmt.Errorf("sessions.db path is required")
	}
	absPath, err := filepath.Abs(filepath.Clean(trimmed))
	if err != nil {
		return nil, fmt.Errorf("resolve sessions.db path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absPath), 0o700); err != nil {
		return nil, fmt.Errorf("create sessions.db dir: %w", err)
	}
	writeDSN := runtimepersistence.SQLiteFileURI(absPath, "_pragma=foreign_keys(ON)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_txlock=immediate")
	writeDB, err := sql.Open("sqlite", writeDSN)
	if err != nil {
		return nil, fmt.Errorf("open sessions.db writer: %w", err)
	}
	writeDB.SetMaxOpenConns(1)
	writeDB.SetMaxIdleConns(1)

	if err := verifyAndInitStore(writeDB); err != nil {
		_ = writeDB.Close()
		return nil, err
	}

	readDSN := runtimepersistence.SQLiteFileURI(absPath, "mode=ro&_pragma=busy_timeout(5000)&_pragma=query_only(ON)")
	readDB, err := sql.Open("sqlite", readDSN)
	if err != nil {
		_ = writeDB.Close()
		return nil, fmt.Errorf("open sessions.db reader: %w", err)
	}
	readDB.SetMaxOpenConns(8)
	readDB.SetMaxIdleConns(4)

	return &Store{
		path:           absPath,
		writeDB:        writeDB,
		readDB:         readDB,
		liveHeartbeats: make(map[string]time.Time),
	}, nil
}

func (st *Store) Close() error {
	var firstErr error
	if st.readDB != nil {
		if err := st.readDB.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if st.writeDB != nil {
		if err := st.writeDB.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// FlushWAL checkpoints the WAL file cleanly before data-root handoff.
func (st *Store) FlushWAL(ctx context.Context) error {
	if st == nil || st.writeDB == nil {
		return nil
	}
	_, err := st.writeDB.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE);`)
	return err
}

// putPendingAttention participates in the occurrence receipt and schedule transaction.
func putPendingAttention(ctx context.Context, tx *sql.Tx, accountID string, att *runtimev1.PendingAttentionRecord, now time.Time) error {
	nowStr := formatRFC3339(now)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_session_pending_attention(
			attention_id, account_id, work_session_ref, agent_binding,
			attention_kind, trust_scope, summary_json, expires_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(attention_id) DO UPDATE SET
			summary_json = excluded.summary_json,
			expires_at = excluded.expires_at,
			updated_at = excluded.updated_at`,
		att.GetAttentionId(),
		accountID,
		att.GetWorkSessionRef(),
		att.GetAgentBinding(),
		att.GetAttentionKind(),
		att.GetTrustScope(),
		att.GetSummaryJson(),
		att.GetExpiresAt(),
		nowStr,
	)
	return err
}

// VerifyDurabilityPragmas reads back SQLite PRAGMA journal_mode and synchronous
// to guarantee WAL + synchronous=FULL (2).
func (st *Store) VerifyDurabilityPragmas(ctx context.Context) (journalMode string, synchronous int, err error) {
	if err := st.writeDB.QueryRowContext(ctx, `PRAGMA journal_mode;`).Scan(&journalMode); err != nil {
		return "", 0, err
	}
	if err := st.writeDB.QueryRowContext(ctx, `PRAGMA synchronous;`).Scan(&synchronous); err != nil {
		return "", 0, err
	}
	return strings.ToLower(strings.TrimSpace(journalMode)), synchronous, nil
}

func verifyAndInitStore(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var journalMode string
	if err := db.QueryRowContext(ctx, `PRAGMA journal_mode=WAL;`).Scan(&journalMode); err != nil {
		return fmt.Errorf("enable WAL on sessions.db: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(journalMode), "wal") {
		return fmt.Errorf("sessions.db journal_mode=%q want wal", journalMode)
	}
	if _, err := db.ExecContext(ctx, `PRAGMA synchronous=FULL;`); err != nil {
		return fmt.Errorf("set synchronous=FULL on sessions.db: %w", err)
	}
	var syncMode int
	if err := db.QueryRowContext(ctx, `PRAGMA synchronous;`).Scan(&syncMode); err != nil {
		return fmt.Errorf("readback synchronous on sessions.db: %w", err)
	}
	if syncMode != 2 {
		return fmt.Errorf("sessions.db synchronous=%d want 2 (FULL)", syncMode)
	}

	ddl := []string{
		`CREATE TABLE IF NOT EXISTS runtime_session (
			work_session_ref TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			agent_binding TEXT NOT NULL,
			session_kind TEXT NOT NULL,
			owner_body_kind TEXT NOT NULL,
			device_id TEXT NOT NULL DEFAULT '',
			publisher_scope_key TEXT NOT NULL DEFAULT '',
			parent_session_ref TEXT NOT NULL DEFAULT '',
			forked_from_session_ref TEXT NOT NULL DEFAULT '',
			forked_at_seq INTEGER NOT NULL DEFAULT 0,
			is_primary_companion INTEGER NOT NULL DEFAULT 0,
			is_general_inbox INTEGER NOT NULL DEFAULT 0,
			title TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'active',
			trust_tier TEXT NOT NULL DEFAULT 'trusted',
			workspace_root TEXT NOT NULL DEFAULT '',
			permission_mode TEXT NOT NULL DEFAULT 'plan-readonly',
			latest_receipt_json TEXT NOT NULL DEFAULT '{}',
			topic_summary TEXT NOT NULL DEFAULT '',
			projection_seq INTEGER NOT NULL DEFAULT 0,
			projection_lease_epoch INTEGER NOT NULL DEFAULT 0,
			head_seq INTEGER NOT NULL DEFAULT 0,
			inbox_turn_count INTEGER NOT NULL DEFAULT 0,
			last_active_at TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			archived_at TEXT NOT NULL DEFAULT '',
			body_purge_pending INTEGER NOT NULL DEFAULT 0,
			deleted_at TEXT NOT NULL DEFAULT ''
		);`,
		`CREATE TABLE IF NOT EXISTS runtime_session_milestone (
			id INTEGER PRIMARY KEY, delivery_id TEXT NOT NULL, account_id TEXT NOT NULL, agent_binding TEXT NOT NULL,
			work_session_ref TEXT NOT NULL, body_kind TEXT NOT NULL, kind TEXT NOT NULL,
			summary TEXT NOT NULL, deliverables TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_session_acct_agent ON runtime_session(account_id, agent_binding, status, updated_at DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_session_scope ON runtime_session(account_id, publisher_scope_key, status);`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_session_workspace ON runtime_session(account_id, agent_binding, workspace_root, status);`,

		`CREATE TABLE IF NOT EXISTS runtime_body_outbox (
			outbox_id TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			device_id TEXT NOT NULL,
			capability_namespace TEXT NOT NULL,
			work_session_ref TEXT NOT NULL,
			agent_binding TEXT NOT NULL DEFAULT '',
			command_kind INTEGER NOT NULL,
			payload_json TEXT NOT NULL DEFAULT '{}',
			payload_hash TEXT NOT NULL DEFAULT '',
			state TEXT NOT NULL DEFAULT 'pending',
			result_state TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			acked_at TEXT NOT NULL DEFAULT ''
		);`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_body_outbox_pending ON runtime_body_outbox(account_id, device_id, capability_namespace, state, created_at ASC);`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_body_outbox_session ON runtime_body_outbox(work_session_ref, state);`,

		`CREATE TABLE IF NOT EXISTS runtime_body_continuity_ledger (
			work_session_ref TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			agent_binding TEXT NOT NULL,
			last_step_mac TEXT NOT NULL DEFAULT '',
			last_committed_count INTEGER NOT NULL DEFAULT 0,
			post_compaction_mac TEXT NOT NULL DEFAULT '',
			issued_tool_call_ids_json TEXT NOT NULL DEFAULT '[]',
			issued_tool_args_json TEXT NOT NULL DEFAULT '{}',
			read_set_epoch INTEGER NOT NULL DEFAULT 0,
			compaction_count INTEGER NOT NULL DEFAULT 0,
			effective_context_budget_tokens INTEGER NOT NULL DEFAULT 64000,
			updated_at TEXT NOT NULL
		);`,

		`CREATE TABLE IF NOT EXISTS runtime_body_issued_tool_call (
			account_id TEXT NOT NULL,
			work_session_ref TEXT NOT NULL,
			call_id TEXT NOT NULL,
			tool_name TEXT NOT NULL,
			args_hash TEXT NOT NULL,
			raw_args_hash TEXT NOT NULL,
			consumed_at TEXT NOT NULL DEFAULT '',
			result_committed_at TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			PRIMARY KEY (account_id, work_session_ref, call_id)
		);`,

		`CREATE TABLE IF NOT EXISTS runtime_body_memory_read (
			account_id TEXT NOT NULL, work_session_ref TEXT NOT NULL, binding TEXT NOT NULL, bank TEXT NOT NULL,
			lifecycle TEXT NOT NULL, ref TEXT NOT NULL, PRIMARY KEY(account_id,work_session_ref,binding,bank,lifecycle,ref))`,
		`CREATE TABLE IF NOT EXISTS runtime_body_step_journal (
			account_id TEXT NOT NULL,
			work_session_ref TEXT NOT NULL,
			step_request_id TEXT NOT NULL,
			prev_step_mac TEXT NOT NULL DEFAULT '',
			prev_committed_count INTEGER NOT NULL DEFAULT 0,
			next_step_mac TEXT NOT NULL,
			next_committed_count INTEGER NOT NULL,
			post_compaction_mac TEXT NOT NULL DEFAULT '',
			tool_calls_json TEXT NOT NULL DEFAULT '[]',
			done_json TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (account_id, work_session_ref, step_request_id)
		);`,

		`CREATE TABLE IF NOT EXISTS runtime_pending_agent_purge (
			account_id TEXT NOT NULL,
			agent_binding TEXT NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (account_id, agent_binding)
		);`,

		`CREATE TABLE IF NOT EXISTS runtime_session_submission (
			account_id TEXT NOT NULL,
			caller_subject TEXT NOT NULL DEFAULT '',
			client_submission_id TEXT NOT NULL,
			payload_hash TEXT NOT NULL DEFAULT '',
			resolved_work_session_ref TEXT NOT NULL,
			outcome INTEGER NOT NULL,
			route_reason TEXT NOT NULL DEFAULT '',
			session_kind TEXT NOT NULL DEFAULT '',
			owner_body_kind TEXT NOT NULL DEFAULT '',
			effective_permission_mode TEXT NOT NULL DEFAULT '',
			outbox_id TEXT NOT NULL DEFAULT '',
			promoted_handoff_turns INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			PRIMARY KEY (account_id, caller_subject, client_submission_id)
		);`,

		`CREATE TABLE IF NOT EXISTS runtime_brain_event (
			work_session_ref TEXT NOT NULL,
			seq INTEGER NOT NULL,
			event_id TEXT NOT NULL,
			event_type TEXT NOT NULL,
			payload_json TEXT NOT NULL DEFAULT '{}',
			moved_to_work_session_ref TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			PRIMARY KEY (work_session_ref, seq)
		);`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_brain_event_session_seq ON runtime_brain_event(work_session_ref, seq ASC);`,

		`CREATE TABLE IF NOT EXISTS runtime_session_alarm (
			alarm_id TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			agent_binding TEXT NOT NULL,
			target_work_session_ref TEXT NOT NULL DEFAULT '',
			alarm_kind INTEGER NOT NULL,
			cron_expr TEXT NOT NULL DEFAULT '',
			time_zone TEXT NOT NULL DEFAULT 'UTC',
			source_publisher TEXT NOT NULL DEFAULT '',
			source_object_id TEXT NOT NULL DEFAULT '',
			source_object_version TEXT NOT NULL DEFAULT '',
			template_title TEXT NOT NULL DEFAULT '',
			template_body TEXT NOT NULL DEFAULT '',
			template_payload_json TEXT NOT NULL DEFAULT '{}',
			requires_llm INTEGER NOT NULL DEFAULT 0,
			delivery_channels_json TEXT NOT NULL DEFAULT '[]',
			status TEXT NOT NULL DEFAULT 'active',
			unack_streak INTEGER NOT NULL DEFAULT 0,
			next_fire_at TEXT NOT NULL DEFAULT '',
			version INTEGER NOT NULL DEFAULT 1,
			expires_at TEXT NOT NULL DEFAULT '',
			last_receipt_state INTEGER NOT NULL DEFAULT 0,
			last_delivery_at TEXT NOT NULL DEFAULT '',
			last_claimed_occurrence TEXT NOT NULL DEFAULT '',
			claim_expires_at TEXT NOT NULL DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_session_alarm_delegation ON runtime_session_alarm(account_id, source_publisher, source_object_id) WHERE source_object_id != '';`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_session_alarm_due ON runtime_session_alarm(status, next_fire_at ASC);`,

		`CREATE TABLE IF NOT EXISTS runtime_alarm_delivery (
			delivery_id TEXT PRIMARY KEY,
			alarm_id TEXT NOT NULL,
			account_id TEXT NOT NULL,
			channel TEXT NOT NULL,
			receipt_state INTEGER NOT NULL,
			provider_message_ref TEXT NOT NULL DEFAULT '',
			detail TEXT NOT NULL DEFAULT '',
			fired_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_alarm_delivery_alarm ON runtime_alarm_delivery(alarm_id, fired_at DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_alarm_delivery_ref ON runtime_alarm_delivery(account_id, provider_message_ref) WHERE provider_message_ref != '';`,

		`CREATE TABLE IF NOT EXISTS runtime_session_pending_attention (
			attention_id TEXT PRIMARY KEY,
			account_id TEXT NOT NULL,
			work_session_ref TEXT NOT NULL,
			agent_binding TEXT NOT NULL,
			attention_kind TEXT NOT NULL,
			trust_scope TEXT NOT NULL,
			summary_json TEXT NOT NULL DEFAULT '{}',
			expires_at TEXT NOT NULL DEFAULT '',
			updated_at TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_attention_acct ON runtime_session_pending_attention(account_id, work_session_ref);`,

		`CREATE TABLE IF NOT EXISTS runtime_body_carrier_lease (
			account_id TEXT NOT NULL,
			device_id TEXT NOT NULL,
			capability_namespace TEXT NOT NULL,
			lease_epoch INTEGER NOT NULL,
			carrier_app_id TEXT NOT NULL,
			carrier_subject TEXT NOT NULL,
			instance_id TEXT NOT NULL,
			capabilities_json TEXT NOT NULL DEFAULT '{}',
			last_heartbeat_at TEXT NOT NULL,
			active INTEGER NOT NULL DEFAULT 1,
			PRIMARY KEY (account_id, device_id, capability_namespace)
		);`,

		`CREATE VIRTUAL TABLE IF NOT EXISTS runtime_session_fts USING fts5(
			work_session_ref UNINDEXED,
			account_id UNINDEXED,
			agent_binding UNINDEXED,
			indexed_text,
			tokenize = 'unicode61'
		);`,

		`CREATE TABLE IF NOT EXISTS runtime_session_meta (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);`,
		fmt.Sprintf(`INSERT OR IGNORE INTO runtime_session_meta(key, value) VALUES ('schema_version', '%d');`, sessionsSchemaVersion),
	}

	for _, stmt := range ddl {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("init sessions.db ddl: %w", err)
		}
	}
	// Additive column migrations for pre-existing local sessions.db files.
	additiveAlters := []struct {
		table string
		col   string
		sql   string
	}{
		{"runtime_session", "routing_goal", "ALTER TABLE runtime_session ADD COLUMN routing_goal TEXT NOT NULL DEFAULT ''"},
		{"runtime_body_issued_tool_call", "revoked", "ALTER TABLE runtime_body_issued_tool_call ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0"},
		{"runtime_body_continuity_ledger", "generation", "ALTER TABLE runtime_body_continuity_ledger ADD COLUMN generation INTEGER NOT NULL DEFAULT 0"},
		{"runtime_session_milestone", "delivery_id", `ALTER TABLE runtime_session_milestone ADD COLUMN delivery_id TEXT NOT NULL DEFAULT ''`},
		{"runtime_session", "forgotten_memory_count", `ALTER TABLE runtime_session ADD COLUMN forgotten_memory_count INTEGER`},
		{"runtime_session", "projection_lease_epoch", `ALTER TABLE runtime_session ADD COLUMN projection_lease_epoch INTEGER NOT NULL DEFAULT 0`},
		{"runtime_body_outbox", "input_committed", "ALTER TABLE runtime_body_outbox ADD COLUMN input_committed INTEGER NOT NULL DEFAULT 0"},
		{"runtime_body_continuity_ledger", "last_committed_count", `ALTER TABLE runtime_body_continuity_ledger ADD COLUMN last_committed_count INTEGER NOT NULL DEFAULT 0`},
		{"runtime_body_continuity_ledger", "issued_tool_args_json", `ALTER TABLE runtime_body_continuity_ledger ADD COLUMN issued_tool_args_json TEXT NOT NULL DEFAULT '{}'`},
		{"runtime_session_alarm", "last_claimed_occurrence", `ALTER TABLE runtime_session_alarm ADD COLUMN last_claimed_occurrence TEXT NOT NULL DEFAULT ''`},
		{"runtime_session_alarm", "claim_expires_at", `ALTER TABLE runtime_session_alarm ADD COLUMN claim_expires_at TEXT NOT NULL DEFAULT ''`},
	}
	for _, alt := range additiveAlters {
		exists, err := sqliteTableHasColumn(ctx, db, alt.table, alt.col)
		if err != nil {
			return fmt.Errorf("inspect sessions.db %s.%s: %w", alt.table, alt.col, err)
		}
		if !exists {
			if _, err := db.ExecContext(ctx, alt.sql); err != nil {
				return fmt.Errorf("migrate sessions.db %s.%s: %w", alt.table, alt.col, err)
			}
		}
	}
	// Old journals do not identify individual user inputs in their signed prefix.
	// Retire legacy deliveries before the ledger head, including unacked redeliveries.
	// Inputs routed after the last step and new-format inputs remain eligible.
	migration, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = migration.Rollback() }()
	if _, err := migration.ExecContext(ctx, `UPDATE runtime_session_milestone SET delivery_id = 'milestone_' || lower(hex(randomblob(12))) WHERE delivery_id = ''`); err != nil {
		return fmt.Errorf("assign pending milestone identities: %w", err)
	}
	if _, err := migration.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_session_milestone_delivery ON runtime_session_milestone(delivery_id)`); err != nil {
		return err
	}
	tag, err := migration.ExecContext(ctx, "INSERT OR IGNORE INTO runtime_session_meta(key,value) VALUES('outbox_input_receipt_v1','1')")
	if err != nil {
		return err
	}
	applied, err := tag.RowsAffected()
	if err != nil {
		return err
	}
	if applied == 1 {
		if _, err = migration.ExecContext(ctx, `UPDATE runtime_body_outbox AS o SET input_committed=1
			WHERE o.command_kind=? AND o.input_committed=0 AND json_type(o.payload_json, '$.bodyInputText') IS NULL
			AND EXISTS (SELECT 1 FROM runtime_body_continuity_ledger l WHERE l.account_id=o.account_id
			  AND l.work_session_ref=o.work_session_ref AND l.last_step_mac!='' AND julianday(o.created_at)<=julianday(l.updated_at))`,
			int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT)); err != nil {
			return fmt.Errorf("fence pre-migration body inputs: %w", err)
		}
	}
	// Only Runtime's original, user-authored goal can enter a Cognition pointer.
	if _, err := migration.ExecContext(ctx, `CREATE TRIGGER IF NOT EXISTS capture_session_routing_goal AFTER INSERT ON runtime_session
		BEGIN UPDATE runtime_session SET routing_goal=NEW.topic_summary WHERE account_id=NEW.account_id AND work_session_ref=NEW.work_session_ref; END`); err != nil {
		return err
	}
	if err := migrateSessionRoutingGoals(ctx, migration); err != nil {
		return fmt.Errorf("migrate session routing goals: %w", err)
	}
	// Earlier authorizations did not retain exact memory dependencies.
	tag, err = migration.ExecContext(ctx, "INSERT OR IGNORE INTO runtime_session_meta(key,value) VALUES('body_memory_dependencies_v1','1')")
	if err != nil {
		return err
	}
	applied, err = tag.RowsAffected()
	if err != nil {
		return err
	}
	if applied == 1 {
		for _, stmt := range []string{
			"UPDATE runtime_body_issued_tool_call SET revoked=1",
			"DELETE FROM runtime_body_step_journal",
			"UPDATE runtime_body_continuity_ledger SET generation=generation+1,issued_tool_call_ids_json='[]',issued_tool_args_json='{}'",
		} {
			if _, err := migration.ExecContext(ctx, stmt); err != nil {
				return err
			}
		}
	}
	if err := migration.Commit(); err != nil {
		return err
	}
	// Upgrade v1 runtime_session_submission atomically inside a single transaction.
	hasCallerSubject, err := sqliteTableHasColumn(ctx, db, "runtime_session_submission", "caller_subject")
	if err != nil {
		return fmt.Errorf("inspect runtime_session_submission: %w", err)
	}
	if !hasCallerSubject {
		migTx, txErr := db.BeginTx(ctx, nil)
		if txErr != nil {
			return fmt.Errorf("begin runtime_session_submission v1->v2 migration: %w", txErr)
		}
		for _, mig := range []string{
			`DROP TABLE IF EXISTS runtime_session_submission_v2;`,
			`CREATE TABLE runtime_session_submission_v2 (
				account_id TEXT NOT NULL,
				caller_subject TEXT NOT NULL DEFAULT '',
				client_submission_id TEXT NOT NULL,
				payload_hash TEXT NOT NULL DEFAULT '',
				resolved_work_session_ref TEXT NOT NULL,
				outcome INTEGER NOT NULL,
				route_reason TEXT NOT NULL DEFAULT '',
				session_kind TEXT NOT NULL DEFAULT '',
				owner_body_kind TEXT NOT NULL DEFAULT '',
				effective_permission_mode TEXT NOT NULL DEFAULT '',
				outbox_id TEXT NOT NULL DEFAULT '',
				promoted_handoff_turns INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				PRIMARY KEY (account_id, caller_subject, client_submission_id)
			);`,
			`INSERT INTO runtime_session_submission_v2(
				account_id, caller_subject, client_submission_id, payload_hash,
				resolved_work_session_ref, outcome, route_reason, session_kind,
				owner_body_kind, effective_permission_mode, outbox_id, promoted_handoff_turns, created_at
			) SELECT account_id, '', client_submission_id, '',
				resolved_work_session_ref, outcome, route_reason, session_kind,
				owner_body_kind, effective_permission_mode, outbox_id, promoted_handoff_turns, created_at
			FROM runtime_session_submission;`,
			`DROP TABLE runtime_session_submission;`,
			`ALTER TABLE runtime_session_submission_v2 RENAME TO runtime_session_submission;`,
		} {
			if _, err := migTx.ExecContext(ctx, mig); err != nil {
				_ = migTx.Rollback()
				return fmt.Errorf("migrate runtime_session_submission v1->v2: %w", err)
			}
		}
		if err := migTx.Commit(); err != nil {
			return fmt.Errorf("commit runtime_session_submission v1->v2: %w", err)
		}
	}
	hasSnapshot, err := sqliteTableHasColumn(ctx, db, "runtime_session_submission", "split_record")
	if err != nil {
		return err
	}
	if !hasSnapshot {
		if _, err := db.ExecContext(ctx, "ALTER TABLE runtime_session_submission ADD COLUMN split_record BLOB"); err != nil {
			return err
		}
	}
	_, _ = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO runtime_session_meta(key, value) VALUES ('schema_version', '%d') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, sessionsSchemaVersion))
	return nil
}

func migrateSessionRoutingGoals(ctx context.Context, tx *sql.Tx) error {
	tag, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO runtime_session_meta(key,value) VALUES('session_routing_goals_v1','1')")
	if err != nil {
		return err
	}
	applied, err := tag.RowsAffected()
	if err != nil || applied == 0 {
		return err
	}
	// The session and its first input were committed together. Later inputs and
	// mutable Body titles/summaries cannot establish what the original user asked.
	rows, err := tx.QueryContext(ctx, `SELECT s.account_id, s.work_session_ref,
		CASE WHEN s.forked_from_session_ref != '' THEN (
			SELECT json_extract(b.payload_json,'$.text') FROM runtime_brain_event b
			WHERE b.work_session_ref=s.forked_from_session_ref AND b.moved_to_work_session_ref=s.work_session_ref
			  AND b.event_type='user_message' ORDER BY b.seq DESC LIMIT 1)
		WHEN json_extract(o.payload_json,'$.routeReason')='l2_editable_brief_handoff'
			THEN json_extract(o.payload_json,'$.handoffBriefText')
		ELSE json_extract(o.payload_json,'$.text') END
		FROM runtime_session s JOIN runtime_body_outbox o ON o.rowid=(
			SELECT first.rowid FROM runtime_body_outbox first WHERE first.account_id=s.account_id
			AND first.work_session_ref=s.work_session_ref AND first.created_at=s.created_at AND first.command_kind=?
			ORDER BY first.rowid LIMIT 1)
		WHERE s.routing_goal='' AND s.deleted_at='' AND s.trust_tier='trusted'`,
		int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT))
	if err != nil {
		return err
	}
	type goal struct{ account, session, title string }
	var goals []goal
	defer rows.Close()
	for rows.Next() {
		var g goal
		var text sql.NullString
		if err := rows.Scan(&g.account, &g.session, &text); err != nil {
			return err
		}
		if strings.TrimSpace(text.String) != "" {
			g.title = deriveSessionTitle(text.String, "")
			goals = append(goals, g)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, g := range goals {
		if _, err := tx.ExecContext(ctx, "UPDATE runtime_session SET routing_goal=? WHERE account_id=? AND work_session_ref=?", g.title, g.account, g.session); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE runtime_session_milestone AS m SET summary=COALESCE((
		SELECT routing_goal FROM runtime_session s WHERE s.account_id=m.account_id
		AND s.work_session_ref=m.work_session_ref AND s.deleted_at=''), '')`)
	return err
}

func sqliteTableHasColumn(ctx context.Context, db *sql.DB, table, column string) (bool, error) {
	rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return false, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var (
			cid        int
			name       string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultVal, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

// LoadOrCreateLedgerSecret durably persists a 32-byte HMAC secret in
// runtime_session_meta so continuity ledger MACs survive Runtime restarts.
func (st *Store) LoadOrCreateLedgerSecret(ctx context.Context) ([]byte, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var encoded string
	err = tx.QueryRowContext(ctx, `SELECT value FROM runtime_session_meta WHERE key = 'ledger_secret_hex'`).Scan(&encoded)
	if err == nil && strings.TrimSpace(encoded) != "" {
		decoded, decErr := hex.DecodeString(strings.TrimSpace(encoded))
		if decErr == nil && len(decoded) >= 32 {
			return decoded, nil
		}
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_session_meta(key, value) VALUES ('ledger_secret_hex', ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		hex.EncodeToString(secret),
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return secret, nil
}

// ftsIndexedContent mirrors nimi-cognition/memoryv1's Chinese overlapping bigram
// indexer so SQLite unicode61 matches Chinese topic substrings deterministically.
func ftsIndexedContent(value string) string {
	var singles []string
	var bigrams []string
	var run []rune
	flush := func() {
		for _, ch := range run {
			singles = append(singles, string(ch))
		}
		for i := 0; i+1 < len(run); i++ {
			bigrams = append(bigrams, string(run[i:i+2]))
		}
		run = run[:0]
	}
	for _, ch := range value {
		if unicode.Is(unicode.Han, ch) {
			run = append(run, ch)
			continue
		}
		flush()
	}
	flush()
	parts := []string{strings.TrimSpace(value)}
	if len(singles) > 0 {
		parts = append(parts, strings.Join(singles, " "))
	}
	if len(bigrams) > 0 {
		parts = append(parts, strings.Join(bigrams, " "))
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

func extractSearchTokens(value string) []string {
	var tokens []string
	seen := make(map[string]struct{})
	var wordRun []rune
	var hanRun []rune
	appendToken := func(v string) {
		tok := strings.ToLower(strings.TrimSpace(v))
		if tok == "" {
			return
		}
		if _, exists := seen[tok]; exists {
			return
		}
		seen[tok] = struct{}{}
		tokens = append(tokens, tok)
	}
	flushWord := func() {
		if len(wordRun) == 0 {
			return
		}
		tok := string(wordRun)
		wordRun = wordRun[:0]
		if len([]rune(tok)) < 2 {
			return
		}
		appendToken(tok)
	}
	flushHan := func() {
		if len(hanRun) == 0 {
			return
		}
		if len(hanRun) == 1 {
			appendToken(string(hanRun))
		} else {
			for i := 0; i+1 < len(hanRun); i++ {
				appendToken(string(hanRun[i : i+2]))
			}
		}
		hanRun = hanRun[:0]
	}
	for _, ch := range value {
		switch {
		case unicode.Is(unicode.Han, ch):
			flushWord()
			hanRun = append(hanRun, ch)
		case unicode.IsLetter(ch) || unicode.IsNumber(ch):
			flushHan()
			wordRun = append(wordRun, ch)
		default:
			flushWord()
			flushHan()
		}
	}
	flushWord()
	flushHan()
	return tokens
}

func ftsQuery(value string) string {
	rawTokens := extractSearchTokens(value)
	if len(rawTokens) == 0 {
		return ""
	}
	quoted := make([]string, 0, len(rawTokens))
	for _, tok := range rawTokens {
		quoted = append(quoted, `"`+strings.ReplaceAll(tok, `"`, `""`)+`"`)
	}
	return strings.Join(quoted, " OR ")
}

func newID(prefix string) string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return prefix + "_" + hex.EncodeToString(b[:])
}

const fixedRFC3339Nano = "2006-01-02T15:04:05.000000000Z"

func formatRFC3339(t time.Time) string {
	return t.UTC().Format(fixedRFC3339Nano)
}

func parseRFC3339(raw string) time.Time {
	t, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(raw))
	if err != nil {
		return time.Time{}
	}
	return t.UTC()
}

type sessionRow struct {
	Record               *runtimev1.WorkSessionRecord
	AccountID            string
	TopicSummary         string
	ProjectionLeaseEpoch int64
	InboxTurnCount       int
	LastActiveAt         time.Time
	DeletedAt            string
}

func scanSessionRow(scanner interface{ Scan(dest ...any) error }) (*sessionRow, error) {
	rec := &runtimev1.WorkSessionRecord{}
	var (
		accountID            string
		isPrimaryCompanion   int
		isGeneralInbox       int
		topicSummary         string
		projectionLeaseEpoch int64
		inboxTurnCount       int
		lastActiveAtRaw      string
		bodyPurgePending     int
		deletedAt            string
	)
	err := scanner.Scan(
		&rec.WorkSessionRef,
		&accountID,
		&rec.AgentBinding,
		&rec.SessionKind,
		&rec.OwnerBodyKind,
		&rec.DeviceId,
		&rec.PublisherScopeKey,
		&rec.ParentSessionRef,
		&rec.ForkedFromSessionRef,
		&rec.ForkedAtSeq,
		&isPrimaryCompanion,
		&isGeneralInbox,
		&rec.Title,
		&rec.Status,
		&rec.TrustTier,
		&rec.WorkspaceRoot,
		&rec.PermissionMode,
		&rec.LatestReceiptJson,
		&topicSummary,
		&rec.ProjectionSeq,
		&projectionLeaseEpoch,
		&rec.HeadSeq,
		&inboxTurnCount,
		&lastActiveAtRaw,
		&rec.CreatedAt,
		&rec.UpdatedAt,
		&rec.ArchivedAt,
		&bodyPurgePending,
		&deletedAt,
	)
	if err != nil {
		return nil, err
	}
	rec.IsPrimaryCompanion = isPrimaryCompanion != 0
	rec.IsGeneralInbox = isGeneralInbox != 0
	rec.BodyPurgePending = bodyPurgePending != 0
	return &sessionRow{
		Record:               rec,
		AccountID:            accountID,
		TopicSummary:         topicSummary,
		ProjectionLeaseEpoch: projectionLeaseEpoch,
		InboxTurnCount:       inboxTurnCount,
		LastActiveAt:         parseRFC3339(lastActiveAtRaw),
		DeletedAt:            deletedAt,
	}, nil
}

const sessionSelectColumns = `
	work_session_ref, account_id, agent_binding, session_kind, owner_body_kind,
	device_id, publisher_scope_key, parent_session_ref, forked_from_session_ref,
	forked_at_seq, is_primary_companion, is_general_inbox, title, status,
	trust_tier, workspace_root, permission_mode, latest_receipt_json,
	topic_summary, projection_seq, projection_lease_epoch, head_seq, inbox_turn_count, last_active_at,
	created_at, updated_at, archived_at, body_purge_pending, deleted_at`

const sessionSelectColumnsRuntimeTable = `
	runtime_session.work_session_ref, runtime_session.account_id, runtime_session.agent_binding,
	runtime_session.session_kind, runtime_session.owner_body_kind, runtime_session.device_id,
	runtime_session.publisher_scope_key, runtime_session.parent_session_ref,
	runtime_session.forked_from_session_ref, runtime_session.forked_at_seq,
	runtime_session.is_primary_companion, runtime_session.is_general_inbox,
	runtime_session.title, runtime_session.status, runtime_session.trust_tier,
	runtime_session.workspace_root, runtime_session.permission_mode,
	runtime_session.latest_receipt_json, runtime_session.topic_summary,
	runtime_session.projection_seq, runtime_session.projection_lease_epoch, runtime_session.head_seq,
	runtime_session.inbox_turn_count, runtime_session.last_active_at,
	runtime_session.created_at, runtime_session.updated_at,
	runtime_session.archived_at, runtime_session.body_purge_pending,
	runtime_session.deleted_at`

func upsertSessionFTSTx(ctx context.Context, tx *sql.Tx, row *sessionRow) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_fts WHERE work_session_ref = ?`, row.Record.GetWorkSessionRef()); err != nil {
		return err
	}
	if row.DeletedAt != "" || row.Record.GetStatus() == "deleting" || row.Record.GetStatus() == "deleted" {
		return nil
	}
	wsBase := ""
	if ws := strings.TrimSpace(row.Record.GetWorkspaceRoot()); ws != "" {
		wsBase = filepath.Base(ws)
	}
	raw := strings.TrimSpace(strings.Join([]string{
		row.Record.GetTitle(),
		row.TopicSummary,
		wsBase,
	}, " "))
	if raw == "" {
		return nil
	}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO runtime_session_fts(work_session_ref, account_id, agent_binding, indexed_text) VALUES (?, ?, ?, ?)`,
		row.Record.GetWorkSessionRef(),
		row.AccountID,
		row.Record.GetAgentBinding(),
		ftsIndexedContent(raw),
	)
	return err
}

func (st *Store) GetSession(ctx context.Context, accountID, workSessionRef string) (*sessionRow, error) {
	row := st.readDB.QueryRowContext(ctx,
		`SELECT `+sessionSelectColumns+` FROM runtime_session WHERE account_id = ? AND work_session_ref = ? AND deleted_at = '' AND status NOT IN ('deleting', 'deleted')`,
		accountID, workSessionRef,
	)
	res, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errSessionNotFound
	}
	return res, err
}

// GetSessionIncludingDeleting loads a live OR in-progress 'deleting' session so
// interrupted DeleteSession calls can be retried idempotently without returning NotFound.
func (st *Store) GetSessionIncludingDeleting(ctx context.Context, accountID, workSessionRef string) (*sessionRow, error) {
	row := st.readDB.QueryRowContext(ctx,
		`SELECT `+sessionSelectColumns+` FROM runtime_session WHERE account_id = ? AND work_session_ref = ?`,
		accountID, workSessionRef,
	)
	res, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errSessionNotFound
	}
	return res, err
}

// ListDeletingSessions returns all sessions stuck in the durable 'deleting'
// transition state so startup/background recovery completes Cognition cleanup
// and PURGE_SESSION outbox enqueueing after crashes.
func (st *Store) ListDeletingSessions(ctx context.Context) ([]*sessionRow, error) {
	rows, err := st.readDB.QueryContext(ctx,
		`SELECT `+sessionSelectColumns+` FROM runtime_session WHERE status = 'deleting' OR (deleted_at <> '' AND forgotten_memory_count IS NULL) ORDER BY updated_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*sessionRow
	for rows.Next() {
		item, scanErr := scanSessionRow(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

type pendingAgentPurgeItem struct {
	AccountID    string
	AgentBinding string
}

func (st *Store) EnqueuePendingAgentPurge(ctx context.Context, accountID, agentBinding string, now time.Time) error {
	_, err := st.writeDB.ExecContext(ctx, `
		INSERT INTO runtime_pending_agent_purge(account_id, agent_binding, created_at)
		VALUES (?, ?, ?)
		ON CONFLICT(account_id, agent_binding) DO NOTHING`,
		strings.TrimSpace(accountID), strings.TrimSpace(agentBinding), formatRFC3339(now),
	)
	return err
}

func (st *Store) DeletePendingAgentPurge(ctx context.Context, accountID, agentBinding string) error {
	_, err := st.writeDB.ExecContext(ctx, `
		DELETE FROM runtime_pending_agent_purge WHERE account_id = ? AND agent_binding = ?`,
		strings.TrimSpace(accountID), strings.TrimSpace(agentBinding),
	)
	return err
}

func (st *Store) ListPendingAgentPurges(ctx context.Context) ([]pendingAgentPurgeItem, error) {
	rows, err := st.readDB.QueryContext(ctx, `
		SELECT account_id, agent_binding FROM runtime_pending_agent_purge ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []pendingAgentPurgeItem
	for rows.Next() {
		var item pendingAgentPurgeItem
		if err := rows.Scan(&item.AccountID, &item.AgentBinding); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (st *Store) ListDistinctActiveAgentBindings(ctx context.Context) ([]pendingAgentPurgeItem, error) {
	rows, err := st.readDB.QueryContext(ctx, `
		SELECT DISTINCT account_id, agent_binding FROM (
			SELECT account_id, agent_binding FROM runtime_session WHERE deleted_at = '' AND status != 'deleted'
			UNION
			SELECT account_id, agent_binding FROM runtime_session_alarm WHERE status IN ('active', 'sleeping', 'paused')
		) ORDER BY account_id, agent_binding`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []pendingAgentPurgeItem
	for rows.Next() {
		var item pendingAgentPurgeItem
		if err := rows.Scan(&item.AccountID, &item.AgentBinding); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// ListRecentBrainEvents returns the LATEST `limit` brain events in ascending
// chronological seq order (never the oldest N events!).
func (st *Store) ListRecentBrainEvents(ctx context.Context, workSessionRef string, limit int) ([]*runtimev1.BrainSessionEventEnvelope, error) {
	if limit <= 0 {
		limit = 64
	}
	rows, err := st.readDB.QueryContext(ctx, `
		SELECT work_session_ref, seq, event_id, event_type, payload_json, moved_to_work_session_ref, created_at
		FROM runtime_brain_event
		WHERE work_session_ref = ?
		ORDER BY seq DESC
		LIMIT ?`,
		workSessionRef, limit,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var desc []*runtimev1.BrainSessionEventEnvelope
	for rows.Next() {
		ev := &runtimev1.BrainSessionEventEnvelope{}
		if err := rows.Scan(&ev.WorkSessionRef, &ev.Seq, &ev.EventId, &ev.EventType, &ev.PayloadJson, &ev.MovedToWorkSessionRef, &ev.CreatedAt); err != nil {
			return nil, err
		}
		desc = append(desc, ev)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i, j := 0, len(desc)-1; i < j; i, j = i+1, j-1 {
		desc[i], desc[j] = desc[j], desc[i]
	}
	return desc, nil
}

type readerVisibilityFilter struct {
	FullAccount      bool
	IncludeCompanion bool
	SubjectScopeKey  string
	ChannelPrefix    string
}

func encodeSessionPageToken(updatedAt, workSessionRef string) string {
	raw, _ := json.Marshal(struct {
		UpdatedAt      string `json:"u"`
		WorkSessionRef string `json:"r"`
	}{UpdatedAt: updatedAt, WorkSessionRef: workSessionRef})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeSessionPageToken(token string) (updatedAt, workSessionRef string, ok bool) {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return "", "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(trimmed)
	if err != nil {
		return "", "", false
	}
	var cursor struct {
		UpdatedAt      string `json:"u"`
		WorkSessionRef string `json:"r"`
	}
	if err := json.Unmarshal(raw, &cursor); err != nil || cursor.UpdatedAt == "" || cursor.WorkSessionRef == "" {
		return "", "", false
	}
	return cursor.UpdatedAt, cursor.WorkSessionRef, true
}

func (st *Store) ListSessions(ctx context.Context, accountID, agentBinding string, includeArchived bool, sessionKinds []string, statusFilter string, searchQuery string, visibility readerVisibilityFilter, pageSize int, pageToken string) ([]*sessionRow, int32, string, error) {
	var args []any
	var where []string
	where = append(where, `account_id = ?`, `deleted_at = ''`, `status != 'deleting'`, `status != 'deleted'`)
	args = append(args, accountID)
	if !visibility.FullAccount {
		var scopeParts []string
		if visibility.IncludeCompanion {
			scopeParts = append(scopeParts, `(session_kind = 'companion' OR is_primary_companion = 1)`)
		}
		if strings.TrimSpace(visibility.SubjectScopeKey) != "" {
			scopeParts = append(scopeParts, `publisher_scope_key = ?`)
			args = append(args, strings.TrimSpace(visibility.SubjectScopeKey))
		}
		if strings.TrimSpace(visibility.ChannelPrefix) != "" {
			scopeParts = append(scopeParts, `substr(publisher_scope_key, 1, length(?)) = ?`)
			prefix := strings.TrimSpace(visibility.ChannelPrefix)
			args = append(args, prefix, prefix)
		}
		if len(scopeParts) == 0 {
			where = append(where, `1 = 0`)
		} else {
			where = append(where, `(`+strings.Join(scopeParts, " OR ")+`)`)
		}
	}
	if strings.TrimSpace(agentBinding) != "" {
		where = append(where, `agent_binding = ?`)
		args = append(args, strings.TrimSpace(agentBinding))
	}
	if !includeArchived {
		where = append(where, `archived_at = ''`)
	}
	if strings.TrimSpace(statusFilter) != "" {
		where = append(where, `status = ?`)
		args = append(args, strings.TrimSpace(statusFilter))
	}
	if len(sessionKinds) > 0 {
		placeholders := make([]string, len(sessionKinds))
		for i, k := range sessionKinds {
			placeholders[i] = "?"
			args = append(args, strings.TrimSpace(k))
		}
		where = append(where, `session_kind IN (`+strings.Join(placeholders, ",")+`)`)
	}
	if q := strings.TrimSpace(searchQuery); q != "" {
		fq := ftsQuery(q)
		if fq != "" {
			where = append(where, `work_session_ref IN (SELECT work_session_ref FROM runtime_session_fts WHERE account_id = ? AND indexed_text MATCH ?)`)
			args = append(args, accountID, fq)
		}
	}
	whereClause := strings.Join(where, " AND ")
	var totalVisible int32
	if err := st.readDB.QueryRowContext(ctx, `SELECT COUNT(1) FROM runtime_session WHERE `+whereClause, args...).Scan(&totalVisible); err != nil {
		return nil, 0, "", err
	}
	limit := pageSize
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	pageWhere := append([]string(nil), where...)
	pageArgs := append([]any(nil), args...)
	if curUpdated, curRef, ok := decodeSessionPageToken(pageToken); ok {
		pageWhere = append(pageWhere, `(updated_at < ? OR (updated_at = ? AND work_session_ref < ?))`)
		pageArgs = append(pageArgs, curUpdated, curUpdated, curRef)
	}
	pageArgs = append(pageArgs, limit+1)
	query := `SELECT ` + sessionSelectColumns + ` FROM runtime_session WHERE ` + strings.Join(pageWhere, " AND ") + ` ORDER BY updated_at DESC, work_session_ref DESC LIMIT ?`
	rows, err := st.readDB.QueryContext(ctx, query, pageArgs...)
	if err != nil {
		return nil, 0, "", err
	}
	defer func() { _ = rows.Close() }()
	var out []*sessionRow
	for rows.Next() {
		item, err := scanSessionRow(rows)
		if err != nil {
			return nil, 0, "", err
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, "", err
	}
	nextToken := ""
	if len(out) > limit {
		out = out[:limit]
		last := out[len(out)-1]
		nextToken = encodeSessionPageToken(last.Record.GetUpdatedAt(), last.Record.GetWorkSessionRef())
	}
	return out, totalVisible, nextToken, nil
}

type ftsMatch struct {
	Row   *sessionRow
	Score float64
}

// QueryFTSCandidates runs strictly against the read-only pool OUTSIDE any write
// transaction so FTS5 BM25 matching never holds SQLite's single writer lock.
func (st *Store) QueryFTSCandidates(ctx context.Context, accountID, agentBinding, inputText string, limit int) ([]ftsMatch, error) {
	if limit <= 0 {
		limit = 5
	}
	fq := ftsQuery(inputText)
	if fq == "" {
		return nil, nil
	}
	rows, err := st.readDB.QueryContext(ctx, `
		SELECT `+sessionSelectColumnsRuntimeTable+`, bm25(runtime_session_fts) AS rank
		FROM runtime_session_fts
		JOIN runtime_session USING (work_session_ref)
		WHERE runtime_session_fts.account_id = ?
		  AND runtime_session_fts.agent_binding = ?
		  AND runtime_session.deleted_at = ''
		  AND runtime_session.archived_at = ''
		  AND runtime_session.status NOT IN ('deleting', 'deleted', 'archived')
		  AND runtime_session.is_general_inbox = 0
		  AND runtime_session.session_kind != 'channel_external'
		  AND runtime_session_fts.indexed_text MATCH ?
		ORDER BY rank ASC, runtime_session.updated_at DESC
		LIMIT ?`,
		accountID, agentBinding, fq, limit,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var matches []ftsMatch
	for rows.Next() {
		rec := &runtimev1.WorkSessionRecord{}
		var (
			accID                string
			isPrimaryCompanion   int
			isGeneralInbox       int
			topicSummary         string
			projectionLeaseEpoch int64
			inboxTurnCount       int
			lastActiveAtRaw      string
			bodyPurgePending     int
			deletedAt            string
			rank                 float64
		)
		if err := rows.Scan(
			&rec.WorkSessionRef,
			&accID,
			&rec.AgentBinding,
			&rec.SessionKind,
			&rec.OwnerBodyKind,
			&rec.DeviceId,
			&rec.PublisherScopeKey,
			&rec.ParentSessionRef,
			&rec.ForkedFromSessionRef,
			&rec.ForkedAtSeq,
			&isPrimaryCompanion,
			&isGeneralInbox,
			&rec.Title,
			&rec.Status,
			&rec.TrustTier,
			&rec.WorkspaceRoot,
			&rec.PermissionMode,
			&rec.LatestReceiptJson,
			&topicSummary,
			&rec.ProjectionSeq,
			&projectionLeaseEpoch,
			&rec.HeadSeq,
			&inboxTurnCount,
			&lastActiveAtRaw,
			&rec.CreatedAt,
			&rec.UpdatedAt,
			&rec.ArchivedAt,
			&bodyPurgePending,
			&deletedAt,
			&rank,
		); err != nil {
			return nil, err
		}
		rec.IsPrimaryCompanion = isPrimaryCompanion != 0
		rec.IsGeneralInbox = isGeneralInbox != 0
		rec.BodyPurgePending = bodyPurgePending != 0
		// Combine SQLite FTS5 BM25 rank with deterministic query-bigram overlap so
		// small corpora (e.g. N=2 where SQLite FTS5 BM25 IDF ln((2-1+0.5)/(1+0.5)) == 0)
		// still produce accurate calibrated confidence scores.
		absRank := -rank
		if absRank < 0 {
			absRank = 0
		}
		bm25Score := absRank / (absRank + 1.0)
		queryTokens := extractSearchTokens(inputText)
		docText := strings.Join([]string{rec.GetTitle(), topicSummary, filepath.Base(strings.TrimSpace(rec.GetWorkspaceRoot()))}, " ")
		docTokenList := extractSearchTokens(docText)
		docTokenSet := make(map[string]struct{}, len(docTokenList))
		for _, tok := range docTokenList {
			docTokenSet[tok] = struct{}{}
		}
		matchedCount := 0
		for _, tok := range queryTokens {
			if _, ok := docTokenSet[tok]; ok {
				matchedCount++
			}
		}
		tokenRecall := 0.0
		if len(queryTokens) > 0 {
			tokenRecall = float64(matchedCount) / float64(len(queryTokens))
		}
		score := tokenRecall
		if bm25Score > 0 {
			score = 0.65*tokenRecall + 0.35*bm25Score
		}
		if matchedCount >= 3 && score < 0.72 {
			score = 0.68 + 0.20*tokenRecall
		}
		normInput := strings.ToLower(strings.TrimSpace(inputText))
		normTitle := strings.ToLower(strings.TrimSpace(rec.GetTitle()))
		if normTitle != "" && (strings.Contains(normInput, normTitle) || strings.Contains(normTitle, normInput)) {
			score = 0.92
		}
		matches = append(matches, ftsMatch{
			Row: &sessionRow{
				Record:         rec,
				AccountID:      accID,
				TopicSummary:   topicSummary,
				InboxTurnCount: inboxTurnCount,
				LastActiveAt:   parseRFC3339(lastActiveAtRaw),
				DeletedAt:      deletedAt,
			},
			Score: score,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].Score != matches[j].Score {
			return matches[i].Score > matches[j].Score
		}
		return matches[i].Row.Record.GetUpdatedAt() > matches[j].Row.Record.GetUpdatedAt()
	})
	return matches, nil
}

// FindActiveSessionByWorkspace looks up an active pc_work session bound to the exact workspace root.
func (st *Store) FindActiveSessionByWorkspace(ctx context.Context, accountID, agentBinding, workspaceRoot string) (*sessionRow, error) {
	rows, err := st.readDB.QueryContext(ctx,
		`SELECT `+sessionSelectColumns+` FROM runtime_session
		 WHERE account_id = ? AND agent_binding = ? AND workspace_root = ?
		   AND session_kind = 'pc_work' AND deleted_at = '' AND archived_at = ''
		   AND status NOT IN ('deleting', 'deleted', 'archived')
		 ORDER BY updated_at DESC LIMIT 2`,
		accountID, agentBinding, workspaceRoot,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var found []*sessionRow
	for rows.Next() {
		item, err := scanSessionRow(rows)
		if err != nil {
			return nil, err
		}
		found = append(found, item)
	}
	if len(found) == 1 {
		return found[0], nil
	}
	return nil, nil
}

// FindActiveGeneralInbox returns the active general_inbox session visible to
// filter if still within the 2h / 10-turn sliding window.
func (st *Store) FindActiveGeneralInbox(ctx context.Context, accountID, agentBinding string, filter readerVisibilityFilter, now time.Time) (*sessionRow, error) {
	query := `SELECT ` + sessionSelectColumns + ` FROM runtime_session
		 WHERE account_id = ? AND agent_binding = ? AND is_general_inbox = 1
		   AND deleted_at = '' AND archived_at = '' AND status NOT IN ('deleting', 'deleted', 'archived')`
	args := []any{accountID, agentBinding}
	if !filter.FullAccount {
		query += ` AND publisher_scope_key = ?`
		args = append(args, filter.SubjectScopeKey)
	}
	query += ` ORDER BY updated_at DESC LIMIT 1`
	row := st.readDB.QueryRowContext(ctx, query, args...)
	item, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if item.InboxTurnCount >= 10 || now.Sub(item.LastActiveAt) > 2*time.Hour {
		return nil, nil
	}
	return item, nil
}

// FindActiveExternalChannelSession isolates external channel peers cleanly.
func (st *Store) FindActiveExternalChannelSession(ctx context.Context, accountID, agentBinding, scopeKey string) (*sessionRow, error) {
	row := st.readDB.QueryRowContext(ctx,
		`SELECT `+sessionSelectColumns+` FROM runtime_session
		 WHERE account_id = ? AND agent_binding = ? AND session_kind = 'channel_external'
		   AND publisher_scope_key = ? AND deleted_at = '' AND archived_at = ''
		   AND status NOT IN ('deleting', 'deleted', 'archived')
		 ORDER BY updated_at DESC LIMIT 1`,
		accountID, agentBinding, scopeKey,
	)
	item, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return item, err
}

const lookupSubmissionSQL = `SELECT payload_hash, resolved_work_session_ref, outcome, route_reason, session_kind,
	owner_body_kind, effective_permission_mode, outbox_id, promoted_handoff_turns, split_record
	FROM runtime_session_submission WHERE account_id = ? AND caller_subject = ? AND client_submission_id = ?`

func readSubmissionReceipt(row *sql.Row, payloadHash string) (*runtimev1.RouteAndSubmitInputResponse, error) {
	var storedHash string
	var outcome int32
	var splitRecord []byte
	resp := &runtimev1.RouteAndSubmitInputResponse{Deduplicated: true}
	err := row.Scan(&storedHash, &resp.ResolvedWorkSessionRef, &outcome, &resp.RouteReason, &resp.SessionKind,
		&resp.OwnerBodyKind, &resp.EffectivePermissionMode, &resp.OutboxId, &resp.PromotedHandoffTurns, &splitRecord)
	if err != nil {
		return nil, err
	}
	if storedHash != "" && payloadHash != "" && storedHash != payloadHash {
		return nil, errSubmissionPayloadConflict
	}
	resp.Outcome = runtimev1.RouteAndSubmitOutcome(outcome)
	if len(splitRecord) > 0 {
		resp.WorkSessionRecord = &runtimev1.WorkSessionRecord{}
		if err := json.Unmarshal(splitRecord, resp.WorkSessionRecord); err != nil {
			return nil, err
		}
	}
	return resp, nil
}

func (st *Store) LookupSubmission(ctx context.Context, accountID, callerSubject, requestID, payloadHash string) (*runtimev1.RouteAndSubmitInputResponse, error) {
	if strings.TrimSpace(requestID) == "" {
		return nil, nil
	}
	row := st.readDB.QueryRowContext(ctx, lookupSubmissionSQL, accountID, callerSubject, requestID)
	resp, err := readSubmissionReceipt(row, payloadHash)
	if errors.Is(err, sql.ErrNoRows) {
		// Fail closed on migrated v1 legacy submission tombstones (caller_subject == '')
		// so pre-upgrade client_submission_id retries never execute a duplicate business action.
		if callerSubject != "" {
			var legacyExists int
			legErr := st.readDB.QueryRowContext(ctx, `
				SELECT 1 FROM runtime_session_submission
				WHERE account_id = ? AND caller_subject = '' AND client_submission_id = ?`,
				accountID, requestID,
			).Scan(&legacyExists)
			if legErr == nil {
				return nil, errSubmissionPayloadConflict
			}
			if !errors.Is(legErr, sql.ErrNoRows) {
				return nil, legErr
			}
		}
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if resp.WorkSessionRecord == nil {
		if sess, err := st.GetSession(ctx, accountID, resp.ResolvedWorkSessionRef); err == nil && sess != nil {
			resp.WorkSessionRecord = sess.Record
		}
	}
	return resp, nil
}

type routedCommitInput struct {
	AccountID                string
	CallerSubject            string
	ClientSubmissionID       string
	SubmissionPayloadHash    string
	Session                  *sessionRow
	ExistingSessionUpdate    bool
	ExplicitPermissionChange bool
	CloseSourceInboxRef      string
	MoveSourceEventSession   string
	MoveSourceEventSeq       int64
	Outcome                  runtimev1.RouteAndSubmitOutcome
	RouteReason              string
	OutboxEnvelope           *runtimev1.BodyOutboxEnvelope
	OutboxPayloadHash        string
	BrainEvent               *runtimev1.BrainSessionEventEnvelope
	PromotedTurns            int32
	Now                      time.Time
}

func (st *Store) CommitRoutedSubmission(ctx context.Context, in routedCommitInput) (*runtimev1.RouteAndSubmitInputResponse, bool, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = tx.Rollback() }()

	// Atomic idempotency check inside the BEGIN IMMEDIATE transaction, scoped by
	// (account_id, caller_subject, client_submission_id) with payload_hash conflict detection.
	if in.ClientSubmissionID != "" {
		row := tx.QueryRowContext(ctx, lookupSubmissionSQL, in.AccountID, in.CallerSubject, in.ClientSubmissionID)
		receipt, err := readSubmissionReceipt(row, in.SubmissionPayloadHash)
		if err == nil {
			return receipt, true, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, false, err
		}
	}

	if in.MoveSourceEventSession != "" {
		var live int
		err := tx.QueryRowContext(ctx, `SELECT 1 FROM runtime_session WHERE account_id=? AND work_session_ref=?
			AND deleted_at='' AND status NOT IN ('deleting','deleted')`, in.AccountID, in.MoveSourceEventSession).Scan(&live)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, false, errSessionNotFound
		}
		if err != nil {
			return nil, false, err
		}
	}

	rec := in.Session.Record
	nowStr := formatRFC3339(in.Now)

	var (
		liveStatus         string
		liveDeletedAt      string
		liveHeadSeq        int64
		liveInboxCount     int
		liveProjSeq        int64
		liveProjEpoch      int64
		liveReceiptJSON    string
		liveCreatedAt      string
		livePermissionMode string
	)
	existsErr := tx.QueryRowContext(ctx, `
		SELECT status, deleted_at, head_seq, inbox_turn_count, projection_seq, projection_lease_epoch, latest_receipt_json, created_at, permission_mode
		FROM runtime_session
		WHERE account_id = ? AND work_session_ref = ?`,
		in.AccountID, rec.WorkSessionRef,
	).Scan(&liveStatus, &liveDeletedAt, &liveHeadSeq, &liveInboxCount, &liveProjSeq, &liveProjEpoch, &liveReceiptJSON, &liveCreatedAt, &livePermissionMode)
	if existsErr == nil {
		if liveDeletedAt != "" || liveStatus == "deleting" || liveStatus == "deleted" {
			return nil, false, errSessionNotFound
		}
		rec.HeadSeq = liveHeadSeq
		rec.ProjectionSeq = liveProjSeq
		in.Session.ProjectionLeaseEpoch = liveProjEpoch
		if in.ExistingSessionUpdate && !in.ExplicitPermissionChange && livePermissionMode != "" {
			rec.PermissionMode = livePermissionMode
		}
		if liveReceiptJSON != "" {
			rec.LatestReceiptJson = liveReceiptJSON
		}
		if liveCreatedAt != "" {
			rec.CreatedAt = liveCreatedAt
		}
		if rec.IsGeneralInbox {
			in.Session.InboxTurnCount = liveInboxCount + 1
		}
	} else if errors.Is(existsErr, sql.ErrNoRows) {
		if in.ExistingSessionUpdate {
			return nil, false, errSessionNotFound
		}
	} else {
		return nil, false, existsErr
	}

	if rec.CreatedAt == "" {
		rec.CreatedAt = nowStr
	}
	rec.UpdatedAt = nowStr
	if in.BrainEvent != nil {
		rec.HeadSeq++
		in.BrainEvent.Seq = rec.HeadSeq
		in.BrainEvent.WorkSessionRef = rec.WorkSessionRef
		if in.BrainEvent.CreatedAt == "" {
			in.BrainEvent.CreatedAt = nowStr
		}
		if in.BrainEvent.EventId == "" {
			in.BrainEvent.EventId = newID("ev")
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_brain_event(work_session_ref, seq, event_id, event_type, payload_json, moved_to_work_session_ref, created_at)
			VALUES (?, ?, ?, ?, ?, '', ?)`,
			in.BrainEvent.WorkSessionRef, in.BrainEvent.Seq, in.BrainEvent.EventId,
			in.BrainEvent.EventType, in.BrainEvent.PayloadJson, in.BrainEvent.CreatedAt,
		); err != nil {
			return nil, false, err
		}
	}

	isPrimary := 0
	if rec.IsPrimaryCompanion {
		isPrimary = 1
	}
	isInbox := 0
	if rec.IsGeneralInbox {
		isInbox = 1
	}
	purgePending := 0
	if rec.BodyPurgePending {
		purgePending = 1
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_session(
			work_session_ref, account_id, agent_binding, session_kind, owner_body_kind,
			device_id, publisher_scope_key, parent_session_ref, forked_from_session_ref,
			forked_at_seq, is_primary_companion, is_general_inbox, title, status,
			trust_tier, workspace_root, permission_mode, latest_receipt_json,
			topic_summary, projection_seq, projection_lease_epoch, head_seq, inbox_turn_count, last_active_at,
			created_at, updated_at, archived_at, body_purge_pending, deleted_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
		ON CONFLICT(work_session_ref) DO UPDATE SET
			device_id = CASE WHEN excluded.device_id != '' THEN excluded.device_id ELSE runtime_session.device_id END,
			status = excluded.status,
			permission_mode = excluded.permission_mode,
			head_seq = excluded.head_seq,
			inbox_turn_count = excluded.inbox_turn_count,
			last_active_at = excluded.last_active_at,
			updated_at = excluded.updated_at`,
		rec.WorkSessionRef, in.AccountID, rec.AgentBinding, rec.SessionKind, rec.OwnerBodyKind,
		rec.DeviceId, rec.PublisherScopeKey, rec.ParentSessionRef, rec.ForkedFromSessionRef,
		rec.ForkedAtSeq, isPrimary, isInbox, rec.Title, rec.Status,
		rec.TrustTier, rec.WorkspaceRoot, rec.PermissionMode, rec.LatestReceiptJson,
		in.Session.TopicSummary, rec.ProjectionSeq, in.Session.ProjectionLeaseEpoch, rec.HeadSeq, in.Session.InboxTurnCount, nowStr,
		rec.CreatedAt, rec.UpdatedAt, rec.ArchivedAt, purgePending,
	); err != nil {
		return nil, false, err
	}
	if err := upsertSessionFTSTx(ctx, tx, in.Session); err != nil {
		return nil, false, err
	}

	if strings.TrimSpace(in.CloseSourceInboxRef) != "" {
		res, err := tx.ExecContext(ctx, `
			UPDATE runtime_session
			SET status = 'promoted', archived_at = ?, updated_at = ?
			WHERE account_id = ? AND work_session_ref = ? AND is_general_inbox = 1 AND status = 'active' AND deleted_at = ''`,
			nowStr, nowStr, in.AccountID, strings.TrimSpace(in.CloseSourceInboxRef),
		)
		if err != nil {
			return nil, false, err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return nil, false, errSessionConflict
		}
	}

	if strings.TrimSpace(in.MoveSourceEventSession) != "" && in.MoveSourceEventSeq > 0 {
		if _, err := tx.ExecContext(ctx, `
			UPDATE runtime_brain_event
			SET moved_to_work_session_ref = ?
			WHERE work_session_ref = ? AND seq = ?`,
			rec.WorkSessionRef, strings.TrimSpace(in.MoveSourceEventSession), in.MoveSourceEventSeq,
		); err != nil {
			return nil, false, err
		}
	}

	outboxID := ""
	if in.OutboxEnvelope != nil {
		outboxID = in.OutboxEnvelope.OutboxId
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_body_outbox(
				outbox_id, account_id, device_id, capability_namespace, work_session_ref,
				agent_binding, command_kind, payload_json, payload_hash, state, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
			in.OutboxEnvelope.OutboxId, in.AccountID, in.OutboxEnvelope.DeviceId,
			in.OutboxEnvelope.CapabilityNamespace, in.OutboxEnvelope.WorkSessionRef,
			in.OutboxEnvelope.AgentBinding, int32(in.OutboxEnvelope.CommandKind),
			in.OutboxEnvelope.PayloadJson, in.OutboxPayloadHash, in.OutboxEnvelope.CreatedAt,
		); err != nil {
			return nil, false, err
		}
	}

	if in.ClientSubmissionID != "" {
		var splitRecord []byte
		if in.RouteReason == "split_or_redirect" {
			splitRecord, err = json.Marshal(rec)
			if err != nil {
				return nil, false, err
			}
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_session_submission(
				account_id, caller_subject, client_submission_id, payload_hash, resolved_work_session_ref, outcome,
				route_reason, session_kind, owner_body_kind, effective_permission_mode,
				outbox_id, promoted_handoff_turns, created_at, split_record
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			in.AccountID, in.CallerSubject, in.ClientSubmissionID, in.SubmissionPayloadHash, rec.WorkSessionRef, int32(in.Outcome),
			in.RouteReason, rec.SessionKind, rec.OwnerBodyKind, rec.PermissionMode,
			outboxID, in.PromotedTurns, nowStr, splitRecord,
		); err != nil {
			return nil, false, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	return &runtimev1.RouteAndSubmitInputResponse{
		Outcome:                 in.Outcome,
		ResolvedWorkSessionRef:  rec.WorkSessionRef,
		RouteReason:             in.RouteReason,
		SessionKind:             rec.SessionKind,
		OwnerBodyKind:           rec.OwnerBodyKind,
		EffectivePermissionMode: rec.PermissionMode,
		OutboxId:                outboxID,
		Deduplicated:            false,
		PromotedHandoffTurns:    in.PromotedTurns,
		WorkSessionRecord:       rec,
	}, false, nil
}

func (st *Store) ListBrainEvents(ctx context.Context, workSessionRef string, afterSeq int64, maxSeq int64, limit int) ([]*runtimev1.BrainSessionEventEnvelope, error) {
	if limit <= 0 {
		limit = 200
	}
	var (
		rows *sql.Rows
		err  error
	)
	if maxSeq > 0 {
		rows, err = st.readDB.QueryContext(ctx, `
			SELECT work_session_ref, seq, event_id, event_type, payload_json, created_at, moved_to_work_session_ref
			FROM runtime_brain_event
			WHERE work_session_ref = ? AND seq > ? AND seq <= ? AND moved_to_work_session_ref = ''
			ORDER BY seq ASC LIMIT ?`,
			workSessionRef, afterSeq, maxSeq, limit,
		)
	} else {
		rows, err = st.readDB.QueryContext(ctx, `
			SELECT work_session_ref, seq, event_id, event_type, payload_json, created_at, moved_to_work_session_ref
			FROM runtime_brain_event
			WHERE work_session_ref = ? AND seq > ?
			ORDER BY seq ASC LIMIT ?`,
			workSessionRef, afterSeq, limit,
		)
	}
	return scanBrainEvents(rows, err)
}

func (st *Store) listRecentBrainEvents(ctx context.Context, ref string, limit int) ([]*runtimev1.BrainSessionEventEnvelope, error) {
	return scanBrainEvents(st.readDB.QueryContext(ctx, `SELECT * FROM (
		SELECT work_session_ref, seq, event_id, event_type, payload_json, created_at, moved_to_work_session_ref
		FROM runtime_brain_event WHERE work_session_ref = ? ORDER BY seq DESC LIMIT ?
	) ORDER BY seq ASC`, ref, limit))
}

func scanBrainEvents(rows *sql.Rows, err error) ([]*runtimev1.BrainSessionEventEnvelope, error) {
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*runtimev1.BrainSessionEventEnvelope
	for rows.Next() {
		ev := &runtimev1.BrainSessionEventEnvelope{}
		if err := rows.Scan(
			&ev.WorkSessionRef, &ev.Seq, &ev.EventId, &ev.EventType,
			&ev.PayloadJson, &ev.CreatedAt, &ev.MovedToWorkSessionRef,
		); err != nil {
			return nil, err
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

func (st *Store) AppendBrainEvent(ctx context.Context, accountID, workSessionRef, eventType, payloadJSON string, now time.Time) (*runtimev1.BrainSessionEventEnvelope, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var headSeq int64
	err = tx.QueryRowContext(ctx, `SELECT head_seq FROM runtime_session WHERE account_id = ? AND work_session_ref = ? AND deleted_at = '' AND status NOT IN ('deleting', 'deleted')`, accountID, workSessionRef).Scan(&headSeq)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	nextSeq := headSeq + 1
	nowStr := formatRFC3339(now)
	ev := &runtimev1.BrainSessionEventEnvelope{
		WorkSessionRef: workSessionRef,
		Seq:            nextSeq,
		EventId:        newID("ev"),
		EventType:      eventType,
		PayloadJson:    payloadJSON,
		CreatedAt:      nowStr,
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_brain_event(work_session_ref, seq, event_id, event_type, payload_json, moved_to_work_session_ref, created_at)
		VALUES (?, ?, ?, ?, ?, '', ?)`,
		ev.WorkSessionRef, ev.Seq, ev.EventId, ev.EventType, ev.PayloadJson, ev.CreatedAt,
	); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE runtime_session SET head_seq = ?, updated_at = ?, last_active_at = ? WHERE work_session_ref = ? AND deleted_at = '' AND status NOT IN ('deleting', 'deleted')`, nextSeq, nowStr, nowStr, workSessionRef); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return ev, nil
}

func (st *Store) MarkBrainEventMovedTo(ctx context.Context, workSessionRef string, seq int64, targetRef string) error {
	_, err := st.writeDB.ExecContext(ctx, `
		UPDATE runtime_brain_event SET moved_to_work_session_ref = ?
		WHERE work_session_ref = ? AND seq = ?`,
		targetRef, workSessionRef, seq,
	)
	return err
}

func (st *Store) UpdateSessionFields(ctx context.Context, accountID string, req *runtimev1.UpdateSessionRequest, now time.Time) (*sessionRow, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	row := tx.QueryRowContext(ctx, `SELECT `+sessionSelectColumns+` FROM runtime_session WHERE account_id = ? AND work_session_ref = ? AND deleted_at = '' AND status NOT IN ('deleting', 'deleted')`, accountID, req.GetWorkSessionRef())
	existing, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	nowStr := formatRFC3339(now)
	if req.Title != nil {
		existing.Record.Title = strings.TrimSpace(req.GetTitle())
	}
	if req.Status != nil {
		existing.Record.Status = strings.TrimSpace(req.GetStatus())
	}
	if req.PermissionMode != nil {
		existing.Record.PermissionMode = strings.TrimSpace(req.GetPermissionMode())
	}
	if req.WorkspaceRoot != nil {
		existing.Record.WorkspaceRoot = strings.TrimSpace(req.GetWorkspaceRoot())
	}
	if req.Archived != nil {
		if req.GetArchived() {
			existing.Record.ArchivedAt = nowStr
			existing.Record.Status = "archived"
		} else {
			existing.Record.ArchivedAt = ""
			if existing.Record.Status == "archived" {
				existing.Record.Status = "active"
			}
		}
	}
	existing.Record.UpdatedAt = nowStr
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_session SET title = ?, status = ?, permission_mode = ?, workspace_root = ?, archived_at = ?, updated_at = ?
		WHERE work_session_ref = ?`,
		existing.Record.Title, existing.Record.Status, existing.Record.PermissionMode,
		existing.Record.WorkspaceRoot, existing.Record.ArchivedAt, nowStr, existing.Record.WorkSessionRef,
	); err != nil {
		return nil, err
	}
	if err := upsertSessionFTSTx(ctx, tx, existing); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return existing, nil
}

// MarkSessionDeleting establishes the irreversible sessions.db deletion fence
// BEFORE Cognition memory neutralization/forgetting runs, preventing concurrent
// projections, milestones, alarms, or Body NEW_INTENTs from resurrecting it.
func (st *Store) MarkSessionDeleting(ctx context.Context, accountID, workSessionRef string, now time.Time) (*sessionRow, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	row := tx.QueryRowContext(ctx, `SELECT `+sessionSelectColumns+` FROM runtime_session WHERE account_id = ? AND work_session_ref = ? AND deleted_at = ''`, accountID, workSessionRef)
	existing, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errSessionNotFound
	}
	if err != nil {
		return nil, err
	}
	nowStr := formatRFC3339(now)
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_session
		SET status = 'deleting', updated_at = ?
		WHERE account_id = ? AND work_session_ref = ? AND deleted_at = ''`,
		nowStr, accountID, workSessionRef,
	); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_fts WHERE work_session_ref = ?`, workSessionRef); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_pending_attention WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_body_outbox
		SET state = 'cancelled', result_state = 'session_deleted', acked_at = ?
		WHERE account_id = ? AND work_session_ref = ? AND state = 'pending' AND command_kind = ?`,
		nowStr, accountID, workSessionRef, int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT),
	); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_session_alarm
		SET status = 'cancelled', version = version + 1, updated_at = ?
		WHERE account_id = ? AND target_work_session_ref = ? AND status IN ('active', 'sleeping', 'paused')`,
		nowStr, accountID, workSessionRef,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	existing.Record.Status = "deleting"
	existing.Record.UpdatedAt = nowStr
	return existing, nil
}

func (st *Store) MarkSessionDeletedAndEnqueuePurge(ctx context.Context, accountID, workSessionRef string, now time.Time) (*sessionRow, *runtimev1.BodyOutboxEnvelope, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	row := tx.QueryRowContext(ctx, `SELECT `+sessionSelectColumns+` FROM runtime_session WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef)
	existing, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, errSessionNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	if existing.DeletedAt != "" {
		return existing, nil, nil
	}
	nowStr := formatRFC3339(now)
	needsBodyPurge := existing.Record.OwnerBodyKind != "" && existing.Record.OwnerBodyKind != "brain"
	purgePending := 0
	if needsBodyPurge {
		purgePending = 1
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_session
		SET status = 'deleted', deleted_at = ?, updated_at = ?, body_purge_pending = ?
		WHERE account_id = ? AND work_session_ref = ?`,
		nowStr, nowStr, purgePending, accountID, workSessionRef,
	); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_fts WHERE work_session_ref = ?`, workSessionRef); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_pending_attention WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_milestone WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_body_continuity_ledger WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_body_issued_tool_call WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM runtime_body_memory_read WHERE account_id=? AND work_session_ref=?", accountID, workSessionRef); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_body_step_journal WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_body_outbox
		SET state = 'cancelled', result_state = 'session_deleted', acked_at = ?
		WHERE account_id = ? AND work_session_ref = ? AND state = 'pending' AND command_kind = ?`,
		nowStr, accountID, workSessionRef, int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT),
	); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_session_alarm
		SET status = 'cancelled', version = version + 1, updated_at = ?
		WHERE account_id = ? AND target_work_session_ref = ? AND status IN ('active', 'sleeping', 'paused')`,
		nowStr, accountID, workSessionRef,
	); err != nil {
		return nil, nil, err
	}

	var purgeEnv *runtimev1.BodyOutboxEnvelope
	if needsBodyPurge {
		deviceID := existing.Record.DeviceId
		if deviceID == "" {
			deviceID = "local-default"
		}
		purgeEnv = &runtimev1.BodyOutboxEnvelope{
			OutboxId:            newID("outbox"),
			DeviceId:            deviceID,
			CapabilityNamespace: existing.Record.OwnerBodyKind,
			WorkSessionRef:      workSessionRef,
			CommandKind:         runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_SESSION,
			PayloadJson:         fmt.Sprintf(`{"workSessionRef":%q,"reason":"session_deleted"}`, workSessionRef),
			CreatedAt:           nowStr,
			AgentBinding:        existing.Record.AgentBinding,
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_body_outbox(
				outbox_id, account_id, device_id, capability_namespace, work_session_ref,
				agent_binding, command_kind, payload_json, payload_hash, state, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 'pending', ?)`,
			purgeEnv.OutboxId, accountID, purgeEnv.DeviceId, purgeEnv.CapabilityNamespace,
			purgeEnv.WorkSessionRef, purgeEnv.AgentBinding, int32(purgeEnv.CommandKind),
			purgeEnv.PayloadJson, nowStr,
		); err != nil {
			return nil, nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	existing.Record.Status = "deleted"
	existing.Record.BodyPurgePending = needsBodyPurge
	existing.DeletedAt = nowStr
	return existing, purgeEnv, nil
}

type purgedSessionMeta struct {
	WorkSessionRef    string
	SessionKind       string
	PublisherScopeKey string
}

// PurgeAgentSessionsAndAlarms cascades TerminateAgent into sessions.db:
// marks all sessions for the agent deleted, cancels all its alarms, neutralizes
// pending NEW_INTENTs, and enqueues PURGE_AGENT tombstones for affected Body carriers.
func (st *Store) PurgeAgentSessionsAndAlarms(ctx context.Context, accountID, agentBinding string, now time.Time) ([]purgedSessionMeta, []*runtimev1.BodyOutboxEnvelope, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	nowStr := formatRFC3339(now)
	rows, err := tx.QueryContext(ctx, `
		SELECT work_session_ref, session_kind, publisher_scope_key, owner_body_kind, device_id
		FROM runtime_session
		WHERE account_id = ? AND agent_binding = ? AND deleted_at = ''`,
		accountID, agentBinding,
	)
	if err != nil {
		return nil, nil, err
	}
	type targetCarrier struct{ deviceID, ns string }
	carriers := make(map[targetCarrier]struct{})
	var deletedMetas []purgedSessionMeta
	for rows.Next() {
		var ref, kind, scopeKey, ns, dev string
		if err := rows.Scan(&ref, &kind, &scopeKey, &ns, &dev); err != nil {
			_ = rows.Close()
			return nil, nil, err
		}
		deletedMetas = append(deletedMetas, purgedSessionMeta{
			WorkSessionRef:    ref,
			SessionKind:       kind,
			PublisherScopeKey: scopeKey,
		})
		if ns != "" && ns != "brain" {
			if dev == "" {
				dev = "local-default"
			}
			carriers[targetCarrier{deviceID: dev, ns: ns}] = struct{}{}
		}
	}
	if err := rows.Close(); err != nil {
		return nil, nil, err
	}
	// Always target PC Body namespace so any PC body carrier purges cached agent state even if sessions were already cleared.
	carriers[targetCarrier{deviceID: "local-default", ns: DefaultPCNamespace}] = struct{}{}

	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_session
		SET status = 'deleted', deleted_at = ?, updated_at = ?, body_purge_pending = CASE WHEN owner_body_kind != '' AND owner_body_kind != 'brain' THEN 1 ELSE 0 END
		WHERE account_id = ? AND agent_binding = ? AND deleted_at = ''`,
		nowStr, nowStr, accountID, agentBinding,
	); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_fts WHERE account_id = ? AND agent_binding = ?`, accountID, agentBinding); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_pending_attention WHERE account_id = ? AND agent_binding = ?`, accountID, agentBinding); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_milestone WHERE account_id = ? AND agent_binding = ?`, accountID, agentBinding); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_body_continuity_ledger WHERE account_id = ? AND agent_binding = ?`, accountID, agentBinding); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_body_issued_tool_call WHERE account_id = ? AND work_session_ref IN (SELECT work_session_ref FROM runtime_session WHERE account_id = ? AND agent_binding = ?)`, accountID, accountID, agentBinding); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM runtime_body_memory_read WHERE account_id=? AND work_session_ref IN (SELECT work_session_ref FROM runtime_session WHERE account_id=? AND agent_binding=?)", accountID, accountID, agentBinding); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_body_step_journal WHERE account_id = ? AND work_session_ref IN (SELECT work_session_ref FROM runtime_session WHERE account_id = ? AND agent_binding = ?)`, accountID, accountID, agentBinding); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_session_alarm
		SET status = 'cancelled', claim_expires_at = '', version = version + 1, updated_at = ?
		WHERE account_id = ? AND agent_binding = ? AND status IN ('active', 'sleeping', 'paused')`,
		nowStr, accountID, agentBinding,
	); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_body_outbox
		SET state = 'cancelled', result_state = 'agent_terminated', acked_at = ?
		WHERE account_id = ? AND agent_binding = ? AND state = 'pending' AND command_kind = ?`,
		nowStr, accountID, agentBinding, int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT),
	); err != nil {
		return nil, nil, err
	}

	var purgeEnvs []*runtimev1.BodyOutboxEnvelope
	for target := range carriers {
		env := &runtimev1.BodyOutboxEnvelope{
			OutboxId:            newID("outbox"),
			DeviceId:            target.deviceID,
			CapabilityNamespace: target.ns,
			WorkSessionRef:      "",
			AgentBinding:        agentBinding,
			CommandKind:         runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_AGENT,
			PayloadJson:         fmt.Sprintf(`{"agentBinding":%q,"reason":"agent_terminated"}`, agentBinding),
			CreatedAt:           nowStr,
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_body_outbox(
				outbox_id, account_id, device_id, capability_namespace, work_session_ref,
				agent_binding, command_kind, payload_json, payload_hash, state, created_at
			) VALUES (?, ?, ?, ?, '', ?, ?, ?, '', 'pending', ?)`,
			env.OutboxId, accountID, env.DeviceId, env.CapabilityNamespace,
			env.AgentBinding, int32(env.CommandKind), env.PayloadJson, nowStr,
		); err != nil {
			return nil, nil, err
		}
		purgeEnvs = append(purgeEnvs, env)
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return deletedMetas, purgeEnvs, nil
}

// RegisterLease persists carrier registration and increments monotonic lease_epoch.
func (st *Store) RegisterLease(ctx context.Context, lease *carrierLease) (int64, []*runtimev1.BodyOutboxEnvelope, []*runtimev1.BodyOutboxEnvelope, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if strings.HasPrefix(lease.CapabilityNamespace, "app.") {
		var other int
		err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM runtime_body_carrier_lease
			WHERE account_id=? AND capability_namespace=? AND carrier_subject<>?)`, lease.AccountID, lease.CapabilityNamespace, lease.CarrierSubject).Scan(&other)
		if err != nil {
			return 0, nil, nil, err
		}
		if other != 0 {
			return 0, nil, nil, errLeaseConflict
		}
	}
	// Fork C single-active-subject fence across the ENTIRE (account_id, capability_namespace):
	// a competing RegisteredAppSubject CANNOT bypass exclusivity by inventing a new device_id!
	conflictRows, err := tx.QueryContext(ctx, `
		SELECT device_id, carrier_subject, last_heartbeat_at
		FROM runtime_body_carrier_lease
		WHERE account_id = ? AND capability_namespace = ? AND active = 1 AND (carrier_subject != ? OR device_id != ?)`,
		lease.AccountID, lease.CapabilityNamespace, lease.CarrierSubject, lease.DeviceID,
	)
	if err != nil {
		return 0, nil, nil, err
	}
	for conflictRows.Next() {
		var otherDev, otherSub, otherHB string
		if scanErr := conflictRows.Scan(&otherDev, &otherSub, &otherHB); scanErr != nil {
			_ = conflictRows.Close()
			return 0, nil, nil, scanErr
		}
		otherKey := leaseMapKey(lease.AccountID, otherDev, lease.CapabilityNamespace)
		lastHB := st.effectiveHeartbeat(otherKey, otherHB)
		if lease.LastHeartbeatAt.Sub(lastHB) <= LeaseTTL*2 {
			_ = conflictRows.Close()
			return 0, nil, nil, errLeaseConflict
		}
	}
	if err := conflictRows.Close(); err != nil {
		return 0, nil, nil, err
	}
	// Mark any expired leases from other subjects inactive before taking ownership.
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_body_carrier_lease
		SET active = 0
		WHERE account_id = ? AND capability_namespace = ? AND (carrier_subject != ? OR device_id != ?) AND active = 1`,
		lease.AccountID, lease.CapabilityNamespace, lease.CarrierSubject, lease.DeviceID,
	); err != nil {
		return 0, nil, nil, err
	}

	var prevEpoch int64
	err = tx.QueryRowContext(ctx, `
		SELECT COALESCE(MAX(lease_epoch), 0)
		FROM runtime_body_carrier_lease
		WHERE account_id = ? AND capability_namespace = ?`,
		lease.AccountID, lease.CapabilityNamespace,
	).Scan(&prevEpoch)
	if err != nil {
		return 0, nil, nil, err
	}
	key := leaseMapKey(lease.AccountID, lease.DeviceID, lease.CapabilityNamespace)
	nextEpoch := prevEpoch + 1
	nowStr := formatRFC3339(lease.LastHeartbeatAt)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_body_carrier_lease(
			account_id, device_id, capability_namespace, lease_epoch,
			carrier_app_id, carrier_subject, instance_id, capabilities_json,
			last_heartbeat_at, active
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
		ON CONFLICT(account_id, device_id, capability_namespace) DO UPDATE SET
			lease_epoch = excluded.lease_epoch,
			carrier_app_id = excluded.carrier_app_id,
			carrier_subject = excluded.carrier_subject,
			instance_id = excluded.instance_id,
			capabilities_json = excluded.capabilities_json,
			last_heartbeat_at = excluded.last_heartbeat_at,
			active = 1`,
		lease.AccountID, lease.DeviceID, lease.CapabilityNamespace, nextEpoch,
		lease.CarrierAppID, lease.CarrierSubject, lease.InstanceID, lease.CapabilitiesJSON, nowStr,
	); err != nil {
		return 0, nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return 0, nil, nil, err
	}
	st.hbMu.Lock()
	st.liveHeartbeats[key] = lease.LastHeartbeatAt
	st.hbMu.Unlock()

	tombstones, intents, err := st.ListPendingOutbox(ctx, lease.AccountID, lease.DeviceID, lease.CapabilityNamespace)
	return nextEpoch, tombstones, intents, err
}

func (st *Store) effectiveHeartbeat(key, storedRaw string) time.Time {
	stored := parseRFC3339(storedRaw)
	st.hbMu.RLock()
	mem, ok := st.liveHeartbeats[key]
	st.hbMu.RUnlock()
	if ok && mem.After(stored) {
		return mem
	}
	return stored
}

func verifyActiveLeaseTx(
	ctx context.Context,
	q interface {
		QueryRowContext(context.Context, string, ...any) *sql.Row
	},
	st *Store,
	accountID, deviceID, ns, carrierSubject string,
	epoch int64,
	now time.Time,
) (bool, error) {
	var (
		storedSubject string
		storedEpoch   int64
		active        int
		heartbeatRaw  string
	)
	err := q.QueryRowContext(ctx, `
		SELECT carrier_subject, lease_epoch, active, last_heartbeat_at
		FROM runtime_body_carrier_lease
		WHERE account_id = ? AND device_id = ? AND capability_namespace = ?`,
		accountID, deviceID, ns,
	).Scan(&storedSubject, &storedEpoch, &active, &heartbeatRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if active == 0 || storedSubject != carrierSubject || storedEpoch != epoch {
		return false, nil
	}
	key := leaseMapKey(accountID, deviceID, ns)
	if now.Sub(st.effectiveHeartbeat(key, heartbeatRaw)) > LeaseTTL*2 {
		return false, nil
	}
	return true, nil
}

// HeartbeatLease verifies active, non-expired carrier ownership via readDB and
// updates liveness purely in memory (zero SQLite disk writes under WAL+FULL).
func (st *Store) HeartbeatLease(ctx context.Context, accountID, deviceID, ns, carrierSubject string, epoch int64, now time.Time) (bool, error) {
	var (
		storedSubject string
		storedEpoch   int64
		active        int
		heartbeatRaw  string
	)
	err := st.readDB.QueryRowContext(ctx, `
		SELECT carrier_subject, lease_epoch, active, last_heartbeat_at
		FROM runtime_body_carrier_lease
		WHERE account_id = ? AND device_id = ? AND capability_namespace = ?`,
		accountID, deviceID, ns,
	).Scan(&storedSubject, &storedEpoch, &active, &heartbeatRaw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if active == 0 || storedSubject != carrierSubject || storedEpoch != epoch {
		return false, nil
	}
	key := leaseMapKey(accountID, deviceID, ns)
	st.hbMu.Lock()
	defer st.hbMu.Unlock()
	storedHB := parseRFC3339(heartbeatRaw)
	effective := storedHB
	if mem, ok := st.liveHeartbeats[key]; ok && mem.After(effective) {
		effective = mem
	}
	if now.Sub(effective) > LeaseTTL*2 {
		return false, nil
	}
	st.liveHeartbeats[key] = now
	return true, nil
}

func (st *Store) UnregisterLease(ctx context.Context, accountID, deviceID, ns, carrierSubject string, epoch int64) (bool, error) {
	res, err := st.writeDB.ExecContext(ctx, `
		UPDATE runtime_body_carrier_lease
		SET active = 0
		WHERE account_id = ? AND device_id = ? AND capability_namespace = ?
		  AND carrier_subject = ? AND lease_epoch = ?`,
		accountID, deviceID, ns, carrierSubject, epoch,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		key := leaseMapKey(accountID, deviceID, ns)
		st.hbMu.Lock()
		delete(st.liveHeartbeats, key)
		st.hbMu.Unlock()
	}
	return n > 0, nil
}

func (st *Store) VerifyActiveLease(ctx context.Context, accountID, deviceID, ns, carrierSubject string, epoch int64, now time.Time) (bool, error) {
	return verifyActiveLeaseTx(ctx, st.readDB, st, accountID, deviceID, ns, carrierSubject, epoch, now)
}

func (st *Store) FindActiveCarrier(ctx context.Context, accountID, ns string, now time.Time) (deviceID string, carrierAppID string, online bool, err error) {
	rows, err := st.readDB.QueryContext(ctx, `
		SELECT device_id, carrier_app_id, last_heartbeat_at
		FROM runtime_body_carrier_lease
		WHERE account_id = ? AND capability_namespace = ? AND active = 1`,
		accountID, ns,
	)
	if err != nil {
		return "", "", false, err
	}
	defer func() { _ = rows.Close() }()
	bestDev := ""
	bestApp := ""
	var bestTime time.Time
	for rows.Next() {
		var devID, appID, hbRaw string
		if err := rows.Scan(&devID, &appID, &hbRaw); err != nil {
			return "", "", false, err
		}
		key := leaseMapKey(accountID, devID, ns)
		eff := st.effectiveHeartbeat(key, hbRaw)
		if now.Sub(eff) <= LeaseTTL*2 && (bestDev == "" || eff.After(bestTime)) {
			bestDev = devID
			bestApp = strings.TrimSpace(appID)
			bestTime = eff
		}
	}
	if err := rows.Err(); err != nil {
		return "", "", false, err
	}
	return bestDev, bestApp, bestDev != "", nil
}

func (st *Store) FindActiveCarrierDevice(ctx context.Context, accountID, ns string, now time.Time) (string, bool, error) {
	dev, _, online, err := st.FindActiveCarrier(ctx, accountID, ns, now)
	return dev, online, err
}

func (st *Store) ListPendingOutbox(ctx context.Context, accountID, deviceID, ns string) (tombstones []*runtimev1.BodyOutboxEnvelope, intents []*runtimev1.BodyOutboxEnvelope, err error) {
	rows, err := st.readDB.QueryContext(ctx, `
		SELECT outbox_id, device_id, capability_namespace, work_session_ref, agent_binding,
		       command_kind, payload_json, created_at
		FROM runtime_body_outbox
		WHERE account_id = ? AND (device_id = ? OR device_id = 'local-default')
		  AND capability_namespace = ? AND state = 'pending'
		ORDER BY created_at ASC`,
		accountID, deviceID, ns,
	)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		env := &runtimev1.BodyOutboxEnvelope{}
		var kind int32
		if err := rows.Scan(
			&env.OutboxId, &env.DeviceId, &env.CapabilityNamespace, &env.WorkSessionRef,
			&env.AgentBinding, &kind, &env.PayloadJson, &env.CreatedAt,
		); err != nil {
			return nil, nil, err
		}
		env.CommandKind = runtimev1.BodyOutboxCommandKind(kind)
		switch env.CommandKind {
		case runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_INVALIDATE_MEMORY,
			runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_SESSION,
			runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_AGENT:
			tombstones = append(tombstones, env)
		default:
			intents = append(intents, env)
		}
	}
	return tombstones, intents, rows.Err()
}

func (st *Store) EnqueueOutbox(ctx context.Context, accountID string, env *runtimev1.BodyOutboxEnvelope, payloadHash string) error {
	_, err := st.writeDB.ExecContext(ctx, `
		INSERT INTO runtime_body_outbox(
			outbox_id, account_id, device_id, capability_namespace, work_session_ref,
			agent_binding, command_kind, payload_json, payload_hash, state, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
		env.OutboxId, accountID, env.DeviceId, env.CapabilityNamespace, env.WorkSessionRef,
		env.AgentBinding, int32(env.CommandKind), env.PayloadJson, payloadHash, env.CreatedAt,
	)
	return err
}

func (st *Store) AckOutbox(ctx context.Context, accountID, deviceID, ns, carrierSubject string, leaseEpoch int64, outboxID, resultState string, now time.Time) (bool, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()

	// Verify active lease inside the write transaction so a fenced carrier cannot ACK outbox items.
	activeLease, leaseErr := verifyActiveLeaseTx(ctx, tx, st, accountID, deviceID, ns, carrierSubject, leaseEpoch, now)
	if leaseErr != nil {
		return false, leaseErr
	}
	if !activeLease {
		return false, errLeaseConflict
	}

	var workSessionRef, agentBinding, payloadJSON string
	var cmdKind int32
	err = tx.QueryRowContext(ctx, `
		SELECT work_session_ref, agent_binding, command_kind, payload_json FROM runtime_body_outbox
		WHERE account_id = ? AND outbox_id = ? AND capability_namespace = ?
		  AND (device_id = ? OR device_id = 'local-default')
		  AND state = 'pending'`,
		accountID, outboxID, ns, deviceID,
	).Scan(&workSessionRef, &agentBinding, &cmdKind, &payloadJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	nowStr := formatRFC3339(now)
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_body_outbox SET state = 'acked', result_state = ?, acked_at = ?
		WHERE account_id = ? AND outbox_id = ? AND capability_namespace = ?`,
		resultState, nowStr, accountID, outboxID, ns,
	); err != nil {
		return false, err
	}
	switch runtimev1.BodyOutboxCommandKind(cmdKind) {
	case runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT:
		_, err = tx.ExecContext(ctx, `UPDATE runtime_session SET status = 'active' WHERE account_id = ? AND work_session_ref = ? AND status = 'queued_body_offline' AND deleted_at = '' `, accountID, workSessionRef)
	case runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_SESSION:
		_, err = tx.ExecContext(ctx, `UPDATE runtime_session SET body_purge_pending = 0 WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef)
	case runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_AGENT:
		_, err = tx.ExecContext(ctx, `UPDATE runtime_session SET body_purge_pending = 0 WHERE account_id = ? AND agent_binding = ? AND owner_body_kind = ?`, accountID, agentBinding, ns)
	case runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_INVALIDATE_MEMORY:
		var inv struct {
			Epoch         int64  `json:"epoch"`
			PreviousEpoch *int64 `json:"previousEpoch,omitempty"`
			Generation    *int64 `json:"generation,omitempty"`
		}
		if err := json.Unmarshal([]byte(payloadJSON), &inv); err != nil || inv.Epoch < 0 || workSessionRef == "" {
			return false, errSessionConflict
		}
		var prev, gen any
		if inv.PreviousEpoch != nil {
			prev = *inv.PreviousEpoch
		}
		if inv.Generation != nil {
			gen = *inv.Generation
		}
		res, err := tx.ExecContext(ctx, `UPDATE runtime_body_continuity_ledger SET read_set_epoch=?, generation=generation+1,
			issued_tool_call_ids_json='[]', issued_tool_args_json='{}', updated_at=?
			WHERE account_id=? AND work_session_ref=? AND (? IS NULL OR read_set_epoch=?) AND (? IS NULL OR generation=?)`,
			inv.Epoch, nowStr, accountID, workSessionRef, prev, prev, gen, gen)
		if err != nil {
			return false, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return false, err
		}
		if n == 1 {
			for _, sql := range []string{
				"DELETE FROM runtime_body_memory_read WHERE account_id=? AND work_session_ref=?",
				"DELETE FROM runtime_body_step_journal WHERE account_id=? AND work_session_ref=?",
				"UPDATE runtime_body_issued_tool_call SET revoked=1 WHERE account_id=? AND work_session_ref=?",
			} {
				if _, err := tx.ExecContext(ctx, sql, accountID, workSessionRef); err != nil {
					return false, err
				}
			}
		}
	}
	if err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func hasPendingTombstonesTx(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, accountID, deviceID, ns, workSessionRef, agentBinding string) (bool, error) {
	var count int
	if workSessionRef != "" {
		err := q.QueryRowContext(ctx, `
			SELECT COUNT(1) FROM runtime_body_outbox
			WHERE account_id = ? AND capability_namespace = ?
			  AND (device_id = ? OR device_id = 'local-default')
			  AND state = 'pending'
			  AND (
				(command_kind IN (?, ?) AND work_session_ref = ?)
				OR (command_kind = ? AND agent_binding = ?)
			  )`,
			accountID, ns, deviceID,
			int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_INVALIDATE_MEMORY),
			int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_SESSION),
			workSessionRef,
			int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_AGENT),
			agentBinding,
		).Scan(&count)
		return count > 0, err
	}
	err := q.QueryRowContext(ctx, `
		SELECT COUNT(1) FROM runtime_body_outbox
		WHERE account_id = ? AND (device_id = ? OR device_id = 'local-default')
		  AND capability_namespace = ? AND state = 'pending'
		  AND command_kind IN (?, ?, ?)`,
		accountID, deviceID, ns,
		int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_INVALIDATE_MEMORY),
		int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_SESSION),
		int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_AGENT),
	).Scan(&count)
	return count > 0, err
}

func (st *Store) HasPendingTombstones(ctx context.Context, accountID, deviceID, ns, workSessionRef, agentBinding string) (bool, error) {
	return hasPendingTombstonesTx(ctx, st.readDB, accountID, deviceID, ns, workSessionRef, agentBinding)
}

type ledgerRecord struct {
	Generation                   int64
	WorkSessionRef               string
	AccountID                    string
	AgentBinding                 string
	LastStepMAC                  string
	LastCommittedCount           int
	PostCompactionMAC            string
	IssuedToolCallIDsJSON        string
	IssuedToolArgsJSON           string
	ReadSetEpoch                 int64
	CompactionCount              int64
	EffectiveContextBudgetTokens uint32
	UpdatedAt                    string
}

func (st *Store) GetLedger(ctx context.Context, accountID, workSessionRef string) (*ledgerRecord, error) {
	rec := &ledgerRecord{}
	err := st.readDB.QueryRowContext(ctx, `
		SELECT work_session_ref, account_id, agent_binding, last_step_mac, last_committed_count, post_compaction_mac,
		       issued_tool_call_ids_json, issued_tool_args_json, read_set_epoch, compaction_count, effective_context_budget_tokens, updated_at, generation
		FROM runtime_body_continuity_ledger
		WHERE account_id = ? AND work_session_ref = ?`,
		accountID, workSessionRef,
	).Scan(
		&rec.WorkSessionRef, &rec.AccountID, &rec.AgentBinding,
		&rec.LastStepMAC, &rec.LastCommittedCount, &rec.PostCompactionMAC, &rec.IssuedToolCallIDsJSON,
		&rec.IssuedToolArgsJSON, &rec.ReadSetEpoch, &rec.CompactionCount, &rec.EffectiveContextBudgetTokens, &rec.UpdatedAt, &rec.Generation,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return rec, err
}

type stepJournalRecord struct {
	PublicDeltas       []bodyJournalDelta
	StreamBudget       uint32
	AssistantText      string
	RequestDigest      string
	StepRequestID      string
	PrevStepMAC        string
	PrevCommittedCount int
	NextStepMAC        string
	NextCommittedCount int
	PostCompactionMAC  string
	ToolCalls          []*runtimev1.BodyToolCall
	Done               *runtimev1.BodyStepDone
}

func (st *Store) GetStepJournal(ctx context.Context, accountID, workSessionRef, stepRequestID string) (*stepJournalRecord, error) {
	if strings.TrimSpace(stepRequestID) == "" {
		return nil, nil
	}
	var (
		rec           stepJournalRecord
		toolCallsJSON string
		doneJSON      string
	)
	rec.StepRequestID = strings.TrimSpace(stepRequestID)
	err := st.readDB.QueryRowContext(ctx, `
		SELECT prev_step_mac, prev_committed_count, next_step_mac, next_committed_count,
		       post_compaction_mac, tool_calls_json, done_json
		FROM runtime_body_step_journal
		WHERE account_id = ? AND work_session_ref = ? AND step_request_id = ?`,
		accountID, workSessionRef, rec.StepRequestID,
	).Scan(
		&rec.PrevStepMAC, &rec.PrevCommittedCount, &rec.NextStepMAC, &rec.NextCommittedCount,
		&rec.PostCompactionMAC, &toolCallsJSON, &doneJSON,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var rawCalls []struct {
		CallID        string `json:"callId"`
		Name          string `json:"name"`
		ArgumentsJSON string `json:"argumentsJson"`
	}
	if strings.TrimSpace(toolCallsJSON) != "" && json.Unmarshal([]byte(toolCallsJSON), &rawCalls) == nil {
		for _, c := range rawCalls {
			rec.ToolCalls = append(rec.ToolCalls, &runtimev1.BodyToolCall{
				CallId:        c.CallID,
				Name:          c.Name,
				ArgumentsJson: c.ArgumentsJSON,
			})
		}
	}
	var rawDone struct {
		PublicDeltas                 []bodyJournalDelta
		StreamBudget                 uint32
		AssistantText                string
		RequestDigest                string
		FinishReason                 string `json:"finishReason"`
		UsageInputTokens             int64  `json:"usageInputTokens"`
		UsageOutputTokens            int64  `json:"usageOutputTokens"`
		StepMAC                      string `json:"stepMac"`
		CompactionSummary            string `json:"compactionSummary"`
		PostCompactionMAC            string `json:"postCompactionMac"`
		EffectiveContextBudgetTokens uint32 `json:"effectiveContextBudgetTokens"`
	}
	if err := json.Unmarshal([]byte(doneJSON), &rawDone); err != nil {
		return nil, err
	}
	rec.StreamBudget = rawDone.StreamBudget
	rec.PublicDeltas = rawDone.PublicDeltas
	rec.AssistantText = rawDone.AssistantText
	rec.RequestDigest = rawDone.RequestDigest
	rec.Done = &runtimev1.BodyStepDone{
		FinishReason:                 rawDone.FinishReason,
		UsageInputTokens:             rawDone.UsageInputTokens,
		UsageOutputTokens:            rawDone.UsageOutputTokens,
		StepMac:                      rawDone.StepMAC,
		CompactionSummary:            rawDone.CompactionSummary,
		PostCompactionMac:            rawDone.PostCompactionMAC,
		EffectiveContextBudgetTokens: rawDone.EffectiveContextBudgetTokens,
	}
	return &rec, nil
}

func (st *Store) verifyOutboxInput(ctx context.Context, account, ref, id, text string) (bool, error) {
	var raw string
	err := st.readDB.QueryRowContext(ctx, "SELECT payload_json FROM runtime_body_outbox WHERE account_id=? AND work_session_ref=? AND outbox_id=? AND command_kind=? AND input_committed=0", account, ref, id, int32(runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_NEW_INTENT)).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var input struct {
		BodyInputText                         *string
		Text, HandoffBriefText, WorkspaceRoot string
		AttachmentPaths                       []string
		HandoffHistory                        []map[string]any
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return false, err
	}
	if input.BodyInputText != nil {
		return *input.BodyInputText == text, nil
	}
	return bodyIntentText(input.Text, input.HandoffBriefText, input.WorkspaceRoot, input.AttachmentPaths, input.HandoffHistory) == text, nil
}

func (st *Store) IsToolResultAlreadyCommitted(ctx context.Context, accountID, workSessionRef, callID string) (bool, error) {
	var committedAt string
	err := st.readDB.QueryRowContext(ctx, `
		SELECT result_committed_at FROM runtime_body_issued_tool_call
		WHERE account_id = ? AND work_session_ref = ? AND call_id = ?`,
		accountID, workSessionRef, strings.TrimSpace(callID),
	).Scan(&committedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strings.TrimSpace(committedAt) != "", nil
}

type commitStepLedgerInput struct {
	MemoryReadSet        cognitionmemory.MemoryReadSet
	PublicDeltas         []bodyJournalDelta
	StreamBudget         uint32
	InputIDs             []string
	OriginalReadEpoch    int64
	AssistantText        string
	RequestDigest        string
	Ledger               *ledgerRecord
	DeviceID             string
	Namespace            string
	CarrierSubject       string
	LeaseEpoch           int64
	SettledToolCallIDs   []string
	NewlyIssuedToolCalls []*runtimev1.BodyToolCall
	StepRequestID        string
	PrevStepMAC          string
	PrevCommittedCount   int
	Done                 *runtimev1.BodyStepDone
	Now                  time.Time
}

// CommitStepLedger atomically re-verifies the active lease and live session,
// marks newly settled tool_call_ids, inserts new per-call rows into
// runtime_body_issued_tool_call WITHOUT ever overwriting consumed_at on prior
// calls, updates the single-anchor ledger, and persists an idempotent replay
// journal entry keyed by step_request_id.
func (st *Store) CommitStepLedger(ctx context.Context, in commitStepLedgerInput) error {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	rec := in.Ledger
	activeLease, err := verifyActiveLeaseTx(ctx, tx, st, rec.AccountID, in.DeviceID, in.Namespace, in.CarrierSubject, in.LeaseEpoch, in.Now)
	if err != nil {
		return err
	}
	if !activeLease {
		return errLeaseConflict
	}

	var status, deletedAt, ownerBodyKind, boundDev string
	err = tx.QueryRowContext(ctx, `
		SELECT status, deleted_at, owner_body_kind, device_id
		FROM runtime_session
		WHERE account_id = ? AND work_session_ref = ?`,
		rec.AccountID, rec.WorkSessionRef,
	).Scan(&status, &deletedAt, &ownerBodyKind, &boundDev)
	if errors.Is(err, sql.ErrNoRows) || deletedAt != "" || status == "deleted" || status == "deleting" {
		return errSessionNotFound
	}
	if err != nil {
		return err
	}
	if ownerBodyKind != in.Namespace || (boundDev != "" && boundDev != "local-default" && boundDev != in.DeviceID) {
		return errBodyNamespaceMismatch
	}

	pending, err := hasPendingTombstonesTx(ctx, tx, rec.AccountID, in.DeviceID, in.Namespace, "", "")
	if err != nil {
		return err
	}
	if pending {
		return errTombstoneFence
	}
	var epoch, generation int64
	if err := tx.QueryRowContext(ctx, "SELECT read_set_epoch, generation FROM runtime_body_continuity_ledger WHERE account_id=? AND work_session_ref=?", rec.AccountID, rec.WorkSessionRef).Scan(&epoch, &generation); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if epoch != in.OriginalReadEpoch || generation != rec.Generation {
		return errTombstoneFence
	}
	for _, ref := range in.MemoryReadSet.Refs {
		_, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO runtime_body_memory_read(account_id,work_session_ref,binding,bank,lifecycle,ref) VALUES(?,?,?,?,?,?)",
			rec.AccountID, rec.WorkSessionRef, in.MemoryReadSet.BindingRef, in.MemoryReadSet.BankRef, in.MemoryReadSet.LifecycleRef, ref)
		if err != nil {
			return err
		}
	}
	for _, id := range in.InputIDs {
		res, err := tx.ExecContext(ctx, "UPDATE runtime_body_outbox SET input_committed=1 WHERE account_id=? AND work_session_ref=? AND outbox_id=? AND input_committed=0", rec.AccountID, rec.WorkSessionRef, id)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err != nil || n != 1 {
			return errSessionConflict
		}
	}

	nowStr := formatRFC3339(in.Now)
	for _, callID := range in.SettledToolCallIDs {
		cid := strings.TrimSpace(callID)
		if cid == "" {
			continue
		}
		var existingCommitted string
		qErr := tx.QueryRowContext(ctx, `
			SELECT result_committed_at FROM runtime_body_issued_tool_call
			WHERE account_id = ? AND work_session_ref = ? AND call_id = ?`,
			rec.AccountID, rec.WorkSessionRef, cid,
		).Scan(&existingCommitted)
		if qErr == nil {
			if strings.TrimSpace(existingCommitted) != "" {
				return errSessionConflict
			}
			if _, err := tx.ExecContext(ctx, `
				UPDATE runtime_body_issued_tool_call
				SET result_committed_at = ?
				WHERE account_id = ? AND work_session_ref = ? AND call_id = ? AND result_committed_at = ''`,
				nowStr, rec.AccountID, rec.WorkSessionRef, cid,
			); err != nil {
				return err
			}
		} else if !errors.Is(qErr, sql.ErrNoRows) {
			return qErr
		}
	}

	// Preserve any concurrent consumed flags in legacy issued_tool_args_json too.
	var existingArgsJSON string
	_ = tx.QueryRowContext(ctx, `
		SELECT issued_tool_args_json FROM runtime_body_continuity_ledger
		WHERE account_id = ? AND work_session_ref = ?`,
		rec.AccountID, rec.WorkSessionRef,
	).Scan(&existingArgsJSON)
	mergedMeta := decodeIssuedToolMeta(existingArgsJSON)
	for _, c := range in.NewlyIssuedToolCalls {
		cid := strings.TrimSpace(c.GetCallId())
		toolName := strings.TrimSpace(c.GetName())
		if cid == "" || toolName == "" {
			continue
		}
		rawArgs := c.GetArgumentsJson()
		canonArgs := canonicalJSONString(rawArgs)
		argsHash := sha256HexString(canonArgs)
		rawHash := sha256HexString(rawArgs)
		consumedAt := ""
		if prev, ok := mergedMeta[cid]; ok && prev.Consumed {
			consumedAt = nowStr
		}
		// Never overwrite an already-issued call_id row or reset its consumed_at!
		if _, err := tx.ExecContext(ctx, `
			INSERT OR IGNORE INTO runtime_body_issued_tool_call(
				account_id, work_session_ref, call_id, tool_name, args_hash, raw_args_hash,
				consumed_at, result_committed_at, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)`,
			rec.AccountID, rec.WorkSessionRef, cid, toolName, argsHash, rawHash, consumedAt, nowStr,
		); err != nil {
			return err
		}
		if prev, exists := mergedMeta[cid]; !exists {
			mergedMeta[cid] = issuedToolMeta{
				ToolName:    toolName,
				ArgsHash:    argsHash,
				RawArgsHash: rawHash,
				Consumed:    false,
			}
		} else {
			mergedMeta[cid] = prev
		}
	}
	issuedWindow := decodeIssuedWindow(rec.IssuedToolCallIDsJSON)
	keep := make(map[string]struct{}, len(issuedWindow))
	for _, id := range issuedWindow {
		keep[id] = struct{}{}
	}
	for id := range mergedMeta {
		if _, ok := keep[id]; !ok {
			delete(mergedMeta, id)
		}
	}
	mergedArgsBytes, _ := json.Marshal(mergedMeta)
	rec.IssuedToolArgsJSON = string(mergedArgsBytes)
	if rec.IssuedToolArgsJSON == "" {
		rec.IssuedToolArgsJSON = "{}"
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_body_continuity_ledger(
			work_session_ref, account_id, agent_binding, last_step_mac, last_committed_count, post_compaction_mac,
			issued_tool_call_ids_json, issued_tool_args_json, read_set_epoch, compaction_count, effective_context_budget_tokens, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(work_session_ref) DO UPDATE SET
			last_step_mac = excluded.last_step_mac,
			last_committed_count = excluded.last_committed_count,
			post_compaction_mac = excluded.post_compaction_mac,
			issued_tool_call_ids_json = excluded.issued_tool_call_ids_json,
			issued_tool_args_json = excluded.issued_tool_args_json,
			read_set_epoch = excluded.read_set_epoch,
			compaction_count = excluded.compaction_count,
			effective_context_budget_tokens = excluded.effective_context_budget_tokens,
			updated_at = excluded.updated_at`,
		rec.WorkSessionRef, rec.AccountID, rec.AgentBinding, rec.LastStepMAC, rec.LastCommittedCount, rec.PostCompactionMAC,
		rec.IssuedToolCallIDsJSON, rec.IssuedToolArgsJSON, rec.ReadSetEpoch, rec.CompactionCount, rec.EffectiveContextBudgetTokens, rec.UpdatedAt,
	); err != nil {
		return err
	}

	if stepReqID := strings.TrimSpace(in.StepRequestID); stepReqID != "" && in.Done != nil {
		type serializedCall struct {
			CallID        string `json:"callId"`
			Name          string `json:"name"`
			ArgumentsJSON string `json:"argumentsJson"`
		}
		callsOut := make([]serializedCall, 0, len(in.NewlyIssuedToolCalls))
		for _, c := range in.NewlyIssuedToolCalls {
			callsOut = append(callsOut, serializedCall{
				CallID:        c.GetCallId(),
				Name:          c.GetName(),
				ArgumentsJSON: c.GetArgumentsJson(),
			})
		}
		callsJSON, _ := json.Marshal(callsOut)
		doneJSON, _ := json.Marshal(struct {
			PublicDeltas                 []bodyJournalDelta
			StreamBudget                 uint32
			AssistantText                string
			RequestDigest                string
			FinishReason                 string `json:"finishReason"`
			UsageInputTokens             int64  `json:"usageInputTokens"`
			UsageOutputTokens            int64  `json:"usageOutputTokens"`
			StepMAC                      string `json:"stepMac"`
			CompactionSummary            string `json:"compactionSummary"`
			PostCompactionMAC            string `json:"postCompactionMac"`
			EffectiveContextBudgetTokens uint32 `json:"effectiveContextBudgetTokens"`
		}{
			PublicDeltas:                 in.PublicDeltas,
			StreamBudget:                 in.StreamBudget,
			AssistantText:                in.AssistantText,
			RequestDigest:                in.RequestDigest,
			FinishReason:                 in.Done.GetFinishReason(),
			UsageInputTokens:             in.Done.GetUsageInputTokens(),
			UsageOutputTokens:            in.Done.GetUsageOutputTokens(),
			StepMAC:                      in.Done.GetStepMac(),
			CompactionSummary:            in.Done.GetCompactionSummary(),
			PostCompactionMAC:            in.Done.GetPostCompactionMac(),
			EffectiveContextBudgetTokens: in.Done.GetEffectiveContextBudgetTokens(),
		})
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_body_step_journal(
				account_id, work_session_ref, step_request_id, prev_step_mac, prev_committed_count,
				next_step_mac, next_committed_count, post_compaction_mac, tool_calls_json, done_json, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(account_id, work_session_ref, step_request_id) DO NOTHING`,
			rec.AccountID, rec.WorkSessionRef, stepReqID, in.PrevStepMAC, in.PrevCommittedCount,
			rec.LastStepMAC, rec.LastCommittedCount, rec.PostCompactionMAC, string(callsJSON), string(doneJSON), nowStr,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (st *Store) UpsertLedger(ctx context.Context, rec *ledgerRecord) error {
	if rec.IssuedToolArgsJSON == "" {
		rec.IssuedToolArgsJSON = "{}"
	}
	_, err := st.writeDB.ExecContext(ctx, `
		INSERT INTO runtime_body_continuity_ledger(
			work_session_ref, account_id, agent_binding, last_step_mac, last_committed_count, post_compaction_mac,
			issued_tool_call_ids_json, issued_tool_args_json, read_set_epoch, compaction_count, effective_context_budget_tokens, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(work_session_ref) DO UPDATE SET
			last_step_mac = excluded.last_step_mac,
			last_committed_count = excluded.last_committed_count,
			post_compaction_mac = excluded.post_compaction_mac,
			issued_tool_call_ids_json = excluded.issued_tool_call_ids_json,
			issued_tool_args_json = excluded.issued_tool_args_json,
			read_set_epoch = excluded.read_set_epoch,
			compaction_count = excluded.compaction_count,
			effective_context_budget_tokens = excluded.effective_context_budget_tokens,
			updated_at = excluded.updated_at`,
		rec.WorkSessionRef, rec.AccountID, rec.AgentBinding, rec.LastStepMAC, rec.LastCommittedCount, rec.PostCompactionMAC,
		rec.IssuedToolCallIDsJSON, rec.IssuedToolArgsJSON, rec.ReadSetEpoch, rec.CompactionCount, rec.EffectiveContextBudgetTokens, rec.UpdatedAt,
	)
	return err
}

type consumeToolCallInput struct {
	Generation     int64
	AccountID      string
	DeviceID       string
	Namespace      string
	CarrierSubject string
	LeaseEpoch     int64
	WorkSessionRef string
	CallID         string
	ToolName       string
	PayloadHash    string
	ActionKind     string
	Now            time.Time
}

// ConsumeAuthorizedToolCall atomically verifies active lease, live session,
// permission_mode, tombstone drain, issued tool_name/args payload hash, and
// once-only consumption inside a single BEGIN IMMEDIATE SQLite write transaction.
func (st *Store) ConsumeAuthorizedToolCall(ctx context.Context, in consumeToolCallInput) (*runtimev1.AuthorizeBodySideEffectResponse, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	activeLease, err := verifyActiveLeaseTx(ctx, tx, st, in.AccountID, in.DeviceID, in.Namespace, in.CarrierSubject, in.LeaseEpoch, in.Now)
	if err != nil {
		return nil, err
	}
	if !activeLease {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "lease_conflict_or_expired",
		}, nil
	}

	var (
		status        string
		deletedAt     string
		purgePending  int
		ownerBodyKind string
		deviceID      string
		permMode      string
		agentBinding  string
	)
	err = tx.QueryRowContext(ctx, `
		SELECT status, deleted_at, body_purge_pending, owner_body_kind, device_id, permission_mode, agent_binding
		FROM runtime_session
		WHERE account_id = ? AND work_session_ref = ?`,
		in.AccountID, in.WorkSessionRef,
	).Scan(&status, &deletedAt, &purgePending, &ownerBodyKind, &deviceID, &permMode, &agentBinding)
	if errors.Is(err, sql.ErrNoRows) || deletedAt != "" || status == "deleted" || status == "deleting" {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized:         false,
			DenyReason:         "work_session_deleted",
			WorkSessionDeleted: true,
		}, nil
	}
	if err != nil {
		return nil, err
	}
	if purgePending != 0 {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized:         false,
			DenyReason:         "work_session_purge_pending",
			WorkSessionDeleted: true,
		}, nil
	}
	if ownerBodyKind != in.Namespace {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "work_session_namespace_mismatch",
		}, nil
	}
	if deviceID != "" && deviceID != "local-default" && deviceID != in.DeviceID {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "work_session_device_mismatch",
		}, nil
	}
	if !actionKindAllowedByPermissionMode(permMode, in.ActionKind) {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "permission_mode_denies_side_effect",
		}, nil
	}

	hasTombstones, err := hasPendingTombstonesTx(ctx, tx, in.AccountID, in.DeviceID, in.Namespace, in.WorkSessionRef, agentBinding)
	if err != nil {
		return nil, err
	}
	if hasTombstones {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized:        false,
			DenyReason:        "pending_tombstones_must_be_drained",
			MemoryInvalidated: true,
		}, nil
	}

	reqHash := strings.TrimSpace(in.PayloadHash)
	if reqHash == "" {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "tool_payload_hash_missing",
		}, nil
	}
	nowStr := formatRFC3339(in.Now)

	var issuedIDsJSON, issuedArgsJSON string
	var generation int64
	err = tx.QueryRowContext(ctx, `
		SELECT issued_tool_call_ids_json, issued_tool_args_json, generation
		FROM runtime_body_continuity_ledger
		WHERE account_id = ? AND work_session_ref = ?`,
		in.AccountID, in.WorkSessionRef,
	).Scan(&issuedIDsJSON, &issuedArgsJSON, &generation)
	if errors.Is(err, sql.ErrNoRows) {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "session_ledger_uninitialized",
		}, nil
	}
	if err != nil {
		return nil, err
	}

	if generation != in.Generation {
		return &runtimev1.AuthorizeBodySideEffectResponse{DenyReason: "memory_read_set_invalidated", MemoryInvalidated: true}, nil
	}
	issuedWindow := decodeIssuedWindow(issuedIDsJSON)
	if !containsString(issuedWindow, in.CallID) {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "tool_call_not_issued_by_runtime",
		}, nil
	}

	// Primary path: atomic row-level once-only consumption from runtime_body_issued_tool_call.
	var (
		relToolName   string
		relArgsHash   string
		relRawHash    string
		relConsumedAt string
		relSettledAt  string
		revoked       bool
	)
	relErr := tx.QueryRowContext(ctx, `
		SELECT tool_name, args_hash, raw_args_hash, consumed_at, result_committed_at, revoked
		FROM runtime_body_issued_tool_call
		WHERE account_id = ? AND work_session_ref = ? AND call_id = ?`,
		in.AccountID, in.WorkSessionRef, in.CallID,
	).Scan(&relToolName, &relArgsHash, &relRawHash, &relConsumedAt, &relSettledAt, &revoked)
	if relErr == nil {
		if revoked {
			return &runtimev1.AuthorizeBodySideEffectResponse{DenyReason: "memory_read_set_invalidated", MemoryInvalidated: true}, nil
		}
		if strings.TrimSpace(relConsumedAt) != "" {
			return &runtimev1.AuthorizeBodySideEffectResponse{
				Authorized: false,
				DenyReason: "tool_call_already_consumed",
			}, nil
		}
		if relSettledAt != "" {
			return &runtimev1.AuthorizeBodySideEffectResponse{DenyReason: "tool_result_already_committed"}, nil
		}
		if strings.TrimSpace(relToolName) == "" || !strings.EqualFold(relToolName, in.ToolName) {
			return &runtimev1.AuthorizeBodySideEffectResponse{
				Authorized: false,
				DenyReason: "tool_name_mismatch",
			}, nil
		}
		if (relArgsHash == "" && relRawHash == "") ||
			(!strings.EqualFold(reqHash, relArgsHash) && !strings.EqualFold(reqHash, relRawHash)) {
			return &runtimev1.AuthorizeBodySideEffectResponse{
				Authorized: false,
				DenyReason: "tool_payload_hash_mismatch",
			}, nil
		}
		res, execErr := tx.ExecContext(ctx, `
			UPDATE runtime_body_issued_tool_call
			SET consumed_at = ?
			WHERE account_id = ? AND work_session_ref = ? AND call_id = ? AND consumed_at = '' AND result_committed_at = ''`,
			nowStr, in.AccountID, in.WorkSessionRef, in.CallID,
		)
		if execErr != nil {
			return nil, execErr
		}
		affected, _ := res.RowsAffected()
		if affected != 1 {
			return &runtimev1.AuthorizeBodySideEffectResponse{
				Authorized: false,
				DenyReason: "tool_call_already_consumed",
			}, nil
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return &runtimev1.AuthorizeBodySideEffectResponse{Authorized: true}, nil
	}
	if !errors.Is(relErr, sql.ErrNoRows) {
		return nil, relErr
	}

	// Legacy upgrade fallback: verify against issued_tool_args_json and immediately
	// record an irreversible consumed row in runtime_body_issued_tool_call.
	issuedMeta := decodeIssuedToolMeta(issuedArgsJSON)
	meta, ok := issuedMeta[in.CallID]
	if !ok {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "tool_call_metadata_missing",
		}, nil
	}
	if meta.Consumed {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "tool_call_already_consumed",
		}, nil
	}
	if strings.TrimSpace(meta.ToolName) == "" || !strings.EqualFold(meta.ToolName, in.ToolName) {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "tool_name_mismatch",
		}, nil
	}
	if meta.ArgsHash == "" && meta.RawArgsHash == "" {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "tool_payload_hash_missing",
		}, nil
	}
	hashMatched := (meta.ArgsHash != "" && strings.EqualFold(reqHash, meta.ArgsHash)) ||
		(meta.RawArgsHash != "" && strings.EqualFold(reqHash, meta.RawArgsHash))
	if !hashMatched {
		return &runtimev1.AuthorizeBodySideEffectResponse{
			Authorized: false,
			DenyReason: "tool_payload_hash_mismatch",
		}, nil
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO runtime_body_issued_tool_call(
			account_id, work_session_ref, call_id, tool_name, args_hash, raw_args_hash,
			consumed_at, result_committed_at, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?)
		ON CONFLICT(account_id, work_session_ref, call_id) DO UPDATE SET consumed_at = excluded.consumed_at`,
		in.AccountID, in.WorkSessionRef, in.CallID, meta.ToolName, meta.ArgsHash, meta.RawArgsHash, nowStr, nowStr,
	); err != nil {
		return nil, err
	}
	meta.Consumed = true
	issuedMeta[in.CallID] = meta
	updatedMetaJSON, _ := json.Marshal(issuedMeta)
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_body_continuity_ledger
		SET issued_tool_args_json = ?, updated_at = ?
		WHERE account_id = ? AND work_session_ref = ?`,
		string(updatedMetaJSON), nowStr, in.AccountID, in.WorkSessionRef,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &runtimev1.AuthorizeBodySideEffectResponse{Authorized: true}, nil
}

func permissionModeRank(mode string) (int, bool) {
	switch strings.TrimSpace(mode) {
	case "readonly":
		return 0, true
	case "companion":
		return 1, true
	case "plan-readonly":
		return 2, true
	case "strict":
		return 3, true
	case "workspace-edit":
		return 4, true
	default:
		return -1, false
	}
}

func canBodyUpdatePermissionMode(existing, incoming string) bool {
	inRank, okIn := permissionModeRank(incoming)
	if !okIn {
		return false
	}
	exRank, okEx := permissionModeRank(existing)
	if !okEx {
		return inRank <= 2
	}
	return inRank <= exRank
}

func (st *Store) ApplyBodyProjection(ctx context.Context, accountID, verifiedNS, carrierSubject string, req *runtimev1.ReportBodySessionProjectionRequest, now time.Time) (*runtimev1.ReportBodySessionProjectionResponse, *sessionRow, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// Active lease and tombstone fence evaluated INSIDE the write transaction to eliminate TOCTOU.
	activeLease, err := verifyActiveLeaseTx(ctx, tx, st, accountID, req.GetDeviceId(), verifiedNS, carrierSubject, req.GetLeaseEpoch(), now)
	if err != nil {
		return nil, nil, err
	}
	if !activeLease {
		return nil, nil, errLeaseConflict
	}

	hasTombstones, err := hasPendingTombstonesTx(ctx, tx, accountID, req.GetDeviceId(), verifiedNS, "", "")
	if err != nil {
		return nil, nil, err
	}
	if hasTombstones {
		return nil, nil, errTombstoneFence
	}

	row := tx.QueryRowContext(ctx, `SELECT `+sessionSelectColumns+` FROM runtime_session WHERE account_id = ? AND work_session_ref = ?`, accountID, req.GetWorkSessionRef())
	existing, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, errSessionNotFound
	}
	if err != nil {
		return nil, nil, err
	}
	if existing.DeletedAt != "" || existing.Record.Status == "deleted" || existing.Record.Status == "deleting" {
		return nil, nil, errSessionNotFound
	}
	// Object-scope binding: caller's verified capability namespace (and bound device) MUST own this session.
	if existing.Record.OwnerBodyKind != verifiedNS {
		return nil, nil, errBodyNamespaceMismatch
	}
	if existing.Record.DeviceId != "" && existing.Record.DeviceId != "local-default" && req.GetDeviceId() != "" && existing.Record.DeviceId != req.GetDeviceId() {
		return nil, nil, errBodyNamespaceMismatch
	}

	// Strictly monotonic (lease_epoch, projection_seq) fencing:
	// - Older epoch is always stale-ignored.
	// - Same epoch requires strictly higher projection_seq.
	// - Newer epoch resets sequence baseline (so Body restart starting at seq=1 is accepted!).
	incomingEpoch := req.GetLeaseEpoch()
	incomingSeq := req.GetProjectionSeq()
	if incomingEpoch < existing.ProjectionLeaseEpoch ||
		(incomingEpoch == existing.ProjectionLeaseEpoch && incomingSeq <= existing.Record.ProjectionSeq) {
		return &runtimev1.ReportBodySessionProjectionResponse{
			Applied:              false,
			CurrentProjectionSeq: existing.Record.ProjectionSeq,
			StaleIgnored:         true,
		}, existing, nil
	}

	nowStr := formatRFC3339(now)
	existing.ProjectionLeaseEpoch = incomingEpoch
	existing.Record.ProjectionSeq = incomingSeq
	if req.GetDeviceId() != "" {
		existing.Record.DeviceId = strings.TrimSpace(req.GetDeviceId())
	}
	if s := strings.TrimSpace(req.GetStatus()); s != "" && s != "deleted" && s != "deleting" {
		existing.Record.Status = s
	}
	if t := strings.TrimSpace(req.GetTitle()); t != "" {
		existing.Record.Title = t
	}
	if w := strings.TrimSpace(req.GetWorkspaceRoot()); w != "" {
		existing.Record.WorkspaceRoot = w
	}
	if pm := strings.TrimSpace(req.GetPermissionMode()); pm != "" {
		// Bodies may preserve or downgrade permission_mode, never escalate it!
		if !canBodyUpdatePermissionMode(existing.Record.PermissionMode, pm) {
			return nil, nil, errBodyNamespaceMismatch
		}
		existing.Record.PermissionMode = pm
	}
	var milestoneReceipt struct {
		MilestoneRef string `json:"milestoneRef"`
	}
	if r := strings.TrimSpace(req.GetLatestReceiptJson()); r != "" {
		// A delivery cursor for a milestone is not a user-visible task receipt.
		if req.GetMilestoneKind() == "" || json.Unmarshal([]byte(r), &milestoneReceipt) != nil || milestoneReceipt.MilestoneRef == "" {
			existing.Record.LatestReceiptJson = r
		}
	}
	existing.Record.UpdatedAt = nowStr

	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_session
		SET projection_seq = ?, projection_lease_epoch = ?, device_id = ?, status = ?, title = ?, workspace_root = ?,
		    permission_mode = ?, latest_receipt_json = ?, topic_summary = ?,
		    last_active_at = ?, updated_at = ?
		WHERE account_id = ? AND work_session_ref = ? AND deleted_at = '' AND status NOT IN ('deleting', 'deleted')`,
		existing.Record.ProjectionSeq, existing.ProjectionLeaseEpoch, existing.Record.DeviceId, existing.Record.Status, existing.Record.Title,
		existing.Record.WorkspaceRoot, existing.Record.PermissionMode,
		existing.Record.LatestReceiptJson, existing.TopicSummary,
		nowStr, nowStr, accountID, existing.Record.WorkSessionRef,
	); err != nil {
		return nil, nil, err
	}
	if err := upsertSessionFTSTx(ctx, tx, existing); err != nil {
		return nil, nil, err
	}

	if req.GetClearPendingAttention() {
		// Only clear Body-owned approval/interaction attentions; NEVER wipe delivered desktop alarm reminders!
		if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_pending_attention WHERE account_id = ? AND work_session_ref = ? AND attention_kind != 'alarm_reminder'`, accountID, existing.Record.WorkSessionRef); err != nil {
			return nil, nil, err
		}
	}
	if att := req.GetPendingAttention(); att != nil && strings.TrimSpace(att.GetAttentionId()) != "" {
		if strings.EqualFold(strings.TrimSpace(att.GetAttentionKind()), "alarm_reminder") || strings.HasPrefix(att.GetAttentionId(), "alarm_") {
			return nil, nil, errAttentionScopeConflict
		}
		var existingAcct, existingRef, existingKind string
		attErr := tx.QueryRowContext(ctx, `SELECT account_id, work_session_ref, attention_kind FROM runtime_session_pending_attention WHERE attention_id = ?`, att.GetAttentionId()).Scan(&existingAcct, &existingRef, &existingKind)
		if attErr == nil && (existingKind == "alarm_reminder" || existingAcct != accountID || existingRef != existing.Record.WorkSessionRef) {
			return nil, nil, errAttentionScopeConflict
		}
		if attErr != nil && !errors.Is(attErr, sql.ErrNoRows) {
			return nil, nil, attErr
		}
		// Force trust_scope to the verified carrier subject; never trust caller-supplied trust_scope.
		forcedTrustScope := "subject:" + strings.TrimSpace(carrierSubject)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_session_pending_attention(
				attention_id, account_id, work_session_ref, agent_binding,
				attention_kind, trust_scope, summary_json, expires_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(attention_id) DO UPDATE SET
				attention_kind = excluded.attention_kind,
				trust_scope = excluded.trust_scope,
				summary_json = excluded.summary_json,
				expires_at = excluded.expires_at,
				updated_at = excluded.updated_at
			WHERE runtime_session_pending_attention.account_id = excluded.account_id
			  AND runtime_session_pending_attention.work_session_ref = excluded.work_session_ref`,
			att.GetAttentionId(), accountID, existing.Record.WorkSessionRef, existing.Record.AgentBinding,
			att.GetAttentionKind(), forcedTrustScope, att.GetSummaryJson(), att.GetExpiresAt(), nowStr,
		); err != nil {
			return nil, nil, err
		}
	}

	if kind := strings.TrimSpace(req.GetMilestoneKind()); kind != "" && existing.Record.GetTrustTier() == "trusted" && existing.Record.GetSessionKind() != "channel_external" {
		paths, err := json.Marshal(req.GetDeliverablePaths())
		if err != nil {
			return nil, nil, err
		}
		var routingGoal string
		if err := tx.QueryRowContext(ctx, "SELECT routing_goal FROM runtime_session WHERE account_id=? AND work_session_ref=?", accountID, req.GetWorkSessionRef()).Scan(&routingGoal); err != nil {
			return nil, nil, err
		}
		deliveryID := newID("milestone")
		if milestoneReceipt.MilestoneRef != "" {
			deliveryID = "milestone_" + sha256HexString(accountID+"\x00"+req.GetWorkSessionRef()+"\x00"+milestoneReceipt.MilestoneRef)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO runtime_session_milestone
			(delivery_id,account_id,agent_binding,work_session_ref,body_kind,kind,summary,deliverables)
			VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(delivery_id) DO NOTHING`, deliveryID, accountID, existing.Record.GetAgentBinding(), req.GetWorkSessionRef(), verifiedNS, kind, routingGoal, string(paths)); err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return &runtimev1.ReportBodySessionProjectionResponse{
		Applied:              true,
		CurrentProjectionSeq: existing.Record.ProjectionSeq,
		StaleIgnored:         false,
	}, existing, nil
}

func (st *Store) ListPendingAttention(ctx context.Context, accountID string, now time.Time) ([]*runtimev1.PendingAttentionRecord, error) {
	rows, err := st.readDB.QueryContext(ctx, `
		SELECT attention_id, work_session_ref, agent_binding, attention_kind, trust_scope, summary_json, expires_at, updated_at
		FROM runtime_session_pending_attention
		WHERE account_id = ? AND (expires_at = '' OR julianday(expires_at) > julianday(?))
		ORDER BY updated_at DESC LIMIT 100`,
		accountID, formatRFC3339(now),
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var out []*runtimev1.PendingAttentionRecord
	for rows.Next() {
		rec := &runtimev1.PendingAttentionRecord{}
		if err := rows.Scan(
			&rec.AttentionId, &rec.WorkSessionRef, &rec.AgentBinding,
			&rec.AttentionKind, &rec.TrustScope, &rec.SummaryJson, &rec.ExpiresAt, &rec.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// RegisterPrimaryCompanionProjection registers a companion conversation anchor as a
// read-only projection (is_primary_companion = 1) without coupling to any hardcoded app_id.
func (st *Store) RegisterPrimaryCompanionProjection(ctx context.Context, accountID, agentBinding, workSessionRef, title string, now time.Time) error {
	nowStr := formatRFC3339(now)
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `
		INSERT INTO runtime_session(
			work_session_ref, account_id, agent_binding, session_kind, owner_body_kind,
			device_id, publisher_scope_key, is_primary_companion, is_general_inbox,
			title, status, trust_tier, permission_mode, latest_receipt_json,
			topic_summary, last_active_at, created_at, updated_at
		) VALUES (?, ?, ?, 'companion', 'brain', '', 'companion:primary', 1, 0, ?, 'active', 'trusted', 'companion', '{}', '', ?, ?, ?)
		ON CONFLICT(work_session_ref) DO UPDATE SET
			title = excluded.title,
			updated_at = excluded.updated_at`,
		workSessionRef, accountID, agentBinding, title, nowStr, nowStr, nowStr,
	)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (st *Store) sessionMemoryReads(ctx context.Context, account, session string) ([]cognitionmemory.MemoryReadSet, error) {
	rows, err := st.readDB.QueryContext(ctx, "SELECT binding,bank,lifecycle,ref FROM runtime_body_memory_read WHERE account_id=? AND work_session_ref=? ORDER BY binding,bank,lifecycle,ref", account, session)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var sets []cognitionmemory.MemoryReadSet
	for rows.Next() {
		var binding, bank, lifecycle, ref string
		if err := rows.Scan(&binding, &bank, &lifecycle, &ref); err != nil {
			return nil, err
		}
		if len(sets) == 0 || sets[len(sets)-1].BindingRef != binding || sets[len(sets)-1].BankRef != bank || sets[len(sets)-1].LifecycleRef != lifecycle || len(sets[len(sets)-1].Refs) >= 512 {
			sets = append(sets, cognitionmemory.MemoryReadSet{BindingRef: binding, BankRef: bank, LifecycleRef: lifecycle})
		}
		last := &sets[len(sets)-1]
		last.Refs = append(last.Refs, ref)
	}
	return sets, rows.Err()
}

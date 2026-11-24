package agentsession

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
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
	errLeaseConflict             = errors.New("body carrier lease conflict")
	errTombstoneFence            = errors.New("pending purge or invalidate tombstones must be drained first")
	errSubmissionPayloadConflict = errors.New("idempotent submission payload mismatch")
	errAttentionScopeConflict    = errors.New("attention id belongs to a different account or work session")
	errBodyNamespaceMismatch     = errors.New("work session does not belong to caller body namespace or device")
)

// Store manages the physically isolated sessions.db (WAL + synchronous=FULL)
// with a single-writer pool and a concurrent read-only pool for FTS5 BM25
// routing queries outside write transactions.
// @nimi-authority: rule.nimi.runtime.agent-participation.sessions-db-isolation
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

// UpsertPendingAttention persists a standalone attention item (such as a fired
// desktop alarm notice) and returns it for live overview fan-out.
func (st *Store) UpsertPendingAttention(ctx context.Context, accountID string, att *runtimev1.PendingAttentionRecord, now time.Time) error {
	if st == nil || st.writeDB == nil || att == nil || strings.TrimSpace(att.GetAttentionId()) == "" {
		return nil
	}
	nowStr := formatRFC3339(now)
	_, err := st.writeDB.ExecContext(ctx, `
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
	// Additive v1 -> v2 column migrations for pre-existing local sessions.db files.
	additiveAlters := []struct {
		table string
		col   string
		sql   string
	}{
		{"runtime_session", "projection_lease_epoch", `ALTER TABLE runtime_session ADD COLUMN projection_lease_epoch INTEGER NOT NULL DEFAULT 0`},
		{"runtime_body_continuity_ledger", "last_committed_count", `ALTER TABLE runtime_body_continuity_ledger ADD COLUMN last_committed_count INTEGER NOT NULL DEFAULT 0`},
		{"runtime_body_continuity_ledger", "issued_tool_args_json", `ALTER TABLE runtime_body_continuity_ledger ADD COLUMN issued_tool_args_json TEXT NOT NULL DEFAULT '{}'`},
		{"runtime_session_alarm", "last_claimed_occurrence", `ALTER TABLE runtime_session_alarm ADD COLUMN last_claimed_occurrence TEXT NOT NULL DEFAULT ''`},
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
	// Upgrade v1 runtime_session_submission if missing caller_subject or payload_hash.
	hasCallerSubject, err := sqliteTableHasColumn(ctx, db, "runtime_session_submission", "caller_subject")
	if err != nil {
		return fmt.Errorf("inspect runtime_session_submission: %w", err)
	}
	if !hasCallerSubject {
		for _, mig := range []string{
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
			if _, err := db.ExecContext(ctx, mig); err != nil {
				return fmt.Errorf("migrate runtime_session_submission v1->v2: %w", err)
			}
		}
	}
	_, _ = db.ExecContext(ctx, fmt.Sprintf(`INSERT INTO runtime_session_meta(key, value) VALUES ('schema_version', '%d') ON CONFLICT(key) DO UPDATE SET value = excluded.value`, sessionsSchemaVersion))
	return nil
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
		`SELECT `+sessionSelectColumns+` FROM runtime_session WHERE account_id = ? AND work_session_ref = ? AND deleted_at = ''`,
		accountID, workSessionRef,
	)
	res, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errSessionNotFound
	}
	return res, err
}

type readerVisibilityFilter struct {
	FullAccount bool
	ZhiyuScope  bool
	AppScopeKey string
}

func (st *Store) ListSessions(ctx context.Context, accountID, agentBinding string, includeArchived bool, sessionKinds []string, statusFilter string, searchQuery string, visibility readerVisibilityFilter) ([]*sessionRow, int32, error) {
	var args []any
	var where []string
	where = append(where, `account_id = ?`, `deleted_at = ''`, `status != 'deleting'`, `status != 'deleted'`)
	args = append(args, accountID)
	if !visibility.FullAccount {
		if visibility.ZhiyuScope {
			where = append(where, `(session_kind = 'companion' OR is_primary_companion = 1 OR publisher_scope_key = 'app:nimi.zhiyu')`)
		} else {
			where = append(where, `publisher_scope_key != '' AND publisher_scope_key = ?`)
			args = append(args, visibility.AppScopeKey)
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
		return nil, 0, err
	}
	query := `SELECT ` + sessionSelectColumns + ` FROM runtime_session WHERE ` + whereClause + ` ORDER BY updated_at DESC LIMIT 200`
	rows, err := st.readDB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = rows.Close() }()
	var out []*sessionRow
	for rows.Next() {
		item, err := scanSessionRow(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, item)
	}
	return out, totalVisible, rows.Err()
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

// FindActiveGeneralInbox returns the active general_inbox session if still within
// the 2h / 10-turn sliding window.
func (st *Store) FindActiveGeneralInbox(ctx context.Context, accountID, agentBinding string, now time.Time) (*sessionRow, error) {
	row := st.readDB.QueryRowContext(ctx,
		`SELECT `+sessionSelectColumns+` FROM runtime_session
		 WHERE account_id = ? AND agent_binding = ? AND is_general_inbox = 1
		   AND deleted_at = '' AND archived_at = '' AND status NOT IN ('deleting', 'deleted', 'archived')
		 ORDER BY updated_at DESC LIMIT 1`,
		accountID, agentBinding,
	)
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

func (st *Store) LookupSubmission(ctx context.Context, accountID, callerSubject, requestID, payloadHash string) (*runtimev1.RouteAndSubmitInputResponse, error) {
	if strings.TrimSpace(requestID) == "" {
		return nil, nil
	}
	var (
		storedHash    string
		ref           string
		outcome       int32
		routeReason   string
		sessionKind   string
		ownerBodyKind string
		permMode      string
		outboxID      string
		promotedTurns int32
	)
	err := st.readDB.QueryRowContext(ctx, `
		SELECT payload_hash, resolved_work_session_ref, outcome, route_reason, session_kind,
		       owner_body_kind, effective_permission_mode, outbox_id, promoted_handoff_turns
		FROM runtime_session_submission
		WHERE account_id = ? AND caller_subject = ? AND client_submission_id = ?`,
		accountID, callerSubject, requestID,
	).Scan(&storedHash, &ref, &outcome, &routeReason, &sessionKind, &ownerBodyKind, &permMode, &outboxID, &promotedTurns)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if storedHash != "" && payloadHash != "" && storedHash != payloadHash {
		return nil, errSubmissionPayloadConflict
	}
	resp := &runtimev1.RouteAndSubmitInputResponse{
		Outcome:                 runtimev1.RouteAndSubmitOutcome(outcome),
		ResolvedWorkSessionRef:  ref,
		RouteReason:             routeReason,
		SessionKind:             sessionKind,
		OwnerBodyKind:           ownerBodyKind,
		EffectivePermissionMode: permMode,
		OutboxId:                outboxID,
		Deduplicated:            true,
		PromotedHandoffTurns:    promotedTurns,
	}
	if sess, err := st.GetSession(ctx, accountID, ref); err == nil && sess != nil {
		resp.WorkSessionRecord = sess.Record
	}
	return resp, nil
}

type routedCommitInput struct {
	AccountID              string
	CallerSubject          string
	ClientSubmissionID     string
	SubmissionPayloadHash  string
	Session                *sessionRow
	ExistingSessionUpdate  bool
	CloseSourceInboxRef    string
	MoveSourceEventSession string
	MoveSourceEventSeq     int64
	Outcome                runtimev1.RouteAndSubmitOutcome
	RouteReason            string
	OutboxEnvelope         *runtimev1.BodyOutboxEnvelope
	OutboxPayloadHash      string
	BrainEvent             *runtimev1.BrainSessionEventEnvelope
	PromotedTurns          int32
	Now                    time.Time
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
		var (
			storedHash    string
			ref           string
			outcome       int32
			routeReason   string
			sessionKind   string
			ownerBodyKind string
			permMode      string
			outboxID      string
			promotedTurns int32
		)
		err := tx.QueryRowContext(ctx, `
			SELECT payload_hash, resolved_work_session_ref, outcome, route_reason, session_kind,
			       owner_body_kind, effective_permission_mode, outbox_id, promoted_handoff_turns
			FROM runtime_session_submission
			WHERE account_id = ? AND caller_subject = ? AND client_submission_id = ?`,
			in.AccountID, in.CallerSubject, in.ClientSubmissionID,
		).Scan(&storedHash, &ref, &outcome, &routeReason, &sessionKind, &ownerBodyKind, &permMode, &outboxID, &promotedTurns)
		if err == nil {
			if storedHash != "" && in.SubmissionPayloadHash != "" && storedHash != in.SubmissionPayloadHash {
				return nil, false, errSubmissionPayloadConflict
			}
			resp := &runtimev1.RouteAndSubmitInputResponse{
				Outcome:                 runtimev1.RouteAndSubmitOutcome(outcome),
				ResolvedWorkSessionRef:  ref,
				RouteReason:             routeReason,
				SessionKind:             sessionKind,
				OwnerBodyKind:           ownerBodyKind,
				EffectivePermissionMode: permMode,
				OutboxId:                outboxID,
				Deduplicated:            true,
				PromotedHandoffTurns:    promotedTurns,
			}
			return resp, true, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return nil, false, err
		}
	}

	rec := in.Session.Record
	nowStr := formatRFC3339(in.Now)

	var (
		liveStatus      string
		liveDeletedAt   string
		liveHeadSeq     int64
		liveInboxCount  int
		liveProjSeq     int64
		liveProjEpoch   int64
		liveReceiptJSON string
		liveCreatedAt   string
	)
	existsErr := tx.QueryRowContext(ctx, `
		SELECT status, deleted_at, head_seq, inbox_turn_count, projection_seq, projection_lease_epoch, latest_receipt_json, created_at
		FROM runtime_session
		WHERE account_id = ? AND work_session_ref = ?`,
		in.AccountID, rec.WorkSessionRef,
	).Scan(&liveStatus, &liveDeletedAt, &liveHeadSeq, &liveInboxCount, &liveProjSeq, &liveProjEpoch, &liveReceiptJSON, &liveCreatedAt)
	if existsErr == nil {
		if liveDeletedAt != "" || liveStatus == "deleting" || liveStatus == "deleted" {
			return nil, false, errSessionNotFound
		}
		rec.HeadSeq = liveHeadSeq
		rec.ProjectionSeq = liveProjSeq
		in.Session.ProjectionLeaseEpoch = liveProjEpoch
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
		if _, err := tx.ExecContext(ctx, `
			UPDATE runtime_session
			SET status = 'promoted', archived_at = ?, updated_at = ?
			WHERE account_id = ? AND work_session_ref = ? AND is_general_inbox = 1 AND status = 'active'`,
			nowStr, nowStr, in.AccountID, strings.TrimSpace(in.CloseSourceInboxRef),
		); err != nil {
			return nil, false, err
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
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_session_submission(
				account_id, caller_subject, client_submission_id, payload_hash, resolved_work_session_ref, outcome,
				route_reason, session_kind, owner_body_kind, effective_permission_mode,
				outbox_id, promoted_handoff_turns, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			in.AccountID, in.CallerSubject, in.ClientSubmissionID, in.SubmissionPayloadHash, rec.WorkSessionRef, int32(in.Outcome),
			in.RouteReason, rec.SessionKind, rec.OwnerBodyKind, rec.PermissionMode,
			outboxID, in.PromotedTurns, nowStr,
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
	err = tx.QueryRowContext(ctx, `SELECT head_seq FROM runtime_session WHERE account_id = ? AND work_session_ref = ? AND deleted_at = ''`, accountID, workSessionRef).Scan(&headSeq)
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
	if _, err := tx.ExecContext(ctx, `UPDATE runtime_session SET head_seq = ?, updated_at = ?, last_active_at = ? WHERE work_session_ref = ?`, nextSeq, nowStr, nowStr, workSessionRef); err != nil {
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

	row := tx.QueryRowContext(ctx, `SELECT `+sessionSelectColumns+` FROM runtime_session WHERE account_id = ? AND work_session_ref = ? AND deleted_at = ''`, accountID, req.GetWorkSessionRef())
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

	row := tx.QueryRowContext(ctx, `SELECT `+sessionSelectColumns+` FROM runtime_session WHERE account_id = ? AND work_session_ref = ? AND deleted_at = ''`, accountID, workSessionRef)
	existing, err := scanSessionRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, errSessionNotFound
	}
	if err != nil {
		return nil, nil, err
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
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_body_continuity_ledger WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef); err != nil {
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

// PurgeAgentSessionsAndAlarms cascades TerminateAgent into sessions.db:
// marks all sessions for the agent deleted, cancels all its alarms, neutralizes
// pending NEW_INTENTs, and enqueues PURGE_AGENT tombstones for affected Body carriers.
func (st *Store) PurgeAgentSessionsAndAlarms(ctx context.Context, accountID, agentBinding string, now time.Time) ([]string, []*runtimev1.BodyOutboxEnvelope, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	nowStr := formatRFC3339(now)
	rows, err := tx.QueryContext(ctx, `
		SELECT work_session_ref, owner_body_kind, device_id
		FROM runtime_session
		WHERE account_id = ? AND agent_binding = ? AND deleted_at = ''`,
		accountID, agentBinding,
	)
	if err != nil {
		return nil, nil, err
	}
	type targetCarrier struct{ deviceID, ns string }
	carriers := make(map[targetCarrier]struct{})
	var deletedRefs []string
	for rows.Next() {
		var ref, ns, dev string
		if err := rows.Scan(&ref, &ns, &dev); err != nil {
			_ = rows.Close()
			return nil, nil, err
		}
		deletedRefs = append(deletedRefs, ref)
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
	// Always target PC Body namespace so Harness purges any cached agent state even if sessions were already cleared.
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
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_body_continuity_ledger WHERE account_id = ? AND agent_binding = ?`, accountID, agentBinding); err != nil {
		return nil, nil, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE runtime_session_alarm
		SET status = 'cancelled', version = version + 1, updated_at = ?
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
	return deletedRefs, purgeEnvs, nil
}

// RegisterLease persists carrier registration and increments monotonic lease_epoch.
func (st *Store) RegisterLease(ctx context.Context, lease *carrierLease) (int64, []*runtimev1.BodyOutboxEnvelope, []*runtimev1.BodyOutboxEnvelope, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return 0, nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var prevEpoch int64
	var prevSubject string
	var prevActive int
	var prevHeartbeat string
	err = tx.QueryRowContext(ctx, `
		SELECT lease_epoch, carrier_subject, active, last_heartbeat_at
		FROM runtime_body_carrier_lease
		WHERE account_id = ? AND device_id = ? AND capability_namespace = ?`,
		lease.AccountID, lease.DeviceID, lease.CapabilityNamespace,
	).Scan(&prevEpoch, &prevSubject, &prevActive, &prevHeartbeat)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, nil, nil, err
	}
	key := leaseMapKey(lease.AccountID, lease.DeviceID, lease.CapabilityNamespace)
	if err == nil && prevActive != 0 && prevSubject != lease.CarrierSubject {
		lastHB := st.effectiveHeartbeat(key, prevHeartbeat)
		if lease.LastHeartbeatAt.Sub(lastHB) < LeaseTTL {
			return 0, nil, nil, errLeaseConflict
		}
	}
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
	if now.Sub(st.effectiveHeartbeat(key, heartbeatRaw)) > LeaseTTL*2 {
		return false, nil
	}
	return true, nil
}

func (st *Store) FindActiveCarrierDevice(ctx context.Context, accountID, ns string, now time.Time) (string, bool, error) {
	rows, err := st.readDB.QueryContext(ctx, `
		SELECT device_id, last_heartbeat_at
		FROM runtime_body_carrier_lease
		WHERE account_id = ? AND capability_namespace = ? AND active = 1`,
		accountID, ns,
	)
	if err != nil {
		return "", false, err
	}
	defer func() { _ = rows.Close() }()
	bestDev := ""
	var bestTime time.Time
	for rows.Next() {
		var devID, hbRaw string
		if err := rows.Scan(&devID, &hbRaw); err != nil {
			return "", false, err
		}
		key := leaseMapKey(accountID, devID, ns)
		eff := st.effectiveHeartbeat(key, hbRaw)
		if now.Sub(eff) <= LeaseTTL*2 && (bestDev == "" || eff.After(bestTime)) {
			bestDev = devID
			bestTime = eff
		}
	}
	if err := rows.Err(); err != nil {
		return "", false, err
	}
	return bestDev, bestDev != "", nil
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

func (st *Store) AckOutbox(ctx context.Context, accountID, deviceID, ns, outboxID, resultState string, now time.Time) (bool, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback() }()

	var workSessionRef, agentBinding string
	var cmdKind int32
	err = tx.QueryRowContext(ctx, `
		SELECT work_session_ref, agent_binding, command_kind FROM runtime_body_outbox
		WHERE account_id = ? AND outbox_id = ? AND capability_namespace = ?
		  AND (device_id = ? OR device_id = 'local-default')
		  AND state = 'pending'`,
		accountID, outboxID, ns, deviceID,
	).Scan(&workSessionRef, &agentBinding, &cmdKind)
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
	case runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_SESSION:
		_, _ = tx.ExecContext(ctx, `UPDATE runtime_session SET body_purge_pending = 0 WHERE account_id = ? AND work_session_ref = ?`, accountID, workSessionRef)
	case runtimev1.BodyOutboxCommandKind_BODY_OUTBOX_COMMAND_KIND_PURGE_AGENT:
		_, _ = tx.ExecContext(ctx, `UPDATE runtime_session SET body_purge_pending = 0 WHERE account_id = ? AND agent_binding = ? AND owner_body_kind = ?`, accountID, agentBinding, ns)
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
		       issued_tool_call_ids_json, issued_tool_args_json, read_set_epoch, compaction_count, effective_context_budget_tokens, updated_at
		FROM runtime_body_continuity_ledger
		WHERE account_id = ? AND work_session_ref = ?`,
		accountID, workSessionRef,
	).Scan(
		&rec.WorkSessionRef, &rec.AccountID, &rec.AgentBinding,
		&rec.LastStepMAC, &rec.LastCommittedCount, &rec.PostCompactionMAC, &rec.IssuedToolCallIDsJSON,
		&rec.IssuedToolArgsJSON, &rec.ReadSetEpoch, &rec.CompactionCount, &rec.EffectiveContextBudgetTokens, &rec.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return rec, err
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

func (st *Store) ApplyBodyProjection(ctx context.Context, accountID, verifiedNS string, req *runtimev1.ReportBodySessionProjectionRequest, now time.Time) (*runtimev1.ReportBodySessionProjectionResponse, *sessionRow, error) {
	tx, err := st.writeDB.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback() }()

	// Tombstone fence evaluated INSIDE the write transaction to eliminate TOCTOU.
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
	// - Newer epoch resets sequence baseline (so Harness restart starting at seq=1 is accepted!).
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
		existing.Record.PermissionMode = pm
	}
	if r := strings.TrimSpace(req.GetLatestReceiptJson()); r != "" {
		existing.Record.LatestReceiptJson = r
	}
	if ts := strings.TrimSpace(req.GetTopicSummary()); ts != "" {
		existing.TopicSummary = ts
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
		if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_session_pending_attention WHERE account_id = ? AND work_session_ref = ?`, accountID, existing.Record.WorkSessionRef); err != nil {
			return nil, nil, err
		}
	}
	if att := req.GetPendingAttention(); att != nil && strings.TrimSpace(att.GetAttentionId()) != "" {
		var existingAcct, existingRef string
		attErr := tx.QueryRowContext(ctx, `SELECT account_id, work_session_ref FROM runtime_session_pending_attention WHERE attention_id = ?`, att.GetAttentionId()).Scan(&existingAcct, &existingRef)
		if attErr == nil && (existingAcct != accountID || existingRef != existing.Record.WorkSessionRef) {
			return nil, nil, errAttentionScopeConflict
		}
		if attErr != nil && !errors.Is(attErr, sql.ErrNoRows) {
			return nil, nil, attErr
		}
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
			att.GetAttentionKind(), att.GetTrustScope(), att.GetSummaryJson(), att.GetExpiresAt(), nowStr,
		); err != nil {
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

func (st *Store) ListPendingAttention(ctx context.Context, accountID string) ([]*runtimev1.PendingAttentionRecord, error) {
	rows, err := st.readDB.QueryContext(ctx, `
		SELECT attention_id, work_session_ref, agent_binding, attention_kind, trust_scope, summary_json, expires_at, updated_at
		FROM runtime_session_pending_attention
		WHERE account_id = ?
		ORDER BY updated_at DESC LIMIT 100`,
		accountID,
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

// RegisterPrimaryCompanionProjection registers a Zhiyu conversation anchor as a
// read-only projection (is_primary_companion = 1) without touching Zhiyu write storage.
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
		) VALUES (?, ?, ?, 'companion', 'brain', '', 'app:nimi.zhiyu', 1, 0, ?, 'active', 'trusted', 'companion', '{}', '', ?, ?, ?)
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

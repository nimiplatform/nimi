package appactivity

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/oklog/ulid/v2"
)

const recordColumns = `activity_id, account_id, publisher_kind, publisher_ref, publisher_key, source_ref,
	create_seq, change_seq, revision, content_hash, kind, todo_state, attention, title, summary,
	object_ref, activity_type, data_json, agent_local_ref, agent_ref, agent_display_name,
	occurred_at_ms, published_at_ms, updated_at_ms, terminal_at_ms, read_through_revision`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanRecord(row rowScanner) (storedRecord, error) {
	var record storedRecord
	var attention int
	err := row.Scan(
		&record.ActivityID, &record.AccountID, &record.PublisherKind, &record.PublisherRef, &record.PublisherKey,
		&record.SourceRef, &record.CreateSeq, &record.ChangeSeq, &record.Revision, &record.ContentHash,
		&record.Kind, &record.TodoState, &attention, &record.Title, &record.Summary, &record.ObjectRef,
		&record.ActivityType, &record.DataJSON, &record.AgentLocalRef, &record.AgentRef, &record.AgentDisplayName,
		&record.OccurredAtMS, &record.PublishedAtMS, &record.UpdatedAtMS, &record.TerminalAtMS,
		&record.ReadThroughRevision,
	)
	record.Attention = attention == 1
	return record, err
}

type querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func loadRecordByID(ctx context.Context, q querier, accountID, activityID string) (storedRecord, error) {
	record, err := scanRecord(q.QueryRowContext(ctx,
		`SELECT `+recordColumns+` FROM runtime_app_activity_record WHERE activity_id = ? AND account_id = ?`,
		activityID, accountID))
	if errors.Is(err, sql.ErrNoRows) {
		return storedRecord{}, ErrNotFound
	}
	return record, err
}

func loadRecordByKey(ctx context.Context, q querier, accountID, publisherKind, publisherRef, key string) (storedRecord, bool, error) {
	record, err := scanRecord(q.QueryRowContext(ctx,
		`SELECT `+recordColumns+` FROM runtime_app_activity_record
		 WHERE account_id = ? AND publisher_kind = ? AND publisher_ref = ? AND publisher_key = ?`,
		accountID, publisherKind, publisherRef, key))
	if errors.Is(err, sql.ErrNoRows) {
		return storedRecord{}, false, nil
	}
	if err != nil {
		return storedRecord{}, false, err
	}
	return record, true, nil
}

// accountFencedTx reports whether Account-terminal cleanup has fenced the
// account namespace. The fence table is owned by the Runtime Agent owner.
func accountFencedTx(ctx context.Context, tx *sql.Tx, accountID string) (bool, error) {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM runtime_realm_account_termination WHERE account_id = ?`, accountID).Scan(&count); err != nil {
		return false, fmt.Errorf("inspect App activity account fence: %w", err)
	}
	return count > 0, nil
}

func nextChangeSeqTx(ctx context.Context, tx *sql.Tx, accountID string) (uint64, error) {
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO runtime_app_activity_account(account_id, last_change_seq, replay_floor_seq) VALUES(?, 0, 0)
		 ON CONFLICT(account_id) DO NOTHING`, accountID); err != nil {
		return 0, fmt.Errorf("ensure App activity account sequence: %w", err)
	}
	var seq uint64
	if err := tx.QueryRowContext(ctx,
		`UPDATE runtime_app_activity_account SET last_change_seq = last_change_seq + 1 WHERE account_id = ? RETURNING last_change_seq`,
		accountID).Scan(&seq); err != nil {
		return 0, fmt.Errorf("advance App activity account sequence: %w", err)
	}
	return seq, nil
}

func accountSequence(ctx context.Context, q querier, accountID string) (last uint64, floor uint64, err error) {
	err = q.QueryRowContext(ctx,
		`SELECT last_change_seq, replay_floor_seq FROM runtime_app_activity_account WHERE account_id = ?`,
		accountID).Scan(&last, &floor)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, nil
	}
	return last, floor, err
}

func insertChangeTx(ctx context.Context, tx *sql.Tx, record storedRecord, kind string, committedAtMS int64) error {
	imageJSON := ""
	if kind == changeKindUpsert {
		encoded, err := json.Marshal(record.image())
		if err != nil {
			return fmt.Errorf("encode App activity change image: %w", err)
		}
		imageJSON = string(encoded)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO runtime_app_activity_change(account_id, change_seq, activity_id, change_kind, record_json, committed_at_ms)
		 VALUES(?, ?, ?, ?, ?, ?)`,
		record.AccountID, record.ChangeSeq, record.ActivityID, kind, imageJSON, committedAtMS); err != nil {
		return fmt.Errorf("insert App activity change: %w", err)
	}
	return nil
}

func insertRecordTx(ctx context.Context, tx *sql.Tx, record storedRecord) error {
	_, err := tx.ExecContext(ctx, `INSERT INTO runtime_app_activity_record(`+recordColumns+`)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		record.ActivityID, record.AccountID, record.PublisherKind, record.PublisherRef, record.PublisherKey,
		record.SourceRef, record.CreateSeq, record.ChangeSeq, record.Revision, record.ContentHash,
		record.Kind, record.TodoState, boolInt(record.Attention), record.Title, record.Summary, record.ObjectRef,
		record.ActivityType, record.DataJSON, record.AgentLocalRef, record.AgentRef, record.AgentDisplayName,
		record.OccurredAtMS, record.PublishedAtMS, record.UpdatedAtMS, record.TerminalAtMS, record.ReadThroughRevision)
	if err != nil {
		return fmt.Errorf("insert App activity record: %w", err)
	}
	return nil
}

func updateRecordTx(ctx context.Context, tx *sql.Tx, record storedRecord) error {
	result, err := tx.ExecContext(ctx, `UPDATE runtime_app_activity_record SET
		change_seq = ?, revision = ?, content_hash = ?, todo_state = ?, attention = ?, title = ?, summary = ?,
		object_ref = ?, activity_type = ?, data_json = ?, agent_local_ref = ?, agent_ref = ?, agent_display_name = ?,
		occurred_at_ms = ?, updated_at_ms = ?, terminal_at_ms = ?, read_through_revision = ?
		WHERE activity_id = ? AND account_id = ?`,
		record.ChangeSeq, record.Revision, record.ContentHash, record.TodoState, boolInt(record.Attention),
		record.Title, record.Summary, record.ObjectRef, record.ActivityType, record.DataJSON, record.AgentLocalRef,
		record.AgentRef, record.AgentDisplayName, record.OccurredAtMS, record.UpdatedAtMS, record.TerminalAtMS,
		record.ReadThroughRevision, record.ActivityID, record.AccountID)
	if err != nil {
		return fmt.Errorf("update App activity record: %w", err)
	}
	if count, err := result.RowsAffected(); err != nil || count != 1 {
		return fmt.Errorf("update App activity record: %w", ErrConflict)
	}
	return nil
}

// publishTx creates or revises one publisher-partitioned record. The result
// reports whether a new change committed.
func publishTx(
	ctx context.Context,
	tx *sql.Tx,
	accountID, publisherKind, publisherRef string,
	input publishInput,
	agent AgentFacts,
	nowMS int64,
) (storedRecord, bool, error) {
	fenced, err := accountFencedTx(ctx, tx, accountID)
	if err != nil {
		return storedRecord{}, false, err
	}
	if fenced {
		return storedRecord{}, false, ErrAccountFenced
	}
	hash := contentHash(input, agent.LocalAgentRef)
	existing, found, err := loadRecordByKey(ctx, tx, accountID, publisherKind, publisherRef, input.Key)
	if err != nil {
		return storedRecord{}, false, err
	}
	if found {
		if existing.Kind != input.Kind {
			return storedRecord{}, false, fmt.Errorf("%w: kind is fixed for a key", ErrInvalidInput)
		}
		if input.Revision == existing.Revision {
			if existing.ContentHash == hash {
				return existing, false, nil
			}
			return storedRecord{}, false, ErrConflict
		}
		if input.Revision < existing.Revision {
			return storedRecord{}, false, ErrConflict
		}
	}
	seq, err := nextChangeSeqTx(ctx, tx, accountID)
	if err != nil {
		return storedRecord{}, false, err
	}
	agentRefValue := ""
	if agent.LocalAgentRef != "" {
		agentRefValue = AgentAssociationRef(accountID, agent.LocalAgentRef)
	}
	record := storedRecord{
		AccountID: accountID, PublisherKind: publisherKind, PublisherRef: publisherRef, PublisherKey: input.Key,
		SourceRef: sourceRef(accountID, publisherKind, publisherRef), ChangeSeq: seq, Revision: input.Revision,
		ContentHash: hash, Kind: input.Kind, TodoState: input.TodoState, Attention: input.Attention,
		Title: input.Title, Summary: input.Summary, ObjectRef: input.ObjectRef, ActivityType: input.ActivityType,
		DataJSON: input.DataJSON, AgentLocalRef: agent.LocalAgentRef, AgentRef: agentRefValue,
		AgentDisplayName: agent.DisplayName, OccurredAtMS: input.OccurredAtMS, UpdatedAtMS: nowMS,
	}
	if found {
		record.ActivityID = existing.ActivityID
		record.CreateSeq = existing.CreateSeq
		record.PublishedAtMS = existing.PublishedAtMS
		record.ReadThroughRevision = existing.ReadThroughRevision
		record.TerminalAtMS = existing.TerminalAtMS
		switch {
		case !terminalState(record.TodoState):
			record.TerminalAtMS = 0
		case !terminalState(existing.TodoState):
			record.TerminalAtMS = nowMS
		}
		if err := updateRecordTx(ctx, tx, record); err != nil {
			return storedRecord{}, false, err
		}
	} else {
		record.ActivityID = "act_" + ulid.Make().String()
		record.CreateSeq = seq
		record.PublishedAtMS = nowMS
		if terminalState(record.TodoState) {
			record.TerminalAtMS = nowMS
		}
		if err := insertRecordTx(ctx, tx, record); err != nil {
			return storedRecord{}, false, err
		}
	}
	if err := insertChangeTx(ctx, tx, record, changeKindUpsert, nowMS); err != nil {
		return storedRecord{}, false, err
	}
	return record, true, nil
}

// markReadTx advances the shared read-through revision monotonically.
func markReadTx(ctx context.Context, tx *sql.Tx, accountID, activityID string, displayedRevision uint64, nowMS int64) (storedRecord, bool, error) {
	record, err := loadRecordByID(ctx, tx, accountID, activityID)
	if err != nil {
		return storedRecord{}, false, err
	}
	if displayedRevision == 0 || displayedRevision > record.Revision {
		return storedRecord{}, false, fmt.Errorf("%w: displayed revision", ErrInvalidInput)
	}
	if displayedRevision <= record.ReadThroughRevision {
		return record, false, nil
	}
	seq, err := nextChangeSeqTx(ctx, tx, accountID)
	if err != nil {
		return storedRecord{}, false, err
	}
	record.ReadThroughRevision = displayedRevision
	record.ChangeSeq = seq
	if err := updateRecordTx(ctx, tx, record); err != nil {
		return storedRecord{}, false, err
	}
	if err := insertChangeTx(ctx, tx, record, changeKindUpsert, nowMS); err != nil {
		return storedRecord{}, false, err
	}
	return record, true, nil
}

// removeRecordsTx deletes records with content-free remove changes. When
// purgeHistory is true every retained change payload of those records is
// deleted and the replay floor advances past the purged range.
func removeRecordsTx(ctx context.Context, tx *sql.Tx, accountID string, activityIDs []string, purgeHistory bool, nowMS int64) error {
	for _, activityID := range activityIDs {
		if purgeHistory {
			var maxSeq sql.NullInt64
			if err := tx.QueryRowContext(ctx,
				`SELECT MAX(change_seq) FROM runtime_app_activity_change WHERE account_id = ? AND activity_id = ?`,
				accountID, activityID).Scan(&maxSeq); err != nil {
				return fmt.Errorf("inspect App activity history: %w", err)
			}
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM runtime_app_activity_change WHERE account_id = ? AND activity_id = ?`,
				accountID, activityID); err != nil {
				return fmt.Errorf("purge App activity history: %w", err)
			}
			if maxSeq.Valid {
				if err := raiseReplayFloorTx(ctx, tx, accountID, uint64(maxSeq.Int64)); err != nil {
					return err
				}
			}
		}
		result, err := tx.ExecContext(ctx,
			`DELETE FROM runtime_app_activity_record WHERE account_id = ? AND activity_id = ?`, accountID, activityID)
		if err != nil {
			return fmt.Errorf("remove App activity record: %w", err)
		}
		if count, _ := result.RowsAffected(); count == 0 {
			continue
		}
		seq, err := nextChangeSeqTx(ctx, tx, accountID)
		if err != nil {
			return err
		}
		if err := insertChangeTx(ctx, tx, storedRecord{AccountID: accountID, ActivityID: activityID, ChangeSeq: seq}, changeKindRemove, nowMS); err != nil {
			return err
		}
	}
	return nil
}

func raiseReplayFloorTx(ctx context.Context, tx *sql.Tx, accountID string, floor uint64) error {
	if _, err := tx.ExecContext(ctx,
		`UPDATE runtime_app_activity_account SET replay_floor_seq = MAX(replay_floor_seq, ?) WHERE account_id = ?`,
		floor, accountID); err != nil {
		return fmt.Errorf("advance App activity replay floor: %w", err)
	}
	return nil
}

type changeRow struct {
	Seq        uint64
	Kind       string
	ActivityID string
	Image      recordImage
}

func loadChangesAfter(ctx context.Context, q querier, accountID string, cursor uint64, limit int) ([]changeRow, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT change_seq, change_kind, activity_id, record_json FROM runtime_app_activity_change
		 WHERE account_id = ? AND change_seq > ? ORDER BY change_seq LIMIT ?`,
		accountID, cursor, limit)
	if err != nil {
		return nil, fmt.Errorf("read App activity changes: %w", err)
	}
	defer func() { _ = rows.Close() }()
	changes := make([]changeRow, 0, limit)
	for rows.Next() {
		var change changeRow
		var imageJSON string
		if err := rows.Scan(&change.Seq, &change.Kind, &change.ActivityID, &imageJSON); err != nil {
			return nil, fmt.Errorf("scan App activity change: %w", err)
		}
		if change.Kind == changeKindUpsert {
			if err := json.Unmarshal([]byte(imageJSON), &change.Image); err != nil || change.Image.ActivityID != change.ActivityID {
				return nil, fmt.Errorf("decode App activity change image: %w", ErrUnavailable)
			}
		}
		changes = append(changes, change)
	}
	return changes, rows.Err()
}

// listFilter is the validated query predicate shared by first pages and
// continuations.
type listFilter struct {
	SourceRef      string
	Kind           string
	TodoStates     []string
	AgentRef       string
	OccurredAfter  int64
	OccurredBefore int64
}

func (filter listFilter) where() (string, []any) {
	clauses := []string{}
	args := []any{}
	if filter.SourceRef != "" {
		clauses = append(clauses, "source_ref = ?")
		args = append(args, filter.SourceRef)
	}
	if filter.Kind != "" {
		clauses = append(clauses, "kind = ?")
		args = append(args, filter.Kind)
	}
	if len(filter.TodoStates) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(filter.TodoStates)), ",")
		clauses = append(clauses, "todo_state IN ("+placeholders+")")
		for _, state := range filter.TodoStates {
			args = append(args, state)
		}
	}
	if filter.AgentRef != "" {
		clauses = append(clauses, "agent_ref = ?")
		args = append(args, filter.AgentRef)
	}
	if filter.OccurredAfter != 0 {
		clauses = append(clauses, "occurred_at_ms >= ?")
		args = append(args, filter.OccurredAfter)
	}
	if filter.OccurredBefore != 0 {
		clauses = append(clauses, "occurred_at_ms < ?")
		args = append(args, filter.OccurredBefore)
	}
	if len(clauses) == 0 {
		return "", nil
	}
	return " AND " + strings.Join(clauses, " AND "), args
}

func listPage(ctx context.Context, q querier, accountID string, filter listFilter, bound uint64, afterCreateSeq uint64, afterID string, limit int) ([]storedRecord, error) {
	where, args := filter.where()
	query := `SELECT ` + recordColumns + ` FROM runtime_app_activity_record WHERE account_id = ? AND create_seq <= ?` + where
	params := append([]any{accountID, bound}, args...)
	if afterCreateSeq != 0 {
		query += ` AND (create_seq < ? OR (create_seq = ? AND activity_id < ?))`
		params = append(params, afterCreateSeq, afterCreateSeq, afterID)
	}
	query += ` ORDER BY create_seq DESC, activity_id DESC LIMIT ?`
	params = append(params, limit)
	rows, err := q.QueryContext(ctx, query, params...)
	if err != nil {
		return nil, fmt.Errorf("list App activity: %w", err)
	}
	defer func() { _ = rows.Close() }()
	records := make([]storedRecord, 0, limit)
	for rows.Next() {
		record, err := scanRecord(rows)
		if err != nil {
			return nil, fmt.Errorf("scan App activity: %w", err)
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

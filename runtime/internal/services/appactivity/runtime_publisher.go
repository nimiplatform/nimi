package appactivity

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// RuntimeAgentTurn is one committed completed LocalAgent Conversation turn.
// Every field comes from the committed fact, never from the initiating App or
// the currently signed-in account.
type RuntimeAgentTurn struct {
	AccountID        string
	LocalAgentRef    string
	AgentDisplayName string
	TurnID           string
	CommittedAt      time.Time
}

// PublishRuntimeAgentTurnTx publishes the fixed Runtime-origin activity inside
// the caller's committed-turn transaction. It is idempotent per turn and skips
// fenced accounts. The caller must call NotifyCommitted after commit when the
// returned value is true.
// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-006
// @nimi-authority: rule.nimi.runtime.agent-service.r064
func PublishRuntimeAgentTurnTx(ctx context.Context, tx *sql.Tx, turn RuntimeAgentTurn) (bool, error) {
	if tx == nil || !boundedLine(turn.AccountID, 256) || !boundedLine(turn.LocalAgentRef, 256) ||
		!boundedLine(turn.TurnID, 200) || turn.CommittedAt.IsZero() {
		return false, fmt.Errorf("%w: Runtime Agent turn", ErrInvalidInput)
	}
	displayName := strings.TrimSpace(turn.AgentDisplayName)
	if !boundedLine(displayName, 256) {
		displayName = ""
	}
	input := publishInput{
		Key: "turn:" + turn.TurnID, Revision: 1, Kind: kindActivity, Title: runtimeAgentTurnTitle,
		ActivityType: RuntimeAgentTurnActivityType, OccurredAtMS: turn.CommittedAt.UTC().UnixMilli(),
	}
	existing, found, err := loadRecordByKey(ctx, tx, turn.AccountID, publisherKindRuntimeAgent, runtimeAgentPublisherRef, input.Key)
	if err != nil {
		return false, err
	}
	if found && existing.AgentLocalRef == turn.LocalAgentRef {
		return false, nil
	}
	_, changed, err := publishTx(ctx, tx, turn.AccountID, publisherKindRuntimeAgent, runtimeAgentPublisherRef, input,
		AgentFacts{LocalAgentRef: turn.LocalAgentRef, DisplayName: displayName}, turn.CommittedAt.UTC().UnixMilli())
	if err == ErrAccountFenced {
		return false, nil
	}
	return changed, err
}

// RemoveAgentActivityTx runs inside the LocalAgent termination transaction. It
// removes the Agent's Runtime-origin records with their read state, purges
// every retained change payload that carries the Agent association (including
// payloads whose current record retention already removed), and clears only
// the structured Agent association from App-published records. It returns the
// affected accounts to notify after commit.
// @nimi-authority: rule.nimi.platform.core-protocol.p-actv-007
// @nimi-authority: rule.nimi.runtime.agent-service.r054
func RemoveAgentActivityTx(ctx context.Context, tx *sql.Tx, localAgentRef string, now time.Time) ([]string, error) {
	if tx == nil || strings.TrimSpace(localAgentRef) == "" {
		return nil, fmt.Errorf("%w: LocalAgent reference", ErrInvalidInput)
	}
	rows, err := tx.QueryContext(ctx, `SELECT `+recordColumns+` FROM runtime_app_activity_record WHERE agent_local_ref = ?`, localAgentRef)
	if err != nil {
		return nil, fmt.Errorf("list LocalAgent App activity: %w", err)
	}
	records := []storedRecord{}
	for rows.Next() {
		record, err := scanRecord(rows)
		if err != nil {
			_ = rows.Close()
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	nowMS := now.UTC().UnixMilli()
	accounts := map[string]bool{}
	partitions, err := activityAccounts(ctx, tx)
	if err != nil {
		return nil, err
	}
	for _, accountID := range partitions {
		purged, err := purgeAgentPayloadsTx(ctx, tx, accountID, AgentAssociationRef(accountID, localAgentRef))
		if err != nil {
			return nil, err
		}
		if purged {
			accounts[accountID] = true
		}
	}
	for _, record := range records {
		accounts[record.AccountID] = true
		if record.PublisherKind == publisherKindRuntimeAgent {
			if err := removeRecordsTx(ctx, tx, record.AccountID, []string{record.ActivityID}, true, nowMS); err != nil {
				return nil, err
			}
			continue
		}
		seq, err := nextChangeSeqTx(ctx, tx, record.AccountID)
		if err != nil {
			return nil, err
		}
		record.AgentLocalRef = ""
		record.AgentRef = ""
		record.AgentDisplayName = ""
		record.ChangeSeq = seq
		if err := updateRecordTx(ctx, tx, record); err != nil {
			return nil, err
		}
		if err := insertChangeTx(ctx, tx, record, changeKindUpsert, nowMS); err != nil {
			return nil, err
		}
	}
	result := make([]string, 0, len(accounts))
	for accountID := range accounts {
		result = append(result, accountID)
	}
	return result, nil
}

// purgeAgentPayloadsTx deletes every retained upsert payload of the account
// that carries the Agent reference and advances the replay floor past the
// purged range, so a cursor that would need one of them expires instead of
// replaying it. Content-free removes carry no Agent facts and stay.
func purgeAgentPayloadsTx(ctx context.Context, tx *sql.Tx, accountID, ref string) (bool, error) {
	const match = `account_id = ? AND change_kind = 'upsert' AND json_extract(record_json, '$.agentRef') = ?`
	var maxSeq sql.NullInt64
	if err := tx.QueryRowContext(ctx,
		`SELECT MAX(change_seq) FROM runtime_app_activity_change WHERE `+match, accountID, ref).Scan(&maxSeq); err != nil {
		return false, fmt.Errorf("inspect LocalAgent App activity payloads: %w", err)
	}
	if !maxSeq.Valid {
		return false, nil
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM runtime_app_activity_change WHERE `+match, accountID, ref); err != nil {
		return false, fmt.Errorf("purge LocalAgent App activity payloads: %w", err)
	}
	return true, raiseReplayFloorTx(ctx, tx, accountID, uint64(maxSeq.Int64))
}

// RemoveAccountActivityTx removes a terminally deleted Account's complete
// activity partition inside the Account-terminal cleanup transaction.
// @nimi-authority: rule.nimi.runtime.protected-session.r033
func RemoveAccountActivityTx(ctx context.Context, tx *sql.Tx, accountID string) error {
	if tx == nil || strings.TrimSpace(accountID) == "" {
		return fmt.Errorf("%w: account", ErrInvalidInput)
	}
	for _, statement := range []string{
		`DELETE FROM runtime_app_activity_change WHERE account_id = ?`,
		`DELETE FROM runtime_app_activity_record WHERE account_id = ?`,
		`DELETE FROM runtime_app_activity_account WHERE account_id = ?`,
	} {
		if _, err := tx.ExecContext(ctx, statement, accountID); err != nil {
			return fmt.Errorf("remove Account App activity: %w", err)
		}
	}
	return nil
}

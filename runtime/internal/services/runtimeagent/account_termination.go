package runtimeagent

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
)

var (
	ErrRealmAccountTerminationConflict    = errors.New("Realm Account termination contract conflict")
	ErrRealmAccountTerminationUnavailable = errors.New("Realm Account termination is unavailable")
)

type realmAccountTerminationRow struct {
	AccountID   string
	OperationID string
	DeletedAt   string
	Phase       string
}

type realmAccountTerminationItemRow struct {
	OperationID      string
	LocalAgentRef    string
	OwnerAccountID   string
	RuntimeSourceRef string
	ChildOperationID string
}

// ConsumeRealmAccountDeletedResult is the only Account-level deletion ingress.
// The Account package first observes the exact typed Realm refresh result; this
// method then atomically persists the permanent Account fence, snapshots every
// locally owned Agent regardless of lifecycle, and establishes every child's
// Memory/outbox/AI barrier before cleanup starts.
// @nimi-authority: rule.nimi.runtime.protected-session.r033
// @nimi-authority: rule.nimi.runtime.agent-participation.r192
// @nimi-authority: rule.nimi.runtime.memory-world.r024
func (s *Service) ConsumeRealmAccountDeletedResult(ctx context.Context, result accountservice.ObservedRealmAccountDeletedResult) error {
	if s == nil || s.backend == nil {
		return ErrRealmAccountTerminationUnavailable
	}
	s.accountTerminationMu.Lock()
	defer s.accountTerminationMu.Unlock()
	if _, err := s.custodyObservedRealmAccountDeletedResult(ctx, result); err != nil {
		return err
	}
	if err := s.resumeRealmAccountTerminations(ctx); err != nil && s.logger != nil {
		s.logger.Warn("Realm Account deletion cleanup remains pending", "account_id", result.AccountID(), "operation_id", result.OperationID(), "error", err)
	}
	return nil
}

// ResumeRealmAccountTerminations resumes only already-custodied local work.
// It performs no Realm request or acknowledgement and is safe at startup.
func (s *Service) ResumeRealmAccountTerminations(ctx context.Context) error {
	if s == nil || s.backend == nil {
		return ErrRealmAccountTerminationUnavailable
	}
	s.accountTerminationMu.Lock()
	defer s.accountTerminationMu.Unlock()
	return s.resumeRealmAccountTerminations(ctx)
}

func (s *Service) custodyObservedRealmAccountDeletedResult(ctx context.Context, result accountservice.ObservedRealmAccountDeletedResult) (string, error) {
	if !result.Observed() || !validRealmAccountTerminationText(result.AccountID()) || !validRealmAccountTerminationText(result.OperationID()) || result.DeletedAt().IsZero() || result.Reason() != accountservice.RealmAccountDeletedReason {
		return "", ErrRealmAccountTerminationConflict
	}
	if s.cognitionMemoryTermination == nil {
		return "", ErrRealmAccountTerminationUnavailable
	}
	accountID := result.AccountID()
	operationID := result.OperationID()
	deletedAt := result.DeletedAt().UTC().Format(time.RFC3339Nano)

	s.mu.Lock()
	targets := make([]realmAccountTerminationItemRow, 0)
	for _, entry := range s.agents {
		if entry == nil || entry.Agent == nil || strings.TrimSpace(entry.Agent.GetOwnerUserId()) != accountID {
			continue
		}
		localAgentRef := strings.TrimSpace(entry.Agent.GetLocalAgentRef())
		runtimeSourceRef := strings.TrimSpace(entry.Agent.GetRuntimeSourceRef())
		if localAgentRef == "" || runtimeSourceRef == "" {
			s.mu.Unlock()
			return "", ErrRealmAccountTerminationConflict
		}
		targets = append(targets, realmAccountTerminationItemRow{
			OperationID: operationID, LocalAgentRef: localAgentRef, OwnerAccountID: accountID,
			RuntimeSourceRef: runtimeSourceRef, ChildOperationID: "ratagent_" + ulid.Make().String(),
		})
	}
	sort.Slice(targets, func(i, j int) bool { return targets[i].LocalAgentRef < targets[j].LocalAgentRef })
	for _, target := range targets {
		s.beginAgentTerminationFence(target.LocalAgentRef)
	}

	fencedRefs := make([]string, 0, len(targets))
	now := time.Now().UTC().Format(time.RFC3339Nano)
	err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		existing, found, err := loadRealmAccountTerminationTx(tx, accountID, operationID)
		if err != nil {
			return err
		}
		if found {
			if existing.AccountID != accountID || existing.OperationID != operationID || existing.DeletedAt != deletedAt {
				return ErrRealmAccountTerminationConflict
			}
			rows, err := tx.Query(`SELECT local_agent_ref FROM runtime_realm_account_termination_item WHERE operation_id = ? ORDER BY local_agent_ref`, operationID)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var ref string
				if err := rows.Scan(&ref); err != nil {
					return err
				}
				fencedRefs = append(fencedRefs, ref)
			}
			return rows.Err()
		}

		phase := "fenced"
		if len(targets) == 0 {
			phase = "completed"
		}
		if _, err := tx.Exec(`INSERT INTO runtime_realm_account_termination(account_id, operation_id, deleted_at, phase, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)`, accountID, operationID, deletedAt, phase, now, now); err != nil {
			return err
		}
		for _, target := range targets {
			if _, err := s.cognitionMemoryTermination.PrepareAgentTerminationTx(tx, target.LocalAgentRef, target.ChildOperationID, memoryv1.DeleteReasonAccountTermination); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_realm_account_termination_item(operation_id, local_agent_ref, owner_account_id, runtime_source_ref, child_operation_id, phase, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 'pending', ?, ?)`, target.OperationID, target.LocalAgentRef, target.OwnerAccountID, target.RuntimeSourceRef, target.ChildOperationID, now, now); err != nil {
				return err
			}
			fencedRefs = append(fencedRefs, target.LocalAgentRef)
		}
		return nil
	})
	if err != nil {
		for _, target := range targets {
			s.endAgentTerminationFence(target.LocalAgentRef)
		}
		s.mu.Unlock()
		return "", fmt.Errorf("custody observed Realm Account deletion: %w", err)
	}
	if s.accountTerminationFencedAccounts == nil {
		s.accountTerminationFencedAccounts = make(map[string]bool)
	}
	s.accountTerminationFencedAccounts[accountID] = true
	s.chatSurfaceMu.Lock()
	for _, ref := range fencedRefs {
		s.chatDurableTerminatingAgents[ref] = true
	}
	for _, target := range targets {
		if count := s.chatTerminatingAgents[target.LocalAgentRef]; count > 1 {
			s.chatTerminatingAgents[target.LocalAgentRef] = count - 1
		} else {
			delete(s.chatTerminatingAgents, target.LocalAgentRef)
		}
	}
	s.chatSurfaceMu.Unlock()
	s.mu.Unlock()
	return operationID, nil
}

func (s *Service) resumeRealmAccountTerminations(ctx context.Context) error {
	terminations, err := s.listFencedRealmAccountTerminations(ctx)
	if err != nil {
		return err
	}
	for _, termination := range terminations {
		if err := s.resumeRealmAccountTerminationItems(ctx, termination); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) resumeRealmAccountTerminationItems(ctx context.Context, termination realmAccountTerminationRow) error {
	items, err := s.listPendingRealmAccountTerminationItems(ctx, termination.OperationID)
	if err != nil {
		return err
	}
	for _, item := range items {
		if item.OperationID != termination.OperationID || item.OwnerAccountID != termination.AccountID {
			return ErrRealmAccountTerminationConflict
		}
		outcome, err := s.terminateRealmAccountOwnedAgent(ctx, item)
		if err != nil {
			return err
		}
		if err := s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
			updated, err := tx.Exec(`UPDATE runtime_realm_account_termination_item SET phase = 'completed', outcome = ?, updated_at = ? WHERE operation_id = ? AND local_agent_ref = ? AND owner_account_id = ? AND child_operation_id = ? AND phase = 'pending'`, outcome, time.Now().UTC().Format(time.RFC3339Nano), item.OperationID, item.LocalAgentRef, item.OwnerAccountID, item.ChildOperationID)
			if err != nil {
				return err
			}
			count, err := updated.RowsAffected()
			if err != nil || count != 1 {
				return ErrRealmAccountTerminationConflict
			}
			return nil
		}); err != nil {
			return fmt.Errorf("complete Realm Account termination child: %w", err)
		}
	}
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		var pending int
		if err := tx.QueryRow(`SELECT COUNT(*) FROM runtime_realm_account_termination_item WHERE operation_id = ? AND phase != 'completed'`, termination.OperationID).Scan(&pending); err != nil {
			return err
		}
		if pending != 0 {
			return ErrRealmAccountTerminationUnavailable
		}
		updated, err := tx.Exec(`UPDATE runtime_realm_account_termination SET phase = 'completed', updated_at = ? WHERE account_id = ? AND operation_id = ? AND phase = 'fenced'`, time.Now().UTC().Format(time.RFC3339Nano), termination.AccountID, termination.OperationID)
		if err != nil {
			return err
		}
		count, err := updated.RowsAffected()
		if err != nil || count != 1 {
			return ErrRealmAccountTerminationConflict
		}
		return nil
	})
}

func (s *Service) terminateRealmAccountOwnedAgent(ctx context.Context, item realmAccountTerminationItemRow) (string, error) {
	s.mu.RLock()
	entry := cloneAgentEntry(s.agents[item.LocalAgentRef])
	s.mu.RUnlock()
	if entry == nil || entry.Agent == nil {
		return string(memoryv1.OutcomeAlreadyAbsent), nil
	}
	if strings.TrimSpace(entry.Agent.GetOwnerUserId()) != item.OwnerAccountID || strings.TrimSpace(entry.Agent.GetRuntimeSourceRef()) != item.RuntimeSourceRef || strings.TrimSpace(entry.Agent.GetLocalAgentRef()) != item.LocalAgentRef {
		return "", ErrRealmAccountTerminationConflict
	}
	identity := localAgentIdentity{OwnerUserID: item.OwnerAccountID, RuntimeSourceRef: item.RuntimeSourceRef, LocalAgentRef: item.LocalAgentRef}
	if _, err := s.agentAdminRuntime().terminateOwned(ctx, identity, item.ChildOperationID, memoryv1.DeleteReasonAccountTermination, "Realm Account terminal deletion"); err != nil {
		return "", fmt.Errorf("terminate Realm Account LocalAgent %s: %w", item.LocalAgentRef, err)
	}
	return string(memoryv1.OutcomeDeleted), nil
}

func (s *Service) loadRealmAccountTerminationState(ctx context.Context) error {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT t.account_id, i.local_agent_ref FROM runtime_realm_account_termination t LEFT JOIN runtime_realm_account_termination_item i ON i.operation_id = t.operation_id ORDER BY t.account_id, i.local_agent_ref`)
	if err != nil {
		return fmt.Errorf("load Realm Account termination fences: %w", err)
	}
	defer rows.Close()
	accounts := make(map[string]bool)
	refs := make([]string, 0)
	for rows.Next() {
		var accountID string
		var localAgentRef sql.NullString
		if err := rows.Scan(&accountID, &localAgentRef); err != nil {
			return err
		}
		accounts[accountID] = true
		if localAgentRef.Valid && strings.TrimSpace(localAgentRef.String) != "" {
			refs = append(refs, localAgentRef.String)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	s.accountTerminationFencedAccounts = accounts
	s.chatSurfaceMu.Lock()
	for _, ref := range refs {
		s.chatDurableTerminatingAgents[ref] = true
	}
	s.chatSurfaceMu.Unlock()
	s.mu.Unlock()
	return nil
}

func (s *Service) accountTerminationFencedLocked(accountID string) bool {
	return s.accountTerminationFencedAccounts[strings.TrimSpace(accountID)]
}

func (s *Service) listFencedRealmAccountTerminations(ctx context.Context) ([]realmAccountTerminationRow, error) {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT account_id, operation_id, deleted_at, phase FROM runtime_realm_account_termination WHERE phase = 'fenced' ORDER BY deleted_at, operation_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []realmAccountTerminationRow
	for rows.Next() {
		var row realmAccountTerminationRow
		if err := rows.Scan(&row.AccountID, &row.OperationID, &row.DeletedAt, &row.Phase); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (s *Service) listPendingRealmAccountTerminationItems(ctx context.Context, operationID string) ([]realmAccountTerminationItemRow, error) {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT operation_id, local_agent_ref, owner_account_id, runtime_source_ref, child_operation_id FROM runtime_realm_account_termination_item WHERE operation_id = ? AND phase = 'pending' ORDER BY local_agent_ref`, operationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []realmAccountTerminationItemRow
	for rows.Next() {
		var row realmAccountTerminationItemRow
		if err := rows.Scan(&row.OperationID, &row.LocalAgentRef, &row.OwnerAccountID, &row.RuntimeSourceRef, &row.ChildOperationID); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func loadRealmAccountTerminationTx(tx *sql.Tx, accountID, operationID string) (realmAccountTerminationRow, bool, error) {
	var row realmAccountTerminationRow
	err := tx.QueryRow(`SELECT account_id, operation_id, deleted_at, phase FROM runtime_realm_account_termination WHERE account_id = ? OR operation_id = ?`, accountID, operationID).Scan(&row.AccountID, &row.OperationID, &row.DeletedAt, &row.Phase)
	if errors.Is(err, sql.ErrNoRows) {
		return realmAccountTerminationRow{}, false, nil
	}
	if err != nil {
		return realmAccountTerminationRow{}, false, err
	}
	return row, true, nil
}

func validRealmAccountTerminationText(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && len(value) <= 512
}

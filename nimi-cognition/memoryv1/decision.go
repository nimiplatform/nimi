package memoryv1

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

func (c *Core) MarkProcessing(ctx context.Context, operationID string) (Outcome, error) {
	if !validOpaqueRef(operationID) {
		return OutcomeInvalid, contractError(OutcomeInvalid, "operation_id")
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return OutcomeUnavailable, fmt.Errorf("mark processing: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	operation, err := loadOperationTx(tx, operationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return OutcomeInvalid, contractError(OutcomeInvalid, "unknown_operation")
		}
		return OutcomeUnavailable, fmt.Errorf("mark processing: inspect operation: %w", err)
	}
	if operation.Kind != "commit" {
		return OutcomeConflict, contractError(OutcomeConflict, "operation_kind")
	}
	if operation.Outcome.TerminalRemember() {
		return operation.Outcome, nil
	}
	if operation.Outcome != OutcomeReceived && operation.Outcome != OutcomeProcessing {
		return OutcomeConflict, contractError(OutcomeConflict, "operation_state")
	}
	now := formatTime(c.now())
	if _, err := tx.ExecContext(ctx, `UPDATE memory_operations SET outcome = ?, updated_at = ? WHERE operation_id = ?`, OutcomeProcessing, now, operationID); err != nil {
		return OutcomeUnavailable, fmt.Errorf("mark processing: update operation: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memory_receipts SET outcome = ? WHERE operation_id = ?`, OutcomeProcessing, operationID); err != nil {
		return OutcomeUnavailable, fmt.Errorf("mark processing: update receipt: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return OutcomeUnavailable, fmt.Errorf("mark processing: commit: %w", err)
	}
	return OutcomeProcessing, nil
}

// @nimi-authority: rule.nimi.cognition.memory.r003
// @nimi-authority: rule.nimi.cognition.memory.r005
// @nimi-authority: rule.nimi.cognition.memory.r006
func (c *Core) CommitDecision(ctx context.Context, operationID string, plan MutationPlan) (DecisionResult, error) {
	if !validOpaqueRef(operationID) {
		return DecisionResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "operation_id")
	}
	if err := validateMutationPlan(plan); err != nil {
		return DecisionResult{Outcome: errorOutcome(err)}, err
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	operation, err := loadOperationTx(tx, operationID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return DecisionResult{Outcome: OutcomeInvalid}, contractError(OutcomeInvalid, "unknown_operation")
		}
		return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: inspect operation: %w", err)
	}
	if operation.Kind != "commit" {
		return DecisionResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "operation_kind")
	}
	if operation.Outcome.TerminalRemember() {
		var prior DecisionResult
		if len(operation.ResultJSON) == 0 || json.Unmarshal(operation.ResultJSON, &prior) != nil {
			return DecisionResult{Outcome: OutcomeFailed}, contractError(OutcomeFailed, "stored_result")
		}
		return prior, nil
	}
	if operation.Outcome != OutcomeReceived && operation.Outcome != OutcomeProcessing {
		return DecisionResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "operation_state")
	}
	var payload []byte
	var receiptLifecycle, receiptOutcome string
	if err := tx.QueryRowContext(ctx, `SELECT lifecycle_ref, outcome, payload FROM memory_receipts WHERE operation_id = ?`, operationID).Scan(&receiptLifecycle, &receiptOutcome, &payload); err != nil {
		return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: load custody: %w", err)
	}
	var request CommitRequest
	if len(payload) == 0 || json.Unmarshal(payload, &request) != nil {
		return DecisionResult{Outcome: OutcomeFailed}, contractError(OutcomeFailed, "custody_payload")
	}
	var currentLifecycle, bankState, bindingState string
	if err := tx.QueryRowContext(ctx, `SELECT b.lifecycle_ref, b.state, x.state FROM memory_bank_bindings x JOIN memory_banks b ON b.bank_ref = x.bank_ref WHERE x.binding_ref = ? AND b.bank_ref = ?`, request.BindingRef, request.BankRef).Scan(&currentLifecycle, &bankState, &bindingState); err != nil {
		return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: inspect bank: %w", err)
	}
	if bankState != "active" || bindingState != "active" {
		return DecisionResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, "bank_deleted")
	}
	if receiptLifecycle != currentLifecycle {
		plan = MutationPlan{Outcome: OutcomeNoEffect}
	}
	if err := validatePlanAgainstEventTx(ctx, tx, request, plan); err != nil {
		if staleCorrectionTarget(err, request, plan) || staleConflictTarget(err, plan) {
			plan = MutationPlan{Outcome: OutcomeNoEffect}
		} else {
			return DecisionResult{Outcome: errorOutcome(err)}, err
		}
	}

	result := DecisionResult{Outcome: plan.Outcome, OperationID: operationID}
	if plan.Outcome == OutcomeAdmitted {
		for _, mutation := range plan.Mutations {
			memoryRef, err := c.newRef("mem")
			if err != nil {
				return DecisionResult{Outcome: OutcomeFailed}, err
			}
			insertLifecycle := LifecycleCurrent
			supersedesRef := mutation.TargetMemoryRef
			if mutation.Kind == MutationCorrection || mutation.Kind == MutationConflict {
				targetLifecycle := LifecycleSuperseded
				targetCode := "correction_target"
				if mutation.Kind == MutationConflict {
					targetLifecycle = LifecycleConflicted
					insertLifecycle = LifecycleConflicted
					supersedesRef = ""
					targetCode = "memory_conflict_target"
				}
				updated, err := tx.ExecContext(ctx, `UPDATE memories SET lifecycle = ?, updated_at = ? WHERE memory_ref = ? AND bank_ref = ? AND lifecycle = ?`, targetLifecycle, formatTime(c.now()), mutation.TargetMemoryRef, request.BankRef, LifecycleCurrent)
				if err != nil {
					return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: update target lifecycle: %w", err)
				}
				count, err := updated.RowsAffected()
				if err != nil || count != 1 {
					return DecisionResult{Outcome: OutcomeConflict}, contractError(OutcomeConflict, targetCode)
				}
			}
			now := c.now().UTC()
			occurredAt := mutation.OccurredAt.UTC()
			if occurredAt.IsZero() {
				occurredAt = request.CommittedAt.UTC()
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO memories(memory_ref, bank_ref, content, epistemic_status, lifecycle, occurred_at, updated_at, source_explanation, event_ref, supersedes_ref) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''))`, memoryRef, request.BankRef, mutation.Content, mutation.EpistemicStatus, insertLifecycle, formatTime(occurredAt), formatTime(now), mutation.SourceExplanation, request.EventRef, supersedesRef); err != nil {
				return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: insert memory: %w", err)
			}
			for _, subject := range request.Subjects {
				if _, err := tx.ExecContext(ctx, `INSERT INTO memory_lineage(memory_ref, ref_type, ref_kind, ref_value) VALUES(?, 'subject', ?, ?)`, memoryRef, subject.Kind, subject.Value); err != nil {
					return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: insert subject lineage: %w", err)
				}
			}
			for _, source := range request.Sources {
				if _, err := tx.ExecContext(ctx, `INSERT INTO memory_lineage(memory_ref, ref_type, ref_kind, ref_value) VALUES(?, 'source', ?, ?)`, memoryRef, source.Kind, source.Value); err != nil {
					return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: insert source lineage: %w", err)
				}
			}
			result.AffectedMemoryRefs = append(result.AffectedMemoryRefs, memoryRef)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_banks SET canonical_version = canonical_version + 1, updated_at = ? WHERE bank_ref = ?`, formatTime(c.now()), request.BankRef); err != nil {
			return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: advance canonical version: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE memory_derived_generations SET status = 'building', updated_at = ? WHERE bank_ref = ?`, formatTime(c.now()), request.BankRef); err != nil {
			return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: invalidate derived generations: %w", err)
		}
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return DecisionResult{Outcome: OutcomeFailed}, fmt.Errorf("commit decision: encode result: %w", err)
	}
	now := formatTime(c.now())
	if _, err := tx.ExecContext(ctx, `UPDATE memory_operations SET outcome = ?, result_json = ?, updated_at = ? WHERE operation_id = ?`, result.Outcome, resultJSON, now, operationID); err != nil {
		return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: save operation result: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memory_receipts SET outcome = ?, terminal_at = ? WHERE operation_id = ?`, result.Outcome, now, operationID); err != nil {
		return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: save receipt result: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return DecisionResult{Outcome: OutcomeUnavailable}, fmt.Errorf("commit decision: commit: %w", err)
	}
	return result, nil
}

func staleCorrectionTarget(err error, request CommitRequest, plan MutationPlan) bool {
	if request.Fact.Kind != EventKindCorrection || request.Fact.Correction == nil || plan.Outcome != OutcomeAdmitted {
		return false
	}
	var contractErr *ContractError
	if !errors.As(err, &contractErr) || contractErr.Outcome != OutcomeConflict {
		return false
	}
	return contractErr.Code == "correction_target" || contractErr.Code == "correction_target_lifecycle"
}

func staleConflictTarget(err error, plan MutationPlan) bool {
	if plan.Outcome != OutcomeAdmitted || len(plan.Mutations) != 1 || plan.Mutations[0].Kind != MutationConflict {
		return false
	}
	var contractErr *ContractError
	if !errors.As(err, &contractErr) || contractErr.Outcome != OutcomeConflict {
		return false
	}
	return contractErr.Code == "memory_conflict_target" || contractErr.Code == "memory_conflict_target_lifecycle"
}

func validateMutationPlan(plan MutationPlan) error {
	switch plan.Outcome {
	case OutcomeRejected, OutcomeNoEffect:
		if len(plan.Mutations) != 0 {
			return contractError(OutcomeInvalid, "zero_effect_plan")
		}
	case OutcomeAdmitted:
		if len(plan.Mutations) == 0 {
			return contractError(OutcomeInvalid, "admitted_plan_empty")
		}
	default:
		return contractError(OutcomeInvalid, "terminal_decision")
	}
	for _, mutation := range plan.Mutations {
		if mutation.Kind != MutationRemember && mutation.Kind != MutationCorrection && mutation.Kind != MutationConflict {
			return contractError(OutcomeInvalid, "mutation_kind")
		}
		if mutation.Kind == MutationRemember && mutation.TargetMemoryRef != "" {
			return contractError(OutcomeInvalid, "remember_target")
		}
		if (mutation.Kind == MutationCorrection || mutation.Kind == MutationConflict) && !validOpaqueRef(mutation.TargetMemoryRef) {
			return contractError(OutcomeInvalid, "correction_target")
		}
		if !validContent(mutation.Content) || !validContent(mutation.SourceExplanation) {
			return contractError(OutcomeInvalid, "mutation_content")
		}
		switch mutation.EpistemicStatus {
		case EpistemicExplicit, EpistemicInferred, EpistemicConsolidated:
		default:
			return contractError(OutcomeInvalid, "epistemic_status")
		}
		if forbiddenMemoryContent(mutation.Content) {
			return contractError(OutcomeRejected, "forbidden_content")
		}
	}
	return nil
}

func validatePlanAgainstEventTx(ctx context.Context, tx *sql.Tx, request CommitRequest, plan MutationPlan) error {
	if plan.Outcome != OutcomeAdmitted {
		return nil
	}
	for _, mutation := range plan.Mutations {
		if (request.Fact.Kind == EventKindMessage && request.Fact.Message != nil && request.Fact.Message.Actor != ActorUser) && mutation.EpistemicStatus == EpistemicExplicit {
			return contractError(OutcomeRejected, "epistemic_overstatement")
		}
		if mutation.Kind == MutationCorrection {
			if request.Fact.Kind != EventKindCorrection || request.Fact.Correction == nil || request.Fact.Correction.TargetMemoryRef != mutation.TargetMemoryRef || request.Fact.Correction.CorrectedContent != mutation.Content || mutation.EpistemicStatus != EpistemicExplicit {
				return contractError(OutcomeConflict, "correction_event_binding")
			}
			var lifecycle string
			if err := tx.QueryRowContext(ctx, `SELECT lifecycle FROM memories WHERE memory_ref = ? AND bank_ref = ?`, mutation.TargetMemoryRef, request.BankRef).Scan(&lifecycle); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return contractError(OutcomeConflict, "correction_target")
				}
				return fmt.Errorf("commit decision: inspect correction target: %w", err)
			}
			if lifecycle != string(LifecycleCurrent) {
				return contractError(OutcomeConflict, "correction_target_lifecycle")
			}
		} else if mutation.Kind == MutationConflict {
			if request.Fact.Kind == EventKindCorrection {
				return contractError(OutcomeConflict, "correction_plan_kind")
			}
			var lifecycle string
			if err := tx.QueryRowContext(ctx, `SELECT lifecycle FROM memories WHERE memory_ref = ? AND bank_ref = ?`, mutation.TargetMemoryRef, request.BankRef).Scan(&lifecycle); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return contractError(OutcomeConflict, "memory_conflict_target")
				}
				return fmt.Errorf("commit decision: inspect Memory conflict target: %w", err)
			}
			if lifecycle != string(LifecycleCurrent) {
				return contractError(OutcomeConflict, "memory_conflict_target_lifecycle")
			}
		} else if request.Fact.Kind == EventKindCorrection {
			return contractError(OutcomeConflict, "correction_plan_kind")
		}
	}
	return nil
}

func forbiddenMemoryContent(content string) bool {
	normalized := strings.ToLower(strings.TrimSpace(content))
	for _, directive := range []string{"do not remember", "don't remember", "不要记住", "别记住", "不要保存"} {
		if strings.Contains(normalized, directive) {
			return true
		}
	}
	for _, pattern := range []string{
		`(?i)\b(?:password|passcode|pin|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|session[ _-]?cookie|secret)\b\s*(?:is|=|:|为|是)\s*\S+`,
		`(?i)(?:我的)?(?:密码|口令|个人识别码|验证码|api[ _-]?密钥|访问令牌|刷新令牌|会话(?:cookie|令牌)|密钥|秘钥)\s*(?:是|为|=|:|：)\s*\S+`,
		`(?i)\b(?:sk_(?:live|test)|ghp_|github_pat_|xox[baprs]-|akia)[a-z0-9_-]{8,}\b`,
		`(?i)\beyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b`,
		`(?i)-----begin [a-z0-9 ]*private key-----`,
	} {
		if regexp.MustCompile(pattern).MatchString(content) {
			return true
		}
	}
	for _, field := range strings.Fields(content) {
		if looksLikeOpaqueCredential(strings.Trim(field, `"'.,;:()[]{}<>`)) {
			return true
		}
	}
	return false
}

func looksLikeOpaqueCredential(value string) bool {
	if len(value) < 24 || len(value) > 512 || strings.Contains(value, "://") {
		return false
	}
	classes := 0
	upper, lower, digit, symbol := false, false, false, false
	unique := make(map[rune]struct{})
	transitions := 0
	previousClass := 0
	runeCount := 0
	for _, char := range value {
		runeCount++
		unique[char] = struct{}{}
		class := 0
		switch {
		case char >= 'A' && char <= 'Z':
			upper = true
			class = 1
		case char >= 'a' && char <= 'z':
			lower = true
			class = 2
		case char >= '0' && char <= '9':
			digit = true
			class = 3
		case strings.ContainsRune("_-/+=.", char):
			symbol = true
			class = 4
		default:
			return false
		}
		if previousClass != 0 && class != previousClass {
			transitions++
		}
		previousClass = class
	}
	for _, present := range []bool{upper, lower, digit, symbol} {
		if present {
			classes++
		}
	}
	// Unlabelled credentials are character-class dense. Human-readable project
	// identifiers may contain the same classes, but usually in a few word-sized
	// runs; do not discard those as secrets merely because they are long.
	return classes >= 3 && len(unique) >= 12 && transitions*3 > runeCount
}

// FinalizeTerminal advances only a contiguous terminal ready frontier and
// removes the complete custody payload after the decision/effect commit.
func (c *Core) FinalizeTerminal(ctx context.Context, operationID string) error {
	if !validOpaqueRef(operationID) {
		return contractError(OutcomeInvalid, "operation_id")
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("finalize terminal: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var bindingRef string
	var outcome Outcome
	if err := tx.QueryRowContext(ctx, `SELECT binding_ref, outcome FROM memory_receipts WHERE operation_id = ?`, operationID).Scan(&bindingRef, &outcome); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return contractError(OutcomeInvalid, "unknown_operation")
		}
		return fmt.Errorf("finalize terminal: inspect receipt: %w", err)
	}
	if !outcome.TerminalRemember() {
		return contractError(OutcomeConflict, "operation_not_terminal")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE memory_receipts SET payload = NULL WHERE operation_id = ?`, operationID); err != nil {
		return fmt.Errorf("finalize terminal: compact payload: %w", err)
	}
	if err := advanceReadyFrontierTx(ctx, tx, bindingRef); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("finalize terminal: commit: %w", err)
	}
	return nil
}

func advanceReadyFrontierTx(ctx context.Context, tx *sql.Tx, bindingRef string) error {
	frontiers, err := loadFrontiersTx(ctx, tx, bindingRef)
	if err != nil {
		return err
	}
	ready := frontiers.Ready
	for ready < frontiers.Received {
		var outcome Outcome
		err := tx.QueryRowContext(ctx, `SELECT outcome FROM memory_receipts WHERE binding_ref = ? AND delivery_sequence = ?`, bindingRef, ready+1).Scan(&outcome)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				break
			}
			return fmt.Errorf("memory core: inspect ready frontier: %w", err)
		}
		if !outcome.TerminalRemember() {
			break
		}
		ready++
	}
	if ready != frontiers.Ready {
		if _, err := tx.ExecContext(ctx, `UPDATE memory_frontiers SET ready_frontier = ? WHERE binding_ref = ?`, ready, bindingRef); err != nil {
			return fmt.Errorf("memory core: advance ready frontier: %w", err)
		}
	}
	return nil
}

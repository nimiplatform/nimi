package localservice

import (
	"strings"
)

// firstRunExecutionTerminalReady and firstRunExecutionTerminalBlocked are the
// fail-closed terminal projections for an executionEvidenceRef
// (product-control-record-schema executionEvidenceRef
// failure_projection: local_ai_ready_or_blocked).
const (
	firstRunExecutionTerminalReady   = "local_ai_ready"
	firstRunExecutionTerminalBlocked = "local_ai_blocked"

	// firstRunExecutionStateReady is the mint/resolve success state.
	firstRunExecutionStateReady   = "local_ai_ready"
	firstRunExecutionStateBlocked = "local_ai_blocked"

	// firstRunExecutionCapabilityTerminalExecuted marks a per-capability proof
	// that executed locally to a terminal result.
	firstRunExecutionCapabilityTerminalExecuted = "local_executed"

	// Minimal first-run baseline capability ids
	// (product-control-record-schema executionEvidenceRef
	// selected_local_first_run_baseline_proof.minimal).
	firstRunCapabilityLocalTextChat = "local_text_chat_execution"
	firstRunCapabilityLocalBasicSTT = "local_basic_stt_execution"
	firstRunCapabilityLocalBasicTTS = "local_basic_tts_execution"

	// firstRunExecutionVerifierIdentity stamps the Runtime execution verifier
	// per K-AIEXEC-007.
	firstRunExecutionVerifierIdentity = "runtime_local_service.first_run_execution_evidence"
)

// firstRunExecutionCapabilityProof is the durable per-capability execution
// proof for a minted executionEvidenceRef. Each proof binds the executed
// scenario, the runtimeBaselineRef baseline consumer + model asset it executed
// against, the resolved local route target, and the terminal execution result.
type firstRunExecutionCapabilityProof struct {
	// Capability is the canonical baseline capability id.
	Capability string `json:"capability"`
	// ScenarioType is the runtime ScenarioType enum name the proof executed.
	ScenarioType string `json:"scenarioType"`
	// BoundConsumerID is the runtimeBaselineRef baseline consumer this proof
	// executed against.
	BoundConsumerID string `json:"boundConsumerId"`
	// BoundAssetID is the runtimeBaselineRef-bound model asset id.
	BoundAssetID string `json:"boundAssetId"`
	// LocalRouteTarget is the resolved local execution route target. It is
	// always a local route; a cloud target fails the evidence closed.
	LocalRouteTarget string `json:"localRouteTarget"`
	// RoutePolicy is the resolved route policy enum name; always
	// ROUTE_POLICY_LOCAL for a valid proof.
	RoutePolicy string `json:"routePolicy"`
	// ModelResolved is the runtime-resolved local model id executed.
	ModelResolved string `json:"modelResolved"`
	// TerminalResult is local_executed for a valid proof.
	TerminalResult string `json:"terminalResult"`
	ReasonCode     string `json:"reasonCode,omitempty"`
	// TraceID is the execution trace id stamped by the local execution path.
	TraceID    string `json:"traceId"`
	ExecutedAt string `json:"executedAt"`
}

// firstRunExecutionSchedulingJudgement is the submit-specific scheduling
// judgement recorded into an executionEvidenceRef. It is present only when a
// submit-specific Peek was evaluated for the capability about to execute; a
// scope aggregate judgement is never recorded here (K-AIEXEC-003).
type firstRunExecutionSchedulingJudgement struct {
	Evaluated       bool   `json:"evaluated"`
	Capability      string `json:"capability"`
	SchedulingState string `json:"schedulingState"`
	Detail          string `json:"detail,omitempty"`
	EvaluatedAt     string `json:"evaluatedAt"`
}

// firstRunExecutionEvidenceRecord is the durable first-run baseline execution
// evidence record owned by RuntimeLocalService runtime execution
// (K-AIEXEC-007). It is the backing store for `executionEvidenceRef` consumed
// by product ready admission step 7 (P-COLD-016). It is minted only after
// every selected first-run baseline capability executed through the admitted
// Runtime local execution path and every execution resolved to a local route.
//
// The record carries all ten required_projection fields declared by
// `product-control-record-schema.yaml` -> `evidence_contracts.executionEvidenceRef`.
type firstRunExecutionEvidenceRecord struct {
	// ExecutionEvidenceRef is the durable ULID evidence ref.
	ExecutionEvidenceRef string `json:"executionEvidenceRef"`
	// 1. selected_local_factory_aiProfile_ref
	SelectedLocalFactoryAIProfileRef string `json:"selectedLocalFactoryAiProfileRef"`
	// 2. install_level
	InstallLevel string `json:"installLevel"`
	// 3. runtimeBaselineRef
	RuntimeBaselineRef string `json:"runtimeBaselineRef"`
	// 4. dataRootRef
	DataRootRef string `json:"dataRootRef"`
	// 5. local_execution_target_evidence
	LocalExecutionTargetEvidence []string `json:"localExecutionTargetEvidence"`
	// 6. selected_baseline_capability_proof
	SelectedBaselineCapabilityProof []firstRunExecutionCapabilityProof `json:"selectedBaselineCapabilityProof"`
	// 7. submit_specific_scheduling_judgement_when_evaluated (nil when no
	// submit-specific Peek was evaluated)
	SubmitSpecificSchedulingJudgement *firstRunExecutionSchedulingJudgement `json:"submitSpecificSchedulingJudgement,omitempty"`
	// 8. terminal_result
	TerminalResult string `json:"terminalResult"`
	// 9. timestamps
	ObservedAt string `json:"observedAt"`
	// 10. runtime_audit_sequence
	RuntimeAuditSequence []string `json:"runtimeAuditSequence"`
	// RuntimeVerifierIdentity stamps the Runtime execution verifier.
	RuntimeVerifierIdentity string `json:"runtimeVerifierIdentity"`
}

// upsertFirstRunExecutionEvidenceRecord stores a minted execution evidence
// record keyed by its durable ref and persists state via the wave-3 durable
// state snapshot.
func (s *Service) upsertFirstRunExecutionEvidenceRecord(record firstRunExecutionEvidenceRecord) firstRunExecutionEvidenceRecord {
	record.ExecutionEvidenceRef = strings.TrimSpace(record.ExecutionEvidenceRef)
	s.mu.Lock()
	if s.firstRunExecutionEvidenceRecords == nil {
		s.firstRunExecutionEvidenceRecords = make(map[string]firstRunExecutionEvidenceRecord)
	}
	s.firstRunExecutionEvidenceRecords[record.ExecutionEvidenceRef] = record
	s.persistStateLocked()
	s.mu.Unlock()
	return record
}

// firstRunExecutionEvidenceRecord resolves a durable execution evidence record
// by its ref. A string with no backing durable record fails closed at the
// caller.
func (s *Service) firstRunExecutionEvidenceRecord(executionEvidenceRef string) (firstRunExecutionEvidenceRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.firstRunExecutionEvidenceRecords[strings.TrimSpace(executionEvidenceRef)]
	return record, ok
}

// firstRunExecutionCapabilityIDs returns the ordered set of capability ids that
// must each have a baseline execution proof for an install level. Minimal is
// the local text/chat + basic STT + basic TTS floor; Recommended adds the
// caller-supplied confirmed-plan recommended capabilities on top of that floor.
func firstRunExecutionCapabilityIDs(installLevel string, recommendedCapabilities []string) ([]string, bool) {
	level := normalizeRuntimeBaselineInstallLevel(installLevel)
	if level == "" {
		return nil, false
	}
	minimal := []string{
		firstRunCapabilityLocalTextChat,
		firstRunCapabilityLocalBasicSTT,
		firstRunCapabilityLocalBasicTTS,
	}
	if level == runtimeBaselineInstallLevelMinimal {
		return minimal, true
	}
	// Recommended = the Minimal floor plus every additional confirmed-plan
	// recommended capability.
	out := append([]string(nil), minimal...)
	seen := map[string]struct{}{
		firstRunCapabilityLocalTextChat: {},
		firstRunCapabilityLocalBasicSTT: {},
		firstRunCapabilityLocalBasicTTS: {},
	}
	for _, capability := range recommendedCapabilities {
		trimmed := strings.TrimSpace(capability)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out, true
}

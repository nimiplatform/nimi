package localservice

import (
	"context"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
)

// FirstRunLocalExecution is the cross-service local execution capability the
// executionEvidenceRef minter consumes (K-AIEXEC-007). It is implemented by the
// runtime `ai` service and injected by constructor wiring — internal to the
// runtime, no global state, no sdk/apps import. The execution it performs is
// local-only by construction and asserts a local route target.
type FirstRunLocalExecution interface {
	// ExecuteFirstRunLocalBaseline runs one first-run baseline capability
	// through the admitted Runtime local execution path. It fails closed when
	// the resolved route is not a local route target.
	ExecuteFirstRunLocalBaseline(ctx context.Context, scenarioType runtimev1.ScenarioType, modelID string) (FirstRunLocalExecutionTarget, error)
	// PeekFirstRunLocalBaseline evaluates a submit-specific scheduling Peek for
	// a single first-run baseline capability target (never a scope aggregate).
	PeekFirstRunLocalBaseline(ctx context.Context, capability string) (FirstRunLocalSchedulingJudgement, error)
}

// FirstRunLocalExecutionTarget is the route + execution evidence the `ai`
// service returns for one first-run baseline capability execution.
type FirstRunLocalExecutionTarget struct {
	// RoutePolicy is the resolved route policy enum name; always
	// ROUTE_POLICY_LOCAL for a valid execution.
	RoutePolicy runtimev1.RoutePolicy
	// LocalRouteTarget is the resolved local execution route target.
	LocalRouteTarget string
	// ModelResolved is the runtime-resolved local model id executed.
	ModelResolved string
	// TraceID is the execution trace id stamped by the local execution path.
	TraceID string
}

// FirstRunLocalSchedulingJudgement is a submit-specific scheduling judgement
// for one first-run baseline capability target.
type FirstRunLocalSchedulingJudgement struct {
	Capability      string
	SchedulingState string
	Detail          string
}

// firstRunExecution projection states / reason codes (K-AIEXEC-007 /
// product-control-record-schema executionEvidenceRef).
const (
	firstRunExecutionAuditEventType = "first_run_execution_evidence"

	firstRunExecutionMintAudit          = "first_run_execution_evidence_minted"
	firstRunExecutionResolveAudit       = "first_run_execution_evidence_resolved"
	firstRunExecutionResolveFailedAudit = "first_run_execution_evidence_resolve_failed"

	firstRunExecutionReasonReady                 = "FIRST_RUN_EXECUTION_EVIDENCE_READY"
	firstRunExecutionReasonExecutorMissing       = "FIRST_RUN_EXECUTION_EVIDENCE_EXECUTOR_UNAVAILABLE"
	firstRunExecutionReasonBaselineNotReady      = "FIRST_RUN_EXECUTION_EVIDENCE_BASELINE_NOT_READY"
	firstRunExecutionReasonInstallLevelInvalid   = "FIRST_RUN_EXECUTION_EVIDENCE_INSTALL_LEVEL_INVALID"
	firstRunExecutionReasonFactoryProfileInvalid = "FIRST_RUN_EXECUTION_EVIDENCE_FACTORY_PROFILE_MISMATCH"
	firstRunExecutionReasonDataRootInvalid       = "FIRST_RUN_EXECUTION_EVIDENCE_DATA_ROOT_MISMATCH"
	firstRunExecutionReasonCapabilityUnsupported = "FIRST_RUN_EXECUTION_EVIDENCE_CAPABILITY_UNSUPPORTED"
	firstRunExecutionReasonConsumerMissing       = "FIRST_RUN_EXECUTION_EVIDENCE_CONSUMER_MISSING"
	firstRunExecutionReasonAssetMissing          = "FIRST_RUN_EXECUTION_EVIDENCE_ASSET_MISSING"
	firstRunExecutionReasonExecutionFailed       = "FIRST_RUN_EXECUTION_EVIDENCE_EXECUTION_FAILED"
	firstRunExecutionReasonRouteNotLocal         = "FIRST_RUN_EXECUTION_EVIDENCE_ROUTE_NOT_LOCAL"
	firstRunExecutionReasonRefMissing            = "FIRST_RUN_EXECUTION_EVIDENCE_REF_MISSING"
	firstRunExecutionReasonRefUnknown            = "FIRST_RUN_EXECUTION_EVIDENCE_REF_UNKNOWN"
	firstRunExecutionReasonRefMismatch           = "FIRST_RUN_EXECUTION_EVIDENCE_REF_BINDING_MISMATCH"
	firstRunExecutionReasonRefIncomplete         = "FIRST_RUN_EXECUTION_EVIDENCE_CAPABILITY_SET_INCOMPLETE"
	firstRunExecutionReasonRefRouteCloud         = "FIRST_RUN_EXECUTION_EVIDENCE_ROUTE_CLOUD_RECORDED"
	firstRunExecutionReasonSchedulingFailed      = "FIRST_RUN_EXECUTION_EVIDENCE_SCHEDULING_PEEK_FAILED"
)

// firstRunExecutionCapabilityBinding maps a first-run baseline capability id to
// the runtime ScenarioType and the runtimeBaselineRef baseline consumer it must
// execute against. Only the three admitted Minimal capabilities have canonical
// bindings; recommended-only capabilities are not part of this wave's executor
// path and fail closed (no fabricated binding).
type firstRunExecutionCapabilityBinding struct {
	ScenarioType runtimev1.ScenarioType
	ConsumerID   string
}

var firstRunExecutionCapabilityBindings = map[string]firstRunExecutionCapabilityBinding{
	firstRunCapabilityLocalTextChat: {
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
		ConsumerID:   "llama.cpp.cpu",
	},
	firstRunCapabilityLocalBasicSTT: {
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE,
		ConsumerID:   "speech.qwen3-asr.python",
	},
	firstRunCapabilityLocalBasicTTS: {
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ConsumerID:   "speech.qwen3-tts.python",
	},
}

// SetFirstRunLocalExecutor injects the runtime `ai` service local execution
// capability used by the executionEvidenceRef minter. It is wired by daemon
// bootstrap after both services are constructed (internal-to-runtime).
func (s *Service) SetFirstRunLocalExecutor(executor FirstRunLocalExecution) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.firstRunLocalExecutor = executor
	s.mu.Unlock()
}

func (s *Service) firstRunLocalExecution() FirstRunLocalExecution {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.firstRunLocalExecutor
}

// recordFirstRunExecutionAudit appends a durable Runtime audit/evidence event
// for the executionEvidenceRef and returns the audit id. The audit id sequence
// is part of the executionEvidenceRef required projection.
func (s *Service) recordFirstRunExecutionAudit(operation string, executionEvidenceRef string, reasonCode string, detail string) string {
	auditID := "audit_" + ulid.Make().String()
	event := &runtimev1.LocalAuditEvent{
		Id:         auditID,
		EventType:  firstRunExecutionAuditEventType,
		OccurredAt: nowISO(),
		Source:     "local",
		ReasonCode: boundedLocalAuditField(reasonCode),
		Detail:     boundedLocalAuditField(detail),
		Domain:     localAuditDomain,
		Operation:  boundedLocalAuditField(operation),
		Payload:    firstRunExecutionAuditPayload(executionEvidenceRef),
	}
	s.mu.Lock()
	s.appendRuntimeAuditLocked(event)
	s.mu.Unlock()
	return auditID
}

func firstRunExecutionAuditPayload(executionEvidenceRef string) *structpb.Struct {
	payload, err := structpb.NewStruct(map[string]any{
		"executionEvidenceRef": strings.TrimSpace(executionEvidenceRef),
	})
	if err != nil {
		return nil
	}
	return payload
}

// firstRunExecutionMintRequest is the normalized internal request for minting
// an executionEvidenceRef.
type firstRunExecutionMintRequest struct {
	RuntimeBaselineRef               string
	SelectedLocalFactoryAIProfileRef string
	InstallLevel                     string
	DataRootRef                      string
	HostProfile                      *runtimev1.LocalDeviceProfile
	RecommendedCapabilities          []string
	SubmitSchedulingEvaluated        bool
}

// mintFirstRunExecutionEvidence executes every selected first-run baseline
// capability through the admitted Runtime local execution path and mints a
// durable executionEvidenceRef only when every execution resolved to a local
// route target (K-AIEXEC-007). It fails closed on the first non-local route,
// failed execution, stale runtimeBaselineRef, or unsupported capability.
func (s *Service) mintFirstRunExecutionEvidence(req firstRunExecutionMintRequest) (firstRunExecutionEvidenceRecord, string, string, string) {
	executor := s.firstRunLocalExecution()
	if executor == nil {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonExecutorMissing,
			"runtime first-run local executor is not wired"
	}

	installLevel := normalizeRuntimeBaselineInstallLevel(req.InstallLevel)
	if installLevel == "" {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonInstallLevelInvalid,
			"first-run install level must be minimal or recommended: " + strings.TrimSpace(req.InstallLevel)
	}
	factoryProfileRef := strings.TrimSpace(req.SelectedLocalFactoryAIProfileRef)
	if factoryProfileRef == "" {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonFactoryProfileInvalid,
			"selected first-run local factory AIProfile ref is required"
	}
	dataRootRef := strings.TrimSpace(req.DataRootRef)
	if dataRootRef == "" {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonDataRootInvalid,
			"selected dataRootRef is required"
	}

	// (a) Re-confirm the previously verified runtimeBaselineRef. The execution
	// proof MUST consume a still-ready baseline; a string-only / missing /
	// stale runtimeBaselineRef fails closed before any execution runs.
	baselineRef := strings.TrimSpace(req.RuntimeBaselineRef)
	baseline, baselineState, baselineReason, baselineDetail := s.resolveRuntimeBaselineReadiness(baselineRef, req.HostProfile)
	if baselineState != runtimeBaselineStateReady {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonBaselineNotReady,
			fmt.Sprintf("runtime baseline ref not ready (%s): %s", baselineReason, baselineDetail)
	}
	// The execution evidence binding must match the verified runtime baseline
	// selection — no divergent factory profile / install level / data root.
	if baseline.SelectedLocalFactoryAIProfileRef != factoryProfileRef {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonFactoryProfileInvalid,
			"selected factory AIProfile ref does not match the verified runtimeBaselineRef"
	}
	if normalizeRuntimeBaselineInstallLevel(baseline.InstallLevel) != installLevel {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonInstallLevelInvalid,
			"install level does not match the verified runtimeBaselineRef"
	}
	if strings.TrimSpace(baseline.RuntimeDataRootOrDataRootRef) != dataRootRef {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonDataRootInvalid,
			"dataRootRef does not match the verified runtimeBaselineRef"
	}

	capabilityIDs, ok := firstRunExecutionCapabilityIDs(installLevel, req.RecommendedCapabilities)
	if !ok {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonInstallLevelInvalid,
			"no canonical first-run baseline capability set for install level: " + installLevel
	}

	// Resolve the runtimeBaselineRef-bound model asset per baseline consumer.
	consumerAssets := runtimeBaselineConsumerAssetMap(baseline)

	auditID := s.recordFirstRunExecutionAudit(firstRunExecutionMintAudit, "", firstRunExecutionReasonReady,
		fmt.Sprintf("first-run execution evidence mint started for install_level=%s factory_profile=%s", installLevel, factoryProfileRef))

	proofs := make([]firstRunExecutionCapabilityProof, 0, len(capabilityIDs))
	targetSet := make(map[string]struct{})
	var schedulingJudgement *firstRunExecutionSchedulingJudgement

	for _, capability := range capabilityIDs {
		binding, bound := firstRunExecutionCapabilityBindings[capability]
		if !bound {
			return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonCapabilityUnsupported,
				"first-run baseline capability has no admitted local execution binding: " + capability
		}
		assetID := strings.TrimSpace(consumerAssets[binding.ConsumerID])
		if assetID == "" {
			return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonConsumerMissing,
				fmt.Sprintf("runtimeBaselineRef has no ready consumer %q for capability %q", binding.ConsumerID, capability)
		}

		// (d) Record the submit-specific scheduling judgement only when a
		// submit-specific Peek was evaluated; never substitute a scope
		// aggregate judgement. Evaluated once for the first capability target.
		if req.SubmitSchedulingEvaluated && schedulingJudgement == nil {
			judgement, peekErr := executor.PeekFirstRunLocalBaseline(context.Background(), capability)
			if peekErr != nil {
				return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonSchedulingFailed,
					"submit-specific scheduling peek failed: " + peekErr.Error()
			}
			schedulingJudgement = &firstRunExecutionSchedulingJudgement{
				Evaluated:       true,
				Capability:      judgement.Capability,
				SchedulingState: judgement.SchedulingState,
				Detail:          judgement.Detail,
				EvaluatedAt:     nowISO(),
			}
		}

		// (b) Execute through the admitted local path against the
		// runtimeBaselineRef-bound model asset.
		target, execErr := executor.ExecuteFirstRunLocalBaseline(context.Background(), binding.ScenarioType, assetID)
		if execErr != nil {
			return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonExecutionFailed,
				fmt.Sprintf("local baseline execution failed for capability %q: %s", capability, execErr.Error())
		}
		// (c) Assert the resolved route is a LOCAL route target. A cloud /
		// remote / hybrid route fails the proof closed.
		if target.RoutePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
			return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonRouteNotLocal,
				fmt.Sprintf("capability %q resolved route %s, not a local route target", capability, target.RoutePolicy.String())
		}
		routeTarget := strings.TrimSpace(target.LocalRouteTarget)
		if routeTarget == "" {
			return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonRouteNotLocal,
				fmt.Sprintf("capability %q produced no local execution route target evidence", capability)
		}

		proofs = append(proofs, firstRunExecutionCapabilityProof{
			Capability:       capability,
			ScenarioType:     binding.ScenarioType.String(),
			BoundConsumerID:  binding.ConsumerID,
			BoundAssetID:     assetID,
			LocalRouteTarget: routeTarget,
			RoutePolicy:      target.RoutePolicy.String(),
			ModelResolved:    strings.TrimSpace(target.ModelResolved),
			TerminalResult:   firstRunExecutionCapabilityTerminalExecuted,
			ReasonCode:       firstRunExecutionReasonReady,
			TraceID:          strings.TrimSpace(target.TraceID),
			ExecutedAt:       nowISO(),
		})
		targetSet[routeTarget] = struct{}{}
	}

	ref := "execution_evidence_" + strings.ToLower(ulid.Make().String())
	mintedAuditID := s.recordFirstRunExecutionAudit(firstRunExecutionMintAudit, ref, firstRunExecutionReasonReady,
		fmt.Sprintf("first-run execution evidence minted for %d local baseline capabilities", len(proofs)))

	record := firstRunExecutionEvidenceRecord{
		ExecutionEvidenceRef:              ref,
		SelectedLocalFactoryAIProfileRef:  factoryProfileRef,
		InstallLevel:                      installLevel,
		RuntimeBaselineRef:                baseline.RuntimeBaselineRef,
		DataRootRef:                       dataRootRef,
		LocalExecutionTargetEvidence:      mapKeysSorted(targetSet),
		SelectedBaselineCapabilityProof:   proofs,
		SubmitSpecificSchedulingJudgement: schedulingJudgement,
		TerminalResult:                    firstRunExecutionTerminalReady,
		ObservedAt:                        nowISO(),
		RuntimeAuditSequence:              []string{auditID, mintedAuditID},
		RuntimeVerifierIdentity:           firstRunExecutionVerifierIdentity,
	}
	record = s.upsertFirstRunExecutionEvidenceRecord(record)
	return record, firstRunExecutionStateReady, firstRunExecutionReasonReady, "first-run execution evidence minted"
}

// firstRunExecutionResolveRequest is the normalized internal re-verification
// request for an executionEvidenceRef.
type firstRunExecutionResolveRequest struct {
	ExecutionEvidenceRef       string
	ExpectedRuntimeBaselineRef string
	ExpectedDataRootRef        string
	ExpectedInstallLevel       string
	HostProfile                *runtimev1.LocalDeviceProfile
}

// resolveFirstRunExecutionEvidence re-confirms a stored executionEvidenceRef.
// It is the seam product ready admission step 7 (P-COLD-016) consumes. It fails
// closed for a string-only / missing ref, a ref with no backing durable record,
// a ref whose bound runtimeBaselineRef / dataRootRef / install level no longer
// match the caller's verified composition inputs, a ref with an incomplete
// capability set for its install level, or any ref whose recorded route was
// cloud / non-local. It also re-verifies the bound runtimeBaselineRef.
func (s *Service) resolveFirstRunExecutionEvidence(req firstRunExecutionResolveRequest) (firstRunExecutionEvidenceRecord, string, string, string) {
	ref := strings.TrimSpace(req.ExecutionEvidenceRef)
	if ref == "" {
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonRefMissing,
			"execution evidence ref is required"
	}
	stored, ok := s.firstRunExecutionEvidenceRecord(ref)
	if !ok {
		// A renderer-supplied string with no backing durable record is not
		// evidence.
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonRefUnknown,
			"execution evidence ref has no backing durable record"
	}

	// Stored terminal result must itself be the ready projection.
	if stored.TerminalResult != firstRunExecutionTerminalReady {
		s.recordFirstRunExecutionAudit(firstRunExecutionResolveFailedAudit, ref, firstRunExecutionReasonRefMismatch,
			"stored execution evidence terminal result is not local_ai_ready")
		return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, firstRunExecutionReasonRefMismatch,
			"stored execution evidence terminal result is not local_ai_ready"
	}

	// Caller composition inputs (already verified by their owners) must match
	// the stored evidence binding when supplied.
	if expected := strings.TrimSpace(req.ExpectedRuntimeBaselineRef); expected != "" && expected != stored.RuntimeBaselineRef {
		return s.failFirstRunExecutionResolve(ref, firstRunExecutionReasonRefMismatch,
			"stored executionEvidenceRef runtimeBaselineRef does not match the verified runtimeBaselineRef")
	}
	if expected := strings.TrimSpace(req.ExpectedDataRootRef); expected != "" && expected != stored.DataRootRef {
		return s.failFirstRunExecutionResolve(ref, firstRunExecutionReasonRefMismatch,
			"stored executionEvidenceRef dataRootRef does not match the verified dataRootRef")
	}
	if expected := normalizeRuntimeBaselineInstallLevel(req.ExpectedInstallLevel); expected != "" && expected != normalizeRuntimeBaselineInstallLevel(stored.InstallLevel) {
		return s.failFirstRunExecutionResolve(ref, firstRunExecutionReasonRefMismatch,
			"stored executionEvidenceRef install level does not match the verified install level")
	}

	// Every recorded capability proof must have a local route. A cloud / hybrid
	// / non-local recorded route fails the ref closed.
	for _, proof := range stored.SelectedBaselineCapabilityProof {
		if strings.TrimSpace(proof.RoutePolicy) != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL.String() {
			return s.failFirstRunExecutionResolve(ref, firstRunExecutionReasonRefRouteCloud,
				fmt.Sprintf("recorded capability %q route is %s, not a local route", proof.Capability, proof.RoutePolicy))
		}
		if strings.TrimSpace(proof.TerminalResult) != firstRunExecutionCapabilityTerminalExecuted {
			return s.failFirstRunExecutionResolve(ref, firstRunExecutionReasonRefMismatch,
				fmt.Sprintf("recorded capability %q terminal result is not local_executed", proof.Capability))
		}
		if strings.TrimSpace(proof.LocalRouteTarget) == "" {
			return s.failFirstRunExecutionResolve(ref, firstRunExecutionReasonRefRouteCloud,
				fmt.Sprintf("recorded capability %q has no local route target evidence", proof.Capability))
		}
	}

	// The recorded capability set must be complete for the install level.
	if missing := firstRunExecutionMissingCapabilities(stored); missing != "" {
		return s.failFirstRunExecutionResolve(ref, firstRunExecutionReasonRefIncomplete,
			"executionEvidenceRef capability set is incomplete for install level "+stored.InstallLevel+": missing "+missing)
	}

	// Re-confirm the bound runtimeBaselineRef still resolves ready.
	_, baselineState, baselineReason, baselineDetail := s.resolveRuntimeBaselineReadiness(stored.RuntimeBaselineRef, req.HostProfile)
	if baselineState != runtimeBaselineStateReady {
		return s.failFirstRunExecutionResolve(ref, firstRunExecutionReasonBaselineNotReady,
			fmt.Sprintf("bound runtimeBaselineRef no longer ready (%s): %s", baselineReason, baselineDetail))
	}

	auditID := s.recordFirstRunExecutionAudit(firstRunExecutionResolveAudit, ref, firstRunExecutionReasonReady,
		"first-run execution evidence re-confirmed")
	refreshed := stored
	refreshed.ObservedAt = nowISO()
	refreshed.RuntimeAuditSequence = append(append([]string(nil), stored.RuntimeAuditSequence...), auditID)
	refreshed = s.upsertFirstRunExecutionEvidenceRecord(refreshed)
	return refreshed, firstRunExecutionStateReady, firstRunExecutionReasonReady, "first-run execution evidence re-confirmed"
}

// failFirstRunExecutionResolve records a resolve-failed audit and returns the
// fail-closed projection.
func (s *Service) failFirstRunExecutionResolve(ref string, reasonCode string, detail string) (firstRunExecutionEvidenceRecord, string, string, string) {
	s.recordFirstRunExecutionAudit(firstRunExecutionResolveFailedAudit, ref, reasonCode, detail)
	return firstRunExecutionEvidenceRecord{}, firstRunExecutionStateBlocked, reasonCode, detail
}

// firstRunExecutionMissingCapabilities returns a comma-joined set of capability
// ids that are required for the stored install level but absent from the
// recorded baseline capability proof set, or "" when the set is complete.
func firstRunExecutionMissingCapabilities(record firstRunExecutionEvidenceRecord) string {
	recommended := make([]string, 0)
	for _, proof := range record.SelectedBaselineCapabilityProof {
		capability := strings.TrimSpace(proof.Capability)
		switch capability {
		case firstRunCapabilityLocalTextChat, firstRunCapabilityLocalBasicSTT, firstRunCapabilityLocalBasicTTS, "":
		default:
			recommended = append(recommended, capability)
		}
	}
	required, ok := firstRunExecutionCapabilityIDs(record.InstallLevel, recommended)
	if !ok {
		return "install_level_invalid"
	}
	present := make(map[string]struct{}, len(record.SelectedBaselineCapabilityProof))
	for _, proof := range record.SelectedBaselineCapabilityProof {
		present[strings.TrimSpace(proof.Capability)] = struct{}{}
	}
	missing := make([]string, 0)
	for _, capability := range required {
		if _, ok := present[capability]; !ok {
			missing = append(missing, capability)
		}
	}
	sort.Strings(missing)
	return strings.Join(missing, ",")
}

// runtimeBaselineConsumerAssetMap projects the runtimeBaselineRef
// activation_ready_responses into a consumer id -> bound model asset id map for
// the execution evidence minter. It re-derives nothing — it consumes wave-3
// evidence directly.
func runtimeBaselineConsumerAssetMap(baseline runtimeBaselineReadinessRecord) map[string]string {
	out := make(map[string]string, len(baseline.ActivationReadyResponses))
	for _, response := range baseline.ActivationReadyResponses {
		consumerID := strings.TrimSpace(response.ConsumerID)
		if consumerID == "" {
			continue
		}
		out[consumerID] = strings.TrimSpace(response.BoundAssetID)
	}
	return out
}

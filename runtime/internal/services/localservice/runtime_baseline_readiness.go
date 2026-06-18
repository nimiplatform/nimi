package localservice

import (
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/types/known/structpb"
)

// Runtime baseline readiness projection states and reason codes
// (K-LENV-ACT-011 / product-control-record-schema runtimeBaselineRef
// failure_projection: local_ai_profile_selected_environment_not_ready_or_repair_required).
const (
	runtimeBaselineStateReady          = "ready"
	runtimeBaselineStateNotReady       = "local_ai_profile_selected_environment_not_ready"
	runtimeBaselineStateRepairRequired = "repair_required"

	runtimeBaselineReasonReady                 = "RUNTIME_BASELINE_READINESS_READY"
	runtimeBaselineReasonNotReady              = "RUNTIME_BASELINE_READINESS_ENVIRONMENT_NOT_READY"
	runtimeBaselineReasonRepairRequired        = "RUNTIME_BASELINE_READINESS_REPAIR_REQUIRED"
	runtimeBaselineReasonInstallLevelInvalid   = "RUNTIME_BASELINE_READINESS_INSTALL_LEVEL_INVALID"
	runtimeBaselineReasonFactoryProfileMissing = "RUNTIME_BASELINE_READINESS_FACTORY_PROFILE_MISSING"
	runtimeBaselineReasonDataRootMissing       = "RUNTIME_BASELINE_READINESS_DATA_ROOT_MISSING"
	runtimeBaselineReasonConsumerUnsupported   = "RUNTIME_BASELINE_READINESS_CONSUMER_UNSUPPORTED"
	runtimeBaselineReasonRefUnknown            = "RUNTIME_BASELINE_READINESS_REF_UNKNOWN"
	runtimeBaselineReasonRefMissing            = "RUNTIME_BASELINE_READINESS_REF_MISSING"
	runtimeBaselineReasonRefMismatch           = "RUNTIME_BASELINE_READINESS_REF_BINDING_MISMATCH"

	// runtimeBaselineVerifierIdentity is the Runtime verifier identity stamped
	// onto every minted runtimeBaselineRef per K-LENV-ACT-011.
	runtimeBaselineVerifierIdentity = "runtime_local_service.runtime_baseline_readiness"

	runtimeBaselineAuditEventType = "runtime_baseline_readiness"

	runtimeBaselineMintAudit          = "runtime_baseline_readiness_minted"
	runtimeBaselineResolveAudit       = "runtime_baseline_readiness_resolved"
	runtimeBaselineResolveFailedAudit = "runtime_baseline_readiness_resolve_failed"
)

// recordRuntimeBaselineAudit appends a durable Runtime audit/evidence event for
// the runtime baseline readiness ref and returns the audit id. The audit id
// sequence is part of the runtimeBaselineRef required projection.
func (s *Service) recordRuntimeBaselineAudit(operation string, runtimeBaselineRef string, reasonCode string, detail string) string {
	auditID := "audit_" + ulid.Make().String()
	event := &runtimev1.LocalAuditEvent{
		Id:         auditID,
		EventType:  runtimeBaselineAuditEventType,
		OccurredAt: nowISO(),
		Source:     "local",
		ReasonCode: boundedLocalAuditField(reasonCode),
		Detail:     boundedLocalAuditField(detail),
		Domain:     localAuditDomain,
		Operation:  boundedLocalAuditField(operation),
		Payload:    runtimeBaselineAuditPayload(runtimeBaselineRef),
	}
	s.mu.Lock()
	s.appendRuntimeAuditLocked(event)
	s.mu.Unlock()
	return auditID
}

func runtimeBaselineAuditPayload(runtimeBaselineRef string) *structpb.Struct {
	payload, err := structpb.NewStruct(map[string]any{
		"runtimeBaselineRef": strings.TrimSpace(runtimeBaselineRef),
	})
	if err != nil {
		return nil
	}
	return payload
}

// runtimeBaselineConsumerSet returns the canonical first-run baseline consumer
// id set for an install level. The ids resolve through the existing
// `localEnvironmentConsumerRequirementByID` registry — no new spec consumer is
// invented.
//
// Minimal first-run baseline = local-text + local-speech:
//   - local-text   -> llama.cpp.cpu       (CPU is the universal text baseline;
//     vulkan/cuda are host-capability upgrades, not baseline requirements)
//   - local-speech -> speech.qwen3-asr.python + speech.qwen3-tts.python
//     (P-COLD-016 baseline execution proof requires both basic STT and TTS)
//
// Recommended first-run baseline reuses the Minimal consumer set: the runtime
// baseline readiness ref guarantees the text+speech baseline is ready;
// recommended-only image/video capabilities are confirmed-plan scope, not
// part of the runtime baseline readiness gate. Callers may pin an explicit
// recommended consumer set through `baseline_consumer_ids`.
func runtimeBaselineConsumerSet(installLevel string) ([]string, bool) {
	switch installLevel {
	case runtimeBaselineInstallLevelMinimal, runtimeBaselineInstallLevelRecommended:
		return []string{
			"llama.cpp.cpu",
			"speech.qwen3-asr.python",
			"speech.qwen3-tts.python",
		}, true
	default:
		return nil, false
	}
}

// runtimeBaselineConsumerBinding pins a first-run baseline consumer to the
// model asset selected by the first-run factory AIProfile.
type runtimeBaselineConsumerBinding struct {
	ConsumerID   string
	AssetID      string
	LocalAssetID string
}

// runtimeBaselineConsumerSlotByID maps each engine-keyed first-run baseline
// consumer to the resolver slot id it serves (design/03 consumer<->slot seam).
// The three first-run baseline consumers map one-to-one to the three required
// minimal/recommended preset slots.
var runtimeBaselineConsumerSlotByID = map[string]string{
	"llama.cpp.cpu":           "chat",
	"speech.qwen3-asr.python": "stt",
	"speech.qwen3-tts.python": "tts",
}

// runtimeBaselineResolveRequest is the normalized internal request for both
// minting and re-verifying a runtimeBaselineRef.
type runtimeBaselineResolveRequest struct {
	SelectedLocalFactoryAIProfileRef string
	InstallLevel                     string
	RuntimeDataRootOrDataRootRef     string
	HostProfile                      *runtimev1.LocalDeviceProfile
	// BaselineConsumers pins the first-run baseline consumer set and the model
	// asset bound to each consumer. When empty the canonical consumer set for
	// the install level is resolved by Runtime.
	BaselineConsumers []runtimeBaselineConsumerBinding
}

// runtimeBaselineResolveOutcome is the result of running the activation set
// for a first-run baseline. When State is runtimeBaselineStateReady the
// activation evidence fields are fully populated and a ref may be minted.
type runtimeBaselineResolveOutcome struct {
	State                      string
	ReasonCode                 string
	Detail                     string
	InstallLevel               string
	RequiredDependencyFamilies []string
	SelectedSourceRecordIDs    []string
	VerificationEvidence       []string
	ActivationResponses        []runtimeBaselineActivationConsumerEvidence
}

// normalizeRuntimeBaselineConsumerBindings trims and de-duplicates consumer
// bindings by consumer id, preserving asset binding identity.
func normalizeRuntimeBaselineConsumerBindings(bindings []runtimeBaselineConsumerBinding) []runtimeBaselineConsumerBinding {
	seen := make(map[string]struct{}, len(bindings))
	out := make([]runtimeBaselineConsumerBinding, 0, len(bindings))
	for _, binding := range bindings {
		consumerID := strings.TrimSpace(binding.ConsumerID)
		if consumerID == "" {
			continue
		}
		if _, ok := seen[consumerID]; ok {
			continue
		}
		seen[consumerID] = struct{}{}
		out = append(out, runtimeBaselineConsumerBinding{
			ConsumerID:   consumerID,
			AssetID:      strings.TrimSpace(binding.AssetID),
			LocalAssetID: strings.TrimSpace(binding.LocalAssetID),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ConsumerID < out[j].ConsumerID })
	return out
}

// runtimeBaselineResolveBoundAssetID resolves the durable model asset id bound
// to a consumer for evidence projection and re-verification.
func runtimeBaselineResolveBoundAssetID(s *Service, binding runtimeBaselineConsumerBinding) string {
	if assetID := strings.TrimSpace(binding.AssetID); assetID != "" {
		return assetID
	}
	if localAssetID := strings.TrimSpace(binding.LocalAssetID); localAssetID != "" {
		if model := s.modelByID(localAssetID); model != nil {
			return strings.TrimSpace(model.GetAssetId())
		}
	}
	return ""
}

// resolveRuntimeBaselineActivationSet is the canonical first-run baseline
// consumer/resolver. It maps install level + selected factory AIProfile ref to
// the consumer SET, runs a fresh activation gate for every required consumer,
// and aggregates typed activation evidence. It fails closed on the first
// non-ready required consumer or dependency.
func (s *Service) resolveRuntimeBaselineActivationSet(req runtimeBaselineResolveRequest) runtimeBaselineResolveOutcome {
	installLevel := normalizeRuntimeBaselineInstallLevel(req.InstallLevel)
	if installLevel == "" {
		return runtimeBaselineResolveOutcome{
			State:      runtimeBaselineStateNotReady,
			ReasonCode: runtimeBaselineReasonInstallLevelInvalid,
			Detail:     "first-run install level must be minimal or recommended: " + strings.TrimSpace(req.InstallLevel),
		}
	}
	if strings.TrimSpace(req.SelectedLocalFactoryAIProfileRef) == "" {
		return runtimeBaselineResolveOutcome{
			State:      runtimeBaselineStateNotReady,
			ReasonCode: runtimeBaselineReasonFactoryProfileMissing,
			Detail:     "selected first-run local factory AIProfile ref is required",
		}
	}
	if strings.TrimSpace(req.RuntimeDataRootOrDataRootRef) == "" {
		return runtimeBaselineResolveOutcome{
			State:      runtimeBaselineStateNotReady,
			ReasonCode: runtimeBaselineReasonDataRootMissing,
			Detail:     "selected runtime_data_root / dataRootRef is required",
		}
	}

	// Normalize the host posture once for the whole mint: a caller-supplied
	// HostProfile, or one collected on this host when the request omitted it.
	// The K-MCAT-034 resolver MUST receive this normalized profile — a nil
	// request HostProfile zeroes the resolver RAM budget and fail-closes every
	// cpu variant, projecting a capable host into the first-run blocked state.
	hostProfile := hostProfileOrCollected(req.HostProfile)

	bindings := normalizeRuntimeBaselineConsumerBindings(req.BaselineConsumers)
	if len(bindings) == 0 {
		canonical, ok := runtimeBaselineConsumerSet(installLevel)
		if !ok {
			return runtimeBaselineResolveOutcome{
				State:      runtimeBaselineStateNotReady,
				ReasonCode: runtimeBaselineReasonInstallLevelInvalid,
				Detail:     "no canonical first-run baseline consumer set for install level: " + installLevel,
			}
		}
		// design/03 seam: run the deterministic K-MCAT-034 resolver to fill the
		// per-consumer AssetID from the curated preset + host posture. Without
		// this the bindings carry an empty AssetID and the downstream
		// model.asset dependency fail-closes on LOCAL_ENVIRONMENT_ASSET_ID_REQUIRED.
		resolved, resolveOutcome := s.resolveBaselineConsumerBindings(installLevel, hostProfile, canonical)
		if resolveOutcome.State != runtimeBaselineStateReady {
			return resolveOutcome
		}
		bindings = resolved
	}

	outcome := runtimeBaselineResolveOutcome{
		State:        runtimeBaselineStateReady,
		ReasonCode:   runtimeBaselineReasonReady,
		Detail:       "runtime baseline activation set ready",
		InstallLevel: installLevel,
	}
	familySet := make(map[string]struct{})
	sourceRecordSet := make(map[string]struct{})
	verificationSet := make(map[string]struct{})

	for _, binding := range bindings {
		consumerID := binding.ConsumerID
		requirement, ok := localEnvironmentConsumerRequirementByID(consumerID)
		if !ok {
			return runtimeBaselineResolveOutcome{
				State:      runtimeBaselineStateNotReady,
				ReasonCode: runtimeBaselineReasonConsumerUnsupported,
				Detail:     "first-run baseline consumer is unsupported: " + consumerID,
			}
		}

		// Fresh activation verification per K-LENV-ACT-011: a previous
		// materialization terminal state cannot be reused without re-running
		// the activation gate here.
		gate := s.resolveLocalEnvironmentConsumerActivationGate(localEnvironmentConsumerActivationGateRequest{
			ConsumerID:      consumerID,
			PackID:          requirement.PackID,
			HostProfile:     hostProfile,
			RuntimeDataRoot: req.RuntimeDataRootOrDataRootRef,
			AssetID:         binding.AssetID,
			LocalAssetID:    binding.LocalAssetID,
		})

		consumerEvidence := runtimeBaselineActivationConsumerEvidence{
			ConsumerID:      gate.ConsumerID,
			PackID:          gate.PackID,
			ActivationState: gate.State,
			ReasonCode:      gate.ReasonCode,
			BoundAssetID:    runtimeBaselineResolveBoundAssetID(s, binding),
		}

		if gate.State != localEnvironmentActivationStateReady {
			state := runtimeBaselineStateNotReady
			reason := runtimeBaselineReasonNotReady
			if gate.State == localEnvironmentActivationStateRepairRequired {
				state = runtimeBaselineStateRepairRequired
				reason = runtimeBaselineReasonRepairRequired
			}
			return runtimeBaselineResolveOutcome{
				State:      state,
				ReasonCode: reason,
				Detail:     fmt.Sprintf("first-run baseline consumer %q activation state=%s: %s", consumerID, gate.State, gate.Detail),
			}
		}

		for _, dep := range gate.Dependencies {
			if !dep.Required {
				continue
			}
			depEvidence, failReason, failDetail := s.runtimeBaselineDependencyEvidence(dep)
			if failReason != "" {
				return runtimeBaselineResolveOutcome{
					State:      runtimeBaselineStateNotReady,
					ReasonCode: failReason,
					Detail:     fmt.Sprintf("first-run baseline consumer %q dependency %s: %s", consumerID, dep.DependencyFamily, failDetail),
				}
			}
			consumerEvidence.Dependencies = append(consumerEvidence.Dependencies, depEvidence)
			familySet[depEvidence.DependencyFamily] = struct{}{}
			sourceRecordSet[depEvidence.SelectedSourceRecordID] = struct{}{}
			verificationSet[depEvidence.VerificationEvidence] = struct{}{}
		}
		if len(consumerEvidence.Dependencies) == 0 {
			return runtimeBaselineResolveOutcome{
				State:      runtimeBaselineStateNotReady,
				ReasonCode: runtimeBaselineReasonNotReady,
				Detail:     "first-run baseline consumer " + consumerID + " resolved no required dependency evidence",
			}
		}
		sort.Slice(consumerEvidence.Dependencies, func(i, j int) bool {
			return consumerEvidence.Dependencies[i].EnvironmentKey < consumerEvidence.Dependencies[j].EnvironmentKey
		})
		outcome.ActivationResponses = append(outcome.ActivationResponses, consumerEvidence)
	}

	outcome.RequiredDependencyFamilies = mapKeysSorted(familySet)
	outcome.SelectedSourceRecordIDs = mapKeysSorted(sourceRecordSet)
	outcome.VerificationEvidence = mapKeysSorted(verificationSet)
	return outcome
}

// runtimeBaselineDependencyEvidence converts a ready activation gate
// dependency into durable baseline evidence. It fails closed when the
// dependency is not actually `ready_system`/`ready_managed`, when it lacks a
// backing selected source record, or when that record lacks materialization /
// system-source verification evidence. Local artifact existence is rechecked
// before evidence minting; process liveness and route health remain outside
// this step.
func (s *Service) runtimeBaselineDependencyEvidence(dep localEnvironmentPlanDependency) (runtimeBaselineActivationDependencyEvidence, string, string) {
	state := strings.TrimSpace(dep.State)
	if state != localEnvironmentStateReadySystem && state != localEnvironmentStateReadyManaged {
		return runtimeBaselineActivationDependencyEvidence{}, runtimeBaselineReasonNotReady,
			fmt.Sprintf("dependency state=%s is not ready_system/ready_managed", defaultString(state, localEnvironmentStateUnknown))
	}
	recordID := strings.TrimSpace(dep.SelectedSourceRecordID)
	if recordID == "" {
		return runtimeBaselineActivationDependencyEvidence{}, runtimeBaselineReasonNotReady,
			"ready dependency has no backing selected source record id"
	}
	record, ok := s.localEnvironmentSelectedSourceRecordForDependency(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, dep.ConsumerScope)
	if !ok || strings.TrimSpace(record.RecordID) != recordID {
		return runtimeBaselineActivationDependencyEvidence{}, runtimeBaselineReasonNotReady,
			"ready dependency has no resolvable durable selected source record"
	}
	if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
		return runtimeBaselineActivationDependencyEvidence{}, runtimeBaselineReasonRepairRequired,
			"selected source record fails verification: " + err.Error()
	}
	if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
		return runtimeBaselineActivationDependencyEvidence{}, runtimeBaselineReasonRepairRequired,
			"selected source record fails local artifact verification: " + err.Error()
	}
	// Materialization terminal evidence or system-source verification
	// evidence: the durable selected source record's verification evidence
	// ref. Materialization-success-alone is never reused without this.
	verification := strings.TrimSpace(record.VerificationEvidenceRef)
	if verification == "" {
		return runtimeBaselineActivationDependencyEvidence{}, runtimeBaselineReasonNotReady,
			"selected source record has no materialization/system-source verification evidence"
	}
	return runtimeBaselineActivationDependencyEvidence{
		DependencyFamily:       strings.TrimSpace(dep.DependencyFamily),
		DependencyID:           strings.TrimSpace(dep.DependencyID),
		EnvironmentKey:         strings.TrimSpace(dep.EnvironmentKey),
		SelectedSourceRecordID: recordID,
		SourceKind:             strings.TrimSpace(record.SourceKind),
		DependencyState:        state,
		CanonicalRoot:          strings.TrimSpace(record.CanonicalRoot),
		VerificationEvidence:   verification,
	}, "", ""
}

// MintRuntimeBaselineReadiness runs a fresh activation gate for every required
// first-run baseline consumer and mints a durable runtimeBaselineRef only when
// every required dependency is ready_system/ready_managed (K-LENV-ACT-011).
func (s *Service) mintRuntimeBaselineReadiness(req runtimeBaselineResolveRequest) (runtimeBaselineReadinessRecord, string, string, string) {
	outcome := s.resolveRuntimeBaselineActivationSet(req)
	if outcome.State != runtimeBaselineStateReady {
		return runtimeBaselineReadinessRecord{}, outcome.State, outcome.ReasonCode, outcome.Detail
	}

	ref := "runtime_baseline_" + strings.ToLower(ulid.Make().String())
	observedAt := nowISO()
	auditSequence := make([]string, 0, 1)
	auditSequence = append(auditSequence, s.recordRuntimeBaselineAudit(runtimeBaselineMintAudit, ref, outcome.ReasonCode,
		fmt.Sprintf("runtime baseline readiness minted for install_level=%s factory_profile=%s",
			outcome.InstallLevel, strings.TrimSpace(req.SelectedLocalFactoryAIProfileRef))))

	record := runtimeBaselineReadinessRecord{
		RuntimeBaselineRef:                                ref,
		SelectedLocalFactoryAIProfileRef:                  strings.TrimSpace(req.SelectedLocalFactoryAIProfileRef),
		InstallLevel:                                      outcome.InstallLevel,
		RuntimeDataRootOrDataRootRef:                      strings.TrimSpace(req.RuntimeDataRootOrDataRootRef),
		RequiredDependencyFamilies:                        outcome.RequiredDependencyFamilies,
		SelectedSourceRecordIDs:                           outcome.SelectedSourceRecordIDs,
		ActivationReadyResponses:                          outcome.ActivationResponses,
		MaterializationOrSystemSourceVerificationEvidence: outcome.VerificationEvidence,
		ObservedAt:                                        observedAt,
		RuntimeAuditSequence:                              auditSequence,
		RuntimeVerifierIdentity:                           runtimeBaselineVerifierIdentity,
	}
	record = s.upsertRuntimeBaselineReadinessRecord(record)
	return record, runtimeBaselineStateReady, runtimeBaselineReasonReady, "runtime baseline readiness evidence minted"
}

// resolveRuntimeBaselineReadiness re-confirms a stored runtimeBaselineRef. It
// fails closed for a string-only ref, a missing ref, a ref with no backing
// durable record, a ref whose binding (install level / data root / factory
// profile) no longer matches, or a ref whose dependency set no longer resolves
// `ready`. This is the seam product ready admission step 5 consumes.
func (s *Service) resolveRuntimeBaselineReadiness(runtimeBaselineRef string, hostProfile *runtimev1.LocalDeviceProfile) (runtimeBaselineReadinessRecord, string, string, string) {
	ref := strings.TrimSpace(runtimeBaselineRef)
	if ref == "" {
		return runtimeBaselineReadinessRecord{}, runtimeBaselineStateNotReady, runtimeBaselineReasonRefMissing,
			"runtime baseline ref is required"
	}
	stored, ok := s.runtimeBaselineReadinessRecord(ref)
	if !ok {
		// A string with no backing durable record is not evidence.
		return runtimeBaselineReadinessRecord{}, runtimeBaselineStateNotReady, runtimeBaselineReasonRefUnknown,
			"runtime baseline ref has no backing durable record"
	}

	// Fresh activation verification: re-run the activation set bound to the
	// stored selection. A prior materialization/activation terminal state is
	// never reused without this re-confirmation.
	outcome := s.resolveRuntimeBaselineActivationSet(runtimeBaselineResolveRequest{
		SelectedLocalFactoryAIProfileRef: stored.SelectedLocalFactoryAIProfileRef,
		InstallLevel:                     stored.InstallLevel,
		RuntimeDataRootOrDataRootRef:     stored.RuntimeDataRootOrDataRootRef,
		HostProfile:                      hostProfile,
		BaselineConsumers:                runtimeBaselineConsumerBindingsFromEvidence(stored.ActivationReadyResponses),
	})
	if outcome.State != runtimeBaselineStateReady {
		s.recordRuntimeBaselineAudit(runtimeBaselineResolveFailedAudit, ref, outcome.ReasonCode, outcome.Detail)
		return runtimeBaselineReadinessRecord{}, outcome.State, outcome.ReasonCode, outcome.Detail
	}

	// Binding integrity: the freshly resolved evidence must still match the
	// stored ref's selection and dependency identity.
	if mismatch := runtimeBaselineBindingMismatch(stored, outcome); mismatch != "" {
		s.recordRuntimeBaselineAudit(runtimeBaselineResolveFailedAudit, ref, runtimeBaselineReasonRefMismatch, mismatch)
		return runtimeBaselineReadinessRecord{}, runtimeBaselineStateNotReady, runtimeBaselineReasonRefMismatch, mismatch
	}

	auditID := s.recordRuntimeBaselineAudit(runtimeBaselineResolveAudit, ref, runtimeBaselineReasonReady,
		"runtime baseline readiness re-confirmed")
	refreshed := stored
	refreshed.RequiredDependencyFamilies = outcome.RequiredDependencyFamilies
	refreshed.SelectedSourceRecordIDs = outcome.SelectedSourceRecordIDs
	refreshed.ActivationReadyResponses = outcome.ActivationResponses
	refreshed.MaterializationOrSystemSourceVerificationEvidence = outcome.VerificationEvidence
	refreshed.ObservedAt = nowISO()
	refreshed.RuntimeAuditSequence = append(append([]string(nil), stored.RuntimeAuditSequence...), auditID)
	refreshed = s.upsertRuntimeBaselineReadinessRecord(refreshed)
	return refreshed, runtimeBaselineStateReady, runtimeBaselineReasonReady, "runtime baseline readiness re-confirmed"
}

// runtimeBaselineBindingMismatch returns a non-empty reason when the freshly
// resolved activation outcome diverges from the stored ref's bound selection.
func runtimeBaselineBindingMismatch(stored runtimeBaselineReadinessRecord, outcome runtimeBaselineResolveOutcome) string {
	if normalizeRuntimeBaselineInstallLevel(stored.InstallLevel) != outcome.InstallLevel {
		return fmt.Sprintf("stored install_level=%s no longer matches resolved install_level=%s",
			stored.InstallLevel, outcome.InstallLevel)
	}
	if !stringSetsEqual(stored.RequiredDependencyFamilies, outcome.RequiredDependencyFamilies) {
		return "stored required_dependency_families no longer match resolved activation set"
	}
	if !stringSetsEqual(stored.SelectedSourceRecordIDs, runtimeBaselineSelectedSourceRecordIDsFromResponses(stored.ActivationReadyResponses)) {
		return "stored selected_source_record_ids no longer match stored activation responses"
	}
	if !stringSetsEqual(stored.SelectedSourceRecordIDs, outcome.SelectedSourceRecordIDs) {
		if runtimeBaselineActivationEvidenceEquivalent(stored.ActivationReadyResponses, outcome.ActivationResponses) {
			return ""
		}
		return "stored selected_source_record_ids no longer match resolved activation set"
	}
	return ""
}

func runtimeBaselineSelectedSourceRecordIDsFromResponses(responses []runtimeBaselineActivationConsumerEvidence) []string {
	set := make(map[string]struct{})
	for _, response := range responses {
		for _, dep := range response.Dependencies {
			if id := strings.TrimSpace(dep.SelectedSourceRecordID); id != "" {
				set[id] = struct{}{}
			}
		}
	}
	return mapKeysSorted(set)
}

func runtimeBaselineActivationEvidenceEquivalent(stored []runtimeBaselineActivationConsumerEvidence, outcome []runtimeBaselineActivationConsumerEvidence) bool {
	if len(stored) != len(outcome) {
		return false
	}
	outcomeByConsumer := make(map[string]runtimeBaselineActivationConsumerEvidence, len(outcome))
	for _, response := range outcome {
		consumerID := strings.TrimSpace(response.ConsumerID)
		if consumerID == "" {
			return false
		}
		if _, exists := outcomeByConsumer[consumerID]; exists {
			return false
		}
		outcomeByConsumer[consumerID] = response
	}
	for _, storedResponse := range stored {
		consumerID := strings.TrimSpace(storedResponse.ConsumerID)
		outcomeResponse, ok := outcomeByConsumer[consumerID]
		if !ok {
			return false
		}
		if strings.TrimSpace(storedResponse.PackID) != strings.TrimSpace(outcomeResponse.PackID) ||
			strings.TrimSpace(storedResponse.ActivationState) != strings.TrimSpace(outcomeResponse.ActivationState) ||
			strings.TrimSpace(storedResponse.BoundAssetID) != strings.TrimSpace(outcomeResponse.BoundAssetID) {
			return false
		}
		if !runtimeBaselineActivationDependenciesEquivalent(storedResponse.Dependencies, outcomeResponse.Dependencies) {
			return false
		}
	}
	return true
}

func runtimeBaselineActivationDependenciesEquivalent(stored []runtimeBaselineActivationDependencyEvidence, outcome []runtimeBaselineActivationDependencyEvidence) bool {
	if len(stored) != len(outcome) {
		return false
	}
	outcomeSet := make(map[string]struct{}, len(outcome))
	for _, dep := range outcome {
		key := runtimeBaselineActivationDependencySemanticKey(dep)
		if key == "" {
			return false
		}
		if _, exists := outcomeSet[key]; exists {
			return false
		}
		outcomeSet[key] = struct{}{}
	}
	for _, dep := range stored {
		key := runtimeBaselineActivationDependencySemanticKey(dep)
		if key == "" {
			return false
		}
		if _, ok := outcomeSet[key]; !ok {
			return false
		}
	}
	return true
}

func runtimeBaselineActivationDependencySemanticKey(dep runtimeBaselineActivationDependencyEvidence) string {
	dependencyID := strings.TrimSpace(dep.DependencyID)
	if strings.TrimSpace(dep.DependencyFamily) == localEnvironmentFamilyModelAsset {
		// Model asset dependency ids are semantic asset_id values. A fresh
		// activation may still rebind source record ids or host-profile-derived
		// environment keys, so the stable artifact identity for this comparison
		// is the verified canonical root plus the surrounding BoundAssetID.
		dependencyID = localEnvironmentFamilyModelAsset
	}
	parts := []string{
		strings.TrimSpace(dep.DependencyFamily),
		dependencyID,
		strings.TrimSpace(dep.SourceKind),
		strings.TrimSpace(dep.DependencyState),
		strings.TrimSpace(dep.CanonicalRoot),
	}
	for _, part := range parts {
		if part == "" {
			return ""
		}
	}
	return strings.Join(parts, "\x1f")
}

// runtimeBaselineConsumerBindingsFromEvidence reconstructs the consumer set and
// per-consumer asset binding a stored ref was minted against so re-verification
// runs the same activation set.
func runtimeBaselineConsumerBindingsFromEvidence(responses []runtimeBaselineActivationConsumerEvidence) []runtimeBaselineConsumerBinding {
	out := make([]runtimeBaselineConsumerBinding, 0, len(responses))
	for _, response := range responses {
		out = append(out, runtimeBaselineConsumerBinding{
			ConsumerID: response.ConsumerID,
			AssetID:    response.BoundAssetID,
		})
	}
	return out
}

func mapKeysSorted(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		if strings.TrimSpace(key) == "" {
			continue
		}
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

// resolveBaselineConsumerBindings runs the deterministic K-MCAT-034 resolver
// over the curated preset + host posture and projects each engine-keyed
// baseline consumer onto the resolver-selected variant asset id (design/03
// seam). It fails closed when the resolver fails closed and when a baseline
// consumer has no curated slot.
//
// The resolver never substitutes a different preset: the chosen install level
// resolves for this host or it fails closed (K-MCAT-036/037, design/02).
func (s *Service) resolveBaselineConsumerBindings(
	installLevel string,
	hostProfile *runtimev1.LocalDeviceProfile,
	canonicalConsumers []string,
) ([]runtimeBaselineConsumerBinding, runtimeBaselineResolveOutcome) {
	if s.localProviderCatalog == nil {
		return nil, runtimeBaselineResolveOutcome{
			State:      runtimeBaselineStateNotReady,
			ReasonCode: runtimeBaselineReasonNotReady,
			Detail:     "local provider catalog is not loaded; cannot resolve first-run baseline model set",
		}
	}
	outcome := s.localProviderCatalog.ResolveLocalModelSet(installLevel, hostProfile)
	switch outcome.Kind {
	case catalog.LocalResolveFailClose:
		return nil, runtimeBaselineResolveOutcome{
			State:      runtimeBaselineStateNotReady,
			ReasonCode: baselineReasonForResolverReason(outcome.ReasonCode),
			Detail:     "first-run baseline model resolution failed closed: " + strings.TrimSpace(outcome.Detail),
		}
	case catalog.LocalResolveResolved:
		// proceed
	default:
		return nil, runtimeBaselineResolveOutcome{
			State:      runtimeBaselineStateNotReady,
			ReasonCode: runtimeBaselineReasonNotReady,
			Detail:     "first-run baseline model resolution returned an unknown outcome",
		}
	}

	bindings := make([]runtimeBaselineConsumerBinding, 0, len(canonicalConsumers))
	for _, consumerID := range canonicalConsumers {
		slotID, mapped := runtimeBaselineConsumerSlotByID[consumerID]
		if !mapped {
			return nil, runtimeBaselineResolveOutcome{
				State:      runtimeBaselineStateNotReady,
				ReasonCode: runtimeBaselineReasonConsumerUnsupported,
				Detail:     "first-run baseline consumer has no curated resolver slot: " + consumerID,
			}
		}
		resolvedSlot, ok := outcome.ResolvedSlotByName(slotID)
		if !ok {
			// A required baseline consumer with no resolved slot is a
			// fail-close: the resolver did not satisfy it and never produces a
			// placeholder asset id.
			return nil, runtimeBaselineResolveOutcome{
				State:      runtimeBaselineStateNotReady,
				ReasonCode: catalog.ReasonLocalModelResolveHostUnsupported,
				Detail:     fmt.Sprintf("first-run baseline consumer %q slot %q was not resolved to a model asset", consumerID, slotID),
			}
		}
		bindings = append(bindings, runtimeBaselineConsumerBinding{
			ConsumerID: consumerID,
			AssetID:    resolvedSlot.AssetID,
		})
	}
	return bindings, runtimeBaselineResolveOutcome{State: runtimeBaselineStateReady}
}

// baselineReasonForResolverReason maps a K-MCAT-037 resolver reason code onto a
// runtime baseline readiness reason code. The resolver reason code is preserved
// as the canonical activation projection identifier.
func baselineReasonForResolverReason(resolverReason string) string {
	switch strings.TrimSpace(resolverReason) {
	case catalog.ReasonLocalModelResolveInstallLevelInvalid:
		return runtimeBaselineReasonInstallLevelInvalid
	case catalog.ReasonLocalModelResolveHostUnsupported,
		catalog.ReasonLocalModelResolveSlotOmitted:
		return catalog.ReasonLocalModelResolveHostUnsupported
	default:
		return runtimeBaselineReasonNotReady
	}
}

// stringSetsEqual compares two string slices as de-duplicated unordered sets.
func stringSetsEqual(a []string, b []string) bool {
	left := sortedUniqueStrings(a)
	right := sortedUniqueStrings(b)
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

package localservice

import (
	"sort"
	"strings"
)

// runtimeBaselineInstallLevelMinimal and runtimeBaselineInstallLevelRecommended
// are the only admitted first-run install levels per the product-control
// record schema (`firstRun.installLevel`). Cloud, hybrid, connector, video,
// and app-specific levels are not valid first-run baseline install levels.
const (
	runtimeBaselineInstallLevelMinimal     = "minimal"
	runtimeBaselineInstallLevelRecommended = "recommended"
)

// runtimeBaselineActivationDependencyEvidence is the durable per-dependency
// readiness projection for a minted runtimeBaselineRef. Each entry records the
// selected source record, its ready dependency state, and the materialization
// terminal evidence or system-source verification evidence that produced it.
type runtimeBaselineActivationDependencyEvidence struct {
	DependencyFamily       string `json:"dependencyFamily"`
	DependencyID           string `json:"dependencyId"`
	EnvironmentKey         string `json:"environmentKey"`
	SelectedSourceRecordID string `json:"selectedSourceRecordId"`
	SourceKind             string `json:"sourceKind"`
	DependencyState        string `json:"dependencyState"`
	CanonicalRoot          string `json:"canonicalRoot,omitempty"`
	// VerificationEvidence is the materialization job terminal evidence ref
	// or the system-source verification evidence ref for the selected source
	// record. It is never a probe id, file path, or process health result.
	VerificationEvidence string `json:"verificationEvidence"`
}

// runtimeBaselineActivationConsumerEvidence is the durable per-consumer
// activation response projection for a minted runtimeBaselineRef.
type runtimeBaselineActivationConsumerEvidence struct {
	ConsumerID      string                                        `json:"consumerId"`
	PackID          string                                        `json:"packId"`
	ActivationState string                                        `json:"activationState"`
	ReasonCode      string                                        `json:"reasonCode"`
	Dependencies    []runtimeBaselineActivationDependencyEvidence `json:"dependencies"`
	// BoundAssetID is the model asset id bound to this consumer; it is
	// re-supplied to the activation gate on baseline ref re-verification.
	BoundAssetID string `json:"boundAssetId,omitempty"`
}

// runtimeBaselineReadinessRecord is the durable first-run runtime baseline
// readiness evidence record owned by RuntimeLocalService (K-LENV-ACT-011). It
// is the backing store for `runtimeBaselineRef` consumed by product ready
// admission step 5 (P-COLD-016). It is minted only after a fresh activation
// gate succeeds for every required first-run baseline consumer.
//
// The record carries all nine required_projection fields declared by
// `product-control-record-schema.yaml` -> `evidence_contracts.runtimeBaselineRef`.
type runtimeBaselineReadinessRecord struct {
	// RuntimeBaselineRef is the durable ULID evidence ref.
	RuntimeBaselineRef string `json:"runtimeBaselineRef"`
	// 1. selected_local_factory_aiProfile_ref
	SelectedLocalFactoryAIProfileRef string `json:"selectedLocalFactoryAiProfileRef"`
	// 2. install_level
	InstallLevel string `json:"installLevel"`
	// 3. runtime_data_root_or_dataRootRef
	RuntimeDataRootOrDataRootRef string `json:"runtimeDataRootOrDataRootRef"`
	// 4. required_dependency_families
	RequiredDependencyFamilies []string `json:"requiredDependencyFamilies"`
	// 5. selected_source_record_ids
	SelectedSourceRecordIDs []string `json:"selectedSourceRecordIds"`
	// 6. activation_ready_responses
	ActivationReadyResponses []runtimeBaselineActivationConsumerEvidence `json:"activationReadyResponses"`
	// 7. materialization_or_system_source_verification_evidence
	MaterializationOrSystemSourceVerificationEvidence []string `json:"materializationOrSystemSourceVerificationEvidence"`
	// 8. observed_at
	ObservedAt string `json:"observedAt"`
	// 9. runtime_audit_sequence
	RuntimeAuditSequence []string `json:"runtimeAuditSequence"`
	// RuntimeVerifierIdentity stamps the Runtime verifier per K-LENV-ACT-011.
	RuntimeVerifierIdentity string `json:"runtimeVerifierIdentity"`
}

// upsertRuntimeBaselineReadinessRecord stores a minted baseline readiness
// record keyed by its durable ref and persists state.
func (s *Service) upsertRuntimeBaselineReadinessRecord(record runtimeBaselineReadinessRecord) runtimeBaselineReadinessRecord {
	record.RuntimeBaselineRef = strings.TrimSpace(record.RuntimeBaselineRef)
	s.mu.Lock()
	if s.runtimeBaselineReadinessRecords == nil {
		s.runtimeBaselineReadinessRecords = make(map[string]runtimeBaselineReadinessRecord)
	}
	s.runtimeBaselineReadinessRecords[record.RuntimeBaselineRef] = record
	s.persistStateLocked()
	s.mu.Unlock()
	return record
}

// runtimeBaselineReadinessRecord resolves a durable baseline readiness record
// by its ref. A string that has no backing durable record fails closed at the
// caller.
func (s *Service) runtimeBaselineReadinessRecord(runtimeBaselineRef string) (runtimeBaselineReadinessRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	record, ok := s.runtimeBaselineReadinessRecords[strings.TrimSpace(runtimeBaselineRef)]
	return record, ok
}

// normalizeRuntimeBaselineInstallLevel returns the canonical install level or
// empty string when the level is not an admitted first-run install level.
func normalizeRuntimeBaselineInstallLevel(installLevel string) string {
	switch strings.ToLower(strings.TrimSpace(installLevel)) {
	case runtimeBaselineInstallLevelMinimal:
		return runtimeBaselineInstallLevelMinimal
	case runtimeBaselineInstallLevelRecommended:
		return runtimeBaselineInstallLevelRecommended
	default:
		return ""
	}
}

// sortedUniqueStrings returns trimmed, de-duplicated, sorted non-empty values.
func sortedUniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	out := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	sort.Strings(out)
	return out
}

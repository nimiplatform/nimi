package localservice

import (
	"encoding/json"
	"strings"
)

func parseAndVerifyAccountDefaultProfileAdmissionEvidence(raw string, record *productControlRecord, accountID string, dataRootRef string, aiProfileAlias string) (accountDefaultProfileAdmissionEvidence, productControlState, string) {
	evidence, state, failure := parseAndVerifyAccountDefaultProfileEvidence(raw, accountID, dataRootRef, aiProfileAlias)
	if failure != "" {
		return evidence, state, failure
	}
	expectedRef := strings.TrimSpace(valueOrEmpty(record.FirstRun.AccountDefaultProfileRef))
	if expectedRef == "" {
		return evidence, productControlStateLocalAIReady, "accountDefaultProfileRef is required before ready admission"
	}
	if strings.TrimSpace(evidence.AccountDefaultProfileRef) != expectedRef {
		return evidence, productControlStateLocalAIReady, "Account Default Profile ref is stale or mismatched"
	}
	return evidence, "", ""
}

func parseAndVerifyAccountDefaultProfileEvidence(raw string, accountID string, dataRootRef string, aiProfileAlias string) (accountDefaultProfileAdmissionEvidence, productControlState, string) {
	var evidence accountDefaultProfileAdmissionEvidence
	if err := json.Unmarshal([]byte(raw), &evidence); err != nil {
		return evidence, productControlStateLocalAIReady, "Account Default Profile owner evidence is missing or invalid JSON"
	}
	if strings.TrimSpace(evidence.AccountDefaultProfileRef) == "" {
		return evidence, productControlStateLocalAIReady, "Account Default Profile ref is required"
	}
	if strings.TrimSpace(evidence.AccountID) != accountID {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence is bound to a different account"
	}
	if strings.TrimSpace(evidence.DataRootRef) != dataRootRef {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence is bound to a different data root"
	}
	if strings.TrimSpace(evidence.AIProfileAlias) != aiProfileAlias {
		return evidence, productControlStateAIEnvironmentUnconfigured, "Account Default Profile evidence is bound to a different AI profile"
	}
	if strings.TrimSpace(evidence.ProfileID) == "" || strings.TrimSpace(evidence.ContentHash) == "" {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence is missing baseline refs"
	}
	if !strings.HasPrefix(strings.TrimSpace(evidence.ContentHash), "sha256:") ||
		!strings.HasPrefix(strings.TrimSpace(evidence.ProfilePayloadHash), "sha256:") ||
		!strings.HasPrefix(strings.TrimSpace(evidence.FactoryProvenanceHash), "sha256:") {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence hash fields must use sha256"
	}
	if strings.TrimSpace(evidence.SourcePolicyRef) == "" || strings.TrimSpace(evidence.SourceCatalogID) == "" || evidence.SourceCatalogVersion <= 0 ||
		strings.TrimSpace(evidence.CreatedAt) == "" || strings.TrimSpace(evidence.UpdatedAt) == "" {
		return evidence, productControlStateLocalAIReady, "Account Default Profile evidence required projection is incomplete"
	}
	return evidence, "", ""
}

func parseAndVerifyBuiltInAIConfigAdmissionEvidence(raw string, record *productControlRecord, accountID string, dataRootRef string, aiProfileAlias string, installLevel string) ([]string, productControlState, string) {
	var evidenceSet builtInAIConfigAdmissionEvidenceSet
	if err := json.Unmarshal([]byte(raw), &evidenceSet); err != nil {
		return nil, productControlStateLocalAIReady, "built-in AIConfig owner evidence is missing or invalid JSON"
	}
	refs := []string{strings.TrimSpace(evidenceSet.Nimi.BuiltInAIConfigRef), strings.TrimSpace(evidenceSet.Agent.BuiltInAIConfigRef)}
	if len(record.FirstRun.BuiltInAIConfigRefs) > 0 && !sameStringSet(refs, record.FirstRun.BuiltInAIConfigRefs) {
		return nil, productControlStateLocalAIReady, "built-in AIConfig evidence refs are stale or mismatched"
	}
	for expectedSurface, evidence := range map[string]builtInAIConfigAdmissionEvidence{
		"nimi":  evidenceSet.Nimi,
		"agent": evidenceSet.Agent,
	} {
		if strings.TrimSpace(evidence.BuiltInAIConfigRef) == "" ||
			strings.TrimSpace(evidence.AIConfigContentHash) == "" ||
			strings.TrimSpace(evidence.WriterIdentity) == "" ||
			strings.TrimSpace(evidence.CommittedAt) == "" ||
			evidence.AIConfigVersion == 0 {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence required projection is incomplete"
		}
		if !strings.HasPrefix(strings.TrimSpace(evidence.AIConfigContentHash), "sha256:") ||
			!strings.HasPrefix(strings.TrimSpace(evidence.AIProfileRef.ProfilePayloadHash), "sha256:") {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence hash fields must use sha256"
		}
		if strings.TrimSpace(evidence.AccountID) != accountID || strings.TrimSpace(evidence.DataRootRef) != dataRootRef {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence is bound to a different account or data root"
		}
		if evidence.ScopeRef.Kind != "feature" || evidence.ScopeRef.OwnerID != "desktop.chat" || evidence.ScopeRef.SurfaceID != expectedSurface {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence is not bound to the canonical desktop chat scopes"
		}
		if strings.TrimSpace(evidence.AIProfileRef.AIProfileAlias) != aiProfileAlias || strings.TrimSpace(evidence.AIProfileRef.InstallLevel) != installLevel {
			return nil, productControlStateLocalAIReady, "built-in AIConfig evidence is bound to a different AI profile"
		}
		if strings.TrimSpace(evidence.AIProfileRef.SourcePolicyRef) == "" ||
			strings.TrimSpace(evidence.AIProfileRef.SourceCatalogID) == "" ||
			evidence.AIProfileRef.SourceCatalogVersion <= 0 ||
			strings.TrimSpace(evidence.AIProfileRef.AppliedAt) == "" {
			return nil, productControlStateLocalAIReady, "built-in AIConfig AIProfile projection is incomplete"
		}
	}
	return refs, "", ""
}

func applyProductControlReadyEvidence(record *productControlRecord, evidence productControlReadyAdmissionEvidence) {
	completedAt := nowProductControlISO()
	record.State = productControlStateReadyForUse
	record.FirstRun.Completed = true
	record.FirstRun.CompletedAt = &completedAt
	record.FirstRun.InitializationPlanID = stringPtr(evidence.InitializationPlanID)
	record.FirstRun.BaselineProfileRef = stringPtr(evidence.BaselineProfileRef)
	record.FirstRun.BaselineCommitID = stringPtr(evidence.BaselineCommitID)
	record.FirstRun.AccountDefaultProfileRef = stringPtr(evidence.AccountDefaultProfileRef)
	record.FirstRun.BuiltInAIConfigRefs = append([]string{}, evidence.BuiltInAIConfigRefs...)
	record.FirstRun.RuntimeBaselineRef = stringPtr(evidence.RuntimeBaselineRef)
	record.FirstRun.ExecutionEvidenceRef = stringPtr(evidence.ExecutionEvidenceRef)
	record.Repair = productRepairRecord{}
	if record.DataRoot != nil {
		record.DataRoot.Status = productDataRootStatusReady
		record.DataRoot.VerifiedAt = nowProductControlISO()
		record.DataRoot.VerifiedAtUnixMs = nowProductControlUnixMS()
	}
}

func routeProductControlAdmissionFailure(path string, record *productControlRecord, state productControlState, detail string) error {
	record.State = state
	if state == productControlStateRepairRequired || state == productControlStateBlocked {
		record.Repair = productRepairRecord{Required: true, Reason: stringPtr(detail)}
		if record.DataRoot != nil {
			record.DataRoot.Status = productDataRootStatusRepairRequired
		}
	} else {
		record.Repair = productRepairRecord{}
	}
	return writeProductControlRecord(path, record)
}

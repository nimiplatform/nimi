package localservice

import (
	"encoding/hex"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// associateProfileRuntimeDescriptorPreparedAssets resolves portable asset
// bindings to Runtime-private prepared identities only from the current,
// verified selected-source records. The validated descriptor object is an
// internal translation; the caller's portable JSON is never rewritten.
func (s *Service) associateProfileRuntimeDescriptorPreparedAssets(descriptor *profileRuntimeDescriptor) error {
	if s == nil || descriptor == nil {
		return nil
	}
	bindingIndexes := make(map[string]int, len(descriptor.AssetBindings))
	for index := range descriptor.AssetBindings {
		bindingIndexes[strings.TrimSpace(descriptor.AssetBindings[index].BindingID)] = index
	}
	associations := map[string]string{}
	requiredAssociations := map[string]bool{}
	failedAssociations := map[string]bool{}
	for _, slice := range descriptor.CapabilitySlices {
		if profileRuntimeSliceSupportsLlamaModelAssociation(slice) {
			mainBindingID, _, ok := profileRuntimeDescriptorMainBindingIdentity(
				slice,
				descriptor.AssetBindings,
				bindingIndexes,
			)
			if !ok {
				continue
			}
			if strings.TrimSpace(descriptor.AssetBindings[bindingIndexes[mainBindingID]].PreparedAssetID) != "" {
				continue
			}
			requiredAssociations[mainBindingID] = true
			_, mainLocalAssetID, found, associationErr := s.profileRuntimeSelectedSourcePreparedAssetForConsumers(
				descriptor.AssetBindings[bindingIndexes[mainBindingID]],
				profileRuntimeLlamaConsumerCandidates(slice),
			)
			if associationErr != nil {
				return associationErr
			}
			if !found {
				failedAssociations[mainBindingID] = true
				continue
			}
			if err := profileRuntimeRememberPreparedAssetAssociation(associations, mainBindingID, mainLocalAssetID); err != nil {
				return err
			}
			continue
		}
		if !profileRuntimeSliceSupportsImageMaterializationProjection(slice) {
			continue
		}
		_, consumer, ok := profileRuntimeNativeImageBackendRequirement(slice)
		if !ok {
			continue
		}
		mainBindingID, mainExpectedIdentity, ok := profileRuntimeDescriptorMainBindingIdentity(
			slice,
			descriptor.AssetBindings,
			bindingIndexes,
		)
		if !ok {
			continue
		}
		mainNeedsAssociation := strings.TrimSpace(
			descriptor.AssetBindings[bindingIndexes[mainBindingID]].PreparedAssetID,
		) == ""
		companionBindingIDs := make([]string, 0, len(slice.OrderedCompanionOccurrences))
		for _, occurrence := range slice.OrderedCompanionOccurrences {
			bindingID := strings.TrimSpace(occurrence.AssetBindingRef)
			index, found := bindingIndexes[bindingID]
			if !found ||
				strings.TrimSpace(descriptor.AssetBindings[index].AssetRole) != "companion" ||
				strings.TrimSpace(descriptor.AssetBindings[index].PreparedAssetID) != "" {
				continue
			}
			requiredAssociations[bindingID] = true
			companionBindingIDs = append(companionBindingIDs, bindingID)
		}
		if mainNeedsAssociation {
			requiredAssociations[mainBindingID] = true
		}
		if !mainNeedsAssociation && len(companionBindingIDs) == 0 {
			continue
		}
		mainRecord, mainLocalAssetID, ok, associationErr := s.profileRuntimeSelectedSourcePreparedAsset(
			descriptor.AssetBindings[bindingIndexes[mainBindingID]],
			localEnvironmentFamilyModelAsset,
			"",
			consumer,
			"",
		)
		if associationErr != nil {
			return associationErr
		}
		if !ok {
			if mainNeedsAssociation {
				failedAssociations[mainBindingID] = true
			}
			for _, bindingID := range companionBindingIDs {
				failedAssociations[bindingID] = true
			}
			continue
		}
		if mainNeedsAssociation {
			if err := profileRuntimeRememberPreparedAssetAssociation(associations, mainBindingID, mainLocalAssetID); err != nil {
				return err
			}
		}
		for _, occurrence := range slice.OrderedCompanionOccurrences {
			bindingID := strings.TrimSpace(occurrence.AssetBindingRef)
			index, found := bindingIndexes[bindingID]
			if !found {
				continue
			}
			binding := descriptor.AssetBindings[index]
			if strings.TrimSpace(binding.AssetRole) != "companion" {
				continue
			}
			if strings.TrimSpace(binding.PreparedAssetID) != "" {
				continue
			}
			_, companionLocalAssetID, found, associationErr := s.profileRuntimeSelectedSourcePreparedAsset(
				binding,
				localEnvironmentFamilyModelCompanion,
				mainExpectedIdentity,
				consumer,
				strings.TrimSpace(mainRecord.RecordID),
			)
			if associationErr != nil {
				return associationErr
			}
			if !found {
				failedAssociations[bindingID] = true
				continue
			}
			if err := profileRuntimeRememberPreparedAssetAssociation(associations, bindingID, companionLocalAssetID); err != nil {
				return err
			}
		}
	}
	for bindingID, preparedAssetID := range associations {
		index, ok := bindingIndexes[bindingID]
		if !ok ||
			!requiredAssociations[bindingID] ||
			failedAssociations[bindingID] ||
			strings.TrimSpace(descriptor.AssetBindings[index].PreparedAssetID) != "" {
			continue
		}
		descriptor.AssetBindings[index].PreparedAssetID = preparedAssetID
	}
	return nil
}

func profileRuntimeSliceSupportsLlamaModelAssociation(slice profileRuntimeDescriptorCapability) bool {
	if strings.TrimSpace(slice.ExecutionMode) != "local" ||
		strings.TrimSpace(slice.ContractState) != "declared" ||
		strings.TrimSpace(slice.Execution.Backend) != "llama.cpp" {
		return false
	}
	switch strings.TrimSpace(slice.Capability) {
	case "text.generate", "text.embed":
		return true
	default:
		return false
	}
}

func profileRuntimeLlamaConsumerCandidates(slice profileRuntimeDescriptorCapability) []string {
	if explicit := strings.TrimSpace(slice.RuntimeConsumerID); explicit != "" {
		return []string{explicit}
	}
	return []string{"llama.cpp.cpu", "llama.cpp.vulkan", "llama.cpp.cuda"}
}

func (s *Service) profileRuntimeSelectedSourcePreparedAssetForConsumers(
	binding profileRuntimeDescriptorAssetBinding,
	consumers []string,
) (localEnvironmentSelectedSourceRecordState, string, bool, error) {
	var (
		selectedRecord       localEnvironmentSelectedSourceRecordState
		selectedLocalAssetID string
		found                bool
	)
	for _, consumer := range normalizeStringSlice(consumers) {
		record, localAssetID, ok, err := s.profileRuntimeSelectedSourcePreparedAsset(
			binding,
			localEnvironmentFamilyModelAsset,
			"",
			consumer,
			"",
		)
		if err != nil {
			return localEnvironmentSelectedSourceRecordState{}, "", false, err
		}
		if !ok {
			continue
		}
		if found && strings.TrimSpace(localAssetID) != selectedLocalAssetID {
			return localEnvironmentSelectedSourceRecordState{}, "", false,
				profileRuntimeDescriptorError("materialization.prepared_asset_association_ambiguous", binding.BindingID)
		}
		if !found {
			selectedRecord = record
			selectedLocalAssetID = strings.TrimSpace(localAssetID)
			found = true
		}
	}
	return selectedRecord, selectedLocalAssetID, found, nil
}

func profileRuntimeDescriptorMainBindingIdentity(
	slice profileRuntimeDescriptorCapability,
	bindings []profileRuntimeDescriptorAssetBinding,
	bindingIndexes map[string]int,
) (string, string, bool) {
	mainBindingID := ""
	mainExpectedIdentity := ""
	for _, assetRef := range slice.AssetRefs {
		bindingID := strings.TrimSpace(assetRef)
		index, ok := bindingIndexes[bindingID]
		if !ok {
			continue
		}
		binding := bindings[index]
		if strings.TrimSpace(binding.AssetRole) != "main" {
			continue
		}
		if mainBindingID != "" {
			return "", "", false
		}
		mainBindingID = bindingID
		mainExpectedIdentity = strings.TrimSpace(binding.ExpectedIdentity)
	}
	return mainBindingID, mainExpectedIdentity, mainBindingID != "" && mainExpectedIdentity != ""
}

func (s *Service) profileRuntimeSelectedSourcePreparedAsset(
	binding profileRuntimeDescriptorAssetBinding,
	family string,
	parentAssetID string,
	consumer string,
	parentSelectedSourceRecordID string,
) (localEnvironmentSelectedSourceRecordState, string, bool, error) {
	trimmedFamily := strings.TrimSpace(family)
	trimmedAssetID := strings.TrimSpace(binding.ExpectedIdentity)
	trimmedConsumer := strings.TrimSpace(consumer)
	if trimmedAssetID == "" || trimmedConsumer == "" {
		return localEnvironmentSelectedSourceRecordState{}, "", false, nil
	}
	if strings.TrimSpace(binding.Source) == "manual" {
		return s.profileRuntimePortableManualSelectedSourcePreparedAsset(
			binding,
			trimmedFamily,
			trimmedConsumer,
			parentSelectedSourceRecordID,
		)
	}
	dependencyID := trimmedAssetID
	semanticHashKey := "asset_id"
	localIDKey := "local_asset_id"
	if trimmedFamily == localEnvironmentFamilyModelCompanion {
		dependencyID = localEnvironmentCompanionAssetDependencyID(trimmedAssetID, parentAssetID)
		semanticHashKey = "companion_asset_id"
		localIDKey = "companion_local_asset_id"
	}
	if dependencyID == "" {
		return localEnvironmentSelectedSourceRecordState{}, "", false, nil
	}
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	environmentKey := localEnvironmentKey(
		trimmedFamily,
		dependencyID,
		hostState.HostProfileID,
		localEnvironmentPlatformTuple(hostState),
		s.localEnvironmentRuntimeDataRoot(),
	)
	record, ok := s.localEnvironmentSelectedSourceRecordForDependency(
		environmentKey,
		trimmedFamily,
		dependencyID,
		trimmedConsumer,
	)
	if !ok ||
		validateLocalEnvironmentSelectedSourceRecord(record) != nil ||
		validateLocalEnvironmentSelectedSourceLocalArtifacts(record) != nil {
		return localEnvironmentSelectedSourceRecordState{}, "", false, nil
	}
	if strings.TrimSpace(record.Hashes[semanticHashKey]) != trimmedAssetID ||
		profileRuntimeSelectedSourceEvidenceValue(record.CompatibilityEvidence, semanticHashKey) != trimmedAssetID {
		return localEnvironmentSelectedSourceRecordState{}, "", false, nil
	}
	localAssetID := strings.TrimSpace(record.Hashes[localIDKey])
	if localAssetID == "" ||
		profileRuntimeSelectedSourceEvidenceValue(record.CompatibilityEvidence, localIDKey) != localAssetID {
		return localEnvironmentSelectedSourceRecordState{}, "", false, nil
	}
	if trimmedFamily == localEnvironmentFamilyModelCompanion {
		parentRecordID := strings.TrimSpace(parentSelectedSourceRecordID)
		if parentRecordID == "" ||
			strings.TrimSpace(record.Hashes["parent_model_asset_record"]) != parentRecordID ||
			profileRuntimeSelectedSourceEvidenceValue(record.CompatibilityEvidence, "parent_model_asset_record") != parentRecordID {
			return localEnvironmentSelectedSourceRecordState{}, "", false, nil
		}
	}
	asset := s.assetByLocalID(localAssetID)
	if !s.profileRuntimeSelectedSourceSatisfiesPortableBinding(binding, record, asset) {
		return localEnvironmentSelectedSourceRecordState{}, "", false, nil
	}
	return record, localAssetID, true, nil
}

func (s *Service) profileRuntimePortableManualSelectedSourcePreparedAsset(
	binding profileRuntimeDescriptorAssetBinding,
	family string,
	consumer string,
	parentSelectedSourceRecordID string,
) (localEnvironmentSelectedSourceRecordState, string, bool, error) {
	semanticHashKey := "asset_id"
	localIDKey := "local_asset_id"
	if family == localEnvironmentFamilyModelCompanion {
		semanticHashKey = "companion_asset_id"
		localIDKey = "companion_local_asset_id"
	}
	var matchedRecord localEnvironmentSelectedSourceRecordState
	matchedLocalAssetID := ""
	for _, record := range s.selectedSourceCandidatesForFamilyAndConsumer(family, consumer) {
		if validateLocalEnvironmentSelectedSourceRecord(record) != nil ||
			validateLocalEnvironmentSelectedSourceLocalArtifacts(record) != nil {
			continue
		}
		if family == localEnvironmentFamilyModelCompanion {
			parentRecordID := strings.TrimSpace(parentSelectedSourceRecordID)
			if parentRecordID == "" ||
				strings.TrimSpace(record.Hashes["parent_model_asset_record"]) != parentRecordID ||
				profileRuntimeSelectedSourceEvidenceValue(record.CompatibilityEvidence, "parent_model_asset_record") != parentRecordID {
				continue
			}
		}
		concreteAssetID := strings.TrimSpace(record.Hashes[semanticHashKey])
		localAssetID := strings.TrimSpace(record.Hashes[localIDKey])
		if concreteAssetID == "" || localAssetID == "" ||
			profileRuntimeSelectedSourceEvidenceValue(record.CompatibilityEvidence, semanticHashKey) != concreteAssetID ||
			profileRuntimeSelectedSourceEvidenceValue(record.CompatibilityEvidence, localIDKey) != localAssetID {
			continue
		}
		asset := s.assetByLocalID(localAssetID)
		if asset == nil ||
			strings.TrimSpace(asset.GetLocalAssetId()) != localAssetID ||
			strings.TrimSpace(asset.GetAssetId()) != concreteAssetID ||
			!s.profileRuntimeSelectedSourceSatisfiesPortableBinding(binding, record, asset) {
			continue
		}
		if matchedLocalAssetID != "" {
			return localEnvironmentSelectedSourceRecordState{}, "", false,
				profileRuntimeDescriptorError("materialization.prepared_asset_association_ambiguous", binding.BindingID)
		}
		matchedRecord = record
		matchedLocalAssetID = localAssetID
	}
	return matchedRecord, matchedLocalAssetID, matchedLocalAssetID != "", nil
}

// The caller has already validated the selected-source record and its current
// local artifacts. This predicate closes the remaining portable source
// constraints against the exact local-id registry row.
func (s *Service) profileRuntimeSelectedSourceSatisfiesPortableBinding(
	binding profileRuntimeDescriptorAssetBinding,
	record localEnvironmentSelectedSourceRecordState,
	asset *runtimev1.LocalAssetRecord,
) bool {
	if asset == nil || strings.TrimSpace(asset.GetLocalAssetId()) == "" {
		return false
	}
	switch strings.TrimSpace(binding.Source) {
	case "huggingface":
		source := binding.HuggingFace
		if source == nil || strings.TrimSpace(record.SourceKind) != localEnvironmentSourceManaged ||
			strings.TrimSpace(asset.GetAssetId()) != strings.TrimSpace(binding.ExpectedIdentity) {
			return false
		}
		expectedRepo, err := normalizeHFRepo(source.RepoID)
		if err != nil {
			return false
		}
		assetRepo, err := normalizeHFRepo(asset.GetSource().GetRepo())
		if err != nil || assetRepo != expectedRepo {
			return false
		}
		recordRepo, err := normalizeHFRepo(profileRuntimeSelectedSourceEvidenceValue(record.CompatibilityEvidence, "source_repo"))
		if err != nil || recordRepo != expectedRepo {
			return false
		}
		expectedRevision := strings.TrimSpace(source.Revision)
		if expectedRevision == "" ||
			strings.TrimSpace(asset.GetSource().GetRevision()) != expectedRevision ||
			profileRuntimeSelectedSourceEvidenceValue(record.CompatibilityEvidence, "source_revision") != expectedRevision {
			return false
		}
		if !s.profileRuntimeSelectedSourceProvesHFEntry(source, record, asset) {
			return false
		}
		return profileRuntimeExpectedIntegritySatisfied(source.ExpectedIntegrity, record.Hashes)
	case "manual":
		source := binding.Manual
		if source == nil || strings.TrimSpace(record.SourceKind) != localEnvironmentSourceImported {
			return false
		}
		expectedName := strings.TrimSpace(source.ExpectedName)
		sourceName := strings.TrimSpace(asset.GetSourceFileName())
		if expectedName == "" || sourceName == "" || sourceName != expectedName {
			return false
		}
		if len(source.AllowedFilePatterns) > 0 {
			matched := false
			for _, pattern := range source.AllowedFilePatterns {
				ok, err := filepath.Match(strings.TrimSpace(pattern), sourceName)
				if err != nil {
					return false
				}
				matched = matched || ok
			}
			if !matched {
				return false
			}
		}
		return profileRuntimeExpectedIntegritySatisfied(source.ExpectedIntegrity, record.Hashes)
	default:
		return false
	}
}

func (s *Service) profileRuntimeSelectedSourceProvesHFEntry(
	source *profileRuntimeDescriptorHFSource,
	record localEnvironmentSelectedSourceRecordState,
	asset *runtimev1.LocalAssetRecord,
) bool {
	if s == nil || source == nil || asset == nil || len(source.Entries) != 1 {
		return false
	}
	portableEntry := profileRuntimePortableEntry(source.Entries[0])
	assetEntry := profileRuntimePortableEntry(asset.GetEntry())
	if portableEntry == "" || assetEntry == "" || portableEntry != assetEntry {
		return false
	}
	canonicalRoot := filepath.Clean(strings.TrimSpace(record.CanonicalRoot))
	verifiedArtifacts := normalizeStringSlice(record.VerifiedArtifacts)
	canonicalPortable := filepath.ToSlash(canonicalRoot)
	return canonicalRoot != "." &&
		(strings.HasSuffix(canonicalPortable, "/"+portableEntry) ||
			filepath.Base(canonicalRoot) == filepath.Base(portableEntry)) &&
		len(verifiedArtifacts) == 1 &&
		filepath.Clean(strings.TrimSpace(verifiedArtifacts[0])) == canonicalRoot
}

func profileRuntimePortableEntry(entry string) string {
	return strings.TrimPrefix(filepath.ToSlash(strings.TrimSpace(entry)), "./")
}

func profileRuntimeExpectedIntegritySatisfied(expected string, observedHashes map[string]string) bool {
	trimmedExpected := strings.TrimSpace(expected)
	if trimmedExpected == "" {
		return true
	}
	expectedSHA256 := profileRuntimeCanonicalContentSHA256(trimmedExpected)
	if expectedSHA256 == "" {
		return false
	}
	return profileRuntimeCanonicalContentSHA256(observedHashes["entry_sha256"]) == expectedSHA256
}

func profileRuntimeCanonicalContentSHA256(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.TrimPrefix(normalized, "sha256:")
	if len(normalized) != 64 {
		return ""
	}
	decoded, err := hex.DecodeString(normalized)
	if err != nil || len(decoded) != 32 {
		return ""
	}
	return normalized
}

func profileRuntimeSelectedSourceEvidenceValue(evidence []string, key string) string {
	prefix := strings.TrimSpace(key) + "="
	value := ""
	for _, item := range evidence {
		trimmed := strings.TrimSpace(item)
		if !strings.HasPrefix(trimmed, prefix) {
			continue
		}
		next := strings.TrimSpace(strings.TrimPrefix(trimmed, prefix))
		if next == "" || (value != "" && value != next) {
			return ""
		}
		value = next
	}
	return value
}

func profileRuntimeRememberPreparedAssetAssociation(associations map[string]string, bindingID string, preparedAssetID string) error {
	trimmedBindingID := strings.TrimSpace(bindingID)
	trimmedPreparedAssetID := strings.TrimSpace(preparedAssetID)
	if trimmedBindingID == "" || trimmedPreparedAssetID == "" {
		return nil
	}
	if existing := strings.TrimSpace(associations[trimmedBindingID]); existing != "" && existing != trimmedPreparedAssetID {
		return profileRuntimeDescriptorError("materialization.prepared_asset_association_ambiguous", trimmedBindingID)
	}
	associations[trimmedBindingID] = trimmedPreparedAssetID
	return nil
}

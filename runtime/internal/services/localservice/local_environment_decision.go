package localservice

import (
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
)

// localDecisionPackID prepares the managed Python dependency profile consumed
// by the Local Laya text.decide Driver: PyTorch on the CUDA wheel plane for
// NVIDIA hosts, otherwise the CPU plane.
const localDecisionPackID = "local-decision"

func localDecisionPackDefinition() localComputePackDefinition {
	return localComputePackDefinition{
		PackID: localDecisionPackID, ProductLabel: "Decisions",
		RequiredDependencyFamilies: []string{localEnvironmentFamilyPythonUV, localEnvironmentFamilyPythonRuntime, localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet, localEnvironmentFamilyPythonTorchWheel},
		OptionalDependencyFamilies: []string{localEnvironmentFamilyCUDA}, CloudOnlyImpact: "none",
	}
}

// localDecisionPythonConsumerScope reports the Laya consumer and its torch
// wheel plane scopes.
func localDecisionPythonConsumerScope(consumer string) bool {
	switch strings.TrimSpace(consumer) {
	case engine.TextDecisionConsumerID, engine.TextDecisionConsumerID + ".cuda", engine.TextDecisionConsumerID + ".cpu":
		return true
	default:
		return false
	}
}

// localDecisionDependencySources captures the exact verified Laya profile
// consumption projection for one Loadout execution snapshot on the admission's
// live device profile.
func (s *Service) localDecisionDependencySources(profile *runtimev1.LocalDeviceProfile) ([]localexecution.ExactDependencySource, error) {
	record, _, ok, detail := s.selectedPythonPackageSetSourceForConsumerOnHost(engine.TextDecisionConsumerID, func(root string) string { return filepath.Join(root, "text_decision_server.py") }, profile)
	if !ok {
		return nil, loadoutError(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, "Typed decision managed profile is not ready", map[string]string{"detail": detail})
	}
	return []localexecution.ExactDependencySource{{
		DependencyFamily: record.DependencyFamily, DependencyID: record.DependencyID,
		ConsumerScope: engine.TextDecisionConsumerID, SelectedSourceRecordID: record.RecordID,
		CanonicalRoot: record.CanonicalRoot, Version: record.Version,
		VerifiedArtifacts: append([]string(nil), record.VerifiedArtifacts...), Hashes: cloneStringMap(record.Hashes),
	}}, nil
}

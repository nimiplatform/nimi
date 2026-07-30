package localservice

import (
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func markProductControlFirstRunConsumerReady(
	t *testing.T,
	svc *Service,
	runtimeDataRoot string,
	binding productControlFirstRunConsumerBinding,
	profile *runtimev1.LocalDeviceProfile,
) {
	t.Helper()
	requirement, ok := localEnvironmentConsumerRequirementByID(binding.ConsumerID)
	if !ok {
		t.Fatalf("unknown first-run consumer %q", binding.ConsumerID)
	}
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          requirement.PackID,
		ConsumerScope:   binding.ConsumerID,
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
		AssetID:         binding.AssetID,
	})
	for _, dep := range plan.Dependencies {
		if !dep.Required {
			continue
		}
		sourceKind := localEnvironmentSourceManaged
		if dep.DependencyFamily == localEnvironmentFamilyPythonRuntime || dep.DependencyFamily == localEnvironmentFamilyPythonUV {
			sourceKind = localEnvironmentSourceSystem
		}
		canonicalRoot := filepath.Join(runtimeDataRoot, strings.ReplaceAll(dep.DependencyID, ":", "-"))
		record := localEnvironmentSelectedSourceRecordState{
			DependencyFamily:  dep.DependencyFamily,
			DependencyID:      dep.DependencyID,
			EnvironmentKey:    dep.EnvironmentKey,
			SourceKind:        sourceKind,
			CanonicalRoot:     canonicalRoot,
			SelectedConsumers: []string{binding.ConsumerID},
			AuditReasonCode:   "test_ready",
		}
		if dep.DependencyFamily == localEnvironmentFamilyPythonPackageSet {
			switch binding.ConsumerID {
			case "speech.qwen3-tts.python":
				driverScript := engine.SpeechQwen3TTSDriverPath(canonicalRoot)
				record.VerifiedArtifacts = []string{filepath.Join(canonicalRoot, "bin", "python"), driverScript}
				record.ActivationEnvDelta = []string{"NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD='python' '" + driverScript + "'"}
			case "speech.qwen3-asr.python":
				driverScript := engine.SpeechQwen3ASRDriverPath(canonicalRoot)
				record.VerifiedArtifacts = []string{filepath.Join(canonicalRoot, "bin", "python"), driverScript}
				record.ActivationEnvDelta = []string{"NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD='python' '" + driverScript + "'"}
			}
		}
		record = verifiedSelectedSourceRecordForTest(record)
		writeSelectedSourceLocalArtifactsForTest(t, record)
		svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	}
}

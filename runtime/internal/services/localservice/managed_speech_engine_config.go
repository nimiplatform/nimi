package localservice

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func (s *Service) configuredManagedSpeechEngineConfigForCapability(capabilityContract string, driverID string, port int) (engine.EngineConfig, error) {
	consumer := ""
	envKey := ""
	var driverPath func(string) string
	switch strings.TrimSpace(capabilityContract) {
	case capabilitydriver.AudioSynthesizeContract:
		if strings.TrimSpace(driverID) != capabilitydriver.Qwen3TTSDriverID {
			return engine.EngineConfig{}, fmt.Errorf("speech synthesis Driver is not admitted: %s", strings.TrimSpace(driverID))
		}
		consumer = "speech.qwen3-tts.python"
		envKey = "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
		driverPath = engine.SpeechQwen3TTSDriverPath
	case capabilitydriver.AudioTranscribeContract:
		switch strings.TrimSpace(driverID) {
		case capabilitydriver.Qwen3ASRDriverID:
			consumer = "speech.qwen3-asr.python"
			envKey = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"
			driverPath = engine.SpeechQwen3ASRDriverPath
		case capabilitydriver.Qwen3ASRTransformersDriverID:
			consumer = "speech.qwen3-asr-transformers.python"
			envKey = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD"
			driverPath = engine.SpeechQwen3ASRTransformersDriverPath
		default:
			return engine.EngineConfig{}, fmt.Errorf("speech transcription Driver is not admitted: %s", strings.TrimSpace(driverID))
		}
	default:
		return engine.EngineConfig{}, fmt.Errorf("speech ExecutionHost capability is not admitted: %s", strings.TrimSpace(capabilityContract))
	}
	record, identity, ok, detail := s.selectedSpeechPackageSetSourceForConsumer(consumer, envKey, driverPath)
	if !ok {
		return engine.EngineConfig{}, fmt.Errorf("%s selected source missing: %s", consumer, detail)
	}
	root := strings.TrimSpace(record.CanonicalRoot)
	cfg := engine.DefaultSpeechConfig()
	if port > 0 {
		cfg.Port = port
	}
	cfg.ModelsPath = s.resolvedLocalModelsPath()
	cfg.SpeechHostPackageSetRoot = root
	cfg.SpeechHostAcceleratorPlane = identity.AcceleratorPlane
	if consumer == "speech.qwen3-tts.python" {
		cfg.SpeechQwen3TTSPackageSetRoot = root
	} else if consumer == "speech.qwen3-asr.python" {
		cfg.SpeechQwen3ASRPackageSetRoot = root
	} else {
		cfg.SpeechQwen3ASRTransformersPackageSetRoot = root
	}
	cfg.ExecutionHostIdentity = speechExecutionHostIdentity(capabilityContract, driverID, cfg)
	if cfg.ExecutionHostIdentity == "" {
		return engine.EngineConfig{}, fmt.Errorf("speech ExecutionHost dependency profile identity is incomplete")
	}
	return cfg, nil
}

// MaterializeSpeechExecutionHost starts only the private supervised Host for
// the exact speech capability already selected and planned by the AI service.
// It owns no route, model, binding, or fallback decision.
func (s *Service) MaterializeSpeechExecutionHost(ctx context.Context, capabilityContract string, driverID string, port int) (string, error) {
	if s == nil {
		return "", fmt.Errorf("runtime local service unavailable")
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return "", fmt.Errorf("runtime engine manager unavailable")
	}
	cfg, err := s.configuredManagedSpeechEngineConfigForCapability(capabilityContract, driverID, port)
	if err != nil {
		return "", err
	}

	s.managedSpeechMu.Lock()
	defer s.managedSpeechMu.Unlock()

	info, statusErr := mgr.EngineStatus("speech")
	running := statusErr == nil && info.PID > 0 && info.Port == cfg.Port &&
		(strings.EqualFold(strings.TrimSpace(info.Status), "healthy") || strings.EqualFold(strings.TrimSpace(info.Status), "starting"))
	if running && info.ExecutionHostIdentity == cfg.ExecutionHostIdentity {
		s.MarkManagedEngineUsed("speech", "speech_execution_host_reuse")
		return cfg.Endpoint(), nil
	}
	if statusErr == nil && info.PID > 0 {
		if err := mgr.StopEngine("speech"); err != nil {
			return "", fmt.Errorf("stop previous speech ExecutionHost: %w", err)
		}
	}
	if err := mgr.StartEngineWithConfig(ctx, cfg); err != nil {
		return "", err
	}
	s.MarkManagedEngineUsed("speech", "speech_execution_host_materialized")
	return cfg.Endpoint(), nil
}

// StopSpeechExecutionHost synchronously stops the private supervised Speech
// Host after a running execution is canceled. The caller retains its private
// execution lease until this method returns, so no replacement request can
// overlap the canceled Driver process tree.
func (s *Service) StopSpeechExecutionHost() error {
	if s == nil {
		return fmt.Errorf("runtime local service unavailable")
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return fmt.Errorf("runtime engine manager unavailable")
	}

	s.managedSpeechMu.Lock()
	defer s.managedSpeechMu.Unlock()
	if err := mgr.StopEngine("speech"); err != nil {
		if errors.Is(err, engine.ErrEngineNotRunning) {
			return nil
		}
		return fmt.Errorf("stop canceled speech ExecutionHost: %w", err)
	}
	return nil
}

func (s *Service) selectedSpeechPackageSetSourceForConsumer(consumer string, envKey string, driverPath func(string) string) (localEnvironmentSelectedSourceRecordState, engine.PythonDependencyProfileIdentity, bool, string) {
	trimmedConsumer := strings.TrimSpace(consumer)
	trimmedEnvKey := strings.TrimSpace(envKey)
	if trimmedConsumer == "" || trimmedEnvKey == "" || driverPath == nil {
		return localEnvironmentSelectedSourceRecordState{}, engine.PythonDependencyProfileIdentity{}, false, "speech package-set consumer, driver env key, and driver path are required"
	}

	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	acceleratorPlane := "cpu"
	if localEnvironmentHostSupportsCUDA(hostState) {
		acceleratorPlane = "cuda"
	}
	identity, err := engine.ResolvePythonDependencyProfileIdentity(trimmedConsumer, localEnvironmentPlatformTuple(hostState), acceleratorPlane)
	if err != nil {
		return localEnvironmentSelectedSourceRecordState{}, engine.PythonDependencyProfileIdentity{}, false, "resolve current dependency profile: " + err.Error()
	}
	environmentKey := localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonPackageSet, identity.DependencyID, s.localEnvironmentRuntimeDataRoot())
	record, ok := s.localEnvironmentSelectedSourceRecordForDependency(
		environmentKey,
		localEnvironmentFamilyPythonPackageSet,
		identity.DependencyID,
		trimmedConsumer,
	)
	if !ok {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "no selected source consumption projection for current dependency profile"
	}
	if strings.TrimSpace(record.SourceKind) != localEnvironmentSourceManaged {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "current dependency profile is not Runtime-managed"
	}
	if isLocalEnvironmentRepairActive(record.RepairState) {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "selected source consumption projection is under repair"
	}
	if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "selected source consumption projection fails verification: " + err.Error()
	}
	if strings.TrimSpace(record.Version) != identity.ProfileDigest {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "selected source consumption projection has stale profile identity"
	}
	for key, expected := range pythonDependencyProfileHashes(identity) {
		if strings.TrimSpace(record.Hashes[key]) != expected {
			return localEnvironmentSelectedSourceRecordState{}, identity, false, "selected source consumption projection has stale " + key
		}
	}
	runtimeDataRoot := s.localEnvironmentRuntimeDataRoot()
	expectedRoot := filepath.Join(runtimeDataRoot, "environments", "python-profiles", identity.ProfileDigest)
	if !sameLocalEnvironmentPath(record.CanonicalRoot, expectedRoot) {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "selected source consumption projection has non-canonical profile root"
	}
	driverScript := strings.TrimSpace(driverPath(expectedRoot))
	if !localEnvironmentArtifactPathsContain(record.VerifiedArtifacts, driverScript) {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "selected source consumption projection is missing verified private Driver " + driverScript
	}
	interpreterVerified := false
	for _, interpreter := range []string{
		filepath.Join(expectedRoot, "Scripts", "python.exe"),
		filepath.Join(expectedRoot, "bin", "python"),
	} {
		if localEnvironmentArtifactPathsContain(record.VerifiedArtifacts, interpreter) {
			interpreterVerified = true
			break
		}
	}
	if !interpreterVerified {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "selected source consumption projection is missing verified profile interpreter"
	}
	if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "selected source consumption projection fails local artifact verification: " + err.Error()
	}
	if err := engine.VerifyPythonDependencyProfileStaticContent(expectedRoot, trimmedConsumer, identity); err != nil {
		return localEnvironmentSelectedSourceRecordState{}, identity, false, "selected source consumption projection has static content drift: " + err.Error()
	}
	return record, identity, true, ""
}

func isLocalEnvironmentRepairActive(repairState string) bool {
	switch strings.TrimSpace(repairState) {
	case "", localEnvironmentRepairNone:
		return false
	case localEnvironmentRepairRequired, localEnvironmentRepairRunning, localEnvironmentRepairFailed:
		return true
	default:
		return true
	}
}

func activationEnvDeltaContainsKey(values []string, key string) bool {
	prefix := strings.TrimSpace(key) + "="
	for _, value := range values {
		if strings.HasPrefix(strings.TrimSpace(value), prefix) && strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(value), prefix)) != "" {
			return true
		}
	}
	return false
}

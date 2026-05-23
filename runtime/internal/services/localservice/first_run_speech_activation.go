package localservice

import (
	"context"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func firstRunBaselineRequiresSpeech(record runtimeBaselineReadinessRecord) bool {
	for _, response := range record.ActivationReadyResponses {
		switch strings.TrimSpace(response.ConsumerID) {
		case "speech.qwen3-asr.python", "speech.qwen3-tts.python":
			return true
		}
	}
	return false
}

func (s *Service) ensureFirstRunSpeechEngineReady(ctx context.Context, baseline runtimeBaselineReadinessRecord) error {
	if !firstRunBaselineRequiresSpeech(baseline) {
		return nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return fmt.Errorf("runtime engine manager unavailable")
	}
	if err := s.startConfiguredManagedSpeechEngine(ctx, mgr, 0); err != nil {
		return err
	}
	info, err := mgr.EngineStatus("speech")
	if err != nil {
		return fmt.Errorf("speech engine status unavailable after activation: %w", err)
	}
	if !strings.EqualFold(strings.TrimSpace(info.Status), "healthy") {
		detail := strings.TrimSpace(info.Endpoint)
		if detail != "" {
			detail = " endpoint=" + detail
		}
		return fmt.Errorf("speech engine not healthy after activation: status=%s%s", strings.TrimSpace(info.Status), detail)
	}
	return nil
}

func (s *Service) configuredManagedSpeechEngineConfig(port int) (engine.EngineConfig, error) {
	ttsRecord, ok, detail := s.selectedSpeechPackageSetSourceForConsumer(
		"speech.qwen3-tts.python",
		"NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD",
		engine.SpeechQwen3TTSDriverPath,
	)
	if !ok {
		return engine.EngineConfig{}, fmt.Errorf("qwen3_tts python.package-set selected source missing: %s", detail)
	}
	asrRecord, ok, detail := s.selectedSpeechPackageSetSourceForConsumer(
		"speech.qwen3-asr.python",
		"NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD",
		engine.SpeechQwen3ASRDriverPath,
	)
	if !ok {
		return engine.EngineConfig{}, fmt.Errorf("qwen3_asr python.package-set selected source missing: %s", detail)
	}
	cfg := engine.DefaultSpeechConfig()
	if port > 0 {
		cfg.Port = port
	}
	cfg.ModelsPath = s.resolvedLocalModelsPath()
	cfg.SpeechQwen3TTSPackageSetRoot = strings.TrimSpace(ttsRecord.CanonicalRoot)
	cfg.SpeechQwen3ASRPackageSetRoot = strings.TrimSpace(asrRecord.CanonicalRoot)
	return cfg, nil
}

func (s *Service) startConfiguredManagedSpeechEngine(ctx context.Context, mgr EngineManager, port int) error {
	if mgr == nil {
		return fmt.Errorf("runtime engine manager unavailable")
	}
	cfg, err := s.configuredManagedSpeechEngineConfig(port)
	if err != nil {
		return err
	}
	if managedEngineAlreadyBound(mgr, "speech", cfg.Port) {
		return nil
	}
	if err := mgr.StartEngineWithConfig(ctx, cfg); err != nil {
		lower := strings.ToLower(strings.TrimSpace(err.Error()))
		if !strings.Contains(lower, "already running") {
			return err
		}
	}
	return nil
}

func (s *Service) selectedSpeechPackageSetSourceForConsumer(consumer string, envKey string, driverPath func(string) string) (localEnvironmentSelectedSourceRecordState, bool, string) {
	trimmedConsumer := strings.TrimSpace(consumer)
	trimmedEnvKey := strings.TrimSpace(envKey)
	if trimmedConsumer == "" || trimmedEnvKey == "" || driverPath == nil {
		return localEnvironmentSelectedSourceRecordState{}, false, "speech package-set consumer, driver env key, and driver path are required"
	}

	s.mu.RLock()
	candidates := make([]localEnvironmentSelectedSourceRecordState, 0)
	for _, record := range s.localEnvironmentSelectedSources {
		if record.DependencyFamily != localEnvironmentFamilyPythonPackageSet {
			continue
		}
		if !stringSliceContains(record.SelectedConsumers, trimmedConsumer) {
			continue
		}
		candidates = append(candidates, record)
	}
	s.mu.RUnlock()

	if len(candidates) == 0 {
		return localEnvironmentSelectedSourceRecordState{}, false, "no selected source record for consumer"
	}

	lastDetail := "no selected source record satisfies speech driver evidence"
	for _, record := range candidates {
		if isLocalEnvironmentRepairActive(record.RepairState) {
			lastDetail = "selected source record is under repair"
			continue
		}
		if err := validateLocalEnvironmentSelectedSourceRecord(record); err != nil {
			lastDetail = "selected source record fails verification: " + err.Error()
			continue
		}
		if err := validateLocalEnvironmentSelectedSourceLocalArtifacts(record); err != nil {
			lastDetail = "selected source record fails local artifact verification: " + err.Error()
			continue
		}
		root := strings.TrimSpace(record.CanonicalRoot)
		if root == "" {
			lastDetail = "selected source record missing canonical root"
			continue
		}
		driverScript := strings.TrimSpace(driverPath(root))
		if !stringSliceContains(record.VerifiedArtifacts, driverScript) {
			lastDetail = "selected source record missing verified driver script " + driverScript
			continue
		}
		if !activationEnvDeltaContainsKey(record.ActivationEnvDelta, trimmedEnvKey) {
			lastDetail = "selected source record missing verified driver command " + trimmedEnvKey
			continue
		}
		return record, true, ""
	}
	return localEnvironmentSelectedSourceRecordState{}, false, lastDetail
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

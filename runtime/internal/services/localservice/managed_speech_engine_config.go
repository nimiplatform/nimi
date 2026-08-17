package localservice

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

// @nimi-authority: rule.nimi.runtime.local-compute.r110
func (s *Service) configuredManagedSpeechEngineConfigForCapability(capabilityContract string, driverID string, port int) (engine.EngineConfig, error) {
	consumer := ""
	envKey := ""
	voxcpmBackend := ""
	var requiredDriver engine.SpeechDriver
	var driverPath func(string) string
	switch strings.TrimSpace(capabilityContract) {
	case capabilitydriver.AudioSynthesizeContract:
		switch strings.TrimSpace(driverID) {
		case capabilitydriver.Qwen3TTSDriverID:
			consumer = "speech.qwen3-tts.python"
			envKey = "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
			requiredDriver = engine.SpeechDriverQwen3TTS
			driverPath = engine.SpeechQwen3TTSDriverPath
		case capabilitydriver.VoxCPMDriverID:
			consumer = "speech.voxcpm.python"
			envKey = "NIMI_RUNTIME_SPEECH_VOXCPM_CMD"
			requiredDriver = engine.SpeechDriverVoxCPM
			hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
			backend, err := engine.SpeechVoxCPMBackendForPlatform(localEnvironmentPlatformTuple(hostState))
			if err != nil {
				return engine.EngineConfig{}, err
			}
			voxcpmBackend = backend
			driverPath = func(root string) string {
				path, _ := engine.SpeechVoxCPMDriverPathForBackend(root, backend)
				return path
			}
		default:
			return engine.EngineConfig{}, fmt.Errorf("speech synthesis Driver is not admitted: %s", strings.TrimSpace(driverID))
		}
	case capabilitydriver.VoiceCreateContract:
		if strings.TrimSpace(driverID) != capabilitydriver.Qwen3TTSDriverID {
			return engine.EngineConfig{}, fmt.Errorf("voice.create Driver is not admitted: %s", strings.TrimSpace(driverID))
		}
		consumer = "speech.qwen3-tts.python"
		envKey = "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
		requiredDriver = engine.SpeechDriverQwen3TTS
		driverPath = engine.SpeechQwen3TTSDriverPath
	case capabilitydriver.AudioTranscribeContract:
		switch strings.TrimSpace(driverID) {
		case capabilitydriver.Qwen3ASRDriverID:
			consumer = "speech.qwen3-asr.python"
			envKey = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"
			requiredDriver = engine.SpeechDriverQwen3ASR
			driverPath = engine.SpeechQwen3ASRDriverPath
		case capabilitydriver.Qwen3ASRTransformersDriverID:
			consumer = "speech.qwen3-asr-transformers.python"
			envKey = "NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD"
			requiredDriver = engine.SpeechDriverQwen3ASRTransformers
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
	cfg.SpeechRequiredDriver = requiredDriver
	if consumer == "speech.qwen3-tts.python" {
		cfg.SpeechQwen3TTSPackageSetRoot = root
	} else if consumer == "speech.qwen3-asr.python" {
		cfg.SpeechQwen3ASRPackageSetRoot = root
	} else if consumer == "speech.qwen3-asr-transformers.python" {
		cfg.SpeechQwen3ASRTransformersPackageSetRoot = root
	} else {
		cfg.SpeechVoxCPMPackageSetRoot = root
		cfg.SpeechVoxCPMBackend = voxcpmBackend
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
	if running && info.ExecutionHostIdentity == cfg.ExecutionHostIdentity && strings.TrimSpace(s.managedSpeechAdmissionToken) != "" {
		return cfg.Endpoint(), nil
	}
	if statusErr == nil && info.PID > 0 {
		if err := mgr.StopEngine("speech"); err != nil {
			return "", fmt.Errorf("stop previous speech ExecutionHost: %w", err)
		}
	}
	s.managedSpeechAdmissionToken = ""
	admissionToken, err := newSpeechAdmissionToken()
	if err != nil {
		return "", err
	}
	cfg.SpeechAdmissionToken = admissionToken
	if err := mgr.StartEngineWithConfig(ctx, cfg); err != nil {
		return "", err
	}
	s.managedSpeechAdmissionToken = admissionToken
	return cfg.Endpoint(), nil
}

func newSpeechAdmissionToken() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate speech registration admission token: %w", err)
	}
	return hex.EncodeToString(value), nil
}

const (
	speechExecutionModelRegistrationTimeout = 10 * time.Second
	speechExecutionModelRegistrationMaxBody = 64 * 1024
)

type speechExecutionModelRegistrationPayload struct {
	Model              string            `json:"model"`
	Capability         string            `json:"capability"`
	DriverID           string            `json:"driver_id"`
	Driver             string            `json:"driver"`
	Family             string            `json:"family"`
	Backend            string            `json:"backend"`
	CreationSource     string            `json:"creation_source,omitempty"`
	WorkflowModelID    string            `json:"workflow_model_id,omitempty"`
	BundleDir          string            `json:"bundle_dir"`
	EntryPath          string            `json:"entry_path"`
	DeclaredFiles      []string          `json:"declared_files"`
	DeclaredFileSHA256 map[string]string `json:"declared_file_sha256"`
	VerifiedContentID  string            `json:"verified_content_id"`
	EntrySHA256        string            `json:"entry_sha256"`
}

// RegisterSpeechExecutionModel publishes only the captured ResolvedAssembly
// binding plus facts owned by the already-selected Driver and private Host.
// It never consults the catalog or scans a model root.
func (s *Service) RegisterSpeechExecutionModel(ctx context.Context, endpoint string, registration engine.SpeechExecutionModelRegistration) error {
	if s == nil {
		return fmt.Errorf("runtime local service unavailable")
	}
	payload, err := s.speechExecutionModelRegistrationPayload(registration)
	if err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal speech model registration: %w", err)
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.managedSpeechMu.Lock()
	admissionToken := strings.TrimSpace(s.managedSpeechAdmissionToken)
	s.managedSpeechMu.Unlock()
	if admissionToken == "" {
		return fmt.Errorf("speech model registration admission token unavailable")
	}
	registrationURL := strings.TrimRight(strings.TrimSpace(endpoint), "/") + "/v1/models/register"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, registrationURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create speech model registration request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(engine.SpeechAdmissionTokenHeader, admissionToken)
	resp, err := (&http.Client{Timeout: speechExecutionModelRegistrationTimeout}).Do(req)
	if err != nil {
		return fmt.Errorf("post speech model registration: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, speechExecutionModelRegistrationMaxBody))
	if readErr != nil {
		return fmt.Errorf("read speech model registration response: %w", readErr)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		detail := strings.TrimSpace(string(responseBody))
		if detail == "" {
			detail = http.StatusText(resp.StatusCode)
		}
		return fmt.Errorf("speech model registration rejected with HTTP %d: %s", resp.StatusCode, detail)
	}
	return nil
}

func (s *Service) speechExecutionModelRegistrationPayload(registration engine.SpeechExecutionModelRegistration) (speechExecutionModelRegistrationPayload, error) {
	capabilityContract := strings.TrimSpace(registration.CapabilityContract)
	driverID := strings.TrimSpace(registration.DriverID)
	driver, family, backend, err := speechExecutionRegistrationDriverFacts(capabilityContract, driverID)
	if err != nil {
		return speechExecutionModelRegistrationPayload{}, err
	}
	if strings.TrimSpace(registration.ModelAssetID) == "" || strings.TrimSpace(registration.BundleDir) == "" ||
		strings.TrimSpace(registration.EntryPath) == "" || len(registration.DeclaredFiles) == 0 ||
		len(registration.DeclaredFileSHA256) != len(registration.DeclaredFiles) ||
		strings.TrimSpace(registration.VerifiedContentID) == "" || strings.TrimSpace(registration.EntrySHA256) == "" {
		return speechExecutionModelRegistrationPayload{}, fmt.Errorf("speech model registration binding is incomplete")
	}
	creationSource := strings.TrimSpace(registration.VoiceCreationSource)
	workflowModelID := strings.TrimSpace(registration.WorkflowModelID)
	if capabilityContract == capabilitydriver.VoiceCreateContract {
		if (creationSource != "reference_audio" && creationSource != "text_description") || workflowModelID == "" {
			return speechExecutionModelRegistrationPayload{}, fmt.Errorf("speech voice.create registration binding is incomplete")
		}
	} else if creationSource != "" || workflowModelID != "" {
		return speechExecutionModelRegistrationPayload{}, fmt.Errorf("speech voice.create registration binding is not admitted for %s", capabilityContract)
	}
	return speechExecutionModelRegistrationPayload{
		Model: strings.TrimSpace(registration.ModelAssetID), Capability: capabilityContract,
		DriverID: driverID, Driver: driver, Family: family, Backend: backend,
		CreationSource: creationSource, WorkflowModelID: workflowModelID,
		BundleDir: registration.BundleDir, EntryPath: registration.EntryPath,
		DeclaredFiles:      append([]string(nil), registration.DeclaredFiles...),
		DeclaredFileSHA256: cloneStringMap(registration.DeclaredFileSHA256),
		VerifiedContentID:  registration.VerifiedContentID, EntrySHA256: registration.EntrySHA256,
	}, nil
}

func speechExecutionRegistrationDriverFacts(capabilityContract string, driverID string) (string, string, string, error) {
	switch strings.TrimSpace(driverID) {
	case capabilitydriver.Qwen3TTSDriverID:
		if capabilityContract != capabilitydriver.AudioSynthesizeContract && capabilityContract != capabilitydriver.VoiceCreateContract {
			break
		}
		return "qwen3_tts", "qwen3_tts", "qwen_tts", nil
	case capabilitydriver.Qwen3ASRDriverID:
		if capabilityContract != capabilitydriver.AudioTranscribeContract {
			break
		}
		return "qwen3_asr", "qwen3_asr", "qwen_asr", nil
	case capabilitydriver.Qwen3ASRTransformersDriverID:
		if capabilityContract != capabilitydriver.AudioTranscribeContract {
			break
		}
		return "qwen3_asr_transformers", "qwen3_asr", "transformers", nil
	case capabilitydriver.VoxCPMDriverID:
		if capabilityContract != capabilitydriver.AudioSynthesizeContract {
			break
		}
		hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
		backend, err := engine.SpeechVoxCPMBackendForPlatform(localEnvironmentPlatformTuple(hostState))
		if err != nil {
			return "", "", "", err
		}
		return "voxcpm", capabilitydriver.VoxCPMFamily, backend, nil
	}
	return "", "", "", fmt.Errorf("speech model registration Driver is not admitted for %s: %s", capabilityContract, driverID)
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
			s.managedSpeechAdmissionToken = ""
			return nil
		}
		return fmt.Errorf("stop canceled speech ExecutionHost: %w", err)
	}
	s.managedSpeechAdmissionToken = ""
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

func localEnvironmentArtifactPathsContain(values []string, expected string) bool {
	for _, value := range values {
		if sameLocalEnvironmentPath(value, expected) {
			return true
		}
	}
	return false
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

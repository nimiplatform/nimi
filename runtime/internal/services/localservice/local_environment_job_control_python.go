package localservice

import (
	"context"
	"errors"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

const defaultLocalEnvironmentPythonVersion = "3.12"

func (s *Service) executePythonUVEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if strings.TrimSpace(job.DependencyID) != "uv" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return localEnvironmentDependencyJobResult{}, errors.New("runtime engine manager unavailable")
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
	status, err := mgr.EnsureUVToolDependency(ctx)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateVerifying)
	if strings.TrimSpace(status.ExecutablePath) == "" || strings.TrimSpace(status.Version) == "" || strings.TrimSpace(status.ArchiveSHA256) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.ExecutablePath),
		Version:               strings.TrimSpace(status.Version),
		CompatibilityEvidence: []string{strings.TrimSpace(status.Detail), "asset=" + strings.TrimSpace(status.ArchiveAssetName), "platform=" + strings.TrimSpace(status.Platform)},
		VerifiedArtifacts:     normalizeStringSlice([]string{strings.TrimSpace(status.ExecutablePath)}),
		Hashes:                map[string]string{"archive_sha256": strings.TrimSpace(status.ArchiveSHA256)},
		SelectedConsumers:     pythonSelectedConsumersForDependency(job.DependencyID),
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func (s *Service) executePythonRuntimeEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if strings.TrimSpace(job.DependencyID) != "python.runtime" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	consumer := pythonMaterializerConsumerForJob(job)
	// Prerequisite ordering is runtime authority: the desktop fires uv ->
	// python.runtime concurrently, so wait (bounded, on the job ctx) for uv's
	// selected-source record rather than failing closed when this job races
	// ahead of the uv job. A genuinely absent uv record still fails closed once
	// the bounded wait elapses.
	uvRecord, ok, detail := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, localEnvironmentFamilyPythonUV, consumer)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
	if strings.TrimSpace(uvRecord.CanonicalRoot) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return localEnvironmentDependencyJobResult{}, errors.New("runtime engine manager unavailable")
	}
	engineName, version := pythonRuntimeEngineTarget(consumer)
	status, err := mgr.EnsurePythonRuntimeDependency(ctx, uvRecord.CanonicalRoot, engineName, version, defaultLocalEnvironmentPythonVersion)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	if strings.TrimSpace(status.InterpreterPath) == "" || strings.TrimSpace(status.PythonVersion) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.InterpreterPath),
		Version:               strings.TrimSpace(status.PythonVersion),
		CompatibilityEvidence: []string{strings.TrimSpace(status.Detail), "selected_uv_record=" + strings.TrimSpace(uvRecord.RecordID)},
		VerifiedArtifacts:     normalizeStringSlice([]string{strings.TrimSpace(status.InterpreterPath), strings.TrimSpace(status.UVExecutable)}),
		Hashes:                map[string]string{"selected_uv_record": strings.TrimSpace(uvRecord.RecordID)},
		SelectedConsumers:     pythonSelectedConsumersForDependency(job.DependencyID),
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func (s *Service) executePythonVenvEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if !strings.HasSuffix(strings.TrimSpace(job.DependencyID), ".venv") {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	consumer := pythonMaterializerConsumerForJob(job)
	if strings.TrimSpace(consumer) == "" && strings.HasPrefix(strings.TrimSpace(job.DependencyID), "local-speech.") {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	// Prerequisite ordering (runtime authority): wait for uv then python.runtime
	// rather than failing closed under concurrent unordered desktop Start calls.
	uvRecord, ok, detail := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, localEnvironmentFamilyPythonUV, consumer)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	runtimeRecord, ok, detail := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, localEnvironmentFamilyPythonRuntime, consumer)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateInstalling)
	if strings.TrimSpace(uvRecord.CanonicalRoot) == "" || strings.TrimSpace(runtimeRecord.CanonicalRoot) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return localEnvironmentDependencyJobResult{}, errors.New("runtime engine manager unavailable")
	}
	engineName, version := pythonRuntimeEngineTarget(consumer)
	status, err := mgr.EnsurePythonVenvDependency(ctx, uvRecord.CanonicalRoot, runtimeRecord.CanonicalRoot, engineName, version)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	if strings.TrimSpace(status.VenvRoot) == "" || strings.TrimSpace(status.InterpreterPath) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.VenvRoot),
		Version:               strings.TrimSpace(runtimeRecord.Version),
		CompatibilityEvidence: []string{strings.TrimSpace(status.Detail), "selected_uv_record=" + strings.TrimSpace(uvRecord.RecordID), "selected_python_runtime_record=" + strings.TrimSpace(runtimeRecord.RecordID)},
		VerifiedArtifacts:     normalizeStringSlice([]string{strings.TrimSpace(status.InterpreterPath), strings.TrimSpace(status.PythonRuntime), strings.TrimSpace(status.UVExecutable)}),
		Hashes: map[string]string{
			"selected_uv_record":             strings.TrimSpace(uvRecord.RecordID),
			"selected_python_runtime_record": strings.TrimSpace(runtimeRecord.RecordID),
		},
		SelectedConsumers: pythonSelectedConsumersForDependency(job.DependencyID),
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func (s *Service) executePythonPackageSetEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if !strings.HasSuffix(strings.TrimSpace(job.DependencyID), ".package-set") {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	consumer := pythonMaterializerConsumerForJob(job)
	if strings.TrimSpace(consumer) == "" && strings.HasPrefix(strings.TrimSpace(job.DependencyID), "local-speech.") {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	// Prerequisite ordering (runtime authority): wait for uv then venv.
	uvRecord, ok, detail := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, localEnvironmentFamilyPythonUV, consumer)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	venvRecord, ok, detail := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, localEnvironmentFamilyPythonVenv, consumer)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
	if strings.TrimSpace(uvRecord.CanonicalRoot) == "" || strings.TrimSpace(venvRecord.CanonicalRoot) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return localEnvironmentDependencyJobResult{}, errors.New("runtime engine manager unavailable")
	}
	status, err := mgr.EnsurePythonPackageSetDependency(ctx, uvRecord.CanonicalRoot, venvRecord.CanonicalRoot, consumer)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	if strings.TrimSpace(status.PackageSetID) == "" || strings.TrimSpace(status.LockHash) == "" || (len(status.Packages) > 0 && len(status.InstalledDistributions) == 0) || len(status.ImportProbes) == 0 {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	verifiedArtifacts := normalizeStringSlice([]string{strings.TrimSpace(status.InterpreterPath), strings.TrimSpace(status.UVExecutable)})
	verifiedArtifacts = append(verifiedArtifacts, normalizeStringSlice(status.DriverScripts)...)
	for _, dist := range status.InstalledDistributions {
		verifiedArtifacts = append(verifiedArtifacts, "distribution="+strings.TrimSpace(dist))
	}
	compatibilityEvidence := []string{
		strings.TrimSpace(status.Detail),
		"package_set_id=" + strings.TrimSpace(status.PackageSetID),
		"selected_uv_record=" + strings.TrimSpace(uvRecord.RecordID),
		"selected_venv_record=" + strings.TrimSpace(venvRecord.RecordID),
	}
	for _, probe := range status.ImportProbes {
		compatibilityEvidence = append(compatibilityEvidence, "import_probe="+strings.TrimSpace(probe))
	}
	activationEnvDelta := make([]string, 0, len(status.DriverCommands))
	for key, value := range status.DriverCommands {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" {
			continue
		}
		activationEnvDelta = append(activationEnvDelta, key+"="+value)
		compatibilityEvidence = append(compatibilityEvidence, "driver_command="+key)
	}
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.VenvRoot),
		Version:               strings.TrimSpace(status.LockHash),
		CompatibilityEvidence: normalizeStringSlice(compatibilityEvidence),
		VerifiedArtifacts:     normalizeStringSlice(verifiedArtifacts),
		Hashes: map[string]string{
			"package_lock_hash":    strings.TrimSpace(status.LockHash),
			"selected_uv_record":   strings.TrimSpace(uvRecord.RecordID),
			"selected_venv_record": strings.TrimSpace(venvRecord.RecordID),
		},
		SelectedConsumers:  pythonSelectedConsumersForDependency(job.DependencyID),
		ActivationEnvDelta: normalizeStringSlice(activationEnvDelta),
		AuditReasonCode:    "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func (s *Service) executePythonTorchWheelEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if !strings.HasSuffix(strings.TrimSpace(job.DependencyID), ".torch-wheel") {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	consumer := pythonMaterializerConsumerForJob(job)
	if !strings.HasPrefix(strings.TrimSpace(consumer), "media.") {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	// Prerequisite ordering (runtime authority): wait for uv, venv, and, for a
	// cuda consumer, the CUDA runtime, rather than failing closed under
	// concurrent unordered desktop Start calls.
	uvRecord, ok, detail := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, localEnvironmentFamilyPythonUV, consumer)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	venvRecord, ok, detail := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, localEnvironmentFamilyPythonVenv, consumer)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	if strings.Contains(strings.TrimSpace(consumer), ".cuda") {
		if _, ok, detail := s.waitForSelectedSourceForFamilyAndConsumerDetail(ctx, localEnvironmentFamilyCUDA, consumer); !ok {
			return failedPrerequisiteDependencyResult(detail), nil
		}
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateDownloading)
	if strings.TrimSpace(uvRecord.CanonicalRoot) == "" || strings.TrimSpace(venvRecord.CanonicalRoot) == "" {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	mgr := s.engineManagerOrNil()
	if mgr == nil {
		return localEnvironmentDependencyJobResult{}, errors.New("runtime engine manager unavailable")
	}
	status, err := mgr.EnsurePythonTorchWheelDependency(ctx, uvRecord.CanonicalRoot, venvRecord.CanonicalRoot, consumer)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	if strings.TrimSpace(status.TorchVersion) == "" || strings.TrimSpace(status.WheelLockHash) == "" || strings.TrimSpace(status.WheelIndex) == "" || len(status.ImportProbes) == 0 {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
		}, nil
	}
	hashes := map[string]string{
		"wheel_lock_hash":      strings.TrimSpace(status.WheelLockHash),
		"selected_uv_record":   strings.TrimSpace(uvRecord.RecordID),
		"selected_venv_record": strings.TrimSpace(venvRecord.RecordID),
	}
	if cudaRecord, ok, _ := s.readySelectedSourceForFamilyAndConsumer(localEnvironmentFamilyCUDA, consumer); ok {
		hashes["selected_cuda_record"] = strings.TrimSpace(cudaRecord.RecordID)
	}
	compatibilityEvidence := []string{
		strings.TrimSpace(status.Detail),
		"wheel_index=" + strings.TrimSpace(status.WheelIndex),
		"accelerator_plane=" + strings.TrimSpace(status.AcceleratorPlane),
		"cuda_abi=" + strings.TrimSpace(status.CUDAABI),
		"selected_uv_record=" + strings.TrimSpace(uvRecord.RecordID),
		"selected_venv_record=" + strings.TrimSpace(venvRecord.RecordID),
	}
	for _, probe := range status.ImportProbes {
		compatibilityEvidence = append(compatibilityEvidence, "import_probe="+strings.TrimSpace(probe))
	}
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.VenvRoot),
		Version:               strings.TrimSpace(status.TorchVersion),
		CompatibilityEvidence: normalizeStringSlice(compatibilityEvidence),
		VerifiedArtifacts: normalizeStringSlice([]string{
			strings.TrimSpace(status.InterpreterPath),
			strings.TrimSpace(status.UVExecutable),
			"torch=" + strings.TrimSpace(status.TorchVersion),
			strings.TrimSpace(status.TorchvisionSpec),
		}),
		Hashes:            hashes,
		SelectedConsumers: pythonSelectedConsumersForDependency(job.DependencyID),
		AuditReasonCode:   "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func pythonSelectedConsumersForDependency(dependencyID string) []string {
	switch {
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-image-native."):
		return []string{"stable-diffusion.cpp.cpu", "stable-diffusion.cpp.metal", "stable-diffusion.cpp.cuda"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-image-python."):
		return []string{"media.diffusers.cpu", "media.diffusers.cuda"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-video-python."):
		return []string{"media.video-python.cpu", "media.video-python.cuda"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-asr."):
		return []string{"speech.qwen3-asr.python"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-tts."):
		return []string{"speech.qwen3-tts.python"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech."):
		return []string{"speech.qwen3-asr.python", "speech.qwen3-tts.python"}
	case strings.TrimSpace(dependencyID) == "python.runtime", strings.TrimSpace(dependencyID) == "uv":
		return []string{
			"stable-diffusion.cpp.cpu",
			"stable-diffusion.cpp.metal",
			"stable-diffusion.cpp.cuda",
			"media.diffusers.cpu",
			"media.diffusers.cuda",
			"media.video-python.cpu",
			"media.video-python.cuda",
			"speech.qwen3-asr.python",
			"speech.qwen3-tts.python",
		}
	default:
		return []string{"python.pipeline"}
	}
}

func pythonMaterializerConsumerForDependency(dependencyID string) string {
	switch {
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-image-native."):
		return "stable-diffusion.cpp.metal"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-image-python."):
		return "media.diffusers.cuda"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-video-python."):
		return "media.video-python.cuda"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-asr."):
		return "speech.qwen3-asr.python"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-tts."):
		return "speech.qwen3-tts.python"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech."):
		return ""
	default:
		return ""
	}
}

func pythonMaterializerConsumerForJob(job localEnvironmentDependencyJobState) string {
	if consumer := pythonMaterializerConsumerForDependency(job.DependencyID); strings.TrimSpace(consumer) != "" {
		return consumer
	}
	for _, consumer := range []string{job.ConsumerScope, localEnvironmentConsumerScopeFromKey(job.EnvironmentKey)} {
		if pythonMaterializerConsumerScope(consumer) {
			return strings.TrimSpace(consumer)
		}
	}
	return ""
}

func pythonMaterializerConsumerScope(consumer string) bool {
	trimmed := strings.TrimSpace(consumer)
	return strings.HasPrefix(trimmed, "stable-diffusion.cpp.") ||
		strings.HasPrefix(trimmed, "media.") ||
		strings.HasPrefix(trimmed, "speech.")
}

func localEnvironmentConsumerScopeFromKey(environmentKey string) string {
	parts := strings.Split(strings.TrimSpace(environmentKey), "|")
	if len(parts) <= 5 {
		return ""
	}
	return strings.TrimSpace(parts[len(parts)-1])
}

func pythonRuntimeEngineTarget(consumer string) (string, string) {
	switch {
	case strings.HasPrefix(strings.TrimSpace(consumer), "speech."):
		cfg := engine.DefaultSpeechConfig()
		switch strings.TrimSpace(consumer) {
		case "speech.qwen3-asr.python":
			return "speech", cfg.Version + "-qwen3-asr"
		case "speech.qwen3-tts.python":
			return "speech", cfg.Version + "-qwen3-tts"
		default:
			return "speech", cfg.Version
		}
	case strings.TrimSpace(consumer) == "":
		return "python", defaultLocalEnvironmentPythonVersion
	default:
		cfg := engine.DefaultMediaConfig()
		return "media", cfg.Version
	}
}

func (s *Service) selectedSourceForFamilyAndConsumer(family string, consumer string) (localEnvironmentSelectedSourceRecordState, bool) {
	trimmedFamily := strings.TrimSpace(family)
	trimmedConsumer := strings.TrimSpace(consumer)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, record := range s.localEnvironmentSelectedSources {
		if record.DependencyFamily != trimmedFamily {
			continue
		}
		if trimmedConsumer == "" || stringSliceContains(record.SelectedConsumers, trimmedConsumer) {
			return record, true
		}
	}
	return localEnvironmentSelectedSourceRecordState{}, false
}

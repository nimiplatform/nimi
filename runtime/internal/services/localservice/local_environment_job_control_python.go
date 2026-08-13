package localservice

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

const defaultLocalEnvironmentPythonVersion = engine.ManagedPythonVersion

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
	status, err := mgr.EnsureUVToolDependency(localEnvironmentEngineDownloadProgressContext(ctx, report))
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
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func (s *Service) executePythonRuntimeEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if !pythonRuntimeDependencyIDSupported(job.DependencyID) {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	consumer := pythonMaterializerConsumerForJob(job)
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	platformTuple := localEnvironmentPlatformTuple(hostState)
	runtimeDataRoot := s.localEnvironmentRuntimeDataRoot()
	// Prerequisite ordering is runtime authority: the desktop fires uv ->
	// python.runtime concurrently, so wait (bounded, on the job ctx) for uv's
	// selected-source record rather than failing closed when this job races
	// ahead of the uv job. A genuinely absent uv record still fails closed once
	// the bounded wait elapses.
	uvRecord, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(
		ctx,
		localEnvironmentManagedUVKey(platformTuple, runtimeDataRoot),
		localEnvironmentFamilyPythonUV,
		"uv",
		consumer,
	)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateInstalling)
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
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func pythonRuntimeDependencyIDSupported(dependencyID string) bool {
	return strings.TrimSpace(dependencyID) == localEnvironmentPythonRuntimeDependencyID()
}

func (s *Service) executePythonVenvEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if !strings.HasPrefix(strings.TrimSpace(job.DependencyID), "python-profile.") {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	identity, consumer, err := resolvePythonDependencyProfileForJob(job, true)
	if err != nil {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PROFILE_UNSUPPORTED",
			FailureDetail:   err.Error(),
		}, nil
	}
	// Prerequisite ordering (runtime authority): wait for uv then python.runtime
	// rather than failing closed under concurrent unordered desktop Start calls.
	runtimeDataRoot := s.localEnvironmentRuntimeDataRoot()
	uvRecord, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(
		ctx,
		localEnvironmentManagedUVKey(identity.PlatformTuple, runtimeDataRoot),
		localEnvironmentFamilyPythonUV,
		"uv",
		consumer,
	)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	runtimeRecord, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(
		ctx,
		localEnvironmentPythonRuntimeKey(identity.PlatformTuple, runtimeDataRoot),
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentPythonRuntimeDependencyID(),
		consumer,
	)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	if identity.AcceleratorPlane == "cuda" {
		cudaConsumer := consumer
		if strings.HasPrefix(cudaConsumer, "speech.") {
			cudaConsumer += ".cuda"
		}
		hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
		cudaEnvironmentKey := localEnvironmentKey(localEnvironmentFamilyCUDA, cudaUserSpaceRuntimeDependencyID, hostState.HostProfileID, identity.PlatformTuple, runtimeDataRoot)
		if _, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(ctx, cudaEnvironmentKey, localEnvironmentFamilyCUDA, cudaUserSpaceRuntimeDependencyID, cudaConsumer); !ok {
			return failedPrerequisiteDependencyResult(detail), nil
		}
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
	status, err := mgr.EnsurePythonDependencyProfile(ctx, uvRecord.CanonicalRoot, runtimeRecord.CanonicalRoot, consumer, identity.PlatformTuple, identity.AcceleratorPlane)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	if err := validatePythonDependencyProfileStatus(status, identity); err != nil {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
			FailureDetail:   err.Error(),
		}, nil
	}
	verifiedArtifacts := normalizeStringSlice(append([]string{strings.TrimSpace(status.InterpreterPath)}, status.DriverScripts...))
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.ProfileRoot),
		Version:               identity.ProfileDigest,
		CompatibilityEvidence: pythonDependencyProfileCompatibilityEvidence(status, uvRecord.RecordID, runtimeRecord.RecordID),
		VerifiedArtifacts:     verifiedArtifacts,
		Hashes:                pythonDependencyProfileHashes(identity),
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func (s *Service) executePythonPackageSetEnvironmentDependencyJob(ctx context.Context, job localEnvironmentDependencyJobState, report localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
	if !strings.HasPrefix(strings.TrimSpace(job.DependencyID), "python-profile.") {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	identity, consumer, err := resolvePythonDependencyProfileForJob(job, true)
	if err != nil {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PROFILE_UNSUPPORTED",
			FailureDetail:   err.Error(),
		}, nil
	}
	// The package-set row is the profile's consumer activation projection. It
	// only consumes the already promoted immutable profile and never installs
	// into the venv row.
	runtimeDataRoot := s.localEnvironmentRuntimeDataRoot()
	uvRecord, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(
		ctx,
		localEnvironmentManagedUVKey(identity.PlatformTuple, runtimeDataRoot),
		localEnvironmentFamilyPythonUV,
		"uv",
		consumer,
	)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	venvRecord, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(
		ctx,
		localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonVenv, identity.DependencyID, runtimeDataRoot),
		localEnvironmentFamilyPythonVenv,
		identity.DependencyID,
		consumer,
	)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	runtimeRecord, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(
		ctx,
		localEnvironmentPythonRuntimeKey(identity.PlatformTuple, runtimeDataRoot),
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentPythonRuntimeDependencyID(),
		consumer,
	)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateVerifying)
	if strings.TrimSpace(uvRecord.CanonicalRoot) == "" || strings.TrimSpace(runtimeRecord.CanonicalRoot) == "" || strings.TrimSpace(venvRecord.CanonicalRoot) == "" {
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
	status, err := mgr.EnsurePythonDependencyProfile(ctx, uvRecord.CanonicalRoot, runtimeRecord.CanonicalRoot, consumer, identity.PlatformTuple, identity.AcceleratorPlane)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	if err := validatePythonDependencyProfileStatus(status, identity); err != nil || !sameLocalEnvironmentPath(status.ProfileRoot, venvRecord.CanonicalRoot) {
		failureDetail := "python dependency profile root does not match promoted venv projection"
		if err != nil {
			failureDetail = err.Error()
		}
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
			FailureDetail:   failureDetail,
		}, nil
	}
	verifiedArtifacts := normalizeStringSlice([]string{strings.TrimSpace(status.InterpreterPath), strings.TrimSpace(status.UVExecutable)})
	verifiedArtifacts = append(verifiedArtifacts, normalizeStringSlice(status.DriverScripts)...)
	for _, dist := range status.InstalledDistributions {
		verifiedArtifacts = append(verifiedArtifacts, "distribution="+strings.TrimSpace(dist))
	}
	compatibilityEvidence := []string{
		strings.TrimSpace(status.Detail),
		"profile_digest=" + identity.ProfileDigest,
		"selected_uv_record=" + strings.TrimSpace(uvRecord.RecordID),
		"selected_venv_record=" + strings.TrimSpace(venvRecord.RecordID),
		"selected_python_runtime_record=" + strings.TrimSpace(runtimeRecord.RecordID),
	}
	for _, probe := range status.ImportProbes {
		compatibilityEvidence = append(compatibilityEvidence, "import_probe="+strings.TrimSpace(probe))
	}
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.ProfileRoot),
		Version:               identity.ProfileDigest,
		CompatibilityEvidence: normalizeStringSlice(compatibilityEvidence),
		VerifiedArtifacts:     normalizeStringSlice(verifiedArtifacts),
		Hashes:                pythonDependencyProfileHashes(identity),
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
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
	if !strings.HasPrefix(strings.TrimSpace(consumer), "media.") && !strings.HasPrefix(strings.TrimSpace(consumer), "speech.") {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_UNSUPPORTED",
		}, nil
	}
	// Torch is a consumer-independent selected source. The exact profile already
	// consumed that source through one frozen lock; this row verifies that
	// consumption without installing or storing a consumer-local profile root.
	prerequisiteConsumer := pythonTorchWheelPrerequisiteConsumer(consumer)
	identity, resolvedConsumer, err := resolvePythonDependencyProfileForJob(job, false)
	if err != nil || resolvedConsumer != prerequisiteConsumer {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PROFILE_UNSUPPORTED",
			FailureDetail:   localEnvironmentErrorDetail(err, "python dependency profile consumer mismatch"),
		}, nil
	}
	torchIdentity, err := engine.ResolvePythonTorchWheelDependencyIdentity(consumer)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	wantDependencyID := localEnvironmentPythonTorchWheelDependencyID(torchIdentity)
	wantEnvironmentKey := localEnvironmentPythonTorchWheelKey(torchIdentity, identity.PlatformTuple, s.localEnvironmentRuntimeDataRoot())
	if strings.TrimSpace(job.DependencyID) != wantDependencyID || strings.TrimSpace(job.EnvironmentKey) != wantEnvironmentKey {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateUnsupported,
			SourceKind:      localEnvironmentSourceUnavailable,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_PROFILE_UNSUPPORTED",
			FailureDetail:   "python Torch selected-source identity does not match the current resolved plan",
		}, nil
	}
	runtimeDataRoot := s.localEnvironmentRuntimeDataRoot()
	uvRecord, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(
		ctx,
		localEnvironmentManagedUVKey(identity.PlatformTuple, runtimeDataRoot),
		localEnvironmentFamilyPythonUV,
		"uv",
		prerequisiteConsumer,
	)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	runtimeRecord, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(
		ctx,
		localEnvironmentPythonRuntimeKey(identity.PlatformTuple, runtimeDataRoot),
		localEnvironmentFamilyPythonRuntime,
		localEnvironmentPythonRuntimeDependencyID(),
		prerequisiteConsumer,
	)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	if strings.Contains(strings.TrimSpace(consumer), ".cuda") {
		hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
		cudaEnvironmentKey := localEnvironmentKey(localEnvironmentFamilyCUDA, cudaUserSpaceRuntimeDependencyID, hostState.HostProfileID, identity.PlatformTuple, runtimeDataRoot)
		if _, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(ctx, cudaEnvironmentKey, localEnvironmentFamilyCUDA, cudaUserSpaceRuntimeDependencyID, consumer); !ok {
			return failedPrerequisiteDependencyResult(detail), nil
		}
	}
	packageRecord, ok, detail := s.waitForSelectedSourceForDependencyAndConsumerDetail(
		ctx,
		localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonPackageSet, identity.DependencyID, runtimeDataRoot),
		localEnvironmentFamilyPythonPackageSet,
		identity.DependencyID,
		prerequisiteConsumer,
	)
	if !ok {
		return failedPrerequisiteDependencyResult(detail), nil
	}
	reportLocalEnvironmentJobProgress(report, localEnvironmentStateVerifying)
	if strings.TrimSpace(uvRecord.CanonicalRoot) == "" || strings.TrimSpace(runtimeRecord.CanonicalRoot) == "" || strings.TrimSpace(packageRecord.CanonicalRoot) == "" {
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
	status, err := mgr.EnsurePythonDependencyProfile(ctx, uvRecord.CanonicalRoot, runtimeRecord.CanonicalRoot, prerequisiteConsumer, identity.PlatformTuple, identity.AcceleratorPlane)
	if err != nil {
		return localEnvironmentDependencyJobResult{}, err
	}
	if err := validatePythonDependencyProfileStatus(status, identity); err != nil || !sameLocalEnvironmentPath(status.ProfileRoot, packageRecord.CanonicalRoot) {
		failureDetail := "python dependency profile root does not match package-set consumption projection"
		if err != nil {
			failureDetail = err.Error()
		}
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateRepairRequired,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "LOCAL_ENVIRONMENT_DEPENDENCY_REPAIR_REQUIRED",
			FailureDetail:   failureDetail,
		}, nil
	}
	hashes := map[string]string{
		"wheel_lock_hash": strings.TrimSpace(torchIdentity.WheelLockHash),
	}
	compatibilityEvidence := []string{
		strings.TrimSpace(status.Detail),
		"wheel_index=" + strings.TrimPrefix(identity.PackageSource, "pypi=https://pypi.org/simple;pytorch="),
		"accelerator_plane=" + identity.AcceleratorPlane,
		"cuda_abi=" + identity.CUDAABI,
		"torch_version=" + identity.TorchVersion,
	}
	for _, probe := range torchIdentity.ImportProbes {
		compatibilityEvidence = append(compatibilityEvidence, "import_probe="+strings.TrimSpace(probe))
	}
	return localEnvironmentDependencyJobResult{
		State:                 localEnvironmentStateReadyManaged,
		SourceKind:            localEnvironmentSourceManaged,
		CanonicalRoot:         strings.TrimSpace(status.PackageCacheRoot),
		Version:               identity.TorchVersion,
		CompatibilityEvidence: normalizeStringSlice(compatibilityEvidence),
		VerifiedArtifacts:     []string{strings.TrimSpace(status.PackageCacheRoot)},
		Hashes:                hashes,
		AuditReasonCode:       "LOCAL_ENVIRONMENT_DEPENDENCY_READY_MANAGED",
	}, nil
}

func pythonTorchWheelPrerequisiteConsumer(consumer string) string {
	trimmed := strings.TrimSpace(consumer)
	if strings.HasPrefix(trimmed, "speech.") {
		trimmed = strings.TrimSuffix(trimmed, ".cuda")
		trimmed = strings.TrimSuffix(trimmed, ".cpu")
	}
	return trimmed
}

func pythonSelectedConsumersForDependency(dependencyID string) []string {
	switch {
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-image-python."):
		return []string{"media.diffusers.cpu", "media.diffusers.cuda"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-video-python."):
		return []string{"media.video-python.cpu", "media.video-python.cuda"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-asr."):
		return []string{"speech.qwen3-asr.python"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-asr-transformers."):
		return []string{"speech.qwen3-asr-transformers.python"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-tts."):
		return []string{"speech.qwen3-tts.python"}
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech."):
		return []string{"speech.qwen3-asr.python", "speech.qwen3-tts.python"}
	case strings.TrimSpace(dependencyID) == localEnvironmentPythonRuntimeDependencyID(),
		strings.TrimSpace(dependencyID) == "uv":
		return []string{
			"stable-diffusion.cpp.cpu",
			"stable-diffusion.cpp.metal",
			"stable-diffusion.cpp.cuda",
			"media.diffusers.cpu",
			"media.diffusers.cuda",
			"media.video-python.cpu",
			"media.video-python.cuda",
			"speech.qwen3-asr.python",
			"speech.qwen3-asr-transformers.python",
			"speech.qwen3-tts.python",
			"speech.voxcpm.python",
		}
	default:
		return []string{"python.pipeline"}
	}
}

func resolvePythonDependencyProfileForJob(job localEnvironmentDependencyJobState, requireProfileDependencyID bool) (engine.PythonDependencyProfileIdentity, string, error) {
	consumer := pythonTorchWheelPrerequisiteConsumer(pythonMaterializerConsumerForJob(job))
	if !strings.HasPrefix(strings.TrimSpace(consumer), "speech.") && !strings.HasPrefix(strings.TrimSpace(consumer), "media.") {
		return engine.PythonDependencyProfileIdentity{}, "", fmt.Errorf("python dependency profile is not admitted for consumer %s", consumer)
	}
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	acceleratorPlane := "cpu"
	if localEnvironmentHostSupportsCUDA(hostState) {
		acceleratorPlane = "cuda"
	}
	identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, localEnvironmentPlatformTuple(hostState), acceleratorPlane)
	if err != nil {
		return engine.PythonDependencyProfileIdentity{}, "", err
	}
	if requireProfileDependencyID && strings.TrimSpace(job.DependencyID) != identity.DependencyID {
		return engine.PythonDependencyProfileIdentity{}, "", fmt.Errorf("python dependency profile identity mismatch: requested=%s resolved=%s", strings.TrimSpace(job.DependencyID), identity.DependencyID)
	}
	return identity, consumer, nil
}

func validatePythonDependencyProfileStatus(status engine.PythonDependencyProfileStatus, expected engine.PythonDependencyProfileIdentity) error {
	if status.Identity.ProfileDigest != expected.ProfileDigest || status.Identity.DependencyID != expected.DependencyID {
		return fmt.Errorf("python dependency profile status identity mismatch")
	}
	if strings.TrimSpace(status.ProfileRoot) == "" || strings.TrimSpace(status.InterpreterPath) == "" || strings.TrimSpace(status.PackageCacheRoot) == "" {
		return fmt.Errorf("python dependency profile status is missing canonical paths")
	}
	if status.ObservedPythonVersion != expected.PythonVersion || strings.SplitN(strings.TrimSpace(status.ObservedTorchVersion), "+", 2)[0] != expected.TorchVersion || status.ObservedCUDAABI == "" {
		return fmt.Errorf("python dependency profile status version or accelerator proof is incomplete")
	}
	if len(status.InstalledDistributions) == 0 || len(status.ImportProbes) == 0 {
		return fmt.Errorf("python dependency profile consumption verification is incomplete")
	}
	return nil
}

func pythonDependencyProfileHashes(identity engine.PythonDependencyProfileIdentity) map[string]string {
	return map[string]string{
		"profile_digest":        identity.ProfileDigest,
		"exact_lock_sha256":     identity.ExactLockDigest,
		"project_input_sha256":  identity.ProjectInputDigest,
		"driver_bundle_sha256":  identity.DriverBundleDigest,
		"torch_wheel_lock_hash": identity.TorchWheelLockHash,
	}
}

func pythonDependencyProfileCompatibilityEvidence(status engine.PythonDependencyProfileStatus, uvRecordID string, runtimeRecordID string) []string {
	identity := status.Identity
	return normalizeStringSlice([]string{
		strings.TrimSpace(status.Detail),
		"python_version=" + identity.PythonVersion,
		"python_abi=" + identity.PythonABI,
		"platform=" + identity.PlatformTuple,
		"accelerator_plane=" + identity.AcceleratorPlane,
		"torch_version=" + identity.TorchVersion,
		"cuda_abi=" + identity.CUDAABI,
		"torch_wheel_index=" + identity.TorchWheelIndex,
		"torch_package_source=" + identity.TorchPackageSource,
		"package_source=" + identity.PackageSource,
		"driver_protocol=" + identity.DriverProtocol,
		"selected_uv_record=" + strings.TrimSpace(uvRecordID),
		"selected_python_runtime_record=" + strings.TrimSpace(runtimeRecordID),
	})
}

func localEnvironmentErrorDetail(err error, fallback string) string {
	if err != nil {
		return err.Error()
	}
	return fallback
}

func pythonMaterializerConsumerForDependency(dependencyID string) string {
	switch {
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-image-python."):
		return "media.diffusers.cuda"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-video-python."):
		return "media.video-python.cuda"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-asr."):
		return "speech.qwen3-asr.python"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-asr-transformers."):
		return "speech.qwen3-asr-transformers.python"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech-qwen3-tts."):
		return "speech.qwen3-tts.python"
	case strings.HasPrefix(strings.TrimSpace(dependencyID), "local-speech."):
		return ""
	default:
		return ""
	}
}

func pythonMaterializerConsumerForJob(job localEnvironmentDependencyJobState) string {
	for _, consumer := range []string{job.ConsumerScope, localEnvironmentConsumerScopeFromKey(job.EnvironmentKey)} {
		if pythonMaterializerConsumerScope(consumer) {
			return strings.TrimSpace(consumer)
		}
	}
	if consumer := pythonMaterializerConsumerForDependency(job.DependencyID); strings.TrimSpace(consumer) != "" {
		return consumer
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
	// The exact managed interpreter is a consumer-independent Runtime source.
	// Consumer/package isolation starts at the immutable dependency profile,
	// never by cloning the same Python payload under engine- or consumer-named
	// roots.
	return "python", defaultLocalEnvironmentPythonVersion
}

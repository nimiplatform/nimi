package localservice

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func upsertReadyPythonPrerequisiteForTest(t *testing.T, svc *Service, record localEnvironmentSelectedSourceRecordState) localEnvironmentSelectedSourceRecordState {
	t.Helper()
	switch record.DependencyFamily {
	case localEnvironmentFamilyPythonVenv, localEnvironmentFamilyPythonPackageSet, localEnvironmentFamilyPythonTorchWheel, localEnvironmentFamilyCUDA:
		record.CanonicalRoot = t.TempDir()
	default:
		record.CanonicalRoot = filepath.Join(t.TempDir(), "artifact.exe")
	}
	record = verifiedSelectedSourceRecordForTest(record)
	writeSelectedSourceLocalArtifactsForTest(t, record)
	return svc.upsertLocalEnvironmentSelectedSourceRecord(record)
}

func currentPythonDependencyProfileIdentityForTest(t *testing.T, consumer string) engine.PythonDependencyProfileIdentity {
	t.Helper()
	host := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	plane := "cpu"
	if localEnvironmentHostSupportsCUDA(host) {
		plane = "cuda"
	}
	identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, localEnvironmentPlatformTuple(host), plane)
	if err != nil {
		t.Fatalf("resolve Python dependency profile identity for %s: %v", consumer, err)
	}
	return identity
}

func currentMediaPythonDependencyProfileForTest(t *testing.T) (string, engine.PythonDependencyProfileIdentity) {
	t.Helper()
	host := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	plane := "cpu"
	if localEnvironmentHostSupportsCUDA(host) {
		plane = "cuda"
	}
	consumer := "media.diffusers." + plane
	identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, localEnvironmentPlatformTuple(host), plane)
	if err != nil {
		t.Fatalf("resolve media Python dependency profile identity: %v", err)
	}
	return consumer, identity
}

func upsertReadyManagedUVForProfileTest(t *testing.T, svc *Service, consumer string, identity engine.PythonDependencyProfileIdentity) localEnvironmentSelectedSourceRecordState {
	t.Helper()
	return upsertReadyPythonPrerequisiteForTest(t, svc, localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonUV,
		DependencyID:      "uv",
		EnvironmentKey:    localEnvironmentManagedUVKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot()),
		SourceKind:        localEnvironmentSourceManaged,
		Version:           engine.ManagedUVVersion,
		SelectedConsumers: []string{consumer},
	})
}

func upsertReadyManagedPythonRuntimeForProfileTest(t *testing.T, svc *Service, consumer string, identity engine.PythonDependencyProfileIdentity) localEnvironmentSelectedSourceRecordState {
	t.Helper()
	return upsertReadyPythonPrerequisiteForTest(t, svc, localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonRuntime,
		DependencyID:      localEnvironmentPythonRuntimeDependencyID(),
		EnvironmentKey:    localEnvironmentPythonRuntimeKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot()),
		SourceKind:        localEnvironmentSourceManaged,
		Version:           "Python " + engine.ManagedPythonVersion,
		SelectedConsumers: []string{consumer},
	})
}

func upsertReadyCUDAForProfileTest(t *testing.T, svc *Service, consumer string, identity engine.PythonDependencyProfileIdentity) (localEnvironmentSelectedSourceRecordState, bool) {
	t.Helper()
	if identity.AcceleratorPlane != "cuda" {
		return localEnvironmentSelectedSourceRecordState{}, false
	}
	cudaConsumer := consumer
	if strings.HasPrefix(cudaConsumer, "speech.") {
		cudaConsumer += ".cuda"
	}
	host := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	return upsertReadyPythonPrerequisiteForTest(t, svc, localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyCUDA,
		DependencyID:      cudaUserSpaceRuntimeDependencyID,
		EnvironmentKey:    localEnvironmentKey(localEnvironmentFamilyCUDA, cudaUserSpaceRuntimeDependencyID, host.HostProfileID, identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot()),
		SourceKind:        localEnvironmentSourceManaged,
		SelectedConsumers: []string{cudaConsumer},
	}), true
}

func upsertReadyPythonProfileForTest(t *testing.T, svc *Service, family string, consumer string, identity engine.PythonDependencyProfileIdentity) localEnvironmentSelectedSourceRecordState {
	t.Helper()
	record := upsertReadyPythonPrerequisiteForTest(t, svc, localEnvironmentSelectedSourceRecordState{
		DependencyFamily: family,
		DependencyID:     identity.DependencyID,
		EnvironmentKey:   localEnvironmentPythonProfileKey(family, identity.DependencyID, svc.localEnvironmentRuntimeDataRoot()),
		SourceKind:       localEnvironmentSourceManaged,
		Version:          identity.ProfileDigest,
		Hashes:           pythonDependencyProfileHashes(identity),
	})
	if family == localEnvironmentFamilyPythonPackageSet {
		recordReadyPythonPackageSetConsumptionJobForTest(svc, record, consumer)
	}
	return record
}

func recordReadyPythonPackageSetConsumptionJobForTest(svc *Service, record localEnvironmentSelectedSourceRecordState, consumer string) localEnvironmentDependencyJobState {
	return recordReadyPythonSelectedSourceConsumptionJobForTest(svc, record, consumer)
}

func recordReadyPythonSelectedSourceConsumptionJobForTest(svc *Service, record localEnvironmentSelectedSourceRecordState, consumer string) localEnvironmentDependencyJobState {
	now := nowISO()
	job := localEnvironmentDependencyJobState{
		JobID:                  "test_profile_consumption_" + shortHash(record.RecordID+"|"+strings.TrimSpace(consumer)+"|"+now),
		EnvironmentKey:         record.EnvironmentKey,
		DependencyFamily:       record.DependencyFamily,
		DependencyID:           record.DependencyID,
		ConsumerScope:          strings.TrimSpace(consumer),
		State:                  localEnvironmentStateReadyManaged,
		SourceKind:             record.SourceKind,
		CanonicalRoot:          record.CanonicalRoot,
		SelectedSourceRecordID: record.RecordID,
		CreatedAt:              now,
		UpdatedAt:              now,
	}
	svc.mu.Lock()
	svc.localEnvironmentDependencyJobs[job.JobID] = job
	svc.persistStateLocked()
	svc.mu.Unlock()
	return job
}

func rememberPythonProfileJobContractForTest(svc *Service, family string, consumer string, identity engine.PythonDependencyProfileIdentity) string {
	environmentKey := localEnvironmentPythonProfileKey(family, identity.DependencyID, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, family, identity.DependencyID, environmentKey, consumer)
	return environmentKey
}

func rememberPythonDependencyJobContractForTest(svc *Service, family string, dependencyID string, environmentKey string, consumer string) {
	svc.rememberLocalEnvironmentPlanDependencyContracts([]localEnvironmentPlanDependency{{
		EnvironmentKey:   environmentKey,
		DependencyFamily: family,
		DependencyID:     dependencyID,
		ConsumerScope:    consumer,
	}})
}

func pythonDependencyProfileStatusForTest(identity engine.PythonDependencyProfileIdentity, consumer string, profileRoot string, uvPath string, packageCacheRoot string) engine.PythonDependencyProfileStatus {
	interpreterDir := "bin"
	interpreterName := "python"
	if strings.HasPrefix(identity.PlatformTuple, "windows/") {
		interpreterDir = "Scripts"
		interpreterName = "python.exe"
	}
	driverCommands := map[string]string{}
	driverScripts := []string{}
	switch consumer {
	case "speech.qwen3-tts.python":
		driver := engine.SpeechQwen3TTSDriverPath(profileRoot)
		driverCommands["NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"] = "python " + driver
		driverScripts = append(driverScripts, driver)
	case "speech.qwen3-asr.python":
		driver := engine.SpeechQwen3ASRDriverPath(profileRoot)
		driverCommands["NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD"] = "python " + driver
		driverScripts = append(driverScripts, driver)
	case "speech.qwen3-asr-transformers.python":
		driver := engine.SpeechQwen3ASRTransformersDriverPath(profileRoot)
		driverCommands["NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD"] = "python " + driver
		driverScripts = append(driverScripts, driver)
	}
	return engine.PythonDependencyProfileStatus{
		Identity:               identity,
		ProfileRoot:            profileRoot,
		InterpreterPath:        filepath.Join(profileRoot, interpreterDir, interpreterName),
		PackageCacheRoot:       packageCacheRoot,
		UVExecutable:           uvPath,
		InstalledDistributions: []string{"torch==" + identity.TorchVersion},
		ImportProbes:           []string{"torch"},
		DriverCommands:         driverCommands,
		DriverScripts:          driverScripts,
		ObservedPythonVersion:  identity.PythonVersion,
		ObservedTorchVersion:   identity.TorchVersion,
		ObservedCUDAABI:        identity.CUDAABI,
		Detail:                 "test immutable Python dependency profile ready",
	}
}

func startFailedLocalEnvironmentDependencyJobForTest(t *testing.T, svc *Service, req localEnvironmentDependencyJobRequest, detail string) localEnvironmentDependencyJobState {
	t.Helper()
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), req, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{
			State:           localEnvironmentStateFailed,
			SourceKind:      localEnvironmentSourceManaged,
			AuditReasonCode: "TEST_LOCAL_ENVIRONMENT_DEPENDENCY_FAILED",
			FailureDetail:   detail,
		}, nil
	})
	if err != nil {
		t.Fatalf("start failed dependency job: %v", err)
	}
	settled := pollLocalEnvironmentDependencyJobToTerminal(t, svc, job.JobID)
	if settled.State != localEnvironmentStateFailed {
		t.Fatalf("seed dependency job state = %q, want failed", settled.State)
	}
	return settled
}

func TestPythonMaterializerRejectsLocalImageNativePythonDependencies(t *testing.T) {
	job := localEnvironmentDependencyJobState{
		EnvironmentKey:   "python.venv|local-image-native.venv|host|windows/amd64|root|stable-diffusion.cpp.cuda",
		DependencyFamily: localEnvironmentFamilyPythonVenv,
		DependencyID:     "local-image-native.venv",
		ConsumerScope:    "stable-diffusion.cpp.cuda",
	}
	if got := pythonMaterializerConsumerForDependency(job.DependencyID); got != "" {
		t.Fatalf("native image Python dependency consumer = %q, want empty unsupported dependency mapping", got)
	}
	if got := pythonSelectedConsumersForDependency(job.DependencyID); len(got) != 1 || got[0] != "python.pipeline" {
		t.Fatalf("native image Python dependency selected consumers = %v, want default fail-closed python.pipeline", got)
	}
}

func TestStartLocalImageNativePythonPackageSetJobFailsClosedAtAdmission(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	_, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.package-set|local-image-native.package-set|host|windows/amd64|root|stable-diffusion.cpp.cuda",
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyId:     "local-image-native.package-set",
		ConsumerScope:    stableDiffusionCUDAConsumerID,
		Confirmed:        true,
	})
	if err == nil || !strings.Contains(err.Error(), "local environment dependency profile is not admitted by the current plan") {
		t.Fatalf("StartLocalEnvironmentDependencyJob error = %v, want fail-closed plan admission", err)
	}
}

func TestStartPythonRuntimeDependencyJobRequiresSelectedUVRecord(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	// A genuinely absent prerequisite still fails closed once the bounded
	// prerequisite wait elapses; shorten it so the test does not pause.
	svc.SetLocalEnvironmentPrerequisiteWaitTimeout(100 * time.Millisecond)
	svc.SetEngineManager(&mockEngineManager{})
	environmentKey := localEnvironmentPythonRuntimeKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonRuntime, localEnvironmentPythonRuntimeDependencyID(), environmentKey, consumer)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyId:     localEnvironmentPythonRuntimeDependencyID(),
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without selected uv record", job.GetState())
	}
}

func TestStartPythonRuntimeDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	environmentKey := localEnvironmentPythonRuntimeKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonRuntime, localEnvironmentPythonRuntimeDependencyID(), environmentKey, consumer)
	svc.SetEngineManager(&mockEngineManager{
		pythonRuntimeStatus: &engine.PythonRuntimeDependencyStatus{
			PythonVersion:   "Python " + engine.ManagedPythonVersion,
			InterpreterPath: filepath.Join(t.TempDir(), "python.exe"),
			RuntimeRoot:     t.TempDir(),
			UVExecutable:    uvRecord.CanonicalRoot,
			Detail:          "Runtime-managed Python runtime verified through selected uv tool",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyId:     localEnvironmentPythonRuntimeDependencyID(),
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["selected_uv_record"]; got != uvRecord.RecordID {
		t.Fatalf("selected uv record hash = %q, want %q", got, uvRecord.RecordID)
	}
	if got := source.GetSelectedConsumers(); len(got) != 0 {
		t.Fatalf("canonical Python runtime selected source owns consumers: %v", got)
	}
}

func TestPythonRuntimeDependencyJobUsesInstallingWithoutDownloadProgress(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	environmentKey := localEnvironmentPythonRuntimeKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonRuntime, localEnvironmentPythonRuntimeDependencyID(), environmentKey, consumer)
	release := make(chan struct{})
	svc.SetEngineManager(&mockEngineManager{
		pythonRuntimeDependencyRelease: release,
		pythonRuntimeStatus: &engine.PythonRuntimeDependencyStatus{
			PythonVersion:   "Python " + engine.ManagedPythonVersion,
			InterpreterPath: filepath.Join(t.TempDir(), "python.exe"),
			RuntimeRoot:     t.TempDir(),
			UVExecutable:    uvRecord.CanonicalRoot,
			Detail:          "Runtime-managed Python runtime verified through selected uv tool",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyId:     localEnvironmentPythonRuntimeDependencyID(),
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	installing := awaitLocalEnvironmentDependencyJobStateForTest(t, svc, resp.GetJob().GetJobId(), localEnvironmentStateInstalling)
	if installing.GetBytesReceived() != 0 || installing.GetBytesTotal() != 0 || installing.GetPercent() != 0 {
		t.Fatalf("python runtime installing job must not fabricate download progress: %+v", installing)
	}
	close(release)

	terminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if terminal.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", terminal.GetState())
	}
}

func TestStartPythonRuntimeDependencyJobUsesRequestConsumerScope(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	environmentKey := localEnvironmentPythonRuntimeKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonRuntime, localEnvironmentPythonRuntimeDependencyID(), environmentKey, consumer)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyId:     localEnvironmentPythonRuntimeDependencyID(),
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if job.GetConsumerScope() != consumer {
		t.Fatalf("activation job consumer = %q, want %q", job.GetConsumerScope(), consumer)
	}
	if len(source.GetSelectedConsumers()) != 0 {
		t.Fatalf("canonical Python runtime selected source owns consumers: %v", source.GetSelectedConsumers())
	}
	if !stringSliceContains(source.GetCompatibilityEvidence(), "test python runtime ready for python") {
		t.Fatalf("compatibility evidence = %v, want consumer-independent managed Python runtime", source.GetCompatibilityEvidence())
	}
}

func TestStartPythonVenvDependencyJobRequiresSelectedPythonRuntimeRecord(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	svc.SetLocalEnvironmentPrerequisiteWaitTimeout(100 * time.Millisecond)
	upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	svc.SetEngineManager(&mockEngineManager{})
	environmentKey := rememberPythonProfileJobContractForTest(svc, localEnvironmentFamilyPythonVenv, consumer, identity)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonVenv,
		DependencyId:     identity.DependencyID,
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without selected python.runtime record", job.GetState())
	}
}

func TestStartPythonVenvDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	runtimeRecord := upsertReadyManagedPythonRuntimeForProfileTest(t, svc, consumer, identity)
	upsertReadyCUDAForProfileTest(t, svc, consumer, identity)
	profileRoot := t.TempDir()
	svc.SetEngineManager(&mockEngineManager{
		pythonDependencyProfileStatus: func() *engine.PythonDependencyProfileStatus {
			status := pythonDependencyProfileStatusForTest(identity, consumer, profileRoot, uvRecord.CanonicalRoot, t.TempDir())
			return &status
		}(),
	})
	environmentKey := rememberPythonProfileJobContractForTest(svc, localEnvironmentFamilyPythonVenv, consumer, identity)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonVenv,
		DependencyId:     identity.DependencyID,
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	if job.GetCanonicalRoot() != profileRoot {
		t.Fatalf("canonical root = %q, want immutable profile root %q", job.GetCanonicalRoot(), profileRoot)
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonVenv,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["profile_digest"]; got != identity.ProfileDigest {
		t.Fatalf("profile digest = %q, want %q", got, identity.ProfileDigest)
	}
	if got := source.GetHashes()["exact_lock_sha256"]; got != identity.ExactLockDigest {
		t.Fatalf("exact lock digest = %q, want %q", got, identity.ExactLockDigest)
	}
	if !stringSliceContains(source.GetCompatibilityEvidence(), "selected_uv_record="+uvRecord.RecordID) ||
		!stringSliceContains(source.GetCompatibilityEvidence(), "selected_python_runtime_record="+runtimeRecord.RecordID) {
		t.Fatalf("compatibility evidence = %v, want exact uv/runtime record references", source.GetCompatibilityEvidence())
	}
	if got := source.GetSelectedConsumers(); len(got) != 0 {
		t.Fatalf("canonical Python profile selected source owns consumers: %v", got)
	}
}

func TestStartPythonPackageSetDependencyJobRequiresSelectedVenvRecord(t *testing.T) {
	svc := newTestService(t)
	consumer := "speech.qwen3-tts.python"
	identity := currentPythonDependencyProfileIdentityForTest(t, consumer)
	svc.SetLocalEnvironmentPrerequisiteWaitTimeout(100 * time.Millisecond)
	upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	svc.SetEngineManager(&mockEngineManager{})
	environmentKey := rememberPythonProfileJobContractForTest(svc, localEnvironmentFamilyPythonPackageSet, consumer, identity)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyId:     identity.DependencyID,
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without selected python.venv record", job.GetState())
	}
}

func TestStartPythonPackageSetDependencyJobFailsFastWhenVenvJobFailed(t *testing.T) {
	svc := newTestService(t)
	consumer := "speech.qwen3-tts.python"
	identity := currentPythonDependencyProfileIdentityForTest(t, consumer)
	upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	failedVenv, err := svc.startLocalEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobRequest{
		EnvironmentKey:   localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonVenv, identity.DependencyID, svc.localEnvironmentRuntimeDataRoot()),
		DependencyFamily: localEnvironmentFamilyPythonVenv,
		DependencyID:     identity.DependencyID,
		ConsumerScope:    consumer,
		SourceKind:       localEnvironmentSourceManaged,
	}, nil)
	if err != nil {
		t.Fatalf("start failed venv seed job: %v", err)
	}
	if _, ok := svc.transitionLocalEnvironmentDependencyJob(failedVenv.JobID, localEnvironmentStateFailed, "uv venv failed: interpreter inspection failed", true); !ok {
		t.Fatalf("failed to transition venv seed job")
	}
	svc.SetEngineManager(&mockEngineManager{})
	packageEnvironmentKey := rememberPythonProfileJobContractForTest(svc, localEnvironmentFamilyPythonPackageSet, consumer, identity)

	startedAt := time.Now()
	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   packageEnvironmentKey,
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyId:     identity.DependencyID,
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if elapsed := time.Since(startedAt); elapsed > time.Second {
		t.Fatalf("package-set prerequisite failure took %s, want fail-fast", elapsed)
	}
	if job.GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed when venv prerequisite job failed", job.GetState())
	}
	if detail := job.GetFailureDetail(); !strings.Contains(detail, "uv venv failed") || !strings.Contains(detail, "python.venv/"+identity.DependencyID) {
		t.Fatalf("failure detail = %q, want upstream venv failure detail", detail)
	}
}

func TestStartPythonPackageSetDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	consumer := "speech.qwen3-tts.python"
	identity := currentPythonDependencyProfileIdentityForTest(t, consumer)
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	venvRecord := upsertReadyPythonProfileForTest(t, svc, localEnvironmentFamilyPythonVenv, consumer, identity)
	runtimeRecord := upsertReadyManagedPythonRuntimeForProfileTest(t, svc, consumer, identity)
	status := pythonDependencyProfileStatusForTest(identity, consumer, venvRecord.CanonicalRoot, uvRecord.CanonicalRoot, t.TempDir())
	svc.SetEngineManager(&mockEngineManager{pythonDependencyProfileStatus: &status})
	environmentKey := rememberPythonProfileJobContractForTest(svc, localEnvironmentFamilyPythonPackageSet, consumer, identity)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyId:     identity.DependencyID,
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["profile_digest"]; got != identity.ProfileDigest {
		t.Fatalf("profile digest = %q, want %q", got, identity.ProfileDigest)
	}
	if got := source.GetHashes()["exact_lock_sha256"]; got != identity.ExactLockDigest {
		t.Fatalf("exact lock digest = %q, want %q", got, identity.ExactLockDigest)
	}
	if got := source.GetVersion(); got != identity.ProfileDigest {
		t.Fatalf("profile version = %q, want %q", got, identity.ProfileDigest)
	}
	if got := source.GetCompatibilityEvidence(); !stringSliceContains(got, "selected_uv_record="+uvRecord.RecordID) ||
		!stringSliceContains(got, "selected_venv_record="+venvRecord.RecordID) ||
		!stringSliceContains(got, "selected_python_runtime_record="+runtimeRecord.RecordID) {
		t.Fatalf("compatibility evidence = %v, want exact prerequisite record references", got)
	}
	if got := source.GetSelectedConsumers(); len(got) != 0 {
		t.Fatalf("canonical package-set selected source owns consumers: %v", got)
	}
	if got := source.GetActivationEnvDelta(); len(got) != 0 {
		t.Fatalf("canonical package-set selected source owns private activation delta: %v", got)
	}
	if got := job.GetConsumerScope(); got != consumer {
		t.Fatalf("package-set activation job consumer = %q, want %q", got, consumer)
	}
	if got := source.GetVerifiedArtifacts(); !stringSliceContains(got, status.DriverScripts[0]) {
		t.Fatalf("verified artifacts = %v, want tts driver script", got)
	}
}

func TestPythonPackageSetDependencyJobUsesVerifyingWithoutDownloadProgress(t *testing.T) {
	svc := newTestService(t)
	consumer := "speech.qwen3-tts.python"
	identity := currentPythonDependencyProfileIdentityForTest(t, consumer)
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	venvRecord := upsertReadyPythonProfileForTest(t, svc, localEnvironmentFamilyPythonVenv, consumer, identity)
	upsertReadyManagedPythonRuntimeForProfileTest(t, svc, consumer, identity)
	status := pythonDependencyProfileStatusForTest(identity, consumer, venvRecord.CanonicalRoot, uvRecord.CanonicalRoot, t.TempDir())
	svc.SetEngineManager(&mockEngineManager{pythonDependencyProfileStatus: &status})
	states := []string{}
	progressCalled := false
	result, err := svc.executePythonPackageSetEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobState{
		EnvironmentKey:   localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonPackageSet, identity.DependencyID, svc.localEnvironmentRuntimeDataRoot()),
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     identity.DependencyID,
		ConsumerScope:    consumer,
	}, localEnvironmentDependencyJobProgressReporter{
		State: func(state string) { states = append(states, state) },
		Progress: func(localEnvironmentDependencyJobProgress) {
			progressCalled = true
		},
	})
	if err != nil {
		t.Fatalf("executePythonPackageSetEnvironmentDependencyJob: %v", err)
	}
	if len(states) != 1 || states[0] != localEnvironmentStateVerifying {
		t.Fatalf("package-set progress states = %v, want verifying only", states)
	}
	if progressCalled {
		t.Fatal("package-set verification must not fabricate byte progress")
	}
	if result.State != localEnvironmentStateReadyManaged {
		t.Fatalf("result state = %q, want ready_managed", result.State)
	}
}

func TestPythonPackageSetWaitsForVerifiedVenvInsteadOfStaleRepairRecord(t *testing.T) {
	svc := newTestService(t)
	consumer := "speech.qwen3-tts.python"
	identity := currentPythonDependencyProfileIdentityForTest(t, consumer)
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	upsertReadyManagedPythonRuntimeForProfileTest(t, svc, consumer, identity)
	profileEnvironmentKey := localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonVenv, identity.DependencyID, svc.localEnvironmentRuntimeDataRoot())
	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonVenv,
		DependencyID:      identity.DependencyID,
		EnvironmentKey:    profileEnvironmentKey,
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     filepath.Join(t.TempDir(), "missing-venv"),
		VerifiedArtifacts: []string{"Scripts/python.exe"},
		Version:           identity.ProfileDigest,
		Hashes:            pythonDependencyProfileHashes(identity),
		SelectedConsumers: []string{consumer},
		RepairState:       localEnvironmentRepairRequired,
	}))
	venvRoot := t.TempDir()
	status := pythonDependencyProfileStatusForTest(identity, consumer, venvRoot, uvRecord.CanonicalRoot, t.TempDir())
	svc.SetEngineManager(&mockEngineManager{pythonDependencyProfileStatus: &status})
	packageEnvironmentKey := rememberPythonProfileJobContractForTest(svc, localEnvironmentFamilyPythonPackageSet, consumer, identity)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   packageEnvironmentKey,
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyId:     identity.DependencyID,
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	readyVenvRecord := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonVenv,
		DependencyID:      identity.DependencyID,
		EnvironmentKey:    profileEnvironmentKey,
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     venvRoot,
		VerifiedArtifacts: []string{filepath.Join(venvRoot, "Scripts", "python.exe")},
		Version:           identity.ProfileDigest,
		Hashes:            pythonDependencyProfileHashes(identity),
		SelectedConsumers: []string{consumer},
	})
	writeSelectedSourceLocalArtifactsForTest(t, readyVenvRecord)
	go func() {
		time.Sleep(50 * time.Millisecond)
		svc.upsertLocalEnvironmentSelectedSourceRecord(readyVenvRecord)
	}()

	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed after verified venv appears", job.GetState())
	}
}

func TestPythonPackageSetWaitsForExactTTSProfileWhenASRProfileIsAlreadyReady(t *testing.T) {
	svc := newTestService(t)
	svc.SetLocalEnvironmentPrerequisiteWaitTimeout(2 * time.Second)
	ttsConsumer := "speech.qwen3-tts.python"
	asrConsumer := "speech.qwen3-asr.python"
	ttsIdentity := currentPythonDependencyProfileIdentityForTest(t, ttsConsumer)
	asrIdentity := currentPythonDependencyProfileIdentityForTest(t, asrConsumer)
	if ttsIdentity.DependencyID == asrIdentity.DependencyID {
		t.Fatal("ASR and TTS must resolve distinct exact dependency profiles")
	}
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, ttsConsumer, ttsIdentity)
	upsertReadyManagedPythonRuntimeForProfileTest(t, svc, ttsConsumer, ttsIdentity)
	asrVenvRecord := upsertReadyPythonProfileForTest(t, svc, localEnvironmentFamilyPythonVenv, asrConsumer, asrIdentity)

	ttsVenvEnvironmentKey := localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonVenv, ttsIdentity.DependencyID, svc.localEnvironmentRuntimeDataRoot())
	ttsVenvJob, err := svc.startLocalEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobRequest{
		EnvironmentKey:   ttsVenvEnvironmentKey,
		DependencyFamily: localEnvironmentFamilyPythonVenv,
		DependencyID:     ttsIdentity.DependencyID,
		ConsumerScope:    ttsConsumer,
		SourceKind:       localEnvironmentSourceManaged,
	}, nil)
	if err != nil {
		t.Fatalf("start in-flight TTS venv job: %v", err)
	}
	if _, ok := svc.transitionLocalEnvironmentDependencyJob(ttsVenvJob.JobID, localEnvironmentStateInstalling, "", true); !ok {
		t.Fatal("transition TTS venv job to installing")
	}

	ttsProfileRoot := t.TempDir()
	ttsVenvRecord := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonVenv,
		DependencyID:      ttsIdentity.DependencyID,
		EnvironmentKey:    ttsVenvEnvironmentKey,
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     ttsProfileRoot,
		Version:           ttsIdentity.ProfileDigest,
		Hashes:            pythonDependencyProfileHashes(ttsIdentity),
		VerifiedArtifacts: []string{filepath.Join(ttsProfileRoot, "Scripts", "python.exe")},
	})
	writeSelectedSourceLocalArtifactsForTest(t, ttsVenvRecord)
	status := pythonDependencyProfileStatusForTest(ttsIdentity, ttsConsumer, ttsProfileRoot, uvRecord.CanonicalRoot, t.TempDir())
	svc.SetEngineManager(&mockEngineManager{pythonDependencyProfileStatus: &status})

	type packageResult struct {
		result localEnvironmentDependencyJobResult
		err    error
	}
	resultCh := make(chan packageResult, 1)
	go func() {
		result, executeErr := svc.executePythonPackageSetEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobState{
			EnvironmentKey:   localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonPackageSet, ttsIdentity.DependencyID, svc.localEnvironmentRuntimeDataRoot()),
			DependencyFamily: localEnvironmentFamilyPythonPackageSet,
			DependencyID:     ttsIdentity.DependencyID,
			ConsumerScope:    ttsConsumer,
		}, localEnvironmentDependencyJobProgressReporter{})
		resultCh <- packageResult{result: result, err: executeErr}
	}()

	select {
	case got := <-resultCh:
		t.Fatalf("TTS package-set consumed another profile before its exact venv was ready: state=%q err=%v ASR-root=%q", got.result.State, got.err, asrVenvRecord.CanonicalRoot)
	case <-time.After(75 * time.Millisecond):
	}
	svc.upsertLocalEnvironmentSelectedSourceRecord(ttsVenvRecord)

	select {
	case got := <-resultCh:
		if got.err != nil {
			t.Fatalf("execute TTS package-set after exact venv promotion: %v", got.err)
		}
		if got.result.State != localEnvironmentStateReadyManaged {
			t.Fatalf("TTS package-set state = %q, want ready_managed", got.result.State)
		}
		if !sameLocalEnvironmentPath(got.result.CanonicalRoot, ttsProfileRoot) {
			t.Fatalf("TTS package-set root = %q, want exact TTS profile %q (ASR root %q)", got.result.CanonicalRoot, ttsProfileRoot, asrVenvRecord.CanonicalRoot)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("TTS package-set did not resume after exact venv promotion")
	}
}

func TestStartPythonTorchWheelDependencyJobRequiresCUDARecordForCUDAConsumer(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	if identity.AcceleratorPlane != "cuda" {
		t.Skip("current host does not select the CUDA dependency profile")
	}
	svc.SetLocalEnvironmentPrerequisiteWaitTimeout(100 * time.Millisecond)
	upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	upsertReadyManagedPythonRuntimeForProfileTest(t, svc, consumer, identity)
	upsertReadyPythonProfileForTest(t, svc, localEnvironmentFamilyPythonPackageSet, consumer, identity)
	svc.SetEngineManager(&mockEngineManager{})
	torchIdentity, err := engine.ResolvePythonTorchWheelDependencyIdentity(consumer)
	if err != nil {
		t.Fatalf("resolve Torch selected-source identity: %v", err)
	}

	environmentKey := localEnvironmentPythonTorchWheelKey(torchIdentity, identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	dependencyID := localEnvironmentPythonTorchWheelDependencyID(torchIdentity)
	svc.rememberLocalEnvironmentPlanDependencyContracts([]localEnvironmentPlanDependency{{
		EnvironmentKey: environmentKey, DependencyFamily: localEnvironmentFamilyPythonTorchWheel, DependencyID: dependencyID, ConsumerScope: consumer,
	}})
	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
		DependencyId:     dependencyID,
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without selected CUDA record", job.GetState())
	}
}

func TestStartPythonTorchWheelDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	upsertReadyManagedPythonRuntimeForProfileTest(t, svc, consumer, identity)
	packageRecord := upsertReadyPythonProfileForTest(t, svc, localEnvironmentFamilyPythonPackageSet, consumer, identity)
	upsertReadyCUDAForProfileTest(t, svc, consumer, identity)
	packageCacheRoot := t.TempDir()
	status := pythonDependencyProfileStatusForTest(identity, consumer, packageRecord.CanonicalRoot, uvRecord.CanonicalRoot, packageCacheRoot)
	svc.SetEngineManager(&mockEngineManager{pythonDependencyProfileStatus: &status})
	torchIdentity, err := engine.ResolvePythonTorchWheelDependencyIdentity(consumer)
	if err != nil {
		t.Fatalf("resolve Torch selected-source identity: %v", err)
	}

	environmentKey := localEnvironmentPythonTorchWheelKey(torchIdentity, identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	dependencyID := localEnvironmentPythonTorchWheelDependencyID(torchIdentity)
	svc.rememberLocalEnvironmentPlanDependencyContracts([]localEnvironmentPlanDependency{{
		EnvironmentKey: environmentKey, DependencyFamily: localEnvironmentFamilyPythonTorchWheel, DependencyID: dependencyID, ConsumerScope: consumer,
	}})
	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
		DependencyId:     dependencyID,
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["wheel_lock_hash"]; got != torchIdentity.WheelLockHash {
		t.Fatalf("wheel lock hash = %q, want %q", got, torchIdentity.WheelLockHash)
	}
	for _, forbidden := range []string{"selected_uv_record", "selected_venv_record", "selected_python_runtime_record", "selected_cuda_record", "profile_digest"} {
		if got := source.GetHashes()[forbidden]; got != "" {
			t.Fatalf("Torch selected source must not retain consumer-local hash %q=%q", forbidden, got)
		}
	}
	if got := source.GetCanonicalRoot(); got != packageCacheRoot {
		t.Fatalf("Torch canonical root = %q, want shared package cache %q", got, packageCacheRoot)
	}
	if got := source.GetCanonicalRoot(); sameLocalEnvironmentPath(got, packageRecord.CanonicalRoot) {
		t.Fatalf("Torch selected source must not retain consumer profile root %q", got)
	}
	if got := source.GetSelectedConsumers(); len(got) != 0 {
		t.Fatalf("canonical Torch selected source owns consumers: %v", got)
	}
}

func TestPythonTorchWheelDependencyJobUsesVerifyingWithoutDownloadProgress(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	upsertReadyManagedPythonRuntimeForProfileTest(t, svc, consumer, identity)
	packageRecord := upsertReadyPythonProfileForTest(t, svc, localEnvironmentFamilyPythonPackageSet, consumer, identity)
	upsertReadyCUDAForProfileTest(t, svc, consumer, identity)
	status := pythonDependencyProfileStatusForTest(identity, consumer, packageRecord.CanonicalRoot, uvRecord.CanonicalRoot, t.TempDir())
	svc.SetEngineManager(&mockEngineManager{pythonDependencyProfileStatus: &status})
	torchIdentity, err := engine.ResolvePythonTorchWheelDependencyIdentity(consumer)
	if err != nil {
		t.Fatalf("resolve Torch selected-source identity: %v", err)
	}
	states := []string{}
	progressCalled := false
	result, err := svc.executePythonTorchWheelEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobState{
		EnvironmentKey:   localEnvironmentPythonTorchWheelKey(torchIdentity, identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot()),
		DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
		DependencyID:     localEnvironmentPythonTorchWheelDependencyID(torchIdentity),
		ConsumerScope:    consumer,
	}, localEnvironmentDependencyJobProgressReporter{
		State: func(state string) { states = append(states, state) },
		Progress: func(localEnvironmentDependencyJobProgress) {
			progressCalled = true
		},
	})
	if err != nil {
		t.Fatalf("executePythonTorchWheelEnvironmentDependencyJob: %v", err)
	}
	if len(states) != 1 || states[0] != localEnvironmentStateVerifying {
		t.Fatalf("Torch progress states = %v, want verifying only", states)
	}
	if progressCalled {
		t.Fatal("Torch verification must not fabricate byte progress")
	}
	if result.State != localEnvironmentStateReadyManaged {
		t.Fatalf("result state = %q, want ready_managed", result.State)
	}
}

func TestStartModelAssetDependencyJobRejectsPackPlaceholder(t *testing.T) {
	svc := newTestService(t)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.asset|local-image-python.model-asset|host|windows/amd64|root|media.diffusers.cpu",
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyId:     "local-image-python.model-asset",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateRepairRequired {
		t.Fatalf("job state = %q, want repair_required for non asset-specific dependency id", job.GetState())
	}
}

func TestStartModelAssetDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "image/test-model-asset",
		capabilities: []string{"image.generate"},
		engine:       "media",
		entry:        "model.safetensors",
		hashes:       map[string]string{"model.safetensors": "sha256:b899bf805912441a8767d3e01859281ab3a1cd7b18edea93f5e54c18b648b54c"},
	})
	writeLocalEnvironmentAssetEntryForTest(t, svc, model, "verified-model-asset")

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.asset|" + model.GetAssetId() + "|host|windows/amd64|root|media.diffusers.cpu",
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyId:     model.GetAssetId(),
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyModelAsset,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["entry_sha256"]; got != "b899bf805912441a8767d3e01859281ab3a1cd7b18edea93f5e54c18b648b54c" {
		t.Fatalf("entry sha = %q, want verified model hash", got)
	}
	if got := source.GetHashes()["local_asset_id"]; got != model.GetLocalAssetId() {
		t.Fatalf("local asset hash = %q, want %q", got, model.GetLocalAssetId())
	}
	if got := source.GetSelectedConsumers(); len(got) != 1 || got[0] != "media.diffusers.cpu" {
		t.Fatalf("selected consumers = %v, want media.diffusers.cpu", got)
	}
}

func TestStartModelAssetDependencyJobPromotesInstalledImportedAssetID(t *testing.T) {
	svc := newTestService(t)
	sourcePath := filepath.Join(t.TempDir(), "z_image_turbo-Q4_K.gguf")
	if err := os.WriteFile(sourcePath, validImageTestGGUF(), 0o644); err != nil {
		t.Fatalf("write image source: %v", err)
	}
	imported, err := svc.ImportLocalAssetFile(context.Background(), &runtimev1.ImportLocalAssetFileRequest{
		FilePath:     sourcePath,
		Capabilities: []string{"image.generate"},
		Engine:       "media",
	})
	if err != nil {
		t.Fatalf("ImportLocalAssetFile: %v", err)
	}
	model := imported.GetAsset()
	if model == nil {
		t.Fatal("ImportLocalAssetFile returned nil asset")
	}

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.asset|" + model.GetAssetId() + "|host|windows/amd64|root|stable-diffusion.cpp.cuda",
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyId:     model.GetAssetId(),
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed for installed imported image asset id; detail=%q", job.GetState(), job.GetFailureDetail())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyModelAsset,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["local_asset_id"]; got != model.GetLocalAssetId() {
		t.Fatalf("local asset hash = %q, want %q", got, model.GetLocalAssetId())
	}
	if got := source.GetSelectedConsumers(); len(got) != 1 || got[0] != "stable-diffusion.cpp.cuda" {
		t.Fatalf("selected consumers = %v, want stable-diffusion.cpp.cuda", got)
	}
}

func TestStartModelCompanionDependencyJobRequiresParentModelAssetRecord(t *testing.T) {
	svc := newTestService(t)
	svc.SetLocalEnvironmentPrerequisiteWaitTimeout(100 * time.Millisecond)
	companion := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "image/test-companion",
		capabilities: []string{"image.generate"},
		engine:       "media",
		entry:        "vae.safetensors",
	})
	writeLocalEnvironmentAssetEntryForTest(t, svc, companion, "verified-companion")

	dependencyID := localEnvironmentCompanionAssetDependencyID(companion.GetAssetId(), "image/missing-parent")
	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.companion-asset|" + dependencyID + "|host|windows/amd64|root|media.diffusers.cpu",
		DependencyFamily: localEnvironmentFamilyModelCompanion,
		DependencyId:     dependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without parent model.asset selected source", job.GetState())
	}
}

func TestStartModelCompanionDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	parent := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "image/test-parent",
		capabilities: []string{"image.generate"},
		engine:       "media",
		entry:        "model.safetensors",
	})
	companion := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "image/test-vae",
		capabilities: []string{"image.generate"},
		engine:       "media",
		entry:        "vae.safetensors",
	})
	parentEntryPath := writeLocalEnvironmentAssetEntryForTest(t, svc, parent, "verified-parent")
	writeLocalEnvironmentAssetEntryForTest(t, svc, companion, "verified-companion")
	parentRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyModelAsset,
		DependencyID:      parent.GetAssetId(),
		EnvironmentKey:    "model.asset|" + parent.GetAssetId() + "|host|windows/amd64|root",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     parentEntryPath,
		VerifiedArtifacts: []string{parentEntryPath},
		Hashes: map[string]string{
			"asset_id":       parent.GetAssetId(),
			"local_asset_id": parent.GetLocalAssetId(),
		},
		SelectedConsumers: []string{"media.diffusers.cpu"},
	}))

	dependencyID := localEnvironmentCompanionAssetDependencyID(companion.GetAssetId(), parent.GetAssetId())
	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.companion-asset|" + dependencyID + "|host|windows/amd64|root",
		DependencyFamily: localEnvironmentFamilyModelCompanion,
		DependencyId:     dependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyModelCompanion,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["parent_model_asset_record"]; got != parentRecord.RecordID {
		t.Fatalf("parent record hash = %q, want %q", got, parentRecord.RecordID)
	}
	if got := source.GetHashes()["companion_local_asset_id"]; got != companion.GetLocalAssetId() {
		t.Fatalf("companion asset hash = %q, want %q", got, companion.GetLocalAssetId())
	}
}

// TestPythonPrerequisiteOrderingConvergesUnderConcurrentUnorderedStart asserts
// the wave-4 runtime-side ordering guarantee: the desktop fires the python
// family chain as concurrent unordered Start calls, and a dependent
// python.runtime job started before its uv prerequisite still converges to
// ready_managed because the dependent executor waits (bounded, on the job ctx)
// for uv's selected-source record rather than failing closed.
func TestPythonPrerequisiteOrderingConvergesUnderConcurrentUnorderedStart(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	runtimeEnvironmentKey := localEnvironmentPythonRuntimeKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	uvEnvironmentKey := localEnvironmentManagedUVKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonRuntime, localEnvironmentPythonRuntimeDependencyID(), runtimeEnvironmentKey, consumer)
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonUV, "uv", uvEnvironmentKey, consumer)
	svc.SetEngineManager(&mockEngineManager{
		uvToolDependencyStatus: &engine.UVToolDependencyStatus{
			Version:          "0.11.8",
			ExecutablePath:   `C:\nimi\engines\uv\uv.exe`,
			SourceRoot:       `C:\nimi\engines\uv`,
			ArchiveURL:       "https://releases.astral.sh/github/uv/releases/download/0.11.8/uv-x86_64-pc-windows-msvc.zip",
			ArchiveSHA256:    "c84629a56e0706b69a47ea35862208af827cb6fbfa1d0ca763c52c67594637e8",
			ArchiveAssetName: "uv-x86_64-pc-windows-msvc.zip",
			Platform:         "windows/amd64",
			Detail:           "Runtime-managed uv tool verified from pinned official archive",
		},
		pythonRuntimeStatus: &engine.PythonRuntimeDependencyStatus{
			PythonVersion:   "Python " + engine.ManagedPythonVersion,
			InterpreterPath: filepath.Join(t.TempDir(), "python.exe"),
			RuntimeRoot:     t.TempDir(),
			UVExecutable:    `C:\nimi\engines\uv\uv.exe`,
			Detail:          "Runtime-managed Python runtime verified through selected uv tool",
		},
	})

	// Start the dependent python.runtime job FIRST (before uv) — the worst-case
	// ordering. Its executor must wait for uv's record rather than fail closed.
	runtimeResp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   runtimeEnvironmentKey,
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyId:     localEnvironmentPythonRuntimeDependencyID(),
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob python.runtime: %v", err)
	}
	uvResp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   uvEnvironmentKey,
		DependencyFamily: localEnvironmentFamilyPythonUV,
		DependencyId:     "uv",
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob uv: %v", err)
	}

	uvJob := awaitLocalEnvironmentDependencyJobTerminal(t, svc, uvResp.GetJob().GetJobId())
	if uvJob.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("uv job state = %q, want ready_managed", uvJob.GetState())
	}
	runtimeJob := awaitLocalEnvironmentDependencyJobTerminal(t, svc, runtimeResp.GetJob().GetJobId())
	if runtimeJob.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("python.runtime job state = %q, want ready_managed after waiting for uv prerequisite", runtimeJob.GetState())
	}
}

func TestPythonRuntimeWaitIgnoresFailedPrerequisiteFromDifferentConsumer(t *testing.T) {
	svc := newTestService(t)
	consumer := "speech.qwen3-asr.python"
	identity := currentPythonDependencyProfileIdentityForTest(t, consumer)
	runtimeEnvironmentKey := localEnvironmentPythonRuntimeKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonRuntime, localEnvironmentPythonRuntimeDependencyID(), runtimeEnvironmentKey, consumer)
	svc.SetLocalEnvironmentPrerequisiteWaitTimeout(2 * time.Second)
	startFailedLocalEnvironmentDependencyJobForTest(t, svc, localEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.tool.uv|uv|host|windows/amd64|root|first-run",
		DependencyFamily: localEnvironmentFamilyPythonUV,
		DependencyID:     "uv",
		ConsumerScope:    "first-run",
		SourceKind:       localEnvironmentSourceManaged,
	}, "old first-run uv job failed")
	svc.SetEngineManager(&mockEngineManager{
		pythonRuntimeStatus: &engine.PythonRuntimeDependencyStatus{
			PythonVersion:   "Python " + engine.ManagedPythonVersion,
			InterpreterPath: filepath.Join(t.TempDir(), "python.exe"),
			RuntimeRoot:     t.TempDir(),
			UVExecutable:    `C:\nimi\engines\uv\uv.exe`,
			Detail:          "Runtime-managed Python runtime verified through selected uv tool",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   runtimeEnvironmentKey,
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyId:     localEnvironmentPythonRuntimeDependencyID(),
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob python.runtime: %v", err)
	}
	uvRecord := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonUV,
		DependencyID:      "uv",
		EnvironmentKey:    localEnvironmentManagedUVKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot()),
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     filepath.Join(t.TempDir(), "uv.exe"),
		Version:           engine.ManagedUVVersion,
		SelectedConsumers: []string{consumer},
	})
	writeSelectedSourceLocalArtifactsForTest(t, uvRecord)
	go func() {
		time.Sleep(50 * time.Millisecond)
		svc.upsertLocalEnvironmentSelectedSourceRecord(uvRecord)
	}()

	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("python.runtime job state = %q, want ready_managed after speech uv appears", job.GetState())
	}
}

func TestPythonVenvWaitIgnoresOlderFailedPrerequisiteWhenNewerJobInFlight(t *testing.T) {
	svc := newTestService(t)
	consumer := "speech.qwen3-asr.python"
	identity := currentPythonDependencyProfileIdentityForTest(t, consumer)
	svc.SetLocalEnvironmentPrerequisiteWaitTimeout(2 * time.Second)
	uvRecord := upsertReadyManagedUVForProfileTest(t, svc, consumer, identity)
	upsertReadyCUDAForProfileTest(t, svc, consumer, identity)
	runtimeEnvironmentKey := localEnvironmentPythonRuntimeKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	startFailedLocalEnvironmentDependencyJobForTest(t, svc, localEnvironmentDependencyJobRequest{
		EnvironmentKey:   runtimeEnvironmentKey,
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyID:     localEnvironmentPythonRuntimeDependencyID(),
		ConsumerScope:    consumer,
		SourceKind:       localEnvironmentSourceManaged,
	}, "old speech runtime job failed")
	if _, err := svc.startLocalEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobRequest{
		EnvironmentKey:   runtimeEnvironmentKey,
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyID:     localEnvironmentPythonRuntimeDependencyID(),
		ConsumerScope:    consumer,
		SourceKind:       localEnvironmentSourceManaged,
	}, nil); err != nil {
		t.Fatalf("start in-flight python.runtime job: %v", err)
	}
	venvRoot := t.TempDir()
	status := pythonDependencyProfileStatusForTest(identity, consumer, venvRoot, uvRecord.CanonicalRoot, t.TempDir())
	svc.SetEngineManager(&mockEngineManager{pythonDependencyProfileStatus: &status})
	venvEnvironmentKey := rememberPythonProfileJobContractForTest(svc, localEnvironmentFamilyPythonVenv, consumer, identity)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   venvEnvironmentKey,
		DependencyFamily: localEnvironmentFamilyPythonVenv,
		DependencyId:     identity.DependencyID,
		ConsumerScope:    consumer,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob python.venv: %v", err)
	}
	runtimeRecord := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonRuntime,
		DependencyID:      localEnvironmentPythonRuntimeDependencyID(),
		EnvironmentKey:    runtimeEnvironmentKey,
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     filepath.Join(t.TempDir(), "python"),
		Version:           "Python " + engine.ManagedPythonVersion,
		SelectedConsumers: []string{consumer},
		Hashes:            map[string]string{"selected_uv_record": uvRecord.RecordID},
	})
	writeSelectedSourceLocalArtifactsForTest(t, runtimeRecord)
	go func() {
		time.Sleep(50 * time.Millisecond)
		svc.upsertLocalEnvironmentSelectedSourceRecord(runtimeRecord)
	}()

	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("python.venv job state = %q, want ready_managed after newer runtime job produces source", job.GetState())
	}
}

func TestStartNativeSDCPPDependencyJobRepairRequiredWithoutEvidence(t *testing.T) {
	svc := newTestService(t)
	dep := nativeSDCPPPlanDependencyForTest(t, svc, "stable-diffusion.cpp.metal", localEnvironmentAppleSilicon128GBProfile())
	svc.SetEngineManager(&mockEngineManager{
		managedImageBackendStatus: &engine.ManagedImageBackendDependencyStatus{
			BackendName: "stablediffusion-ggml",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   dep.EnvironmentKey,
		DependencyFamily: dep.DependencyFamily,
		DependencyId:     dep.DependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateRepairRequired {
		t.Fatalf("job state = %q, want repair_required", job.GetState())
	}
}

package engine

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

// SpeechExecutionHost is the private transport adapter for the supervised
// speech process. Selection and model identity are fixed in the Driver plan;
// this Host supplies only the configured loopback endpoint.
type SpeechExecutionHost struct {
	materializer SpeechExecutionHostMaterializer
	port         int
	timeout      time.Duration
	lease        speechExecutionLease
	poisoned     error
}

type speechExecutionLease struct {
	mu     sync.Mutex
	active bool
	queue  []*speechExecutionWaiter
}

type speechExecutionWaiter struct {
	ready   chan struct{}
	granted bool
}

const maxSpeechExecutionHostTimeout = 30 * time.Minute

// @nimi-authority: rule.nimi.runtime.local-compute.r110
// SpeechExecutionModelRegistration is the Job-captured Loadout binding passed
// to the exact private Host. Driver family and backend remain materializer-owned
// facts rather than ModelAsset or request selectors.
type SpeechExecutionModelRegistration struct {
	CapabilityContract  string
	DriverID            string
	ModelAssetID        string
	VoiceCreationSource string
	WorkflowModelID     string
	BundleDir           string
	EntryPath           string
	DeclaredFiles       []string
	DeclaredFileSHA256  map[string]string
	VerifiedContentID   string
	EntrySHA256         string
}

// SpeechExecutionHostMaterializer lazily starts the private Host for exactly
// one already-selected speech capability, then registers an explicit captured
// model binding without asking the Host to discover Loadout-owned assets.
type SpeechExecutionHostMaterializer interface {
	MaterializeSpeechExecutionHost(context.Context, string, string, int) (string, error)
	RegisterSpeechExecutionModel(context.Context, string, SpeechExecutionModelRegistration) error
	StopSpeechExecutionHost() error
}

func NewSpeechExecutionHost(materializer SpeechExecutionHostMaterializer, port int, timeout time.Duration) *SpeechExecutionHost {
	if materializer == nil || port <= 0 {
		return nil
	}
	if timeout <= 0 || timeout > maxSpeechExecutionHostTimeout {
		timeout = maxSpeechExecutionHostTimeout
	}
	return &SpeechExecutionHost{materializer: materializer, port: port, timeout: timeout}
}

func (host *SpeechExecutionHost) ExecuteSpeechSynthesis(ctx context.Context, plan *capabilitydriver.SpeechSynthesizeInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.SpeechSynthesisResult, error) {
	if host == nil || host.materializer == nil || plan == nil || strings.TrimSpace(plan.ModelAssetID()) == "" || len(plan.ModelFiles()) != 1 {
		return localexecution.SpeechSynthesisResult{}, speechHostError(localexecution.FailureLoad, fmt.Errorf("local speech synthesis host is unavailable"))
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return localexecution.SpeechSynthesisResult{}, speechHostError(localexecution.FailureCanceled, err)
	}
	defer release()
	if host.poisoned != nil {
		return localexecution.SpeechSynthesisResult{}, speechHostError(localexecution.FailureProcessCrash, host.poisoned)
	}
	if err := beginSpeechExecution(ctx, onStart); err != nil {
		return localexecution.SpeechSynthesisResult{}, err
	}
	modelFiles := plan.ModelFiles()
	seals, err := sealInvocationModelContentContext(ctx, modelFiles)
	if err != nil {
		return localexecution.SpeechSynthesisResult{}, speechContentSealError(ctx, err)
	}
	backend, err := host.materializeBackend(ctx, capabilitydriver.AudioSynthesizeContract, plan.DriverID(), plan.ModelAssetID(), modelFiles, seals, "", "")
	if err != nil {
		if ctx != nil && ctx.Err() != nil {
			return localexecution.SpeechSynthesisResult{}, host.stopCanceledExecution(ctx.Err(), err)
		}
		return localexecution.SpeechSynthesisResult{}, err
	}
	request := plan.Request()
	artifactBody, usage, err := backend.SynthesizeSpeechArtifactBody(ctx, plan.ModelAssetID(), request, nil)
	if err != nil {
		return localexecution.SpeechSynthesisResult{}, host.speechHostBackendError(ctx, err)
	}
	if artifactBody == nil || artifactBody.Body == nil {
		return localexecution.SpeechSynthesisResult{}, speechHostError(localexecution.FailureInference, fmt.Errorf("local speech synthesis returned empty audio"))
	}
	return localexecution.SpeechSynthesisResult{
		AudioBody: artifactBody.Body,
		SizeBytes: artifactBody.SizeBytes,
		MIMEType:  artifactBody.MIMEType,
		Usage:     usage,
	}, nil
}

func (host *SpeechExecutionHost) ExecuteSpeechTranscription(ctx context.Context, plan *capabilitydriver.SpeechTranscribeInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.SpeechTranscriptionResult, error) {
	if host == nil || host.materializer == nil || plan == nil || strings.TrimSpace(plan.ModelAssetID()) == "" || len(plan.ModelFiles()) != 1 {
		return localexecution.SpeechTranscriptionResult{}, speechHostError(localexecution.FailureLoad, fmt.Errorf("local speech transcription host is unavailable"))
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return localexecution.SpeechTranscriptionResult{}, speechHostError(localexecution.FailureCanceled, err)
	}
	defer release()
	if host.poisoned != nil {
		return localexecution.SpeechTranscriptionResult{}, speechHostError(localexecution.FailureProcessCrash, host.poisoned)
	}
	if err := beginSpeechExecution(ctx, onStart); err != nil {
		return localexecution.SpeechTranscriptionResult{}, err
	}
	modelFiles := plan.ModelFiles()
	seals, err := sealInvocationModelContentContext(ctx, modelFiles)
	if err != nil {
		return localexecution.SpeechTranscriptionResult{}, speechContentSealError(ctx, err)
	}
	backend, err := host.materializeBackend(ctx, capabilitydriver.AudioTranscribeContract, plan.DriverID(), plan.ModelAssetID(), modelFiles, seals, "", "")
	if err != nil {
		if ctx != nil && ctx.Err() != nil {
			return localexecution.SpeechTranscriptionResult{}, host.stopCanceledExecution(ctx.Err(), err)
		}
		return localexecution.SpeechTranscriptionResult{}, err
	}
	text, usage, err := backend.Transcribe(ctx, plan.ModelAssetID(), plan.Request(), plan.AudioBytes(), plan.MIMEType(), nil)
	if err != nil {
		return localexecution.SpeechTranscriptionResult{}, host.speechHostBackendError(ctx, err)
	}
	if strings.TrimSpace(text) == "" {
		return localexecution.SpeechTranscriptionResult{}, speechHostError(localexecution.FailureInference, fmt.Errorf("local speech transcription returned empty text"))
	}
	return localexecution.SpeechTranscriptionResult{Text: text, Usage: usage}, nil
}

func (host *SpeechExecutionHost) ExecuteVoiceCreate(ctx context.Context, plan *capabilitydriver.VoiceCreateInvocationPlan, onStart localexecution.SpeechExecutionStartFunc) (localexecution.VoiceCreateResult, error) {
	if host == nil || host.materializer == nil || plan == nil || strings.TrimSpace(plan.ModelAssetID()) == "" || len(plan.ModelFiles()) != 1 {
		return localexecution.VoiceCreateResult{}, speechHostError(localexecution.FailureLoad, fmt.Errorf("local voice.create host is unavailable"))
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return localexecution.VoiceCreateResult{}, speechHostError(localexecution.FailureCanceled, err)
	}
	defer release()
	if host.poisoned != nil {
		return localexecution.VoiceCreateResult{}, speechHostError(localexecution.FailureProcessCrash, host.poisoned)
	}
	if err := beginSpeechExecution(ctx, onStart); err != nil {
		return localexecution.VoiceCreateResult{}, err
	}
	modelFiles := plan.ModelFiles()
	seals, err := sealInvocationModelContentContext(ctx, modelFiles)
	if err != nil {
		return localexecution.VoiceCreateResult{}, speechContentSealError(ctx, err)
	}
	creationSource, err := voiceCreateRegistrationSource(plan.SourceFeature())
	if err != nil {
		return localexecution.VoiceCreateResult{}, speechHostError(localexecution.FailureLoad, err)
	}
	backend, err := host.materializeBackend(
		ctx,
		capabilitydriver.VoiceCreateContract,
		plan.DriverID(),
		plan.ModelAssetID(),
		modelFiles,
		seals,
		creationSource,
		plan.WorkflowModelID(),
	)
	if err != nil {
		if ctx != nil && ctx.Err() != nil {
			return localexecution.VoiceCreateResult{}, host.stopCanceledExecution(ctx.Err(), err)
		}
		return localexecution.VoiceCreateResult{}, err
	}
	payload, err := localVoiceCreatePayload(plan)
	if err != nil {
		return localexecution.VoiceCreateResult{}, speechHostError(localexecution.FailureLoad, err)
	}
	result, err := backend.CreateLocalVoice(ctx, payload)
	if err != nil {
		return localexecution.VoiceCreateResult{}, host.speechHostBackendError(ctx, err)
	}
	if strings.TrimSpace(result.ProviderVoiceRef) == "" {
		return localexecution.VoiceCreateResult{}, speechHostError(localexecution.FailureInference, fmt.Errorf("local voice.create returned an empty handle"))
	}
	return localexecution.VoiceCreateResult{
		ProviderVoiceRef: strings.TrimSpace(result.ProviderVoiceRef),
		Metadata:         result.Metadata,
	}, nil
}

func localVoiceCreatePayload(plan *capabilitydriver.VoiceCreateInvocationPlan) (map[string]any, error) {
	request := plan.Request()
	if request == nil {
		return nil, fmt.Errorf("local voice.create request is unavailable")
	}
	payload := map[string]any{
		"workflow_model_id": plan.WorkflowModelID(),
		"target_model_id":   plan.ModelAssetID(),
	}
	switch source := request.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		input := source.ReferenceAudio
		if input == nil || len(input.GetReferenceAudioBytes()) == 0 {
			return nil, fmt.Errorf("local voice.create reference audio is unavailable")
		}
		payload["creation_source"] = "reference_audio"
		payload["input"] = map[string]any{
			"reference_audio_base64": base64.StdEncoding.EncodeToString(input.GetReferenceAudioBytes()),
			"reference_audio_mime":   strings.TrimSpace(input.GetReferenceAudioMime()),
			"language_hints":         append([]string(nil), input.GetLanguageHints()...),
			"preferred_name":         strings.TrimSpace(input.GetPreferredName()),
			"text":                   strings.TrimSpace(input.GetText()),
		}
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		input := source.TextDescription
		if input == nil {
			return nil, fmt.Errorf("local voice.create text description is unavailable")
		}
		payload["creation_source"] = "text_description"
		payload["input"] = map[string]any{
			"instruction_text": strings.TrimSpace(input.GetInstructionText()),
			"preview_text":     strings.TrimSpace(input.GetPreviewText()),
			"language":         strings.TrimSpace(input.GetLanguage()),
			"preferred_name":   strings.TrimSpace(input.GetPreferredName()),
		}
	default:
		return nil, fmt.Errorf("local voice.create source is unavailable")
	}
	return payload, nil
}

func voiceCreateRegistrationSource(sourceFeature string) (string, error) {
	switch strings.TrimSpace(sourceFeature) {
	case "input.audio":
		return "reference_audio", nil
	case "input.text":
		return "text_description", nil
	default:
		return "", fmt.Errorf("local voice.create source feature is unavailable")
	}
}

func (lease *speechExecutionLease) acquire(ctx context.Context) (func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	waiter := &speechExecutionWaiter{ready: make(chan struct{})}
	lease.mu.Lock()
	if !lease.active && len(lease.queue) == 0 {
		lease.active = true
		waiter.granted = true
		close(waiter.ready)
	} else {
		lease.queue = append(lease.queue, waiter)
	}
	lease.mu.Unlock()

	select {
	case <-waiter.ready:
		if err := ctx.Err(); err != nil {
			lease.releaseGranted()
			return nil, err
		}
	case <-ctx.Done():
		lease.mu.Lock()
		if waiter.granted {
			lease.mu.Unlock()
			lease.releaseGranted()
		} else {
			lease.removeWaiterLocked(waiter)
			lease.mu.Unlock()
		}
		return nil, ctx.Err()
	}

	var once sync.Once
	return func() {
		once.Do(lease.releaseGranted)
	}, nil
}

func (lease *speechExecutionLease) releaseGranted() {
	lease.mu.Lock()
	defer lease.mu.Unlock()
	lease.active = false
	if len(lease.queue) == 0 {
		return
	}
	next := lease.queue[0]
	copy(lease.queue, lease.queue[1:])
	lease.queue[len(lease.queue)-1] = nil
	lease.queue = lease.queue[:len(lease.queue)-1]
	lease.active = true
	next.granted = true
	close(next.ready)
}

func (lease *speechExecutionLease) removeWaiterLocked(wanted *speechExecutionWaiter) {
	for index, waiter := range lease.queue {
		if waiter != wanted {
			continue
		}
		copy(lease.queue[index:], lease.queue[index+1:])
		lease.queue[len(lease.queue)-1] = nil
		lease.queue = lease.queue[:len(lease.queue)-1]
		return
	}
}

func beginSpeechExecution(ctx context.Context, onStart localexecution.SpeechExecutionStartFunc) error {
	if ctx != nil && ctx.Err() != nil {
		return speechHostError(localexecution.FailureCanceled, ctx.Err())
	}
	if onStart == nil {
		return nil
	}
	if err := onStart(); err != nil {
		return speechHostError(localexecution.FailureCanceled, err)
	}
	return nil
}

func speechContentSealError(ctx context.Context, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return speechHostError(localexecution.FailureCanceled, ctx.Err())
	}
	if localexecution.FailureKindOf(err) != "" {
		return err
	}
	return speechHostError(localexecution.FailureContentMismatch, err)
}

func (host *SpeechExecutionHost) materializeBackend(
	ctx context.Context,
	capabilityContract string,
	driverID string,
	modelAssetID string,
	modelFiles []capabilitydriver.InvocationExactBinding,
	seals []invocationModelContentSeal,
	voiceCreationSource string,
	workflowModelID string,
) (*nimillm.Backend, error) {
	registration, err := speechExecutionModelRegistration(
		capabilityContract,
		driverID,
		modelAssetID,
		modelFiles,
		seals,
		voiceCreationSource,
		workflowModelID,
	)
	if err != nil {
		return nil, speechHostError(localexecution.FailureLoad, fmt.Errorf("local speech model registration is incomplete: %w", err))
	}
	endpoint, err := host.materializer.MaterializeSpeechExecutionHost(ctx, capabilityContract, driverID, host.port)
	if err != nil {
		return nil, speechHostError(localexecution.FailureLoad, fmt.Errorf("materialize local speech ExecutionHost for %s: %w", capabilityContract, err))
	}
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if endpoint == "" {
		return nil, speechHostError(localexecution.FailureLoad, fmt.Errorf("local speech ExecutionHost endpoint is unavailable"))
	}
	if err := host.materializer.RegisterSpeechExecutionModel(ctx, endpoint, registration); err != nil {
		return nil, speechHostError(localexecution.FailureLoad, fmt.Errorf("register local speech model %s: %w", modelAssetID, err))
	}
	backend := nimillm.NewBackend("local-speech-execution-host", endpoint, "", host.timeout)
	if backend == nil {
		return nil, speechHostError(localexecution.FailureLoad, fmt.Errorf("local speech ExecutionHost endpoint is unavailable"))
	}
	return backend, nil
}

func speechExecutionModelRegistration(
	capabilityContract string,
	driverID string,
	modelAssetID string,
	modelFiles []capabilitydriver.InvocationExactBinding,
	seals []invocationModelContentSeal,
	voiceCreationSource string,
	workflowModelID string,
) (SpeechExecutionModelRegistration, error) {
	if len(modelFiles) != 1 || len(seals) != 1 {
		return SpeechExecutionModelRegistration{}, fmt.Errorf("exactly one captured model binding is required")
	}
	binding := modelFiles[0]
	if strings.TrimSpace(capabilityContract) == "" || strings.TrimSpace(driverID) == "" || strings.TrimSpace(modelAssetID) == "" ||
		strings.TrimSpace(binding.ModelAssetID) != strings.TrimSpace(modelAssetID) ||
		strings.TrimSpace(binding.BundleDir) == "" || strings.TrimSpace(binding.AbsolutePath) == "" || len(binding.DeclaredFiles) == 0 ||
		len(seals[0].declaredFileSHA256) != len(binding.DeclaredFiles) || strings.TrimSpace(binding.VerifiedContentID) == "" ||
		strings.TrimSpace(binding.EntrySHA256) == "" {
		return SpeechExecutionModelRegistration{}, fmt.Errorf("captured ModelAsset binding and content seal are required")
	}
	voiceCreationSource = strings.TrimSpace(voiceCreationSource)
	workflowModelID = strings.TrimSpace(workflowModelID)
	if capabilityContract == capabilitydriver.VoiceCreateContract {
		if (voiceCreationSource != "reference_audio" && voiceCreationSource != "text_description") || workflowModelID == "" {
			return SpeechExecutionModelRegistration{}, fmt.Errorf("voice.create source and workflow model binding are required")
		}
		if (voiceCreationSource == "reference_audio" && workflowModelID != capabilitydriver.Qwen3VoiceCloneRecipeID) ||
			(voiceCreationSource == "text_description" && workflowModelID != capabilitydriver.Qwen3VoiceDesignRecipeID) {
			return SpeechExecutionModelRegistration{}, fmt.Errorf("voice.create source does not match its captured workflow model")
		}
	} else if voiceCreationSource != "" || workflowModelID != "" {
		return SpeechExecutionModelRegistration{}, fmt.Errorf("voice.create binding is not admitted for %s", capabilityContract)
	}
	return SpeechExecutionModelRegistration{
		CapabilityContract:  strings.TrimSpace(capabilityContract),
		DriverID:            strings.TrimSpace(driverID),
		ModelAssetID:        strings.TrimSpace(modelAssetID),
		VoiceCreationSource: voiceCreationSource,
		WorkflowModelID:     workflowModelID,
		BundleDir:           binding.BundleDir,
		EntryPath:           binding.AbsolutePath,
		DeclaredFiles:       append([]string(nil), binding.DeclaredFiles...),
		DeclaredFileSHA256:  cloneStringMap(seals[0].declaredFileSHA256),
		VerifiedContentID:   binding.VerifiedContentID,
		EntrySHA256:         binding.EntrySHA256,
	}, nil
}

func (host *SpeechExecutionHost) speechHostBackendError(ctx context.Context, err error) error {
	if ctx != nil && ctx.Err() != nil {
		return host.stopCanceledExecution(ctx.Err(), err)
	}
	return speechHostError(localexecution.FailureInference, err)
}

func (host *SpeechExecutionHost) stopCanceledExecution(cancelErr error, executionErr error) error {
	if err := host.stopInterruptedExecution(executionErr); err != nil {
		return err
	}
	return speechHostError(localexecution.FailureCanceled, cancelErr)
}

func (host *SpeechExecutionHost) stopInterruptedExecution(executionErr error) error {
	if stopErr := host.materializer.StopSpeechExecutionHost(); stopErr != nil {
		host.poisoned = fmt.Errorf("stop interrupted local speech ExecutionHost after execution error %v: %w", executionErr, stopErr)
		return speechHostError(localexecution.FailureProcessCrash, host.poisoned)
	}
	return nil
}

func speechHostError(kind localexecution.FailureKind, err error) error {
	return &localexecution.ExecutionError{Kind: kind, Err: err}
}

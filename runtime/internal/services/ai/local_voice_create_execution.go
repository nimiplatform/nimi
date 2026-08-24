// @nimi-authority: rule.nimi.runtime.local-compute.r042

package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// localVoiceCreateEffectiveInputs is an immutable capture of one selected
// local voice.create implementation. The source feature never selects another
// configuration, Driver, provider, or route.
type localVoiceCreateEffectiveInputs struct {
	head                   *runtimev1.ScenarioRequestHead
	loadoutID              string
	displayName            string
	effectiveInputIdentity *runtimev1.LoadoutEffectiveInputIdentity
	resolvedAssembly       *localResolvedAssembly
}

func (input *localVoiceCreateEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if strings.TrimSpace(input.displayName) != "" {
		return strings.TrimSpace(input.displayName)
	}
	return strings.TrimSpace(input.loadoutID)
}

func (s *Service) captureLocalVoiceCreateEffectiveInputs(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	intent executionintent.Intent,
) (*localVoiceCreateEffectiveInputs, error) {
	if s == nil || req == nil || req.GetHead() == nil || req.GetSpec() == nil || req.GetSpec().GetVoiceCreate() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.VoiceCreateContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
	}
	if strings.TrimSpace(req.GetSpec().GetVoiceCreate().GetTargetModelId()) != "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if !validSelectedLocalVoiceCreateExecution(selected) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	sourceFeature := requiredVoiceCreationFeature(req.GetSpec())
	if sourceFeature == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if err := requireSelectedFeatures(intent.RequiredFeatures, selected.SupportedFeatures); err != nil {
		return nil, err
	}
	if err := requireSelectedFeatures([]string{sourceFeature}, selected.SupportedFeatures); err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
	if s.capabilityDrivers == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	identity := capabilitydriver.IdentityFromProto(selected.DriverIdentity)
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.VoiceCreateContract, identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	voiceDriver, ok := driver.(capabilitydriver.VoiceCreateInvocationDriver)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}

	captured, _ := proto.Clone(req.GetSpec().GetVoiceCreate()).(*runtimev1.VoiceCreateScenarioSpec)
	if captured == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if reference := captured.GetReferenceAudio(); reference != nil && strings.TrimSpace(reference.GetReferenceAudioUri()) != "" {
		audioBytes, detectedMIME, fetchErr := nimillm.FetchAudioFromURI(ctx, reference.GetReferenceAudioUri())
		if fetchErr != nil {
			return nil, fetchErr
		}
		if len(audioBytes) == 0 || len(audioBytes) > maxVoiceWorkflowReferenceAudioBytes {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		reference.ReferenceAudioBytes = append([]byte(nil), audioBytes...)
		reference.ReferenceAudioUri = ""
		if strings.TrimSpace(reference.GetReferenceAudioMime()) == "" {
			reference.ReferenceAudioMime = strings.TrimSpace(detectedMIME)
		}
		if strings.TrimSpace(reference.GetReferenceAudioMime()) == "" {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
	}

	exactBindings, _ := captureLocalSpeechBindings(selected.ExactBindings)
	portable, _ := proto.Clone(selected.PortableConfig).(*structpb.Struct)
	planInput := capabilitydriver.VoiceCreateInvocationInput{
		PortableConfig:    portable,
		ExactBindings:     append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
		SupportedFeatures: append([]string(nil), selected.SupportedFeatures...),
		Request:           captured,
	}
	if registered, ok := driver.(capabilitydriver.AudioCppSpeechRegisteredDriver); ok && registered.AudioCppSpeechRegistration().CapabilityContract == capabilitydriver.VoiceCreateContract {
		root, rootErr := s.audioCppReferenceVoiceRoot()
		if rootErr != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, rootErr, grpcerr.ReasonOptions{})
		}
		planInput.AudioCppReferenceRoot = root
		planInput.AudioCppProviderVoiceRef = capabilitydriver.AudioCppReferenceVoicePrefix + ulid.Make().String()
	}
	plan, err := voiceDriver.PlanVoiceCreateInvocation(planInput)
	if err != nil {
		return nil, localSpeechInvocationError(err)
	}
	if plan == nil || strings.TrimSpace(plan.ModelAssetID()) == "" || strings.TrimSpace(plan.DriverID()) == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	resolvedAssembly, err := localResolvedAssemblyForVoiceCreate(selected, captured, plan)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local voice.create ResolvedAssembly capture failed"})
	}
	effectiveInputIdentity, err := projectResolvedAssemblyEffectiveInputIdentity(resolvedAssembly)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local voice.create ResolvedAssembly attribution failed"})
	}
	return &localVoiceCreateEffectiveInputs{
		head:                   cloneScenarioHead(req.GetHead()),
		loadoutID:              strings.TrimSpace(selected.LoadoutID),
		displayName:            strings.TrimSpace(selected.DisplayName),
		effectiveInputIdentity: effectiveInputIdentity,
		resolvedAssembly:       resolvedAssembly,
	}, nil
}

func validSelectedLocalVoiceCreateExecution(selected *localexecution.SelectedLocalExecution) bool {
	return selected != nil && selected.Configured && strings.TrimSpace(selected.LoadoutID) != "" &&
		selected.CapabilityContract == capabilitydriver.VoiceCreateContract && selected.DriverIdentity != nil &&
		len(selected.Requirements) == 1 && len(selected.ExactBindings) == 1 &&
		selected.ExecutionTarget != nil && selected.ExecutionTarget.Valid()
}

func (s *Service) submitLocalVoiceWorkflowJob(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	intent executionintent.Intent,
	ignored []*runtimev1.IgnoredScenarioExtension,
) (*runtimev1.SubmitScenarioJobResponse, error) {
	idempotencyScope, err := buildScenarioJobIdempotencyScope(ctx, req)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	if idempotencyScope != "" {
		if existing, ok := s.scenarioJobs.getByIdempotency(idempotencyScope); ok {
			return &runtimev1.SubmitScenarioJobResponse{Job: existing}, nil
		}
	}
	effective, err := s.captureLocalVoiceCreateEffectiveInputs(ctx, req, intent)
	if err != nil {
		return nil, err
	}
	timeout, err := scenarioJobTimeoutDuration(req, defaultLocalSpeechJobTimeout, true)
	if err != nil {
		return nil, err
	}
	jobCtx := newDetachedAsyncJobContext(ctx)
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	now := timestamppb.New(time.Now().UTC())
	jobID := ulid.Make().String()
	traceID := ulid.Make().String()
	job := &runtimev1.ScenarioJob{
		JobId:                  jobID,
		Head:                   cloneScenarioHead(effective.head),
		ScenarioType:           runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		ExecutionMode:          runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		RouteDecision:          runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:          effective.modelResolved(),
		Status:                 runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED,
		ReasonCode:             runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:              now,
		UpdatedAt:              now,
		TraceId:                traceID,
		ProgressTotalSteps:     1,
		IgnoredExtensions:      cloneIgnoredScenarioExtensions(ignored),
		EffectiveInputIdentity: cloneLoadoutEffectiveInputIdentity(effective.effectiveInputIdentity),
	}
	stored, created, persistErr := s.scenarioJobs.createOwnedAndBindAssemblyChecked(job, cancel, localAppJobOwnerFromContext(ctx), idempotencyScope, effective.resolvedAssembly)
	if persistErr != nil {
		cancel()
		return nil, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, persistErr, grpcerr.ReasonOptions{Message: "ScenarioJob submission could not be persisted"})
	}
	if stored == nil {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !created {
		cancel()
		return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
	}
	go func() {
		defer cancel()
		s.executeCapturedLocalVoiceCreateJob(jobCtx, jobID)
	}()
	return &runtimev1.SubmitScenarioJobResponse{Job: stored}, nil
}

func (s *Service) executeCapturedLocalVoiceCreateJob(
	ctx context.Context,
	jobID string,
) {
	if s == nil || s.voiceAssets == nil || !s.scenarioJobs.startExecution(jobID) {
		return
	}
	defer s.finishScenarioJobExecution(jobID)
	if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_QUEUED, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_QUEUED, nil); transitionErr != nil {
		s.failScenarioJobPersistencePrecondition(jobID, scenarioJobQueuedPersistenceFailedReason, transitionErr)
		return
	} else if !ok {
		return
	}
	job, ok := s.scenarioJobs.get(jobID)
	if !ok || job.GetHead() == nil {
		return
	}
	assembly, ok := s.scenarioJobs.resolvedAssembly(jobID)
	if !ok {
		s.finishLocalVoiceCreateFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	request, plan, err := s.localVoiceCreatePlanFromResolvedAssembly(assembly)
	if err != nil {
		s.finishLocalVoiceCreateFailure(ctx, jobID, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "captured local voice.create assembly is invalid"}))
		return
	}
	resultTarget := &runtimeidentity.Target{Local: &runtimeidentity.LocalTarget{
		ReadinessRef: "model-asset://" + strings.TrimSpace(plan.ModelAssetID()),
	}}
	assetDraft := newVoiceAssetDraft(&voiceWorkflowSubmitInput{
		Head:              job.GetHead(),
		ScenarioType:      runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec:              &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: request}},
		ModelResolved:     job.GetModelResolved(),
		Provider:          "local",
		WorkflowModelID:   plan.WorkflowModelID(),
		WorkflowFamily:    assembly.DriverIdentity.ImplementationID,
		OutputPersistence: "session_ephemeral",
	}, jobID, job.GetCreatedAt())
	if assetDraft == nil || resultTarget == nil || !resultTarget.Valid() {
		s.finishLocalVoiceCreateFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		return
	}
	release, err := s.acquireAsyncScenarioJobLease(ctx, job.GetHead().GetAppId(), "scenario_job_local_voice_create")
	if err != nil {
		s.finishLocalVoiceCreateFailure(ctx, jobID, err)
		return
	}
	defer release()
	if s.localSpeechHost == nil {
		s.finishLocalVoiceCreateFailure(ctx, jobID, localExecutionError(&localexecution.ExecutionError{Kind: localexecution.FailureLoad, Err: errors.New("local voice.create execution host is unavailable")}))
		return
	}
	onStart := func() error {
		if _, ok, transitionErr := s.transitionScenarioJob(jobID, runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_RUNNING, runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_RUNNING, nil); transitionErr != nil {
			s.failScenarioJobPersistencePrecondition(jobID, scenarioJobRunningPersistenceFailedReason, transitionErr)
			return transitionErr
		} else if ok {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return context.Canceled
	}
	result, err := s.localSpeechHost.ExecuteVoiceCreate(ctx, plan, onStart)
	if err != nil {
		s.finishLocalVoiceCreateFailure(ctx, jobID, localExecutionError(err))
		return
	}
	if ctxErr := ctx.Err(); ctxErr != nil {
		s.cleanupUnpublishedAudioCppReferenceVoice(jobID, result.ProviderVoiceRef)
		kind := localexecution.FailureCanceled
		if errors.Is(ctxErr, context.DeadlineExceeded) {
			kind = localexecution.FailureTimeout
		}
		s.finishLocalVoiceCreateFailure(ctx, jobID, localExecutionError(&localexecution.ExecutionError{Kind: kind, Err: ctxErr}))
		return
	}
	metadata := make(map[string]any, len(result.Metadata)+4)
	for key, value := range result.Metadata {
		metadata[key] = value
	}
	metadata["voice_asset_id"] = assetDraft.GetVoiceAssetId()
	metadata["creation_source"] = workflowTypeFromScenarioSpec(&runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: request}})
	metadata["loadout_id"] = assembly.LoadoutID
	metadata["implementation_id"] = assembly.DriverIdentity.ImplementationID
	var transitionErr error
	_, published := s.voiceAssets.publishResult(assetDraft, resultTarget, nil, result.ProviderVoiceRef, metadata, func(asset *runtimev1.VoiceAsset, reference *runtimev1.VoiceReference) bool {
		if ctx.Err() != nil {
			return false
		}
		_, ok, err := s.transitionVoiceScenarioJobCompleted(jobID, asset, reference, func(job *runtimev1.ScenarioJob) {
			job.ProviderJobId = ""
			job.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
			job.ReasonDetail = ""
			job.ReasonMetadata = nil
			job.Usage = result.Usage
			job.ProgressCurrentStep = 1
			job.ProgressTotalSteps = 1
			job.ProgressPercent = 100
		})
		transitionErr = err
		return ok && err == nil
	})
	if published {
		return
	}
	s.cleanupUnpublishedAudioCppReferenceVoice(jobID, result.ProviderVoiceRef)
	if transitionErr != nil {
		return
	}
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	s.finishLocalVoiceCreateFailure(ctx, jobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
}

func (s *Service) cleanupUnpublishedAudioCppReferenceVoice(jobID string, providerVoiceRef string) {
	providerVoiceRef = strings.TrimSpace(providerVoiceRef)
	if !strings.HasPrefix(providerVoiceRef, capabilitydriver.AudioCppReferenceVoicePrefix) {
		return
	}
	if err := s.deleteAudioCppReferenceVoice(providerVoiceRef); err != nil && s.logger != nil {
		s.logger.Warn("cleanup unpublished audio.cpp reference voice failed", "job_id", strings.TrimSpace(jobID), "error", err)
	}
}

func (s *Service) finishLocalVoiceCreateFailure(ctx context.Context, jobID string, err error) {
	if existing, ok := s.scenarioJobs.get(jobID); ok && isTerminalScenarioJobStatus(existing.GetStatus()) {
		return
	}
	jobStatus := runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED
	eventType := runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_FAILED
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_TIMEOUT
	}
	if errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
		jobStatus = runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED
		eventType = runtimev1.ScenarioJobEventType_SCENARIO_JOB_EVENT_CANCELED
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED
	}
	if jobStatus == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT {
		reason = runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	}
	_, _, _ = s.transitionScenarioJob(jobID, jobStatus, eventType, func(job *runtimev1.ScenarioJob) {
		job.ReasonCode = reason
		job.ReasonDetail = sanitizeScenarioJobReasonDetail(err, reason)
		job.ReasonMetadata = scenarioJobReasonMetadata(err, reason)
		if job.ProgressPercent >= 100 {
			job.ProgressPercent = 99
		}
	})
}

func (s *Service) localVoiceCreatePlanFromResolvedAssembly(assembly *localResolvedAssembly) (*runtimev1.VoiceCreateScenarioSpec, *capabilitydriver.VoiceCreateInvocationPlan, error) {
	if assembly == nil {
		return nil, nil, fmt.Errorf("local voice.create ResolvedAssembly is required")
	}
	if err := validateLocalResolvedAssembly(assembly); err != nil {
		return nil, nil, err
	}
	if assembly.CapabilityContract != capabilitydriver.VoiceCreateContract || assembly.Request.Kind != "voice.create" ||
		assembly.LoadPlan.Kind != "speech" || assembly.LoadPlan.Speech == nil || assembly.LoadPlan.Speech.Operation != "voice.create" {
		return nil, nil, fmt.Errorf("local voice.create ResolvedAssembly contract is mismatched")
	}
	request := &runtimev1.VoiceCreateScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, nil, fmt.Errorf("decode local voice.create request: %w", err)
	}
	portable, err := resolvedAssemblyPortableConfig(assembly)
	if err != nil {
		return nil, nil, err
	}
	if s.capabilityDrivers == nil {
		return nil, nil, fmt.Errorf("local voice.create Driver registry is unavailable")
	}
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.VoiceCreateContract, capabilitydriver.Identity{
		ImplementationID: assembly.DriverIdentity.ImplementationID,
		DriverID:         assembly.DriverIdentity.DriverID,
		DriverDialect:    assembly.DriverIdentity.DriverDialect,
	})
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		return nil, nil, fmt.Errorf("captured local voice.create Driver is unavailable")
	}
	voiceDriver, ok := driver.(capabilitydriver.VoiceCreateInvocationDriver)
	if !ok {
		return nil, nil, fmt.Errorf("captured local voice.create Driver has no invocation contract")
	}
	planInput := capabilitydriver.VoiceCreateInvocationInput{
		PortableConfig: portable, ExactBindings: resolvedAssemblyExactBindings(assembly),
		SupportedFeatures: append([]string(nil), assembly.SupportedFeatures...), Request: request,
	}
	if captured := assembly.LoadPlan.Speech.AudioCppReferenceVoice; captured != nil {
		planInput.AudioCppReferenceRoot = captured.Root
		planInput.AudioCppProviderVoiceRef = captured.ProviderVoiceRef
	}
	plan, err := voiceDriver.PlanVoiceCreateInvocation(planInput)
	if err != nil {
		return nil, nil, err
	}
	selected := selectedLocalExecutionFromResolvedAssembly(assembly)
	selected.PortableConfig = portable
	reprojected, err := localResolvedAssemblyForVoiceCreate(selected, request, plan)
	if err != nil {
		return nil, nil, err
	}
	if err := validateRehydratedResolvedAssemblyPlan(assembly, reprojected); err != nil {
		return nil, nil, err
	}
	return request, plan, nil
}

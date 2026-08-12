package ai

import (
	"context"
	"errors"
	"strings"

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
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// localVoiceCreateEffectiveInputs is an immutable capture of one selected
// local voice.create implementation. The source feature never selects another
// configuration, Driver, provider, or route.
type localVoiceCreateEffectiveInputs struct {
	head              *runtimev1.ScenarioRequestHead
	request           *runtimev1.VoiceCreateScenarioSpec
	configurationID   string
	displayName       string
	driverIdentity    *runtimev1.CapabilityImplementationIdentity
	portableConfig    *structpb.Struct
	requirements      []*runtimev1.LocalCapabilityRequirement
	exactBindings     []capabilitydriver.InvocationExactBinding
	supportedFeatures []string
	executionTarget   *runtimeidentity.Target
	plan              *capabilitydriver.VoiceCreateInvocationPlan
}

func (input *localVoiceCreateEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if strings.TrimSpace(input.displayName) != "" {
		return strings.TrimSpace(input.displayName)
	}
	return strings.TrimSpace(input.configurationID)
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
	if s.localExecution == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	}
	selected, err := s.localExecution.ResolveSelectedLocalExecution(capabilitydriver.VoiceCreateContract)
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
	plan, err := voiceDriver.PlanVoiceCreateInvocation(capabilitydriver.VoiceCreateInvocationInput{
		PortableConfig:    portable,
		ExactBindings:     append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
		SupportedFeatures: append([]string(nil), selected.SupportedFeatures...),
		Request:           captured,
	})
	if err != nil {
		return nil, localSpeechInvocationError(err)
	}
	if plan == nil || strings.TrimSpace(plan.ModelAssetID()) == "" || strings.TrimSpace(plan.DriverID()) == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	return &localVoiceCreateEffectiveInputs{
		head:              cloneScenarioHead(req.GetHead()),
		request:           captured,
		configurationID:   strings.TrimSpace(selected.ConfigurationID),
		displayName:       strings.TrimSpace(selected.DisplayName),
		driverIdentity:    cloneCapabilityImplementationIdentity(selected.DriverIdentity),
		portableConfig:    portable,
		requirements:      cloneLocalCapabilityRequirements(selected.Requirements),
		exactBindings:     exactBindings,
		supportedFeatures: append([]string(nil), selected.SupportedFeatures...),
		executionTarget:   selected.ExecutionTarget.Clone(),
		plan:              plan,
	}, nil
}

func validSelectedLocalVoiceCreateExecution(selected *localexecution.SelectedLocalExecution) bool {
	return selected != nil && selected.Configured && strings.TrimSpace(selected.ConfigurationID) != "" &&
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
	effective, err := s.captureLocalVoiceCreateEffectiveInputs(ctx, req, intent)
	if err != nil {
		return nil, err
	}
	timeout, err := scenarioJobTimeoutDuration(req, defaultLocalSpeechJobTimeout, true)
	if err != nil {
		return nil, err
	}
	capturedSpec := &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: effective.request}}
	job, asset := s.voiceAssets.submit(&voiceWorkflowSubmitInput{
		Head:              effective.head,
		LocalAppOwner:     localAppJobOwnerFromContext(ctx),
		ScenarioType:      runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE,
		Spec:              capturedSpec,
		TraceID:           ulid.Make().String(),
		RouteDecision:     runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		ModelResolved:     effective.modelResolved(),
		Provider:          "local",
		WorkflowModelID:   effective.plan.WorkflowModelID(),
		WorkflowFamily:    effective.driverIdentity.GetImplementationId(),
		OutputPersistence: "session_ephemeral",
		ExecutionTarget:   effective.executionTarget.Clone(),
		IgnoredExtensions: ignored,
	})
	if job == nil || asset == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	jobCtx := newDetachedAsyncJobContext(ctx)
	var cancel context.CancelFunc
	if timeout > 0 {
		jobCtx, cancel = context.WithTimeout(jobCtx, timeout)
	} else {
		jobCtx, cancel = context.WithCancel(jobCtx)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		jobCtx = authn.WithIdentity(jobCtx, &authn.Identity{SubjectUserID: identity.SubjectUserID})
	}
	if !s.voiceAssets.setJobCancel(job.GetJobId(), cancel) {
		cancel()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	go func() {
		defer cancel()
		s.executeCapturedLocalVoiceCreateJob(jobCtx, job.GetJobId(), asset.GetVoiceAssetId(), effective)
	}()
	return &runtimev1.SubmitScenarioJobResponse{
		Job: job, Asset: asset, VoiceReference: voiceAssetReference(asset.GetVoiceAssetId()),
	}, nil
}

func (s *Service) executeCapturedLocalVoiceCreateJob(
	ctx context.Context,
	jobID string,
	voiceAssetID string,
	effective *localVoiceCreateEffectiveInputs,
) {
	if s == nil || s.voiceAssets == nil || effective == nil || !s.voiceAssets.startJobExecution(jobID) {
		return
	}
	defer s.voiceAssets.finishJobExecution(jobID)
	defer func() { effective.plan = nil }()
	if !s.voiceAssets.queueJob(jobID) {
		return
	}
	release, err := s.acquireAsyncScenarioJobLease(ctx, effective.head.GetAppId(), "scenario_job_local_voice_create")
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
		if s.voiceAssets.runJob(jobID) {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return context.Canceled
	}
	result, err := s.localSpeechHost.ExecuteVoiceCreate(ctx, effective.plan, onStart)
	if err != nil {
		s.finishLocalVoiceCreateFailure(ctx, jobID, localExecutionError(err))
		return
	}
	metadata := result.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["voice_asset_id"] = voiceAssetID
	metadata["creation_source"] = workflowTypeFromScenarioSpec(&runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VoiceCreate{VoiceCreate: effective.request}})
	metadata["local_configuration_id"] = effective.configurationID
	metadata["implementation_id"] = effective.driverIdentity.GetImplementationId()
	s.voiceAssets.completeJob(jobID, result.ProviderVoiceRef, metadata, result.Usage)
}

func (s *Service) finishLocalVoiceCreateFailure(ctx context.Context, jobID string, err error) {
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		s.voiceAssets.timeoutJob(jobID, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, stableScenarioJobReasonDetail(runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT), voiceWorkflowFailureMetadata(err, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, nil))
		return
	}
	if errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled) {
		return
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
		reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED
	}
	s.voiceAssets.failJob(jobID, reason, sanitizeScenarioJobReasonDetail(err, reason), voiceWorkflowFailureMetadata(err, reason, nil))
}

package ai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

type localTextEffectiveInputs struct {
	loadoutID              string
	displayName            string
	effectiveInputIdentity *runtimev1.LoadoutEffectiveInputIdentity
	driverIdentity         *runtimev1.CapabilityImplementationIdentity
	portableConfig         *structpb.Struct
	exactBindings          []capabilitydriver.InvocationExactBinding
	contentIDs             []string
	request                *runtimev1.TextGenerateScenarioSpec
	plan                   *capabilitydriver.TextInvocationPlan
	resolvedAssembly       *localResolvedAssembly
	cleanup                func()
}

func (input *localTextEffectiveInputs) release() {
	if input != nil && input.cleanup != nil {
		input.cleanup()
	}
}

func (input *localTextEffectiveInputs) modelResolved() string {
	if input == nil {
		return ""
	}
	if input.displayName != "" {
		return input.displayName
	}
	return input.loadoutID
}

func (s *Service) captureLocalTextRoutingIntent(ctx context.Context, head *runtimev1.ScenarioRequestHead) (context.Context, bool, error) {
	capturedCtx, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.LlamaCapabilityContract)
	if err != nil {
		return ctx, false, err
	}
	return capturedCtx, intent.IsLocal(), nil
}

func (s *Service) captureLocalTextEffectiveInputs(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
	spec *runtimev1.TextGenerateScenarioSpec,
	stream bool,
) (*localTextEffectiveInputs, error) {
	if s == nil || head == nil || spec == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	intent, err := s.resolveLocalTextConsumerIntent(ctx, head)
	if err != nil {
		return nil, err
	}
	if !intent.IsLocal() || intent.CapabilityContract != capabilitydriver.LlamaCapabilityContract {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
	}
	selected, err := s.resolveSelectedLocalTextExecution(ctx)
	if err != nil {
		return nil, err
	}
	if !validSelectedTextExecution(selected) {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	if err := requireSelectedFeatures(intent.RequiredFeatures, selected.SupportedFeatures); err != nil {
		return nil, err
	}

	normalized, err := normalizeLocalTextRequest(spec, intent.Defaults)
	if err != nil {
		return nil, err
	}
	resolved, err := s.resolveSelectedLocalTextGenerateScenario(ctx, head, normalized)
	if err != nil {
		return nil, err
	}
	fail := func(err error) (*localTextEffectiveInputs, error) {
		resolved.release()
		return nil, err
	}
	if err := requireSelectedRequestFeatures(resolved.spec, selected.SupportedFeatures); err != nil {
		return fail(err)
	}

	identity := capabilitydriver.IdentityFromProto(selected.DriverIdentity)
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.LlamaCapabilityContract, identity)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || driver == nil {
		return fail(grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE))
	}
	textDriver, ok := driver.(capabilitydriver.TextInvocationDriver)
	if !ok {
		return fail(grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE))
	}

	exactBindings := projectInvocationExactBindings(selected.ExactBindings)
	contentIDs := make([]string, 0, len(selected.ExactBindings))
	for _, binding := range selected.ExactBindings {
		contentIDs = append(contentIDs, binding.VerifiedContentID+"/"+binding.EntrySHA256)
	}
	sort.Strings(contentIDs)
	portable, _ := proto.Clone(selected.PortableConfig).(*structpb.Struct)
	request, _ := proto.Clone(resolved.spec).(*runtimev1.TextGenerateScenarioSpec)
	plan, err := textDriver.PlanTextInvocation(capabilitydriver.TextInvocationInput{
		PortableConfig:           portable,
		ModelContextWindowTokens: selected.ModelContextWindowTokens,
		ExactBindings:            append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
		Request:                  request,
		Stream:                   stream,
	})
	if err != nil {
		return fail(localTextInvocationError(err))
	}
	if plan == nil || plan.ProcessKey() == "" {
		return fail(grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE))
	}
	resolvedAssembly, err := localResolvedAssemblyForText(selected, request, plan)
	if err != nil {
		return fail(grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local text ResolvedAssembly capture failed"}))
	}
	effectiveInputIdentity, err := projectResolvedAssemblyEffectiveInputIdentity(resolvedAssembly)
	if err != nil {
		return fail(grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{Message: "local text ResolvedAssembly attribution failed"}))
	}
	implementation, _ := proto.Clone(selected.DriverIdentity).(*runtimev1.CapabilityImplementationIdentity)
	return &localTextEffectiveInputs{
		loadoutID:              strings.TrimSpace(selected.LoadoutID),
		displayName:            strings.TrimSpace(selected.DisplayName),
		effectiveInputIdentity: effectiveInputIdentity,
		driverIdentity:         implementation,
		portableConfig:         portable,
		exactBindings:          append([]capabilitydriver.InvocationExactBinding(nil), exactBindings...),
		contentIDs:             append([]string(nil), contentIDs...),
		request:                request,
		plan:                   plan,
		resolvedAssembly:       resolvedAssembly,
		cleanup:                resolved.release,
	}, nil
}

func (s *Service) localTextEffectiveInputsFromResolvedAssembly(assembly *localResolvedAssembly) (*localTextEffectiveInputs, error) {
	if err := validateLocalResolvedAssembly(assembly); err != nil {
		return nil, err
	}
	if assembly.CapabilityContract != capabilitydriver.LlamaCapabilityContract || assembly.Request.Kind != "text.generate" ||
		assembly.LoadPlan.Kind != "text" || assembly.LoadPlan.Text == nil {
		return nil, fmt.Errorf("local text ResolvedAssembly contract is mismatched")
	}
	request := &runtimev1.TextGenerateScenarioSpec{}
	if err := (protojson.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(assembly.Request.Payload, request); err != nil {
		return nil, fmt.Errorf("decode local text ResolvedAssembly request: %w", err)
	}
	portable, err := resolvedAssemblyPortableConfig(assembly)
	if err != nil {
		return nil, err
	}
	if s == nil || s.capabilityDrivers == nil {
		return nil, fmt.Errorf("local text Driver registry is unavailable")
	}
	driver, reason := s.capabilityDrivers.Resolve(capabilitydriver.LlamaCapabilityContract, capabilitydriver.Identity{
		ImplementationID: assembly.DriverIdentity.ImplementationID,
		DriverID:         assembly.DriverIdentity.DriverID,
		DriverDialect:    assembly.DriverIdentity.DriverDialect,
	})
	textDriver, ok := driver.(capabilitydriver.TextInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return nil, fmt.Errorf("captured local text Driver is unavailable")
	}
	plan, err := textDriver.PlanTextInvocation(capabilitydriver.TextInvocationInput{
		PortableConfig:           portable,
		ModelContextWindowTokens: assembly.LoadPlan.Text.ContextWindowTokens,
		ExactBindings:            resolvedAssemblyExactBindings(assembly),
		Request:                  request,
		Stream:                   assembly.LoadPlan.Text.Stream,
	})
	if err != nil {
		return nil, err
	}
	selected := selectedLocalExecutionFromResolvedAssembly(assembly)
	selected.PortableConfig = portable
	reprojected, err := localResolvedAssemblyForText(selected, request, plan)
	if err != nil {
		return nil, err
	}
	if err := validateRehydratedResolvedAssemblyPlan(assembly, reprojected); err != nil {
		return nil, err
	}
	return &localTextEffectiveInputs{loadoutID: assembly.LoadoutID, request: request, plan: plan}, nil
}

func (s *Service) resolveSelectedLocalTextContextMetadata(ctx context.Context) (publicChatTextContextMetadataResolution, error) {
	if s == nil || s.capabilityDrivers == nil {
		return publicChatTextContextMetadataResolution{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	}
	selected, err := s.resolveSelectedLocalTextExecution(ctx)
	if err != nil {
		return publicChatTextContextMetadataResolution{}, err
	}
	if !validSelectedTextExecution(selected) {
		return publicChatTextContextMetadataResolution{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	driver, reason := s.capabilityDrivers.Resolve(
		capabilitydriver.LlamaCapabilityContract,
		capabilitydriver.IdentityFromProto(selected.DriverIdentity),
	)
	textDriver, ok := driver.(capabilitydriver.TextInvocationDriver)
	if reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED || !ok {
		return publicChatTextContextMetadataResolution{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	contextWindow, err := textDriver.TextContextWindow(selected.PortableConfig, selected.ModelContextWindowTokens)
	if err != nil || contextWindow == 0 {
		return publicChatTextContextMetadataResolution{}, localTextInvocationError(err)
	}
	hash := sha256.New()
	contentIDs := make([]string, 0, len(selected.ExactBindings))
	for _, binding := range selected.ExactBindings {
		contentIDs = append(contentIDs, binding.VerifiedContentID+"/"+binding.EntrySHA256)
	}
	sort.Strings(contentIDs)
	for _, contentID := range contentIDs {
		_, _ = hash.Write([]byte(contentID))
		_, _ = hash.Write([]byte{0})
	}
	return publicChatTextContextMetadataResolution{
		contextWindow:  contextWindow,
		catalogVersion: "machine-loadout/v1",
		modelRevision:  hex.EncodeToString(hash.Sum(nil)),
		provider:       "local",
		release:        func() {},
	}, nil
}

func (s *Service) resolveSelectedLocalTextExecution(ctx context.Context) (*localexecution.SelectedLocalExecution, error) {
	if captured, ok := localexecution.SelectedLocalExecutionFromContext(ctx, capabilitydriver.LlamaCapabilityContract); ok {
		return captured, nil
	}
	if s == nil || s.localExecution == nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_SELECTION_NOT_FOUND)
	}
	return s.localExecution.ResolveSelectedLocalExecution(capabilitydriver.LlamaCapabilityContract)
}

func validSelectedTextExecution(selected *localexecution.SelectedLocalExecution) bool {
	return selected != nil && selected.Configured &&
		strings.TrimSpace(selected.LoadoutID) != "" &&
		selected.CapabilityContract == capabilitydriver.LlamaCapabilityContract &&
		selected.DriverIdentity != nil &&
		len(selected.Requirements) > 0 && len(selected.Requirements) == len(selected.ExactBindings)
}

func (s *Service) resolveLocalTextConsumerIntent(
	ctx context.Context,
	head *runtimev1.ScenarioRequestHead,
) (executionintent.Intent, error) {
	if intent, ok := executionintent.FromContext(ctx); ok {
		return intent, nil
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.LlamaCapabilityContract)
	return intent, err
}

func scenarioAppAIConfigCaller(ctx context.Context, head *runtimev1.ScenarioRequestHead) (appAIConfigCaller, error) {
	if head == nil {
		return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
	}
	if caller, err := authenticatedAppAIConfigCaller(ctx); err == nil {
		if caller.appID != strings.TrimSpace(head.GetAppId()) {
			return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
		}
		return caller, nil
	}
	identity := authn.IdentityFromContext(ctx)
	appID := incomingAppID(ctx)
	if identity == nil || strings.TrimSpace(identity.SubjectUserID) == "" || appID == "" || appID != strings.TrimSpace(head.GetAppId()) {
		return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
	}
	caller, ok := exactAppAIConfigCaller(strings.TrimSpace(identity.SubjectUserID), appID)
	if !ok {
		return appAIConfigCaller{}, unauthorizedAppAIConfigCallerError()
	}
	return caller, nil
}

func requireSelectedFeatures(required []string, supported []string) error {
	available := make(map[string]struct{}, len(supported))
	for _, feature := range supported {
		available[strings.TrimSpace(feature)] = struct{}{}
	}
	for _, feature := range required {
		if _, ok := available[strings.TrimSpace(feature)]; !ok {
			return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CAPABILITY_MISMATCH)
		}
	}
	return nil
}

func requireSelectedRequestFeatures(spec *runtimev1.TextGenerateScenarioSpec, supported []string) error {
	required := make([]string, 0, 1)
	for _, message := range spec.GetInput() {
		for _, part := range message.GetParts() {
			switch part.GetType() {
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_IMAGE_URL:
				required = append(required, "input.image")
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_AUDIO_URL:
				required = append(required, "input.audio")
			case runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_VIDEO_URL:
				required = append(required, "input.video")
			}
		}
	}
	if err := requireSelectedFeatures(required, supported); err != nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}
	return nil
}

func normalizeLocalTextRequest(
	spec *runtimev1.TextGenerateScenarioSpec,
	defaults *structpb.Struct,
) (*runtimev1.TextGenerateScenarioSpec, error) {
	cloned, _ := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	if cloned == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if defaults == nil || len(defaults.GetFields()) == 0 {
		return cloned, nil
	}
	for key, value := range defaults.GetFields() {
		switch key {
		case "temperature":
			if cloned.Temperature == nil {
				number, ok := finiteDefaultNumber(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.Temperature = proto.Float32(float32(number))
			}
		case "topP", "top_p":
			if cloned.TopP == nil {
				number, ok := finiteDefaultNumber(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.TopP = proto.Float32(float32(number))
			}
		case "maxTokens", "max_tokens":
			if cloned.MaxTokens == nil {
				number, ok := integerDefault(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.MaxTokens = proto.Int32(int32(number))
			}
		case "topK", "top_k":
			if cloned.TopK == nil {
				number, ok := integerDefault(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.TopK = proto.Int32(int32(number))
			}
		case "presencePenalty", "presence_penalty":
			if cloned.PresencePenalty == nil {
				number, ok := finiteDefaultNumber(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.PresencePenalty = proto.Float32(float32(number))
			}
		case "frequencyPenalty", "frequency_penalty":
			if cloned.FrequencyPenalty == nil {
				number, ok := finiteDefaultNumber(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.FrequencyPenalty = proto.Float32(float32(number))
			}
		case "seed":
			if cloned.Seed == nil {
				number, ok := integerDefault(value)
				if !ok {
					return nil, invalidAppAIConfigError()
				}
				cloned.Seed = proto.Int64(number)
			}
		case "stop":
			if len(cloned.GetStop()) == 0 {
				list := value.GetListValue()
				if list == nil {
					return nil, invalidAppAIConfigError()
				}
				for _, item := range list.GetValues() {
					text := item.GetStringValue()
					if item.GetKind() == nil || strings.TrimSpace(text) == "" {
						return nil, invalidAppAIConfigError()
					}
					cloned.Stop = append(cloned.Stop, text)
				}
			}
		default:
			return nil, invalidAppAIConfigError()
		}
	}
	return cloned, nil
}

func finiteDefaultNumber(value *structpb.Value) (float64, bool) {
	if value == nil {
		return 0, false
	}
	if _, ok := value.GetKind().(*structpb.Value_NumberValue); !ok {
		return 0, false
	}
	number := value.GetNumberValue()
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}

func integerDefault(value *structpb.Value) (int64, bool) {
	number, ok := finiteDefaultNumber(value)
	if !ok || math.Trunc(number) != number || number < math.MinInt32 || number > math.MaxInt32 {
		return 0, false
	}
	return int64(number), true
}

func localTextInvocationError(err error) error {
	var invocationErr *capabilitydriver.InvocationError
	if !errors.As(err, &invocationErr) {
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE, err, grpcerr.ReasonOptions{})
	}
	switch invocationErr.Kind {
	case capabilitydriver.InvocationFailureInvalidRequest:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	case capabilitydriver.InvocationFailureUnsupported:
		return grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED, err, grpcerr.ReasonOptions{})
	case capabilitydriver.InvocationFailureInvalidBinding:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED, err, grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID, err, grpcerr.ReasonOptions{})
	}
}

func localTextExecutionError(err error) error {
	return localExecutionError(err)
}

func localExecutionError(err error) error {
	if err == nil {
		return nil
	}
	kind := localexecution.FailureKindOf(err)
	options := grpcerr.ReasonOptions{Metadata: map[string]string{"execution_phase": string(kind)}}
	retryable := false
	switch kind {
	case localexecution.FailureCanceled:
		options.ActionHint = "request_canceled"
		options.Retryable = &retryable
		return grpcerr.WrapWithReasonCode(codes.Canceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED, err, options)
	case localexecution.FailureContentMismatch:
		options.ActionHint = "reverify_or_rebind_local_model_content"
		options.Retryable = &retryable
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CONTENT_MISMATCH, err, options)
	case localexecution.FailureLoad:
		options.ActionHint = "inspect_local_configuration_and_host_resources"
		options.Retryable = &retryable
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED, err, options)
	case localexecution.FailureProcessCrash:
		retryable = true
		options.ActionHint = "retry_after_local_execution_host_restart"
		options.Retryable = &retryable
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_PROCESS_CRASHED, err, options)
	default:
		retryable = true
		options.ActionHint = "retry_or_adjust_request"
		options.Retryable = &retryable
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED, err, options)
	}
}

func (s *Service) executeCapturedLocalText(
	ctx context.Context,
	effective *localTextEffectiveInputs,
	progress localexecution.TextProgressFunc,
) (localexecution.TextResult, error) {
	if s == nil || s.localTextHost == nil {
		return localexecution.TextResult{}, localTextExecutionError(&localexecution.ExecutionError{
			Kind: localexecution.FailureLoad,
			Err:  fmt.Errorf("local text execution host is unavailable"),
		})
	}
	result, err := s.localTextHost.ExecuteText(ctx, effective.plan, progress)
	if err != nil {
		return localexecution.TextResult{}, localTextExecutionError(err)
	}
	if result.FinishReason == runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
		result.FinishReason = runtimev1.FinishReason_FINISH_REASON_STOP
	}
	return result, nil
}

func localTextUsage(result localexecution.TextResult, _ *runtimev1.TextGenerateScenarioSpec) *runtimev1.UsageStats {
	if result.InputTokens == 0 && result.OutputTokens == 0 && result.ComputeMS == 0 {
		return nil
	}
	return &runtimev1.UsageStats{
		InputTokens: result.InputTokens, OutputTokens: result.OutputTokens, ComputeMs: result.ComputeMS,
	}
}

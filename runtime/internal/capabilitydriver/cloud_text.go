package capabilitydriver

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

// CloudInvocationFailureKind identifies the Driver layer that rejected an
// input. Route, grant, Host lifecycle, and fallback are deliberately absent.
type CloudInvocationFailureKind string

const (
	CloudInvocationFailureTarget   CloudInvocationFailureKind = "target_config"
	CloudInvocationFailureRequest  CloudInvocationFailureKind = "request_mapping"
	CloudInvocationFailureResponse CloudInvocationFailureKind = "response_normalization"
)

// CloudInvocationError is emitted by one of the Driver-owned normalization
// layers before it is projected to the public Runtime reason vocabulary.
type CloudInvocationError struct {
	Kind CloudInvocationFailureKind
	Err  error
}

func (e *CloudInvocationError) Error() string {
	if e == nil || e.Err == nil {
		return "cloud capability invocation failed"
	}
	return e.Err.Error()
}

func (e *CloudInvocationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// CloudTextTarget is an exact provider/model target interpreted by one Driver.
// It contains no route, Connector, credential, endpoint, or Host facts.
type CloudTextTarget struct {
	provider             string
	providerModelID      string
	remoteModelCatalogID string
	region               string
}

func (t CloudTextTarget) Provider() string             { return t.provider }
func (t CloudTextTarget) ProviderModelID() string      { return t.providerModelID }
func (t CloudTextTarget) RemoteModelCatalogID() string { return t.remoteModelCatalogID }
func (t CloudTextTarget) Region() string               { return t.region }

// CloudTextMappedRequest is the immutable output of request mapping. Accessors
// clone protobuf state so job snapshots cannot be mutated after capture.
type CloudTextMappedRequest struct {
	providerModelID string
	spec            *runtimev1.TextGenerateScenarioSpec
	stream          bool
}

func (r *CloudTextMappedRequest) ProviderModelID() string {
	if r == nil {
		return ""
	}
	return r.providerModelID
}

func (r *CloudTextMappedRequest) Spec() *runtimev1.TextGenerateScenarioSpec {
	if r == nil || r.spec == nil {
		return nil
	}
	cloned, _ := proto.Clone(r.spec).(*runtimev1.TextGenerateScenarioSpec)
	return cloned
}

func (r *CloudTextMappedRequest) Stream() bool { return r != nil && r.stream }

// CloudTextTransportResponse is the credential-free normalized transport
// carrier returned by Remote ExecutionHost to the Driver.
type CloudTextTransportResponse struct {
	Text         string
	ToolCalls    []*runtimev1.ToolCall
	Usage        *runtimev1.UsageStats
	FinishReason runtimev1.FinishReason
	Streamed     bool
}

// CloudTextResult is the final Runtime-normalized Driver response.
type CloudTextResult struct {
	Text         string
	ToolCalls    []*runtimev1.ToolCall
	Usage        *runtimev1.UsageStats
	FinishReason runtimev1.FinishReason
}

// CloudTextDriver owns the four r051 layers and nothing else:
// target/config validation, request mapping, stream/response normalization,
// and reason-code normalization.
type CloudTextDriver interface {
	ValidateTarget(Identity, *structpb.Struct) (CloudTextTarget, error)
	MapRequest(CloudTextTarget, *runtimev1.TextGenerateScenarioSpec, *structpb.Struct, bool) (*CloudTextMappedRequest, error)
	NormalizeStreamDelta(string) (string, error)
	NormalizeResponse(CloudTextTransportResponse) (CloudTextResult, error)
	NormalizeReason(error) error
}

// CloudTextRegistry resolves an existing provider dialect. It never sees
// Connector custody and therefore cannot become an account or route selector.
type CloudTextRegistry struct {
	drivers map[string]CloudTextDriver
}

func NewProductionCloudTextRegistry() *CloudTextRegistry {
	drivers := make(map[string]CloudTextDriver)
	for providerID, record := range providerregistry.Records {
		if record.RuntimePlane != "remote" || (!record.SupportsText && providerID != "openai_compatible" && providerID != "nimillm") {
			continue
		}
		drivers[providerID] = providerCloudTextDriver{provider: providerID, dialect: cloudTextDialect(providerID)}
	}
	return &CloudTextRegistry{drivers: drivers}
}

// Resolve validates target/config through exactly one provider Driver. The
// provider is Driver configuration, not a connector-derived routing choice.
func (r *CloudTextRegistry) Resolve(identity Identity, rawTarget *structpb.Struct) (CloudTextDriver, CloudTextTarget, error) {
	provider, ok := exactCloudTargetText(rawTarget, "provider")
	if !ok || r == nil {
		return nil, CloudTextTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud text provider target is required"))
	}
	driver := r.drivers[provider]
	if driver == nil {
		return nil, CloudTextTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud text provider %q has no admitted Driver", provider))
	}
	target, err := driver.ValidateTarget(identity, rawTarget)
	if err != nil {
		return nil, CloudTextTarget{}, err
	}
	return driver, target, nil
}

type providerCloudTextDriver struct {
	provider string
	dialect  string
}

func cloudTextDialect(provider string) string {
	switch provider {
	case "anthropic":
		return "anthropic-messages"
	case "openai_codex":
		return "openai-responses"
	default:
		return "openai-chat-completions"
	}
}

func (d providerCloudTextDriver) ValidateTarget(identity Identity, raw *structpb.Struct) (CloudTextTarget, error) {
	if !exactCloudIdentity(identity) {
		return CloudTextTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud implementation identity is incomplete"))
	}
	if raw == nil || len(raw.GetFields()) == 0 {
		return CloudTextTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider model target is required"))
	}
	for key := range raw.GetFields() {
		switch key {
		case "provider", "providerModelId", "remoteModelCatalogId", "region":
		default:
			return CloudTextTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("%s target field %q is unsupported", d.dialect, key))
		}
	}
	provider, ok := exactCloudTargetText(raw, "provider")
	if !ok || provider != d.provider {
		return CloudTextTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider target does not match Driver"))
	}
	providerModelID, ok := exactCloudTargetText(raw, "providerModelId")
	if !ok {
		return CloudTextTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider model identity is required"))
	}
	remoteModelCatalogID, ok := exactCloudTargetText(raw, "remoteModelCatalogId")
	if !ok {
		return CloudTextTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("remote model catalog identity is required"))
	}
	region := ""
	if _, present := raw.GetFields()["region"]; present {
		var valid bool
		region, valid = exactCloudTargetText(raw, "region")
		if !valid {
			return CloudTextTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider region is invalid"))
		}
	}
	return CloudTextTarget{
		provider:             provider,
		providerModelID:      providerModelID,
		remoteModelCatalogID: remoteModelCatalogID,
		region:               region,
	}, nil
}

func (d providerCloudTextDriver) MapRequest(target CloudTextTarget, spec *runtimev1.TextGenerateScenarioSpec, defaults *structpb.Struct, stream bool) (*CloudTextMappedRequest, error) {
	if target.provider != d.provider || target.providerModelID == "" || spec == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud text request mapping input is incomplete"))
	}
	mapped, _ := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	if mapped == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("clone cloud text request"))
	}
	if err := applyCloudTextDefaults(mapped, defaults); err != nil {
		return nil, err
	}
	if err := validateCloudTextRequest(mapped); err != nil {
		return nil, err
	}
	return &CloudTextMappedRequest{providerModelID: target.providerModelID, spec: mapped, stream: stream}, nil
}

func (providerCloudTextDriver) NormalizeStreamDelta(delta string) (string, error) {
	if delta == "" {
		return "", nil
	}
	return delta, nil
}

func (providerCloudTextDriver) NormalizeResponse(response CloudTextTransportResponse) (CloudTextResult, error) {
	finish := response.FinishReason
	if finish == runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED {
		finish = runtimev1.FinishReason_FINISH_REASON_STOP
	}
	if finish == runtimev1.FinishReason_FINISH_REASON_ERROR {
		return CloudTextResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider returned an error finish reason without an error"))
	}
	toolCalls := cloneCloudToolCalls(response.ToolCalls)
	if !response.Streamed && response.Text == "" && len(toolCalls) == 0 {
		return CloudTextResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider returned no text or tool call output"))
	}
	var usage *runtimev1.UsageStats
	if response.Usage != nil {
		usage, _ = proto.Clone(response.Usage).(*runtimev1.UsageStats)
	}
	return CloudTextResult{
		Text:         response.Text,
		ToolCalls:    toolCalls,
		Usage:        usage,
		FinishReason: finish,
	}, nil
}

func (providerCloudTextDriver) NormalizeReason(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
		return grpcerr.WrapWithReasonCode(codes.Canceled, runtimev1.ReasonCode_ACTION_EXECUTED, err, grpcerr.ReasonOptions{Message: "remote execution canceled"})
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return grpcerr.WrapWithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, err, grpcerr.ReasonOptions{Message: "provider request timed out"})
	}
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
		if statusCode, parseErr := strconv.Atoi(metadata["provider_http_status"]); parseErr == nil && statusCode > 0 {
			reason := CloudTextReasonForHTTPStatus(statusCode)
			grpcCode := codes.Internal
			switch reason {
			case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED:
				grpcCode = codes.FailedPrecondition
			case runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED:
				grpcCode = codes.ResourceExhausted
			case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
				grpcCode = codes.DeadlineExceeded
			}
			return grpcerr.WrapWithReasonCode(grpcCode, reason, err, grpcerr.ReasonOptions{Metadata: map[string]string{"provider_http_status": strconv.Itoa(statusCode)}})
		}
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		switch reason {
		case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
			runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED,
			runtimev1.ReasonCode_AI_INPUT_INVALID,
			runtimev1.ReasonCode_AI_OUTPUT_INVALID,
			runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED:
			return err
		}
	}
	switch status.Code(err) {
	case codes.Unauthenticated, codes.PermissionDenied:
		return grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, err, grpcerr.ReasonOptions{})
	case codes.ResourceExhausted:
		return grpcerr.WrapWithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED, err, grpcerr.ReasonOptions{})
	case codes.DeadlineExceeded:
		return grpcerr.WrapWithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, err, grpcerr.ReasonOptions{})
	default:
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "provider request failed"})
	}
}

// CloudTextReasonForHTTPStatus is the Driver reason normalization table. It is
// intentionally independent from transport and connector state.
func CloudTextReasonForHTTPStatus(statusCode int) runtimev1.ReasonCode {
	switch {
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED
	case statusCode == http.StatusTooManyRequests:
		return runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED
	case statusCode == http.StatusRequestTimeout || statusCode == http.StatusGatewayTimeout:
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case statusCode >= 500 && statusCode <= 599:
		return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	default:
		return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
}

func exactCloudIdentity(identity Identity) bool {
	for _, value := range []string{identity.ImplementationID, identity.DriverID, identity.DriverDialect} {
		if value == "" || value != strings.TrimSpace(value) {
			return false
		}
	}
	return true
}

func exactCloudTargetText(target *structpb.Struct, key string) (string, bool) {
	if target == nil {
		return "", false
	}
	value, exists := target.GetFields()[key]
	if !exists || value == nil {
		return "", false
	}
	if _, ok := value.GetKind().(*structpb.Value_StringValue); !ok {
		return "", false
	}
	text := value.GetStringValue()
	return text, text != "" && text == strings.TrimSpace(text)
}

func applyCloudTextDefaults(spec *runtimev1.TextGenerateScenarioSpec, defaults *structpb.Struct) error {
	if defaults == nil {
		return nil
	}
	for key, value := range defaults.GetFields() {
		switch key {
		case "temperature":
			if spec.Temperature == nil {
				number, ok := cloudDefaultNumber(value)
				if !ok {
					return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("temperature default is invalid"))
				}
				spec.Temperature = proto.Float32(float32(number))
			}
		case "topP", "top_p":
			if spec.TopP == nil {
				number, ok := cloudDefaultNumber(value)
				if !ok {
					return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("top_p default is invalid"))
				}
				spec.TopP = proto.Float32(float32(number))
			}
		case "maxTokens", "max_tokens":
			if spec.MaxTokens == nil {
				number, ok := cloudDefaultInteger(value)
				if !ok {
					return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("max_tokens default is invalid"))
				}
				spec.MaxTokens = proto.Int32(int32(number))
			}
		case "topK", "top_k":
			if spec.TopK == nil {
				number, ok := cloudDefaultInteger(value)
				if !ok {
					return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("top_k default is invalid"))
				}
				spec.TopK = proto.Int32(int32(number))
			}
		case "presencePenalty", "presence_penalty":
			if spec.PresencePenalty == nil {
				number, ok := cloudDefaultNumber(value)
				if !ok {
					return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("presence_penalty default is invalid"))
				}
				spec.PresencePenalty = proto.Float32(float32(number))
			}
		case "frequencyPenalty", "frequency_penalty":
			if spec.FrequencyPenalty == nil {
				number, ok := cloudDefaultNumber(value)
				if !ok {
					return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("frequency_penalty default is invalid"))
				}
				spec.FrequencyPenalty = proto.Float32(float32(number))
			}
		case "seed":
			if spec.Seed == nil {
				number, ok := cloudDefaultInteger(value)
				if !ok {
					return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("seed default is invalid"))
				}
				spec.Seed = proto.Int64(number)
			}
		case "stop":
			if len(spec.GetStop()) == 0 {
				list := value.GetListValue()
				if list == nil {
					return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("stop default is invalid"))
				}
				for _, item := range list.GetValues() {
					text := item.GetStringValue()
					if _, ok := item.GetKind().(*structpb.Value_StringValue); !ok || text == "" || text != strings.TrimSpace(text) {
						return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("stop default is invalid"))
					}
					spec.Stop = append(spec.Stop, text)
				}
			}
		default:
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud text default %q is unsupported", key))
		}
	}
	return nil
}

func validateCloudTextRequest(spec *runtimev1.TextGenerateScenarioSpec) error {
	if spec == nil || (len(spec.GetInput()) == 0 && strings.TrimSpace(spec.GetSystemPrompt()) == "") {
		return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("text.generate input is required"))
	}
	for name, number := range map[string]float64{
		"temperature":       float64(spec.GetTemperature()),
		"top_p":             float64(spec.GetTopP()),
		"presence_penalty":  float64(spec.GetPresencePenalty()),
		"frequency_penalty": float64(spec.GetFrequencyPenalty()),
	} {
		if math.IsNaN(number) || math.IsInf(number, 0) {
			return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("%s must be finite", name))
		}
	}
	if spec.GetTemperature() < 0 || spec.GetTemperature() > 2 ||
		spec.GetTopP() < 0 || spec.GetTopP() > 1 ||
		spec.GetMaxTokens() < 0 || spec.GetTopK() < 0 ||
		spec.GetPresencePenalty() < -2 || spec.GetPresencePenalty() > 2 ||
		spec.GetFrequencyPenalty() < -2 || spec.GetFrequencyPenalty() > 2 {
		return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("text.generate sampling parameters are outside the supported range"))
	}
	return nil
}

func cloudDefaultNumber(value *structpb.Value) (float64, bool) {
	if value == nil {
		return 0, false
	}
	if _, ok := value.GetKind().(*structpb.Value_NumberValue); !ok {
		return 0, false
	}
	number := value.GetNumberValue()
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}

func cloudDefaultInteger(value *structpb.Value) (int64, bool) {
	number, ok := cloudDefaultNumber(value)
	if !ok || math.Trunc(number) != number || number < math.MinInt32 || number > math.MaxInt32 {
		return 0, false
	}
	return int64(number), true
}

func cloneCloudToolCalls(values []*runtimev1.ToolCall) []*runtimev1.ToolCall {
	if len(values) == 0 {
		return nil
	}
	out := make([]*runtimev1.ToolCall, 0, len(values))
	for _, value := range values {
		if value == nil {
			continue
		}
		cloned, _ := proto.Clone(value).(*runtimev1.ToolCall)
		if cloned != nil {
			out = append(out, cloned)
		}
	}
	return out
}

func cloudInvocationError(kind CloudInvocationFailureKind, err error) error {
	return &CloudInvocationError{Kind: kind, Err: err}
}

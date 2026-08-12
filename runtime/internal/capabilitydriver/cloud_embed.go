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

const (
	TextEmbedCapabilityContract   = "text.embed"
	CloudEmbedMaxInputsPerRequest = 16
)

// CloudEmbedTarget is one exact provider/model target interpreted by an
// embedding Driver. It contains no route, grant, credential, endpoint, or Host
// facts.
type CloudEmbedTarget struct {
	provider             string
	providerModelID      string
	remoteModelCatalogID string
	region               string
}

func (t CloudEmbedTarget) Provider() string             { return t.provider }
func (t CloudEmbedTarget) ProviderModelID() string      { return t.providerModelID }
func (t CloudEmbedTarget) RemoteModelCatalogID() string { return t.remoteModelCatalogID }
func (t CloudEmbedTarget) Region() string               { return t.region }

// CloudEmbedMappedRequest is the immutable output of Driver request mapping.
type CloudEmbedMappedRequest struct {
	providerModelID string
	inputs          []string
}

func (r *CloudEmbedMappedRequest) ProviderModelID() string {
	if r == nil {
		return ""
	}
	return r.providerModelID
}

func (r *CloudEmbedMappedRequest) Inputs() []string {
	if r == nil {
		return nil
	}
	return append([]string(nil), r.inputs...)
}

// CloudEmbedTransportResponse is the credential-free carrier returned by the
// Remote ExecutionHost before Driver response normalization.
type CloudEmbedTransportResponse struct {
	Vectors []*structpb.ListValue
	Usage   *runtimev1.UsageStats
}

// CloudEmbedResult is the final Runtime-normalized embedding result.
type CloudEmbedResult struct {
	Vectors []*runtimev1.EmbeddingVector
	Usage   *runtimev1.UsageStats
}

// CloudEmbedDriver owns the four cloud embedding layers: target/config
// validation, request mapping, response normalization, and reason-code
// normalization. Route, grant, Host lifecycle, and fallback are absent.
type CloudEmbedDriver interface {
	ValidateTarget(Identity, *structpb.Struct) (CloudEmbedTarget, error)
	MapRequest(CloudEmbedTarget, *runtimev1.TextEmbedScenarioSpec, *structpb.Struct) (*CloudEmbedMappedRequest, error)
	NormalizeResponse(*CloudEmbedMappedRequest, CloudEmbedTransportResponse) (CloudEmbedResult, error)
	NormalizeReason(error) error
}

// CloudEmbedRegistry resolves an admitted provider embedding dialect. It never
// sees Connector custody and cannot become an account or route selector.
type CloudEmbedRegistry struct {
	drivers map[string]CloudEmbedDriver
}

func NewProductionCloudEmbedRegistry() *CloudEmbedRegistry {
	drivers := make(map[string]CloudEmbedDriver)
	for providerID, record := range providerregistry.Records {
		if record.RuntimePlane != "remote" || !record.SupportsEmbed {
			continue
		}
		drivers[providerID] = providerCloudEmbedDriver{provider: providerID}
	}
	return &CloudEmbedRegistry{drivers: drivers}
}

// Resolve validates one exact provider target through its admitted Driver.
func (r *CloudEmbedRegistry) Resolve(identity Identity, rawTarget *structpb.Struct) (CloudEmbedDriver, CloudEmbedTarget, error) {
	provider, ok := exactCloudTargetText(rawTarget, "provider")
	if !ok || r == nil {
		return nil, CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud embedding provider target is required"))
	}
	driver := r.drivers[provider]
	if driver == nil {
		return nil, CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud embedding provider %q has no admitted Driver", provider))
	}
	target, err := driver.ValidateTarget(identity, rawTarget)
	if err != nil {
		return nil, CloudEmbedTarget{}, err
	}
	return driver, target, nil
}

type providerCloudEmbedDriver struct {
	provider string
}

func (d providerCloudEmbedDriver) ValidateTarget(identity Identity, raw *structpb.Struct) (CloudEmbedTarget, error) {
	if !exactCloudIdentity(identity) {
		return CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("cloud embedding implementation identity is incomplete"))
	}
	if raw == nil || len(raw.GetFields()) == 0 {
		return CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider embedding target is required"))
	}
	for key := range raw.GetFields() {
		switch key {
		case "provider", "providerModelId", "remoteModelCatalogId", "region":
		default:
			return CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("embedding target field %q is unsupported", key))
		}
	}
	provider, ok := exactCloudTargetText(raw, "provider")
	if !ok || provider != d.provider {
		return CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider target does not match embedding Driver"))
	}
	record, ok := providerregistry.Lookup(provider)
	if !ok || record.RuntimePlane != "remote" || !record.SupportsEmbed {
		return CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider %q does not implement %s", provider, TextEmbedCapabilityContract))
	}
	providerModelID, ok := exactCloudTargetText(raw, "providerModelId")
	if !ok {
		return CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider embedding model identity is required"))
	}
	remoteModelCatalogID, ok := exactCloudTargetText(raw, "remoteModelCatalogId")
	if !ok {
		return CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("remote embedding model catalog identity is required"))
	}
	region := ""
	if _, present := raw.GetFields()["region"]; present {
		var valid bool
		region, valid = exactCloudTargetText(raw, "region")
		if !valid {
			return CloudEmbedTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("provider region is invalid"))
		}
	}
	return CloudEmbedTarget{
		provider:             provider,
		providerModelID:      providerModelID,
		remoteModelCatalogID: remoteModelCatalogID,
		region:               region,
	}, nil
}

func (d providerCloudEmbedDriver) MapRequest(target CloudEmbedTarget, spec *runtimev1.TextEmbedScenarioSpec, defaults *structpb.Struct) (*CloudEmbedMappedRequest, error) {
	if target.provider != d.provider || target.providerModelID == "" || spec == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("cloud embedding request mapping input is incomplete"))
	}
	if defaults != nil && len(defaults.GetFields()) > 0 {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("text.embed defaults are unsupported"))
	}
	if len(spec.GetInputs()) == 0 {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("text.embed inputs are required"))
	}
	if len(spec.GetInputs()) > CloudEmbedMaxInputsPerRequest {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("text.embed supports at most %d inputs per request", CloudEmbedMaxInputsPerRequest))
	}
	inputs := make([]string, 0, len(spec.GetInputs()))
	for _, input := range spec.GetInputs() {
		trimmed := strings.TrimSpace(input)
		if trimmed == "" {
			return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("text.embed inputs must be non-empty"))
		}
		inputs = append(inputs, trimmed)
	}
	return &CloudEmbedMappedRequest{providerModelID: target.providerModelID, inputs: inputs}, nil
}

func (providerCloudEmbedDriver) NormalizeResponse(request *CloudEmbedMappedRequest, response CloudEmbedTransportResponse) (CloudEmbedResult, error) {
	if request == nil || len(request.inputs) == 0 || len(response.Vectors) != len(request.inputs) {
		return CloudEmbedResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider embedding vector count does not match request"))
	}
	vectors := make([]*runtimev1.EmbeddingVector, 0, len(response.Vectors))
	dimension := -1
	for index, raw := range response.Vectors {
		if raw == nil || len(raw.GetValues()) == 0 {
			return CloudEmbedResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider embedding vector %d is empty", index))
		}
		if dimension < 0 {
			dimension = len(raw.GetValues())
		} else if len(raw.GetValues()) != dimension {
			return CloudEmbedResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider embedding vector dimensions are inconsistent"))
		}
		vector := &runtimev1.EmbeddingVector{Values: make([]float64, 0, len(raw.GetValues()))}
		for _, value := range raw.GetValues() {
			if value == nil {
				return CloudEmbedResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider embedding vector contains an invalid value"))
			}
			if _, ok := value.GetKind().(*structpb.Value_NumberValue); !ok {
				return CloudEmbedResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider embedding vector contains a non-number value"))
			}
			number := value.GetNumberValue()
			if math.IsNaN(number) || math.IsInf(number, 0) {
				return CloudEmbedResult{}, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("provider embedding vector contains a non-finite value"))
			}
			vector.Values = append(vector.Values, number)
		}
		vectors = append(vectors, vector)
	}
	var usage *runtimev1.UsageStats
	if response.Usage != nil {
		usage, _ = proto.Clone(response.Usage).(*runtimev1.UsageStats)
	}
	if usage == nil {
		var inputTokens int64
		for _, input := range request.inputs {
			inputTokens += estimateCloudEmbedTokens(input)
		}
		usage = &runtimev1.UsageStats{
			InputTokens:  inputTokens,
			OutputTokens: int64(len(vectors) * 4),
			ComputeMs:    maxCloudEmbedInt64(4, int64(len(vectors)*3)),
		}
	}
	return CloudEmbedResult{Vectors: vectors, Usage: usage}, nil
}

func (providerCloudEmbedDriver) NormalizeReason(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || status.Code(err) == codes.Canceled {
		return grpcerr.WrapWithReasonCode(codes.Canceled, runtimev1.ReasonCode_ACTION_EXECUTED, err, grpcerr.ReasonOptions{Message: "remote embedding execution canceled"})
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return grpcerr.WrapWithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, err, grpcerr.ReasonOptions{Message: "provider embedding request timed out"})
	}
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
		if statusCode, parseErr := strconv.Atoi(metadata["provider_http_status"]); parseErr == nil && statusCode > 0 {
			reason := CloudEmbedReasonForHTTPStatus(statusCode)
			if existing, exists := grpcerr.ExtractReasonCode(err); exists && cloudEmbedSpecificTransportReason(statusCode, existing) {
				reason = existing
			}
			return grpcerr.WrapWithReasonCode(cloudEmbedReasonGRPCCode(reason), reason, err, grpcerr.ReasonOptions{Metadata: map[string]string{"provider_http_status": strconv.Itoa(statusCode)}})
		}
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		switch reason {
		case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
			runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
			runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
			runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
			runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
			runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
			runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING,
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
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, err, grpcerr.ReasonOptions{Message: "provider embedding request failed"})
	}
}

// CloudEmbedReasonForHTTPStatus is the embedding Driver reason table.
func CloudEmbedReasonForHTTPStatus(statusCode int) runtimev1.ReasonCode {
	switch {
	case statusCode == http.StatusUnauthorized || statusCode == http.StatusForbidden:
		return runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED
	case statusCode == http.StatusTooManyRequests:
		return runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED
	case statusCode == http.StatusRequestTimeout || statusCode == http.StatusGatewayTimeout:
		return runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT
	case statusCode == http.StatusNotFound:
		return runtimev1.ReasonCode_AI_MODEL_NOT_FOUND
	case statusCode == http.StatusBadRequest || statusCode == http.StatusConflict ||
		statusCode == http.StatusRequestEntityTooLarge || statusCode == http.StatusUnsupportedMediaType ||
		statusCode == http.StatusUnprocessableEntity:
		return runtimev1.ReasonCode_AI_INPUT_INVALID
	case statusCode >= 500 && statusCode <= 599:
		return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	default:
		return runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
}

func cloudEmbedSpecificTransportReason(statusCode int, reason runtimev1.ReasonCode) bool {
	if statusCode >= 500 || statusCode == http.StatusRequestTimeout || statusCode == http.StatusGatewayTimeout || statusCode == http.StatusTooManyRequests {
		return false
	}
	switch reason {
	case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED,
		runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
		runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
		runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED,
		runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED,
		runtimev1.ReasonCode_AI_INPUT_INVALID:
		return true
	default:
		return false
	}
}

func cloudEmbedReasonGRPCCode(reason runtimev1.ReasonCode) codes.Code {
	switch reason {
	case runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED,
		runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN:
		return codes.FailedPrecondition
	case runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED:
		return codes.ResourceExhausted
	case runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT:
		return codes.DeadlineExceeded
	case runtimev1.ReasonCode_AI_MODEL_NOT_FOUND:
		return codes.NotFound
	case runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED:
		return codes.PermissionDenied
	case runtimev1.ReasonCode_AI_INPUT_INVALID,
		runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED:
		return codes.InvalidArgument
	default:
		return codes.Internal
	}
}

func estimateCloudEmbedTokens(text string) int64 {
	count := len([]rune(strings.TrimSpace(text)))
	if count == 0 {
		return 0
	}
	tokens := count / 4
	if count%4 != 0 {
		tokens++
	}
	if tokens < 1 {
		tokens = 1
	}
	return int64(tokens)
}

func maxCloudEmbedInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

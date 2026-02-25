package grpcserver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"strings"
)

func reasonCodeFromError(err error) runtimev1.ReasonCode {
	if err == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	st, ok := status.FromError(err)
	if !ok {
		return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
	}
	if st.Code() == codes.OK {
		return runtimev1.ReasonCode_ACTION_EXECUTED
	}
	if value, exists := runtimev1.ReasonCode_value[st.Message()]; exists {
		return runtimev1.ReasonCode(value)
	}
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED
}

func inferReasonCodeFromResponse(resp any) (runtimev1.ReasonCode, bool) {
	if resp == nil {
		return runtimev1.ReasonCode_ACTION_EXECUTED, false
	}

	switch value := resp.(type) {
	case *runtimev1.Ack:
		return value.GetReasonCode(), true
	case *runtimev1.SubmitWorkflowResponse:
		return value.GetReasonCode(), true
	case *runtimev1.GetWorkflowResponse:
		return value.GetReasonCode(), true
	case *runtimev1.PullModelResponse:
		return value.GetReasonCode(), true
	case *runtimev1.CheckModelHealthResponse:
		return value.GetReasonCode(), true
	case *runtimev1.BuildIndexResponse:
		return value.GetReasonCode(), true
	case *runtimev1.SearchIndexResponse:
		return value.GetReasonCode(), true
	case *runtimev1.ValidateAppAccessTokenResponse:
		return value.GetReasonCode(), true
	case *runtimev1.OpenSessionResponse:
		return value.GetReasonCode(), true
	case *runtimev1.RefreshSessionResponse:
		return value.GetReasonCode(), true
	case *runtimev1.OpenExternalPrincipalSessionResponse:
		return value.GetReasonCode(), true
	case *runtimev1.RegisterAppResponse:
		return value.GetReasonCode(), true
	case *runtimev1.RegisterExternalPrincipalResponse:
		return value.GetReasonCode(), true
	default:
		return runtimev1.ReasonCode_ACTION_EXECUTED, false
	}
}

func inferUsage(resp any) (*runtimev1.UsageStats, bool) {
	type usageResponse interface {
		GetUsage() *runtimev1.UsageStats
	}
	item, ok := resp.(usageResponse)
	if !ok {
		return nil, false
	}
	if item.GetUsage() == nil {
		return nil, false
	}
	return cloneUsage(item.GetUsage()), true
}

func inferModelResolved(resp any) (string, bool) {
	type modelResolvedResponse interface {
		GetModelResolved() string
	}
	item, ok := resp.(modelResolvedResponse)
	if !ok {
		return "", false
	}
	modelID := strings.TrimSpace(item.GetModelResolved())
	if modelID == "" {
		return "", false
	}
	return modelID, true
}

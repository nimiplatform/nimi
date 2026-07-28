package connector

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type privateConnectorCause struct {
	detail string
}

func (e *privateConnectorCause) Error() string {
	return e.detail
}

func TestMappedConnectorErrorsPreserveCauseAndSanitizeStatus(t *testing.T) {
	tests := []struct {
		name        string
		mapError    func(error) error
		wantCode    codes.Code
		wantReason  runtimev1.ReasonCode
		wantAction  string
		wantMessage string
	}{
		{
			name:        "catalog model not found",
			mapError:    catalogModelNotFoundError,
			wantCode:    codes.NotFound,
			wantReason:  runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
			wantAction:  "inspect_reason_code_and_retry_with_corrected_request",
			wantMessage: "catalog model was not found",
		},
		{
			name:        "catalog mutation disabled",
			mapError:    catalogMutationDisabledError,
			wantCode:    codes.FailedPrecondition,
			wantReason:  runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID,
			wantAction:  "configure_runtime_model_catalog_custom_dir",
			wantMessage: "model catalog mutations are disabled",
		},
		{
			name:        "catalog provider unsupported",
			mapError:    catalogProviderUnsupportedError,
			wantCode:    codes.InvalidArgument,
			wantReason:  runtimev1.ReasonCode_AI_INPUT_INVALID,
			wantAction:  "inspect_reason_code_and_retry_with_corrected_request",
			wantMessage: "model catalog provider is unsupported",
		},
		{
			name:        "catalog input invalid",
			mapError:    catalogInputInvalidError,
			wantCode:    codes.InvalidArgument,
			wantReason:  runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID,
			wantAction:  "fix_provider_catalog_yaml",
			wantMessage: "model catalog input is invalid",
		},
		{
			name:        "remote catalog stale",
			mapError:    remoteModelCatalogStaleError,
			wantCode:    codes.FailedPrecondition,
			wantReason:  runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE,
			wantAction:  "inspect_reason_code_and_retry_with_corrected_request",
			wantMessage: "remote model catalog binding is stale",
		},
		{
			name:        "connector limit exceeded",
			mapError:    connectorLimitExceededError,
			wantCode:    codes.ResourceExhausted,
			wantReason:  runtimev1.ReasonCode_AI_CONNECTOR_LIMIT_EXCEEDED,
			wantAction:  "inspect_reason_code_and_retry_with_corrected_request",
			wantMessage: "connector limit was exceeded",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cause := &privateConnectorCause{detail: "private connector token=secret-value"}
			err := tt.mapError(cause)

			if !errors.Is(err, cause) {
				t.Fatal("expected errors.Is to retain the original cause")
			}
			var typedCause *privateConnectorCause
			if !errors.As(err, &typedCause) || typedCause != cause {
				t.Fatal("expected errors.As to retain the typed original cause")
			}

			st, ok := status.FromError(err)
			if !ok {
				t.Fatal("expected a gRPC status error")
			}
			if st.Code() != tt.wantCode {
				t.Fatalf("unexpected gRPC code: got %v want %v", st.Code(), tt.wantCode)
			}
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != tt.wantReason {
				t.Fatalf("unexpected reason code: got %v (ok=%v) want %v", reason, ok, tt.wantReason)
			}
			metadata, ok := grpcerr.ExtractReasonMetadata(err)
			if !ok || metadata["action_hint"] != tt.wantAction {
				t.Fatalf("unexpected action hint: %#v", metadata)
			}

			payload := map[string]any{}
			if decodeErr := json.Unmarshal([]byte(st.Message()), &payload); decodeErr != nil {
				t.Fatalf("expected structured public status: %v", decodeErr)
			}
			if payload["message"] != tt.wantMessage {
				t.Fatalf("unexpected public message: %#v", payload)
			}
			if strings.Contains(st.Message(), cause.detail) || strings.Contains(err.Error(), cause.detail) {
				t.Fatalf("private cause leaked to public status: %q", st.Message())
			}
		})
	}
}

func TestInternalProviderErrorPreservesCauseAndSanitizesStatus(t *testing.T) {
	cause := &privateConnectorCause{detail: "private connector credential=/secret/path/token.json"}
	err := newTestService(t).internalProviderError("test.private.connector.operation", cause)

	if !errors.Is(err, cause) {
		t.Fatal("expected errors.Is to retain the provider cause")
	}
	var typedCause *privateConnectorCause
	if !errors.As(err, &typedCause) || typedCause != cause {
		t.Fatal("expected errors.As to retain the typed provider cause")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected a gRPC status error")
	}
	if st.Code() != codes.Internal {
		t.Fatalf("unexpected gRPC code: got %v want %v", st.Code(), codes.Internal)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_INTERNAL {
		t.Fatalf("unexpected reason code: got %v (ok=%v)", reason, ok)
	}
	metadata, ok := grpcerr.ExtractReasonMetadata(err)
	if !ok || metadata["action_hint"] != "retry_or_check_runtime_logs" {
		t.Fatalf("unexpected action hint: %#v", metadata)
	}
	if strings.Contains(st.Message(), cause.detail) || strings.Contains(err.Error(), cause.detail) {
		t.Fatalf("private provider cause leaked to public status: %q", st.Message())
	}
}

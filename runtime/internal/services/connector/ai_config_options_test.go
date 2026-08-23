package connector

import (
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func TestAIConfigEffectiveFailureState(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want runtimev1.AIConfigEffectiveState
	}{
		{
			name: "connector missing",
			err:  grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONNECTOR_NOT_FOUND),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_MISSING,
		},
		{
			name: "credential blocked",
			err:  grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_BLOCKED,
		},
		{
			name: "provider internal",
			err:  grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE,
		},
		{
			name: "provider unavailable",
			err:  grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE,
		},
		{
			name: "untyped dependency failure",
			err:  errors.New("dependency failure"),
			want: runtimev1.AIConfigEffectiveState_AI_CONFIG_EFFECTIVE_STATE_UNAVAILABLE,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := AIConfigEffectiveFailureState(test.err); got != test.want {
				t.Fatalf("state = %s, want %s", got, test.want)
			}
		})
	}
}

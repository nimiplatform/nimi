package ai

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestTimeoutDurationUsesBoundedOverride(t *testing.T) {
	tests := []struct {
		name           string
		timeoutMS      int32
		defaultTimeout time.Duration
		want           time.Duration
		wantError      bool
	}{
		{
			name:           "use default when request missing",
			timeoutMS:      0,
			defaultTimeout: defaultGenerateTimeout,
			want:           defaultGenerateTimeout,
		},
		{
			name:           "allow longer caller timeout",
			timeoutMS:      60_000,
			defaultTimeout: defaultGenerateTimeout,
			want:           60 * time.Second,
		},
		{
			name:           "allow shorter caller timeout",
			timeoutMS:      5_000,
			defaultTimeout: defaultGenerateTimeout,
			want:           5 * time.Second,
		},
		{
			name:           "allow exact runtime maximum",
			timeoutMS:      int32(maxRuntimeRequestTimeout / time.Millisecond),
			defaultTimeout: defaultGenerateTimeout,
			want:           maxRuntimeRequestTimeout,
		},
		{
			name:           "reject public override above runtime max",
			timeoutMS:      int32((10 * time.Minute) / time.Millisecond),
			defaultTimeout: defaultGenerateTimeout,
			wantError:      true,
		},
		{
			name:           "reject negative public override",
			timeoutMS:      -1,
			defaultTimeout: defaultGenerateTimeout,
			wantError:      true,
		},
		{
			name:           "zero default stays zero",
			timeoutMS:      0,
			defaultTimeout: 0,
			want:           0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := timeoutDuration(tt.timeoutMS, tt.defaultTimeout)
			if tt.wantError {
				if got != 0 {
					t.Fatalf("rejected timeout duration = %s, want zero", got)
				}
				if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED || statusCode(err) != codes.InvalidArgument {
					t.Fatalf("timeout error=%v code=%v reason=%v present=%v", err, statusCode(err), reason, ok)
				}
				return
			}
			if err != nil {
				t.Fatalf("timeoutDuration(%d, %s): %v", tt.timeoutMS, tt.defaultTimeout, err)
			}
			if got != tt.want {
				t.Fatalf("timeoutDuration(%d, %s) = %s, want %s", tt.timeoutMS, tt.defaultTimeout, got, tt.want)
			}
		})
	}
}

func TestActionHintFromStreamErrorUsesRuntimeMetadata(t *testing.T) {
	err := grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, grpcerr.ReasonOptions{
		ActionHint: "switch_model_or_refresh_connector_models",
	})

	if got := actionHintFromStreamError(err); got != "switch_model_or_refresh_connector_models" {
		t.Fatalf("actionHintFromStreamError() = %q, want provider action hint", got)
	}
}

func TestActionHintFromStreamErrorFallsBackToRetry(t *testing.T) {
	if got := actionHintFromStreamError(nil); got != "retry_or_reopen_stream" {
		t.Fatalf("actionHintFromStreamError(nil) = %q, want retry fallback", got)
	}
}

func TestSchedulerAcquireErrorPreservesCause(t *testing.T) {
	for _, test := range []struct {
		cause  error
		code   codes.Code
		reason runtimev1.ReasonCode
	}{
		// A caller's deadline or cancel while queued keeps its own meaning.
		{fmt.Errorf("scheduler acquire: %w", context.DeadlineExceeded), codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT},
		{fmt.Errorf("scheduler acquire: %w", context.Canceled), codes.Canceled, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_CANCELED},
		{errors.New("scheduler unavailable"), codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
	} {
		err := schedulerAcquireError(test.cause)
		if !errors.Is(err, test.cause) {
			t.Fatalf("%v: expected scheduler cause to remain available in-process", test.cause)
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != test.reason || status.Code(err) != test.code {
			t.Fatalf("%v: reason=%v code=%v (ok=%v)", test.cause, reason, status.Code(err), ok)
		}
	}
}

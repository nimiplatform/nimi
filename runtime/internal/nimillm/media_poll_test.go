package nimillm

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestProviderPollRetryLimitReached(t *testing.T) {
	if providerPollRetryLimitReached(maxProviderPollAttempts - 1) {
		t.Fatalf("retry count below limit should not trip cap")
	}
	if !providerPollRetryLimitReached(maxProviderPollAttempts) {
		t.Fatalf("retry count at limit should trip cap")
	}
}

func TestProviderPollTimeoutError(t *testing.T) {
	err := providerPollTimeoutError()
	st, ok := status.FromError(err)
	if !ok {
		t.Fatal("expected gRPC status error")
	}
	if st.Code() != codes.DeadlineExceeded {
		t.Fatalf("unexpected status code: %v", st.Code())
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT {
		t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
	}
}

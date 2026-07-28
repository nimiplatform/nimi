package ai

import (
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestRouteDescribeEncodingErrorPreservesCause(t *testing.T) {
	cause := errors.New("private route metadata serialization detail")
	err := routeDescribeEncodingError(cause)
	if !errors.Is(err, cause) {
		t.Fatal("expected route metadata encoding cause to remain available in-process")
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_INTERNAL {
		t.Fatalf("unexpected reason code: %v (ok=%v)", reason, ok)
	}
}

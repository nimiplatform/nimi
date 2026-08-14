package cognition

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestUnavailableServiceFailsClosedWithTypedReason(t *testing.T) {
	svc := NewUnavailableService()

	resp, err := svc.GetKnowledgeBank(context.Background(), &runtimev1.GetKnowledgeBankRequest{})
	if resp != nil {
		t.Fatalf("GetKnowledgeBank response = %#v, want nil", resp)
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("GetKnowledgeBank status = %v, want Unavailable: %v", status.Code(err), err)
	}
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SERVICE_UNAVAILABLE {
		t.Fatalf("GetKnowledgeBank reason = %v (present=%v), want AI_LOCAL_SERVICE_UNAVAILABLE", reason, ok)
	}
}

package workerproxy

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalRuntimeProxyUnavailableWhenWorkerSocketMissing(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_WORKER_DIR", t.TempDir())

	proxy := NewLocalRuntimeProxy(NewConnPool(nil))
	_, err := proxy.ListLocalModels(context.Background(), &runtimev1.ListLocalModelsRequest{})
	if err == nil {
		t.Fatalf("expected unavailable error when localruntime worker socket is missing")
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("status code mismatch: got=%s want=%s", status.Code(err), codes.Unavailable)
	}
}

func TestLocalRuntimeProxyUnavailableWhenPoolNil(t *testing.T) {
	proxy := NewLocalRuntimeProxy(nil)
	_, err := proxy.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{})
	if err == nil {
		t.Fatalf("expected unavailable error when localruntime proxy pool is nil")
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("status code mismatch: got=%s want=%s", status.Code(err), codes.Unavailable)
	}
	if !strings.Contains(err.Error(), "worker_localruntime_unavailable") {
		t.Fatalf("expected worker_localruntime_unavailable in error: %v", err)
	}
}

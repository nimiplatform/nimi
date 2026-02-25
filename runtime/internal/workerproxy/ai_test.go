package workerproxy

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func TestAIProxyUnavailableWhenWorkerSocketMissing(t *testing.T) {
	t.Setenv("NIMI_RUNTIME_WORKER_DIR", t.TempDir())

	proxy := NewAIProxy(NewConnPool(nil))
	_, err := proxy.Generate(context.Background(), &runtimev1.GenerateRequest{
		AppId:         "app.test",
		SubjectUserId: "user.test",
		ModelId:       "local/default",
		Modal:         runtimev1.Modal_MODAL_TEXT,
		Input: []*runtimev1.ChatMessage{
			{
				Role:    "user",
				Content: "hello",
			},
		},
	})
	if err == nil {
		t.Fatalf("expected unavailable error when worker socket is missing")
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("status code mismatch: got=%s want=%s", status.Code(err), codes.Unavailable)
	}
	if !strings.Contains(err.Error(), runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String()) {
		t.Fatalf("expected reason code in error: %v", err)
	}
}

func TestAIProxyApplyQueueWaitFromTrailer(t *testing.T) {
	ctx, _ := usagemetrics.WithQueueWaitRecorder(context.Background())
	proxy := NewAIProxy(nil)
	proxy.applyQueueWaitFromTrailer(ctx, metadata.Pairs("x-nimi-queue-wait-ms", "58"))
	if usagemetrics.QueueWaitMS(ctx) != 58 {
		t.Fatalf("queue wait mismatch: got=%d want=58", usagemetrics.QueueWaitMS(ctx))
	}
}

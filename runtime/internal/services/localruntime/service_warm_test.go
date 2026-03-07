package localruntime

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestWarmLocalModelLoadsOnceAndCachesReadyState(t *testing.T) {
	chatCompletions := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"qwen"}]}`)
		case "/v1/chat/completions":
			chatCompletions++
			_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"ready"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestServiceWithProbe(t, nil)
	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/qwen",
		Capabilities: []string{"chat"},
		Engine:       "localai",
		Endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	first, err := svc.WarmLocalModel(context.Background(), &runtimev1.WarmLocalModelRequest{
		LocalModelId: installed.GetModel().GetLocalModelId(),
		TimeoutMs:    60_000,
	})
	if err != nil {
		t.Fatalf("warm local model first call: %v", err)
	}
	if first.GetAlreadyWarm() {
		t.Fatalf("first warm call should not report already warm")
	}
	if first.GetModelResolved() != "qwen" {
		t.Fatalf("unexpected resolved model id: %q", first.GetModelResolved())
	}

	model := svc.modelByID(installed.GetModel().GetLocalModelId())
	if model == nil || model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("warm should promote model to ACTIVE, got %#v", model)
	}

	second, err := svc.WarmLocalModel(context.Background(), &runtimev1.WarmLocalModelRequest{
		LocalModelId: installed.GetModel().GetLocalModelId(),
		TimeoutMs:    60_000,
	})
	if err != nil {
		t.Fatalf("warm local model second call: %v", err)
	}
	if !second.GetAlreadyWarm() {
		t.Fatalf("second warm call should reuse cached warm state")
	}
	if chatCompletions != 1 {
		t.Fatalf("expected a single backend warm call, got %d", chatCompletions)
	}
}

func TestWarmLocalModelRejectsUnsupportedCapability(t *testing.T) {
	svc := newTestService(t)
	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/image-only",
		Capabilities: []string{"image"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	_, err = svc.WarmLocalModel(context.Background(), &runtimev1.WarmLocalModelRequest{
		LocalModelId: installed.GetModel().GetLocalModelId(),
	})
	if err == nil {
		t.Fatalf("expected warm to reject non-chat model")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected gRPC status error, got %T: %v", err, err)
	}
	if st.Code() != codes.FailedPrecondition {
		t.Fatalf("unexpected grpc code: got=%s want=%s", st.Code(), codes.FailedPrecondition)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED {
		t.Fatalf("unexpected reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
	}
}

func TestWarmLocalModelInstalledProbeFailureReturnsUnavailableWithoutInvalidTransition(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"other-model"}]}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestServiceWithProbe(t, nil)
	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/qwen",
		Capabilities: []string{"chat"},
		Engine:       "localai",
		Endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	_, err = svc.WarmLocalModel(context.Background(), &runtimev1.WarmLocalModelRequest{
		LocalModelId: installed.GetModel().GetLocalModelId(),
		TimeoutMs:    60_000,
	})
	if err == nil {
		t.Fatalf("expected warm failure when probe model does not match registration")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("unexpected reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	model := svc.modelByID(installed.GetModel().GetLocalModelId())
	if model == nil {
		t.Fatalf("expected model record to remain available")
	}
	if model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("installed model should stay INSTALLED after warm probe failure, got %v", model.GetStatus())
	}
	if model.GetHealthDetail() == "" {
		t.Fatalf("expected warm probe failure to populate health detail")
	}
}

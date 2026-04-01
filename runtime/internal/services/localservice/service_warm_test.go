package localservice

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/qwen",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	first, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
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

	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil || model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("warm should promote model to ACTIVE, got %#v", model)
	}

	second, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
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
	installed := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/image-only",
		capabilities: []string{"image"},
		engine:       "llama",
	})

	_, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
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
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/qwen",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	_, err = svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    60_000,
	})
	if err == nil {
		t.Fatalf("expected warm failure when probe model does not match registration")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("unexpected reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil {
		t.Fatalf("expected model record to remain available")
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("installed model should stay INSTALLED after warm probe failure, got %v", model.GetStatus())
	}
	if model.GetHealthDetail() == "" {
		t.Fatalf("expected warm probe failure to populate health detail")
	}
}

func TestWarmLocalModelUnhealthyProbeFailureReturnsUnavailableWithoutInvalidTransition(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   "probe request failed: dial tcp 127.0.0.1:1234: connect: connection refused",
			probeURL: endpoint,
		}
	})
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/qwen",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     "http://127.0.0.1:1234/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	if _, err := svc.updateModelStatus(installed.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, "model active"); err != nil {
		t.Fatalf("promote model active: %v", err)
	}
	if _, err := svc.updateModelStatus(installed.GetLocalAssetId(), runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "probe failed"); err != nil {
		t.Fatalf("mark model unhealthy: %v", err)
	}

	_, err = svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    200,
	})
	if err == nil {
		t.Fatalf("expected warm failure when unhealthy model probe still fails")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("unexpected reason mismatch: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}

	model := svc.modelByID(installed.GetLocalAssetId())
	if model == nil {
		t.Fatalf("expected model record to remain available")
	}
	if model.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("unhealthy model should stay UNHEALTHY after repeated warm probe failure, got %v", model.GetStatus())
	}
	if model.GetHealthDetail() == "" {
		t.Fatalf("expected repeated warm probe failure to keep health detail populated")
	}
}

func TestWarmLocalModelRetriesManagedProbeUntilReady(t *testing.T) {
	chatCompletions := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/chat/completions":
			chatCompletions++
			_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"ready"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls++
		if probeCalls < 3 {
			return endpointProbeResult{
				healthy:  false,
				detail:   `probe request failed: Get "http://127.0.0.1:1234/v1/models": dial tcp 127.0.0.1:1234: connect: connection refused`,
				probeURL: endpoint,
			}
		}
		return endpointProbeResult{
			healthy:  true,
			detail:   "probe succeeded",
			probeURL: endpoint,
			models:   []string{"qwen"},
		}
	})
	installed, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      "local/qwen",
		capabilities: []string{"chat"},
		engine:       "llama",
		endpoint:     server.URL + "/v1",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}

	startedAt := time.Now()
	resp, err := svc.WarmLocalAsset(context.Background(), &runtimev1.WarmLocalAssetRequest{
		LocalAssetId: installed.GetLocalAssetId(),
		TimeoutMs:    5_000,
	})
	if err != nil {
		t.Fatalf("warm local model should wait for managed probe readiness: %v", err)
	}
	if resp.GetAlreadyWarm() {
		t.Fatalf("first warm call should not report already warm")
	}
	if probeCalls != 3 {
		t.Fatalf("expected warm probe retries until ready, got %d probe calls", probeCalls)
	}
	if chatCompletions != 1 {
		t.Fatalf("expected a single backend warm call after probe readiness, got %d", chatCompletions)
	}
	if time.Since(startedAt) < 2*warmManagedProbeRetryInterval {
		t.Fatalf("expected warm call to wait across probe retries")
	}
}

func TestRecordWarmKeyCapsCacheSize(t *testing.T) {
	svc := newTestService(t)
	for i := 0; i < 512; i++ {
		svc.recordWarmKey(fmt.Sprintf("key-%d", i))
	}
	svc.recordWarmKey("key-0")
	svc.recordWarmKey("key-512")
	if got := len(svc.warmedModelKeys); got > 512 {
		t.Fatalf("warm key cache should stay bounded, got %d", got)
	}
	if _, ok := svc.warmedModelKeys["key-1"]; ok {
		t.Fatal("expected oldest untouched key to be evicted first")
	}
	if _, ok := svc.warmedModelKeys["key-0"]; !ok {
		t.Fatal("expected recently touched key to remain cached")
	}
}

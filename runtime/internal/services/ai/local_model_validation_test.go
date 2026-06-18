package ai

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

type fakeLocalModelLister struct {
	responses    []*runtimev1.ListLocalAssetsResponse
	err          error
	calls        int
	warmErr      error
	warmCalls    int
	startErr     error
	startCalls   int
	startResp    *runtimev1.StartLocalAssetResponse
	leaseCalls   []string
	acquireDelay time.Duration
	managedNames map[string]string
}

func (f *fakeLocalModelLister) ListLocalAssets(_ context.Context, _ *runtimev1.ListLocalAssetsRequest) (*runtimev1.ListLocalAssetsResponse, error) {
	if f.err != nil {
		return nil, f.err
	}
	if f.calls >= len(f.responses) {
		return &runtimev1.ListLocalAssetsResponse{}, nil
	}
	resp := f.responses[f.calls]
	f.calls++
	return resp, nil
}

func (f *fakeLocalModelLister) WarmLocalAsset(_ context.Context, _ *runtimev1.WarmLocalAssetRequest) (*runtimev1.WarmLocalAssetResponse, error) {
	f.warmCalls++
	if f.warmErr != nil {
		return nil, f.warmErr
	}
	return &runtimev1.WarmLocalAssetResponse{}, nil
}

func (f *fakeLocalModelLister) StartLocalAsset(_ context.Context, _ *runtimev1.StartLocalAssetRequest) (*runtimev1.StartLocalAssetResponse, error) {
	f.startCalls++
	if f.startErr != nil {
		return nil, f.startErr
	}
	if f.startResp != nil {
		return f.startResp, nil
	}
	return &runtimev1.StartLocalAssetResponse{}, nil
}

func (f *fakeLocalModelLister) AcquireLocalAssetLease(_ context.Context, localAssetID string, reason string) error {
	if f.acquireDelay > 0 {
		time.Sleep(f.acquireDelay)
	}
	f.leaseCalls = append(f.leaseCalls, "acquire:"+strings.TrimSpace(localAssetID)+":"+strings.TrimSpace(reason))
	return nil
}

func (f *fakeLocalModelLister) ReleaseLocalAssetLease(_ context.Context, localAssetID string, reason string) error {
	f.leaseCalls = append(f.leaseCalls, "release:"+strings.TrimSpace(localAssetID)+":"+strings.TrimSpace(reason))
	return nil
}

func (f *fakeLocalModelLister) ResolveManagedLlamaModelByCapabilities(preferred string, _ ...string) (string, bool) {
	if f == nil {
		return "", false
	}
	resolved := strings.TrimSpace(f.managedNames[strings.TrimSpace(preferred)])
	return resolved, resolved != ""
}

func TestParseLocalModelSelector(t *testing.T) {
	tests := []struct {
		modelID        string
		explicitEngine string
		preferLocal    bool
		normalizedID   string
		modal          runtimev1.Modal
	}{
		{modelID: "llama/qwen", explicitEngine: "llama", normalizedID: "qwen"},
		{modelID: "media/qwen", explicitEngine: "media", normalizedID: "qwen"},
		{modelID: "speech/qwen", explicitEngine: "speech", normalizedID: "qwen"},
		{modelID: "sidecar/qwen", explicitEngine: "sidecar", normalizedID: "qwen"},
		{modelID: "local/qwen", preferLocal: true, normalizedID: "qwen", modal: runtimev1.Modal_MODAL_VIDEO},
		{modelID: "raw-model", normalizedID: "raw-model"},
		{modelID: "   ", normalizedID: ""},
	}

	for _, tt := range tests {
		sel := parseLocalModelSelector(tt.modelID, tt.modal)
		if sel.explicitEngine != tt.explicitEngine || sel.preferLocal != tt.preferLocal || sel.modelID != tt.normalizedID || sel.modal != tt.modal {
			t.Fatalf("selector mismatch for %q: %+v", tt.modelID, sel)
		}
	}
}

func TestAcquireSelectedLocalModelLease(t *testing.T) {
	localLister := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "local_qwen",
				AssetId:      "qwen",
				Engine:       "llama",
				Capabilities: []string{"chat"},
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			}},
		}},
	}
	svc, err := newFromProviderConfig(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		nil,
		nil,
		nil,
		nil,
		Config{},
		8,
		2,
	)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	svc.SetLocalModelLister(localLister)

	release, err := svc.acquireSelectedLocalModelLease(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_TEXT, "text_generate_request")
	if err != nil {
		t.Fatalf("acquireSelectedLocalModelLease: %v", err)
	}
	release()

	if len(localLister.leaseCalls) != 2 {
		t.Fatalf("expected acquire/release lease calls, got %#v", localLister.leaseCalls)
	}
	if localLister.leaseCalls[0] != "acquire:local_qwen:text_generate_request" {
		t.Fatalf("unexpected acquire call: %#v", localLister.leaseCalls)
	}
	if localLister.leaseCalls[1] != "release:local_qwen:text_generate_request_cleanup" {
		t.Fatalf("unexpected release call: %#v", localLister.leaseCalls)
	}
}

func TestSelectActiveLocalModel(t *testing.T) {
	models := []*runtimev1.LocalAssetRecord{
		{LocalAssetId: "b", AssetId: "qwen", Engine: "media", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
		{LocalAssetId: "c", AssetId: "qwen", Engine: "sidecar", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
		{LocalAssetId: "a", AssetId: "qwen", Engine: "llama", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE},
	}

	selected, reason := selectActiveLocalModel(models, localModelSelector{modelID: "qwen"})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "llama" {
		t.Fatalf("expected llama prioritized, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", explicitEngine: "media", modal: runtimev1.Modal_MODAL_IMAGE})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "media" {
		t.Fatalf("expected explicit media, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", explicitEngine: "sidecar", modal: runtimev1.Modal_MODAL_MUSIC})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "sidecar" {
		t.Fatalf("expected explicit sidecar, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	_, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", explicitEngine: "unknown"})
	if reason != runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH {
		t.Fatalf("expected provider mismatch, got %v", reason)
	}

	selected, reason = selectActiveLocalModel(models, localModelSelector{modelID: "qwen", preferLocal: true})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetEngine() != "llama" {
		t.Fatalf("expected prefer local llama, got selected=%v reason=%v", selected.GetEngine(), reason)
	}

	selected, reason = selectActiveLocalModel([]*runtimev1.LocalAssetRecord{{
		LocalAssetId:   "01KTEX08DS2GR9HJ1X3R459P1B",
		AssetId:        "local-import/gemma-4-26B-A4B-it-Q8_0",
		LogicalModelId: "nimi/gemma-4-26b-it",
		Engine:         "llama",
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
	}}, localModelSelector{modelID: "01KTEX08DS2GR9HJ1X3R459P1B"})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetLocalAssetId() != "01KTEX08DS2GR9HJ1X3R459P1B" {
		t.Fatalf("expected local_asset_id selector to resolve active local model, got selected=%v reason=%v", selected, reason)
	}

	selected, reason = selectActiveLocalModel([]*runtimev1.LocalAssetRecord{{
		LocalAssetId:   "local-gemma",
		AssetId:        "local-import/gemma-4-26B-A4B-it-Q8_0",
		LogicalModelId: "nimi/gemma-4-26b-it",
		Engine:         "llama",
		Status:         runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
	}}, localModelSelector{modelID: "local/nimi/gemma-4-26b-it", preferLocal: true})
	if reason != runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED || selected.GetLogicalModelId() != "nimi/gemma-4-26b-it" {
		t.Fatalf("expected logical_model_id selector to resolve active local model, got selected=%v reason=%v", selected, reason)
	}

	_, reason = selectActiveLocalModel(models, localModelSelector{modelID: "absent"})
	if reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected unavailable, got %v", reason)
	}
}

func TestLocalEnginePriorityAndProfileRequirement(t *testing.T) {
	if localEnginePriority("llama") >= localEnginePriority("media") {
		t.Fatalf("unexpected local engine priority ordering")
	}
	if localEnginePriority("sidecar") != len(localPreferredEngines(runtimev1.Modal_MODAL_UNSPECIFIED)) {
		t.Fatalf("unsupported text engines should rank after supported providers")
	}
	if localEnginePriority("other") < localEnginePriority("sidecar") {
		t.Fatalf("unexpected default engine priority")
	}

	if modelRequiresInvokeProfile(&runtimev1.LocalAssetRecord{LocalInvokeProfileId: "profile-1"}) {
		t.Fatalf("profile id should satisfy requirement")
	}
	if !modelRequiresInvokeProfile(&runtimev1.LocalAssetRecord{Capabilities: []string{"custom.voice"}}) {
		t.Fatalf("custom capability should require invoke profile")
	}
	if modelRequiresInvokeProfile(&runtimev1.LocalAssetRecord{Capabilities: []string{"chat"}}) {
		t.Fatalf("non-custom capabilities should not require profile")
	}
}

func TestListAllActiveLocalModelsPagination(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{
			{Assets: []*runtimev1.LocalAssetRecord{{LocalAssetId: "1"}}, NextPageToken: "next"},
			{Assets: []*runtimev1.LocalAssetRecord{{LocalAssetId: "2"}}},
		},
	}
	models, err := svc.listAllActiveLocalModels(context.Background())
	if err != nil {
		t.Fatalf("listAllActiveLocalModels: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
}

func TestValidateLocalModelRequest(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)

	// Non-local route should bypass local model validation.
	if err := svc.validateLocalModelRequest(context.Background(), "openai/gpt-4", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("non-local model should bypass validation: %v", err)
	}

	// Remote target bypass path.
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", &nimillm.RemoteTarget{ProviderType: "openai"}, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("remote target should bypass validation: %v", err)
	}

	// Local lister error maps to local model unavailable.
	svc.localModel = &fakeLocalModelLister{err: errors.New("boom")}
	err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}

	// Missing model should fail unavailable.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "other", Engine: "llama"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}

	// Proto zero-value status must not be treated as runnable readiness.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "qwen", Engine: "llama", LocalInvokeProfileId: "invoke"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected unspecified-status local model unavailable, got=%v ok=%v", reason, ok)
	}

	// Missing invoke profile for custom capability should fail.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "qwen", Engine: "llama", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, Capabilities: []string{"custom"}}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING {
		t.Fatalf("expected profile missing, got=%v ok=%v", reason, ok)
	}

	// Explicit unsupported engine/capability combination should fail route unsupported.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "qwen", Engine: "llama"}},
	}}}
	err = svc.validateLocalModelRequest(context.Background(), "media/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("expected route unsupported, got=%v ok=%v", reason, ok)
	}

	// Success path.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "qwen", Engine: "llama", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, LocalInvokeProfileId: "invoke"}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected local model validation success, got %v", err)
	}

	// AIConfig local-runtime refs may carry the Runtime local_asset_id while
	// the runnable model root stays in asset_id/logical_model_id.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "01KTEX08DS2GR9HJ1X3R459P1B",
			AssetId:              "local-import/gemma-4-26B-A4B-it-Q8_0",
			LogicalModelId:       "nimi/gemma-4-26b-it",
			Engine:               "llama",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			LocalInvokeProfileId: "invoke",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "01KTEX08DS2GR9HJ1X3R459P1B", nil, runtimev1.Modal_MODAL_TEXT); err != nil {
		t.Fatalf("expected local_asset_id model validation success, got %v", err)
	}

	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId:         "01KTEX08DS2GR9HJ1X3R459P1B",
				AssetId:              "local-import/gemma-4-26B-A4B-it-Q8_0",
				LogicalModelId:       "nimi/gemma-4-26b-it",
				Engine:               "llama",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"text.generate"},
			}},
		}},
		managedNames: map[string]string{
			"01KTEX08DS2GR9HJ1X3R459P1B": "local-import/gemma-4-26B-A4B-it-Q8_0",
		},
	}
	plan, err := svc.prepareLocalModelExecutionPlan(context.Background(), "01KTEX08DS2GR9HJ1X3R459P1B", nil, runtimev1.Modal_MODAL_TEXT, nil)
	if err != nil {
		t.Fatalf("expected local_asset_id execution plan success, got %v", err)
	}
	if got := plan.resolvedProviderModelID(""); got != "local-import/gemma-4-26B-A4B-it-Q8_0" {
		t.Fatalf("expected provider model id from managed llama resolver, got %q", got)
	}

	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "local-gemma",
			AssetId:              "local-import/gemma-4-26B-A4B-it-Q8_0",
			LogicalModelId:       "nimi/gemma-4-26b-it",
			Engine:               "llama",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			LocalInvokeProfileId: "invoke",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/nimi/gemma-4-26b-it", nil, runtimev1.Modal_MODAL_TEXT); err != nil {
		t.Fatalf("expected logical_model_id model validation success, got %v", err)
	}

	loopbackServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer func() { loopbackServer.Close() }()
	svc = newTestService(logger, Config{EnforceEndpointSecurity: true})
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			AssetId:  "qwen",
			Engine:   "llama",
			Status:   runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			Endpoint: loopbackServer.URL + "/v1",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected local model validation to hydrate active endpoint, got %v", err)
	}
	local, ok := svc.selector.local.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider after validation")
	}
	backend, resolved, explicit, available := local.pickAvailabilityBackend("qwen")
	if backend == nil || !available {
		t.Fatalf("expected hydrated llama backend, backend=%v available=%v", backend, available)
	}
	if resolved != "qwen" || explicit {
		t.Fatalf("unexpected hydrated backend resolution: resolved=%q explicit=%v", resolved, explicit)
	}

	// Same modelId across engines should respect explicit engine selector.
	dualEnginePage := &runtimev1.ListLocalAssetsResponse{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "qwen", Engine: "llama", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, LocalInvokeProfileId: "invoke"},
			{AssetId: "qwen", Engine: "sidecar", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{
		dualEnginePage,
		dualEnginePage,
	}}
	if err := svc.validateLocalModelRequest(context.Background(), "llama/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected llama selector to succeed, got %v", err)
	}
	if err := svc.validateLocalModelRequest(context.Background(), "sidecar/qwen", nil, runtimev1.Modal_MODAL_MUSIC); err != nil {
		t.Fatalf("expected sidecar selector to succeed, got %v", err)
	}
	dualEnginePageWithSidecar := &runtimev1.ListLocalAssetsResponse{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "qwen", Engine: "llama", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, LocalInvokeProfileId: "invoke"},
			{AssetId: "qwen", Engine: "sidecar", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, LocalInvokeProfileId: "invoke"},
			{AssetId: "qwen", Engine: "media", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, LocalInvokeProfileId: "invoke"},
		},
	}
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{
		dualEnginePageWithSidecar,
		dualEnginePageWithSidecar,
	}}
	if err := svc.validateLocalModelRequest(context.Background(), "sidecar/qwen", nil, runtimev1.Modal_MODAL_MUSIC); err != nil {
		t.Fatalf("expected sidecar selector to succeed, got %v", err)
	}

	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			AssetId:              "kokoro-tts",
			Engine:               "speech",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			LocalInvokeProfileId: "invoke",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "speech/kokoro-tts", nil, runtimev1.Modal_MODAL_TTS); err != nil {
		t.Fatalf("expected speech selector to succeed, got %v", err)
	}

	// Case-insensitive modelId matching should succeed across desktop/go-runtime normalization.
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{AssetId: "Qwen", Engine: "llama", Status: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, LocalInvokeProfileId: "invoke"}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected case-insensitive local model validation success, got %v", err)
	}

	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			AssetId:              "local/qwen3-4b-q4_k_m",
			Engine:               "llama",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
			LocalInvokeProfileId: "invoke",
		}},
	}}}
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen3-4b-q4_k_m", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected qualified local model id validation success, got %v", err)
	}

	installedLister := &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId:         "local-installed",
			AssetId:              "qwen-installed",
			Engine:               "llama",
			Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
			LocalInvokeProfileId: "invoke",
			Capabilities:         []string{"chat"},
		}},
	}}}
	svc.localModel = installedLister
	if err := svc.validateLocalModelRequest(context.Background(), "local/qwen-installed", nil, runtimev1.Modal_MODAL_UNSPECIFIED); err != nil {
		t.Fatalf("expected installed local model validation success via warm, got %v", err)
	}
	if installedLister.warmCalls != 1 {
		t.Fatalf("expected installed model to trigger warm, got %d", installedLister.warmCalls)
	}

	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "local-failed-warm",
				AssetId:      "qwen-failed-warm",
				Engine:       "llama",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
				Capabilities: []string{"chat"},
			}},
		}},
		warmErr: errors.New("warm failed"),
	}
	err = svc.validateLocalModelRequest(context.Background(), "local/qwen-failed-warm", nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected warm failure to map to local model unavailable, got=%v ok=%v", reason, ok)
	}

	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "local-speech-start",
				AssetId:      "speech/qwen3tts",
				Engine:       "speech",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
				Capabilities: []string{"audio.synthesize"},
			}},
		}},
		startErr: grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_SPEECH_HOST_INIT_FAILED),
	}
	err = svc.validateLocalModelRequest(context.Background(), "speech/qwen3tts", nil, runtimev1.Modal_MODAL_TTS)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SPEECH_HOST_INIT_FAILED {
		t.Fatalf("expected structured speech host failure to be preserved, got=%v ok=%v err=%v", reason, ok, err)
	}

	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "local-speech-degraded",
				AssetId:      "speech/whisper-large-v3",
				Engine:       "speech",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
				Capabilities: []string{"audio.transcribe"},
			}},
		}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId: "local-speech-degraded",
				AssetId:      "speech/whisper-large-v3",
				Engine:       "speech",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
				Capabilities: []string{"audio.transcribe"},
				HealthDetail: `speech probe missing required capability "audio.transcribe" for "speech/whisper-large-v3"; available_capabilities=audio.synthesize`,
				ReasonCode:   runtimev1.ReasonCode_AI_LOCAL_SPEECH_BUNDLE_DEGRADED,
			},
		},
	}
	err = svc.validateLocalModelRequest(context.Background(), "speech/whisper-large-v3", nil, runtimev1.Modal_MODAL_STT)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SPEECH_BUNDLE_DEGRADED {
		t.Fatalf("expected structured speech bundle degraded reason to be preserved, got=%v ok=%v err=%v", reason, ok, err)
	}

	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "local-speech-capability-download",
				AssetId:      "speech/qwen3tts",
				Engine:       "speech",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED,
				Capabilities: []string{"audio.synthesize"},
			}},
		}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId: "local-speech-capability-download",
				AssetId:      "speech/qwen3tts",
				Engine:       "speech",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
				Capabilities: []string{"audio.synthesize"},
				HealthDetail: `speech probe missing expected model "speech/qwen3tts"; available_models=speech/qwen3-asr`,
				ReasonCode:   runtimev1.ReasonCode_AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED,
			},
		},
	}
	err = svc.validateLocalModelRequest(context.Background(), "speech/qwen3tts", nil, runtimev1.Modal_MODAL_TTS)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED {
		t.Fatalf("expected structured speech capability download reason to be preserved, got=%v ok=%v err=%v", reason, ok, err)
	}

	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId: "local-speech-projected-unhealthy",
				AssetId:      "speech/qwen3tts",
				Engine:       "speech",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
				Capabilities: []string{"audio.synthesize"},
				HealthDetail: `speech probe missing expected model "speech/qwen3tts"; available_models=speech/qwen3-asr`,
				ReasonCode:   runtimev1.ReasonCode_AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED,
			}},
		}},
	}
	err = svc.validateLocalModelRequest(context.Background(), "speech/qwen3tts", nil, runtimev1.Modal_MODAL_TTS)
	reason, ok = grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED {
		t.Fatalf("expected unhealthy speech projection reason to be preserved, got=%v ok=%v err=%v", reason, ok, err)
	}
}

func TestLocalModelValidationLogsUseIdentityRefs(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	svc := newTestService(logger)
	svc.localModel = &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{{
				LocalAssetId:         "01KTEX08DS2GR9HJ1X3R459P1B",
				AssetId:              "local-import/gemma-4-26B-A4B-it-Q8_0",
				LogicalModelId:       "nimi/gemma-4-26b-it",
				Engine:               "llama",
				Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				LocalInvokeProfileId: "invoke",
				Capabilities:         []string{"text.generate"},
			}},
		}},
		managedNames: map[string]string{
			"local-import/gemma-4-26B-A4B-it-Q8_0": "local-import/gemma-4-26B-A4B-it-Q8_0",
		},
	}

	if _, err := svc.prepareLocalModelExecutionPlan(context.Background(), "local-import/gemma-4-26B-A4B-it-Q8_0", nil, runtimev1.Modal_MODAL_TEXT, nil); err != nil {
		t.Fatalf("prepareLocalModelExecutionPlan: %v", err)
	}

	output := logs.String()
	for _, want := range []string{
		"requested_model_ref=local-import/gemma-4-26B-A4B-it-Q8_0",
		"resolved_model_ref=local-import/gemma-4-26B-A4B-it-Q8_0",
		"selected_asset_id=local-import/gemma-4-26B-A4B-it-Q8_0",
		"selected_local_asset_id=01KTEX08DS2GR9HJ1X3R459P1B",
		"selected_logical_model_id=nimi/gemma-4-26b-it",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("expected validation logs to contain %q, got:\n%s", want, output)
		}
	}
	for _, forbidden := range []string{"requested_model_id=", "resolved_model_id=", " local_asset_id="} {
		if strings.Contains(output, forbidden) {
			t.Fatalf("validation logs must not use ambiguous identity label %q, got:\n%s", forbidden, output)
		}
	}
}

func TestValidateLocalModelRequestRejectsUnsupportedExplicitEngineModal(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{
			{AssetId: "wan2.2", Engine: "llama", LocalInvokeProfileId: "invoke"},
		},
	}}}

	err := svc.validateLocalModelRequest(context.Background(), "llama/wan2.2", nil, runtimev1.Modal_MODAL_VIDEO)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("expected route unsupported, got=%v ok=%v", reason, ok)
	}
}

func TestValidateLocalModelRequestIncludesUnhealthyDetail(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	svc.localModel = &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			AssetId:      "unsloth/Z-Image-Turbo-GGUF",
			Engine:       "media",
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			HealthDetail: "media supervised mode requires a CUDA-ready NVIDIA runtime",
		}},
	}}}

	err := svc.validateLocalModelRequest(context.Background(), "local/unsloth/Z-Image-Turbo-GGUF", nil, runtimev1.Modal_MODAL_IMAGE)
	reason, ok := grpcerr.ExtractReasonCode(err)
	if !ok || reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("expected local model unavailable, got=%v ok=%v", reason, ok)
	}
	if err == nil || !strings.Contains(err.Error(), "inspect_local_runtime_model_health") {
		t.Fatalf("expected action hint in structured error payload, got %v", err)
	}
	if err == nil || !strings.Contains(err.Error(), "CUDA-ready NVIDIA runtime") {
		t.Fatalf("expected unhealthy detail in structured error payload, got %v", err)
	}
}

func TestValidateLocalModelRequestUnhealthySupervisedLlamaRetriesStartAndRecovers(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	svc := newTestService(logger)
	lister := &fakeLocalModelLister{responses: []*runtimev1.ListLocalAssetsResponse{{
		Assets: []*runtimev1.LocalAssetRecord{{
			LocalAssetId: "local-llama-idle",
			AssetId:      "local-import/gemma-4-26B-A4B-it-Q8_0",
			Engine:       "llama",
			Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			Capabilities: []string{"chat"},
			Endpoint:     "http://127.0.0.1:1234/v1",
			HealthDetail: `probe request failed: Get "probe_endpoint": dial tcp 127.0.0.1:1234: connect: connection refused; plane=local-supervised; consecutive_failures=3; next_probe_in=30s`,
		}},
	}},
		startResp: &runtimev1.StartLocalAssetResponse{
			Asset: &runtimev1.LocalAssetRecord{
				LocalAssetId: "local-llama-idle",
				AssetId:      "local-import/gemma-4-26B-A4B-it-Q8_0",
				Engine:       "llama",
				Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				Capabilities: []string{"chat"},
				Endpoint:     "http://127.0.0.1:1234/v1",
				HealthDetail: "managed local model ready",
			},
		},
	}
	svc.localModel = lister

	if err := svc.validateLocalModelRequest(context.Background(), "local/local-import/gemma-4-26B-A4B-it-Q8_0", nil, runtimev1.Modal_MODAL_TEXT); err != nil {
		t.Fatalf("expected unhealthy supervised llama idle probe to recover via start, got %v", err)
	}
	if lister.startCalls != 1 {
		t.Fatalf("expected unhealthy supervised llama local model to retry start once, got %d", lister.startCalls)
	}
}

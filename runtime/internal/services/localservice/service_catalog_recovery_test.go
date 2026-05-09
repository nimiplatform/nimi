package localservice

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestSearchCatalogModelsMergesVerifiedAndHuggingFaceSorted(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{
			{
				ItemId:       "hf_zeta_model",
				Source:       "huggingface",
				Title:        "Zeta Model",
				ModelId:      "org/zeta-model",
				Repo:         "org/zeta-model",
				Capabilities: []string{"chat"},
				Engine:       "llama",
				Verified:     false,
			},
			{
				ItemId:       "hf_alpha_model",
				Source:       "huggingface",
				Title:        "Alpha Community",
				ModelId:      "org/alpha-community",
				Repo:         "org/alpha-community",
				Capabilities: []string{"chat"},
				Engine:       "llama",
				Verified:     false,
			},
		}, nil
	}

	resp, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query: "",
	})
	if err != nil {
		t.Fatalf("search catalog models: %v", err)
	}
	if len(resp.GetItems()) < 4 {
		t.Fatalf("expected merged verified+hf items, got %d", len(resp.GetItems()))
	}
	firstHFIndex := -1
	for index, item := range resp.GetItems() {
		if !item.GetVerified() {
			firstHFIndex = index
			break
		}
	}
	if firstHFIndex < 0 {
		t.Fatalf("expected huggingface items in merged results")
	}
	for _, item := range resp.GetItems()[:firstHFIndex] {
		if !item.GetVerified() {
			t.Fatalf("verified items must come first")
		}
	}
	hfItems := resp.GetItems()[firstHFIndex:]
	if len(hfItems) < 2 {
		t.Fatalf("expected at least two huggingface items, got %d", len(hfItems))
	}
	if hfItems[0].GetVerified() || hfItems[1].GetVerified() {
		t.Fatalf("hf items must follow verified items")
	}
	if hfItems[0].GetTitle() != "Alpha Community" || hfItems[1].GetTitle() != "Zeta Model" {
		t.Fatalf("hf items should sort by title asc, got [%s, %s]", hfItems[0].GetTitle(), hfItems[1].GetTitle())
	}
}

func TestSearchCatalogModelsDedupesByModelAndEngine(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return []*runtimev1.LocalCatalogModelDescriptor{
			{
				ItemId:       "hf_dup_llama",
				Source:       "huggingface",
				Title:        "Community Llama Dup",
				ModelId:      "local/llama3.1",
				Repo:         "nimiplatform/llama3.1-8b-instruct",
				Capabilities: []string{"chat"},
				Engine:       "llama",
				Verified:     false,
			},
		}, nil
	}

	resp, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{})
	if err != nil {
		t.Fatalf("search catalog models: %v", err)
	}
	count := 0
	for _, item := range resp.GetItems() {
		if item.GetModelId() == "local/llama3.1" && strings.EqualFold(item.GetEngine(), "llama") {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected deduped model count=1 for local/llama3.1 llama, got %d", count)
	}
}

func TestSearchCatalogModelsHFFailureReturnsReasonCode(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = func(_ context.Context, _ hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		return nil, fmt.Errorf("hf timeout")
	}

	_, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query: "llama",
	})
	if err == nil {
		t.Fatalf("expected hf search failure")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.Unavailable {
		t.Fatalf("expected Unavailable, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_HF_SEARCH_FAILED.String() {
		t.Fatalf("unexpected reason code: %s", st.Message())
	}
}

func TestSearchCatalogModelsInvalidHFRepoQueryReturnsReasonCode(t *testing.T) {
	svc := newTestService(t)
	svc.hfCatalogSearch = defaultHFCatalogSearch

	_, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query: "hf://invalid_repo_format",
	})
	if err == nil {
		t.Fatalf("expected invalid hf repo error")
	}
	st, _ := status.FromError(err)
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument, got %v", st.Code())
	}
	if st.Message() != runtimev1.ReasonCode_AI_LOCAL_HF_REPO_INVALID.String() {
		t.Fatalf("unexpected reason code: %s", st.Message())
	}
}

func TestSearchCatalogModelsPassesHFRequestShape(t *testing.T) {
	svc := newTestService(t)
	captured := hfCatalogSearchRequest{}
	svc.hfCatalogSearch = func(_ context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
		captured = req
		return []*runtimev1.LocalCatalogModelDescriptor{}, nil
	}

	if _, err := svc.SearchCatalogModels(context.Background(), &runtimev1.SearchCatalogModelsRequest{
		Query:        "Llama",
		Capability:   "image",
		EngineFilter: "media",
		PageSize:     7,
	}); err != nil {
		t.Fatalf("search catalog models: %v", err)
	}

	if captured.Query != "llama" {
		t.Fatalf("query should be normalized to lowercase, got %q", captured.Query)
	}
	if captured.Capability != "image" {
		t.Fatalf("capability mismatch: %q", captured.Capability)
	}
	if captured.EngineFilter != "media" {
		t.Fatalf("engine filter mismatch: %q", captured.EngineFilter)
	}
	if captured.Limit != 7 {
		t.Fatalf("hf limit mismatch: got=%d want=7", captured.Limit)
	}
}

func TestHFCatalogUnknownPipelineFailsClosed(t *testing.T) {
	if capabilities := inferCapabilitiesFromHF("unknown-pipeline", nil); len(capabilities) != 0 {
		t.Fatalf("unknown pipeline must not fall back to chat, got %v", capabilities)
	}

	item, ok := mapHFRowToCatalogItem(hfModelSearchEntry{
		ID:          "org/unknown-pipeline-model",
		ModelID:     "org/unknown-pipeline-model",
		PipelineTag: "unknown-pipeline",
	}, "")
	if ok || item != nil {
		t.Fatalf("unknown pipeline row must be blocked, got ok=%v item=%v", ok, item)
	}
}

func TestLocalRecoverySweepPromotesUnhealthyModel(t *testing.T) {
	healthy := false
	svc := newTestServiceWithProbe(t, func(_ context.Context, _ string) endpointProbeResult {
		if healthy {
			return endpointProbeResult{healthy: true, detail: "ok"}
		}
		return endpointProbeResult{healthy: false, detail: "startup failed"}
	})
	installed := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/recovery-sweep-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	localModelID := installed.GetLocalAssetId()
	started, err := svc.StartLocalAsset(context.Background(), &runtimev1.StartLocalAssetRequest{
		LocalAssetId: localModelID,
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetAsset().GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("expected unhealthy after startup failure, got %s", started.GetAsset().GetStatus())
	}

	healthy = true
	for i := 1; i <= 2; i++ {
		svc.mu.Lock()
		state := svc.assetProbeState[localModelID]
		if state == nil {
			t.Fatalf("expected model probe state to exist")
		}
		state.lastProbeAt = time.Now().UTC().Add(-localRecoveryDefaultProbeInterval)
		svc.mu.Unlock()
		svc.runRecoverySweep(context.Background())

		current := svc.modelByID(localModelID)
		if current == nil {
			t.Fatalf("model should still exist")
		}
		if current.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
			t.Fatalf("recovery sweep #%d should keep UNHEALTHY before threshold, got %s", i, current.GetStatus())
		}
	}

	svc.mu.Lock()
	state := svc.assetProbeState[localModelID]
	if state == nil {
		svc.mu.Unlock()
		t.Fatalf("expected model probe state to exist before final sweep")
	}
	state.lastProbeAt = time.Now().UTC().Add(-localRecoveryDefaultProbeInterval)
	svc.mu.Unlock()
	svc.runRecoverySweep(context.Background())

	current := svc.modelByID(localModelID)
	if current == nil {
		t.Fatalf("model should still exist")
	}
	if current.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("expected ACTIVE after third successful recovery sweep, got %s", current.GetStatus())
	}
}

func TestProbeLocalModelEndpointJoinsConcurrentSameAssetProbe(t *testing.T) {
	probeStarted := make(chan struct{}, 2)
	releaseProbe := make(chan struct{})
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeStarted <- struct{}{}
		<-releaseProbe
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{"local/concurrent-probe-model"},
		}
	})
	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "local-asset-concurrent-probe",
		AssetId:      "local/concurrent-probe-model",
		Engine:       "llama",
		Endpoint:     "http://127.0.0.1:18888/v1",
	}

	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			probe := svc.probeLocalModelEndpoint(context.Background(), model, model.GetEndpoint())
			if !probe.healthy || !probe.responded {
				errs <- fmt.Errorf("probe = healthy:%v responded:%v, want healthy/responded", probe.healthy, probe.responded)
				return
			}
			errs <- nil
		}()
	}

	select {
	case <-probeStarted:
	case <-time.After(time.Second):
		t.Fatal("expected first probe to start")
	}
	select {
	case <-probeStarted:
		t.Fatal("concurrent same-asset health checks must join the in-flight probe")
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseProbe)

	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatalf("concurrent health check %d failed: %v", i+1, err)
		}
	}
	if got := len(probeStarted); got != 0 {
		t.Fatalf("unexpected additional probe calls after join: %d", got)
	}
}

func TestLocalRecoverySweepManagedSpeechProjectsColdAfterThreshold(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{"speech/kokoro-tts-model"},
			modelCaps: map[string][]string{
				"speech/kokoro-tts-model": {"audio.synthesize"},
			},
		}
	})
	svc.SetManagedSpeechEndpoint("http://127.0.0.1:18330/v1")

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-tts-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
		files:        []string{"model.onnx", "voices.json"},
	})
	writeManagedBundleFilesForTest(t, svc, installed, []string{"model.onnx", "voices.json"}, map[string][]byte{
		"model.onnx":  []byte("fake-onnx"),
		"voices.json": []byte(`{"voices":["af"]}`),
	})
	if _, err := svc.updateModelAvailabilityAndWarmState(
		installed.GetLocalAssetId(),
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
		"seed unhealthy",
		true,
	); err != nil {
		t.Fatalf("seed supervised speech unhealthy state: %v", err)
	}

	for i := 1; i <= 2; i++ {
		if i > 1 {
			svc.mu.Lock()
			state := svc.assetProbeState[installed.GetLocalAssetId()]
			if state == nil {
				svc.mu.Unlock()
				t.Fatal("expected speech probe state to exist")
			}
			state.lastProbeAt = time.Now().UTC().Add(-localRecoveryDefaultProbeInterval)
			svc.mu.Unlock()
		}
		svc.runRecoverySweep(context.Background())

		current := svc.modelByID(installed.GetLocalAssetId())
		if current == nil {
			t.Fatal("speech asset should still exist")
		}
		if current.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
			t.Fatalf("speech recovery sweep #%d status = %s, want UNHEALTHY", i, current.GetStatus())
		}
		if current.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED {
			t.Fatalf("speech recovery sweep #%d warm_state = %s, want FAILED", i, current.GetWarmState())
		}
	}

	svc.mu.Lock()
	state := svc.assetProbeState[installed.GetLocalAssetId()]
	if state == nil {
		svc.mu.Unlock()
		t.Fatal("expected speech probe state before final sweep")
	}
	state.lastProbeAt = time.Now().UTC().Add(-localRecoveryDefaultProbeInterval)
	svc.mu.Unlock()
	svc.runRecoverySweep(context.Background())

	current := svc.modelByID(installed.GetLocalAssetId())
	if current == nil {
		t.Fatal("speech asset should still exist")
	}
	if current.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("speech recovery sweep final status = %s, want ACTIVE", current.GetStatus())
	}
	if current.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("speech recovery sweep final warm_state = %s, want COLD", current.GetWarmState())
	}
	if current.GetHealthDetail() != managedLocalModelColdDetail() {
		t.Fatalf("speech recovery sweep final detail = %q", current.GetHealthDetail())
	}
}

func TestListLocalAssetsManagedSpeechDoesNotProbeOrMutateState(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls++
		return endpointProbeResult{
			healthy:  false,
			detail:   fmt.Sprintf("probe request failed: Get %q: connection refused", endpoint),
			probeURL: endpoint,
		}
	})
	svc.SetManagedSpeechEndpoint("http://127.0.0.1:18330/v1")

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-tts-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
		files:        []string{"model.onnx", "voices.json"},
	})
	writeManagedBundleFilesForTest(t, svc, installed, []string{"model.onnx", "voices.json"}, map[string][]byte{
		"model.onnx":  []byte("fake-onnx"),
		"voices.json": []byte(`{"voices":["af"]}`),
	})
	if _, err := svc.updateModelAvailabilityAndWarmState(
		installed.GetLocalAssetId(),
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY,
		managedLocalModelReadyDetail(),
		true,
	); err != nil {
		t.Fatalf("seed managed speech active state: %v", err)
	}

	resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
	if err != nil {
		t.Fatalf("ListLocalAssets: %v", err)
	}
	if len(resp.GetAssets()) != 1 {
		t.Fatalf("expected one managed speech asset, got %d", len(resp.GetAssets()))
	}
	row := resp.GetAssets()[0]
	if row.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("list row status = %s, want ACTIVE", row.GetStatus())
	}
	if row.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY {
		t.Fatalf("list row warm_state = %s, want READY", row.GetWarmState())
	}
	if row.GetHealthDetail() != managedLocalModelReadyDetail() {
		t.Fatalf("list row detail = %q, want ready detail", row.GetHealthDetail())
	}
	if probeCalls != 0 {
		t.Fatalf("ListLocalAssets must not probe managed speech endpoint, got %d probe calls", probeCalls)
	}

	stored := svc.modelByID(installed.GetLocalAssetId())
	if stored == nil {
		t.Fatal("expected stored managed speech asset")
	}
	if stored.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("stored status = %s, want ACTIVE", stored.GetStatus())
	}
	if stored.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_READY {
		t.Fatalf("stored warm_state = %s, want READY", stored.GetWarmState())
	}

	svc.runRecoverySweep(context.Background())

	stored = svc.modelByID(installed.GetLocalAssetId())
	if stored == nil {
		t.Fatal("expected stored managed speech asset after recovery sweep")
	}
	if stored.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
		t.Fatalf("stored status after recovery sweep = %s, want ACTIVE", stored.GetStatus())
	}
	if stored.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
		t.Fatalf("stored warm_state after recovery sweep = %s, want COLD", stored.GetWarmState())
	}
	if !strings.Contains(stored.GetHealthDetail(), "connection refused") {
		t.Fatalf("stored detail after recovery sweep = %q, want probe failure detail", stored.GetHealthDetail())
	}
	if probeCalls != 1 {
		t.Fatalf("recovery sweep should own the single managed speech probe, got %d probe calls", probeCalls)
	}
}

func TestListLocalAssetsDoesNotDriveManagedSpeechRecovery(t *testing.T) {
	probeCalls := 0
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probeCalls++
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{"speech/kokoro-tts-model"},
			modelCaps: map[string][]string{
				"speech/kokoro-tts-model": {"audio.synthesize"},
			},
		}
	})
	svc.SetManagedSpeechEndpoint("http://127.0.0.1:18330/v1")

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "speech/kokoro-tts-model",
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.onnx",
		files:        []string{"model.onnx", "voices.json"},
	})
	writeManagedBundleFilesForTest(t, svc, installed, []string{"model.onnx", "voices.json"}, map[string][]byte{
		"model.onnx":  []byte("fake-onnx"),
		"voices.json": []byte(`{"voices":["af"]}`),
	})
	if _, err := svc.updateModelAvailabilityAndWarmState(
		installed.GetLocalAssetId(),
		runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
		runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
		"seed unhealthy",
		true,
	); err != nil {
		t.Fatalf("seed managed speech unhealthy state: %v", err)
	}

	for i := 1; i <= 3; i++ {
		resp, err := svc.ListLocalAssets(context.Background(), &runtimev1.ListLocalAssetsRequest{})
		if err != nil {
			t.Fatalf("ListLocalAssets #%d: %v", i, err)
		}
		if len(resp.GetAssets()) != 1 {
			t.Fatalf("expected one managed speech asset at list #%d, got %d", i, len(resp.GetAssets()))
		}
		row := resp.GetAssets()[0]
		if row.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
			t.Fatalf("list #%d status = %s, want UNHEALTHY", i, row.GetStatus())
		}
	}
	if probeCalls != 0 {
		t.Fatalf("ListLocalAssets must not drive managed speech recovery, got %d probe calls", probeCalls)
	}
	if state := svc.assetProbeState[installed.GetLocalAssetId()]; state != nil {
		t.Fatalf("ListLocalAssets must not create recovery state, got %+v", state)
	}

	svc.runRecoverySweep(context.Background())
	if probeCalls != 1 {
		t.Fatalf("recovery sweep should perform first managed speech probe, got %d", probeCalls)
	}
	current := svc.modelByID(installed.GetLocalAssetId())
	if current == nil {
		t.Fatal("speech asset should still exist")
	}
	if current.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY {
		t.Fatalf("first recovery sweep status = %s, want UNHEALTHY", current.GetStatus())
	}
}

func TestLocalRecoverySweepSanitizesModelProbeMetadata(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   fmt.Sprintf("probe request failed: Get %q: connection refused", endpoint),
			probeURL: endpoint,
		}
	})
	svc.SetEngineManager(&mockEngineManager{
		startErr: fmt.Errorf("bootstrap failed for /tmp/private-recovery-model on 127.0.0.1:1234"),
	})

	installed := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/recovery-model-sanitize",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	localModelID := installed.GetLocalAssetId()
	if _, err := svc.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE, "model active"); err != nil {
		t.Fatalf("promote model to active: %v", err)
	}
	if _, err := svc.updateModelStatus(localModelID, runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY, "model unhealthy"); err != nil {
		t.Fatalf("promote model to unhealthy: %v", err)
	}

	svc.runRecoverySweep(context.Background())

	current := svc.modelByID(localModelID)
	if current == nil {
		t.Fatal("model should still exist")
	}
	detail := current.GetHealthDetail()
	if !strings.Contains(detail, "bootstrap_error=managed_engine_bootstrap_failed") {
		t.Fatalf("expected sanitized bootstrap marker, got %q", detail)
	}
	if !strings.Contains(detail, "plane=local-supervised") {
		t.Fatalf("expected supervised plane marker, got %q", detail)
	}
	if strings.Contains(detail, "/tmp/private-recovery-model") {
		t.Fatalf("recovery detail should not leak filesystem paths: %q", detail)
	}
	if strings.Contains(detail, "http://127.0.0.1:1234") {
		t.Fatalf("recovery detail should not leak raw probe urls: %q", detail)
	}
	if strings.Contains(detail, "probe_url=") {
		t.Fatalf("recovery detail should not emit raw probe_url markers: %q", detail)
	}
}

func TestLocalRecoverySweepSanitizesServiceProbeMetadata(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:  false,
			detail:   fmt.Sprintf("probe request failed: Get %q: connection refused", endpoint),
			probeURL: endpoint,
		}
	})
	svc.SetEngineManager(&mockEngineManager{
		startErr: fmt.Errorf("bootstrap failed for /tmp/private-recovery-service on 127.0.0.1:1234"),
	})

	modelResp := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/recovery-service-sanitize-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-recovery-sanitize",
		Engine:       "llama",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.updateServiceStatus("svc-recovery-sanitize", runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_ACTIVE, "service active"); err != nil {
		t.Fatalf("promote service to active: %v", err)
	}
	if _, err := svc.updateServiceStatus("svc-recovery-sanitize", runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY, "service unhealthy"); err != nil {
		t.Fatalf("promote service to unhealthy: %v", err)
	}

	svc.runRecoverySweep(context.Background())

	current := svc.serviceByID("svc-recovery-sanitize")
	if current == nil {
		t.Fatal("service should still exist")
	}
	detail := current.GetDetail()
	if !strings.Contains(detail, "bootstrap_error=managed_engine_bootstrap_failed") {
		t.Fatalf("expected sanitized bootstrap marker, got %q", detail)
	}
	if !strings.Contains(detail, "plane=local-supervised") {
		t.Fatalf("expected supervised plane marker, got %q", detail)
	}
	if strings.Contains(detail, "/tmp/private-recovery-service") {
		t.Fatalf("recovery detail should not leak filesystem paths: %q", detail)
	}
	if strings.Contains(detail, "http://127.0.0.1:1234") {
		t.Fatalf("recovery detail should not leak raw probe urls: %q", detail)
	}
	if strings.Contains(detail, "probe_url=") {
		t.Fatalf("recovery detail should not emit raw probe_url markers: %q", detail)
	}
}

func TestCollectUnhealthyRecoveryTargetsSnapshotsRuntimeModes(t *testing.T) {
	svc := newTestService(t)
	svc.mu.Lock()
	svc.assets["model-1"] = &runtimev1.LocalAssetRecord{
		LocalAssetId: "model-1",
		AssetId:      "local/recovery-snapshot-model",
		Status:       runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
	}
	svc.assetRuntimeModes["model-1"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
	svc.services["service-1"] = &runtimev1.LocalServiceDescriptor{
		ServiceId: "service-1",
		Engine:    "media",
		Status:    runtimev1.LocalServiceStatus_LOCAL_SERVICE_STATUS_UNHEALTHY,
	}
	svc.serviceRuntimeModes["service-1"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	svc.mu.Unlock()

	models, services := svc.collectUnhealthyRecoveryTargets()
	svc.mu.Lock()
	svc.assetRuntimeModes["model-1"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT
	svc.serviceRuntimeModes["service-1"] = runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED
	svc.mu.Unlock()

	if len(models) != 1 || models[0].mode != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED {
		t.Fatalf("expected model runtime mode snapshot to preserve original value, got %#v", models)
	}
	if len(services) != 1 || services[0].mode != runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT {
		t.Fatalf("expected service runtime mode snapshot to preserve original value, got %#v", services)
	}
}

func TestLocalRecoveryProbeIntervalBackoff(t *testing.T) {
	now := time.Now().UTC()
	if got := recoveryProbeInterval(now, &probeRecoveryState{
		consecutiveFailure: localRecoverySlowFailureThreshold,
		firstFailureAt:     now.Add(-2 * time.Hour),
		lastProbeAt:        now,
	}); got != localRecoverySlowProbeInterval {
		t.Fatalf("expected slow probe interval, got %s", got)
	}

	if got := recoveryProbeInterval(now, &probeRecoveryState{
		consecutiveFailure: localRecoverySlowFailureThreshold + 1000,
		firstFailureAt:     now.Add(-25 * time.Hour),
		lastProbeAt:        now,
	}); got != localRecoveryLongFailProbeInterval {
		t.Fatalf("expected long-fail probe interval, got %s", got)
	}
}

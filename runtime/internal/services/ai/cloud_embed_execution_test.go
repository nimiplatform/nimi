package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCloudEmbedExecutionUsesCapturedAIConfigConnectorWithoutFallback(t *testing.T) {
	var calls atomic.Int32
	var failAuth atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/embeddings" && r.URL.Path != "/v1/embeddings" {
			http.NotFound(w, r)
			return
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("request-scoped credential header = %q", got)
		}
		if failAuth.Load() {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid api key"}}`))
			return
		}
		var body struct {
			Model string   `json:"model"`
			Input []string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode embedding request: %v", err)
		}
		if body.Model != "text-embedding-3-small" || len(body.Input) != 2 || body.Input[0] != "first" || body.Input[1] != "second" {
			t.Fatalf("mapped embedding request = %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		first, second := make([]float64, 1536), make([]float64, 1536)
		first[0], first[1], second[0], second[1] = 0.1, 0.2, 0.3, 0.4
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"embedding": first, "index": 0}, map[string]any{"embedding": second, "index": 1}}, "usage": map[string]any{"prompt_tokens": 3, "total_tokens": 3}})
	}))
	defer server.Close()

	fixture := newManagedCloudScenarioTestFixture(t, "openai", "text-embedding-3-small", server.URL, Config{
		CloudProviders:        map[string]nimillm.ProviderCredentials{},
		AllowLoopbackEndpoint: true,
	})
	catalog, err := aicatalog.NewResolver(aicatalog.ResolverConfig{CustomDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	fixture.service.speechCatalog = catalog
	fixture.connectorService.SetModelCatalogResolver(catalog)
	target, err := structpb.NewStruct(map[string]any{
		"provider":             "openai",
		"providerModelId":      fixture.descriptor.GetProviderModelId(),
		"remoteModelCatalogId": fixture.descriptor.GetRemoteModelCatalogId(),
	})
	if err != nil {
		t.Fatal(err)
	}
	config := appAIConfig("app.embed", &runtimev1.AIConfigCapabilityIntent{
		CapabilityContract: "text.embed",
		Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
			ConnectorRef: fixture.connectorID,
			Implementation: &runtimev1.CapabilityImplementationIdentity{
				ImplementationId: "cloud.text.embed.openai",
				DriverId:         "nimi.runtime.driver.openai",
				DriverDialect:    "openai/embeddings/v1",
			},
			ProviderModelTarget: target,
		}},
	})
	ctx := scenarioJobUserContext("app.embed", "user-001")
	if err := overwriteAIConfigStoreForTest(ctx, fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatalf("store AIConfig: %v", err)
	}
	request := &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.embed", SubjectUserId: "user-001", TimeoutMs: 10_000},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{Purpose: runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT,
			Inputs: []string{" first ", "second"},
		}}},
	}
	response, err := fixture.service.ExecuteScenario(ctx, request)
	if err != nil {
		t.Fatalf("ExecuteScenario(text.embed): %v", err)
	}
	vectors := response.GetOutput().GetTextEmbed().GetVectors()
	if response.GetOutput().GetTextEmbed().GetSpaceId() == "" {
		t.Fatal("embedding response omitted its vector space")
	}
	if len(vectors) != 2 || len(vectors[0].GetValues()) != 1536 || vectors[1].GetValues()[1] != 0.4 {
		t.Fatalf("embedding vectors = %+v", vectors)
	}
	if response.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || response.GetModelResolved() != "text-embedding-3-small" {
		t.Fatalf("embedding diagnostics = route %v model %q", response.GetRouteDecision(), response.GetModelResolved())
	}
	if response.GetUsage().GetInputTokens() != 3 {
		t.Fatalf("embedding usage = %+v", response.GetUsage())
	}
	spaceID := response.GetOutput().GetTextEmbed().GetSpaceId()

	// Admission tracks the whole inventory, but a chat-only catalog change
	// must not change the embedding space after the same target is recommitted.
	_, err = fixture.connectorService.UpsertModelCatalogProvider(fixture.context, &runtimev1.UpsertModelCatalogProviderRequest{
		Provider: "openai",
		Yaml: `version: 1
provider: openai
catalog_version: chat-only-update
models:
  - provider: openai
    model_id: additional-chat-model
    model_type: chat
    updated_at: "2026-09-13"
    capabilities: [text.generate]
    pricing:
      unit: token
      input: "unknown"
      output: "unknown"
      currency: USD
      as_of: "2026-09-13"
      notes: chat catalog fixture
    source_ref:
      url: https://example.com/chat-model
      retrieved_at: "2026-09-13"
      note: chat catalog fixture
voices: []
`,
	})
	if err != nil {
		t.Fatalf("update chat catalog: %v", err)
	}
	_, err = fixture.service.ExecuteScenario(ctx, request)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_REMOTE_MODEL_CATALOG_STALE || calls.Load() != 1 {
		t.Fatalf("stale catalog must fail before dispatch: calls=%d err=%v", calls.Load(), err)
	}
	descriptor := connectorModelDescriptorForAITest(t, fixture.connectorService, fixture.context, fixture.connectorID, "text-embedding-3-small")
	target.Fields["remoteModelCatalogId"] = structpb.NewStringValue(descriptor.GetRemoteModelCatalogId())
	if err := overwriteAIConfigStoreForTest(ctx, fixture.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatalf("recommit embedding target: %v", err)
	}
	response, err = fixture.service.ExecuteScenario(ctx, request)
	if err != nil {
		t.Fatalf("embed after catalog refresh: %v", err)
	}
	if got := response.GetOutput().GetTextEmbed().GetSpaceId(); got != spaceID {
		t.Fatalf("chat-only catalog change invalidated embedding space: before=%q after=%q", spaceID, got)
	}

	failAuth.Store(true)
	_, err = fixture.service.ExecuteScenario(ctx, request)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("embedding auth reason = %v present=%v err=%v", reason, ok, err)
	}
	failAuth.Store(false)
	if calls.Load() != 3 {
		t.Fatalf("provider calls = %d, want exactly three and no fallback dispatch", calls.Load())
	}
}

func TestCloudEmbedNativeDimensionsCaptureOutputAndRestoreContract(t *testing.T) {
	var calls atomic.Int32
	var wrongWidth atomic.Bool
	var reportedUsage atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			Dimensions *uint32  `json:"dimensions"`
			Input      []string `json:"input"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		width := 1536
		if body.Dimensions != nil {
			width = int(*body.Dimensions)
		}
		if wrongWidth.Load() {
			width++
		}
		data := make([]any, len(body.Input))
		for index := range data {
			data[index] = map[string]any{"index": index, "embedding": make([]float64, width)}
		}
		response := map[string]any{"data": data}
		if reportedUsage.Load() {
			response["usage"] = map[string]any{"prompt_tokens": 7, "total_tokens": 7}
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "openai", "text-embedding-3-small", server.URL, Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "openai", "providerModelId": f.descriptor.GetProviderModelId(), "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
	config := appAIConfig("app.embed", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.embed", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
		ConnectorRef: f.connectorID, ProviderModelTarget: target,
		Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "cloud.text.embed.openai", DriverId: "nimi.runtime.driver.openai", DriverDialect: "openai/embeddings/v1"},
	}}})
	ctx := scenarioJobUserContext("app.embed", "user-001")
	if err := overwriteAIConfigStoreForTest(ctx, f.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	spec := &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"hello", "world"}}
	request := &runtimev1.ExecuteScenarioRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app.embed", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: spec}}}
	var defaultSpace, shortSpace string
	for _, width := range []uint32{0, 1536, 256} {
		spec.Dimensions = nil
		if width > 0 {
			spec.Dimensions = proto.Uint32(width)
		}
		response, err := f.service.ExecuteScenario(ctx, request)
		if err != nil {
			t.Fatalf("width %d: %v", width, err)
		}
		output := response.GetOutput().GetTextEmbed()
		expected := int(width)
		if width == 0 {
			expected = 1536
		}
		if len(output.GetVectors()) != 2 || len(output.GetVectors()[0].GetValues()) != expected || response.Usage != nil {
			t.Fatalf("width/usage contract = %+v", response)
		}
		switch width {
		case 0:
			defaultSpace = output.GetSpaceId()
		case 1536:
			if output.GetSpaceId() != defaultSpace {
				t.Fatal("explicit native width changed the embedding space")
			}
		case 256:
			shortSpace = output.GetSpaceId()
		}
	}
	if shortSpace == "" || shortSpace == defaultSpace {
		t.Fatal("different output widths shared an embedding space")
	}
	f.service.scenarioJobs.mu.RLock()
	jobCount := len(f.service.scenarioJobs.jobs)
	f.service.scenarioJobs.mu.RUnlock()
	for _, invalid := range []uint32{0, 1537} {
		spec.Dimensions = proto.Uint32(invalid)
		_, err := f.service.ExecuteScenario(ctx, request)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
			t.Fatalf("invalid width %d: %v", invalid, err)
		}
	}
	f.service.scenarioJobs.mu.RLock()
	if len(f.service.scenarioJobs.jobs) != jobCount {
		t.Error("invalid width published a Job")
	}
	f.service.scenarioJobs.mu.RUnlock()
	if calls.Load() != 3 {
		t.Fatalf("invalid dimensions dispatched: %d calls", calls.Load())
	}
	spec.Dimensions = proto.Uint32(256)
	binding, err := f.service.captureCloudEmbedBinding(ctx, request.Head)
	if err != nil {
		t.Fatal(err)
	}
	binding.dimension = 128
	if _, err := f.service.bindCloudEmbedRequest(ctx, binding, spec); err == nil {
		t.Fatal("request exceeded the captured catalog width")
	}
	effective, err := f.service.captureCloudEmbedEffectiveInputs(ctx, request.Head, request)
	if err != nil {
		t.Fatal(err)
	}
	spec.Inputs[0] = "changed after capture"
	*spec.Dimensions = 1024
	if effective.dimension != 256 || effective.request.GetDimensions() != 256 || effective.request.GetInputs()[0] != "hello" {
		t.Fatal("captured request changed with caller state")
	}
	// Restore a submitted Job before terminal completion releases its custody.
	job, jobCtx, err := f.service.captureImmediateCloudScenarioJob(ctx, request.Head,
		runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		effective.modelResolved(), nil, effective.resolvedAssembly)
	if err != nil {
		t.Fatal(err)
	}
	published, ok := f.service.scenarioJobs.cloudResolvedAssembly(job.GetJobId())
	if !ok {
		t.Fatal("published embedding assembly missing")
	}
	// Restoration consumes the captured width without a current catalog lookup.
	catalog := f.service.speechCatalog
	f.service.speechCatalog = nil
	restored, err := f.service.cloudEmbedEffectiveInputsFromResolvedAssembly(published)
	f.service.speechCatalog = catalog
	if err != nil || restored.dimension != 256 || *restored.mapped.Dimensions() != 256 {
		t.Fatalf("restore = %+v %v", restored, err)
	}
	tampered, err := cloneCloudResolvedAssembly(published)
	if err != nil {
		t.Fatal(err)
	}
	tampered.EmbeddingDimension = 1024
	if _, err := f.service.cloudEmbedEffectiveInputsFromResolvedAssembly(tampered); err == nil {
		t.Fatal("restore accepted a request/captured-width mismatch")
	}
	if _, _, err := f.service.runCapturedCloudEmbedJob(jobCtx, job); err != nil {
		t.Fatalf("execute captured request after caller mutation: %v", err)
	}
	spec.Inputs[0], spec.Dimensions = "hello", proto.Uint32(256)
	wrongWidth.Store(true)
	if _, err := f.service.ExecuteScenario(ctx, request); err == nil {
		t.Fatal("wrong actual width returned successful output")
	}
	wrongWidth.Store(false)
	protectedCtx := accountservice.ContextWithAuthorizedLocalAppDecision(ctx, accountservice.LocalAppCallerDecision{
		AccountID: "user-001", AppID: "app.embed", RegisteredAppSubject: "principal-1",
		Operation: accountservice.LocalAppOperationScenarioExecute, AuthorityClass: localappop.AuthorityClassAppAccess,
		OperationCapability: localappop.AppOperationIDScenarioExecute,
	})
	protectedRequest := &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{
		TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{"hello"}, Dimensions: proto.Uint32(256)},
	}}
	reportedUsage.Store(true)
	response, err := f.service.ExecuteLocalAppScenario(protectedCtx, protectedRequest)
	if err != nil || response.GetTextEmbed().GetUsage().GetInputTokens() != 7 || response.GetTextEmbed().GetUsage().GetOutputTokens() != 0 {
		t.Fatalf("protected reported usage = %+v %v", response, err)
	}
	reportedUsage.Store(false)
	response, err = f.service.ExecuteLocalAppScenario(protectedCtx, protectedRequest)
	if err != nil || response.GetTextEmbed().Usage != nil {
		t.Fatalf("protected missing usage = %+v %v", response, err)
	}
	f.service.scenarioJobs.mu.RLock()
	defer f.service.scenarioJobs.mu.RUnlock()
	completed := 0
	reportedJobs := 0
	for _, record := range f.service.scenarioJobs.jobs {
		if record.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
			completed++
			if record.job.GetUsage() != nil {
				reportedJobs++
				if record.job.GetUsage().GetInputTokens() != 7 || record.job.GetUsage().GetOutputTokens() != 0 {
					t.Fatal("Job usage differs from the provider report")
				}
			}
		}
	}
	if completed != jobCount+3 {
		t.Fatal("wrong actual width reached COMPLETED")
	}
	if reportedJobs != 1 {
		t.Fatal("missing usage was estimated at Job completion")
	}
}

func TestTextEmbedLocalIntentExecutesSelectedLlamaDriver(t *testing.T) {
	service := newTestService(nil)
	digest := strings.Repeat("a", 64)
	service.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: &localexecution.SelectedLocalExecution{
		LoadoutID:                "local-embed-loadout",
		CapabilityContract:       capabilitydriver.TextEmbedCapabilityContract,
		DisplayName:              "Local embedding",
		RecipeID:                 capabilitydriver.LlamaEmbedGGUFRecipeID,
		RecipeRevision:           "1",
		DriverIdentity:           (&capabilitydriver.Identity{ImplementationID: capabilitydriver.LlamaEmbedImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaEmbedDriverDialect}).Proto(),
		ModelContextWindowTokens: 8192, EmbeddingDimension: 2,
		Requirements: []*runtimev1.LocalCapabilityRequirement{{
			RequirementId: capabilitydriver.EmbeddingGGUFRequirementID,
		}},
		ExactBindings: []localexecution.ExactBinding{{EmbeddingInputProtocol: capabilitydriver.EmbeddingInputNativeV1,
			RequirementID:     capabilitydriver.EmbeddingGGUFRequirementID,
			ModelAssetID:      "embedding/test",
			AbsolutePath:      filepath.Join(t.TempDir(), "embedding.gguf"),
			VerifiedContentID: "sha256:" + digest,
			EntrySHA256:       digest,
		}},
		Configured: true,
	}})
	host := &localTextHostStub{embedResult: localexecution.EmbedResult{
		Vectors: []*runtimev1.EmbeddingVector{
			{Values: []float64{0.1, 0.2}},
			{Values: []float64{0.3, 0.4}},
		},
		InputTokens: 3,
	}}
	service.SetLocalTextExecutionHost(host)
	ctx := withLocalScenarioTestIntent(scenarioJobUserContext("app.embed", "user-001"), "text.embed")
	response, err := service.ExecuteScenario(ctx, &runtimev1.ExecuteScenarioRequest{
		Head:          &runtimev1.ScenarioRequestHead{AppId: "app.embed", SubjectUserId: "user-001"},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{Purpose: runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY,
			Inputs: []string{"first", "second"},
		}}},
	})
	if err != nil {
		t.Fatalf("ExecuteScenario(local text.embed): %v", err)
	}
	vectors := response.GetOutput().GetTextEmbed().GetVectors()
	if len(vectors) != 2 || vectors[1].GetValues()[1] != 0.4 ||
		response.GetRouteDecision() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL ||
		response.GetModelResolved() != "Local embedding" || response.GetUsage().GetInputTokens() != 3 {
		t.Fatalf("local embedding response = %+v", response)
	}
	service.scenarioJobs.mu.RLock()
	if len(service.scenarioJobs.jobs) != 1 {
		service.scenarioJobs.mu.RUnlock()
		t.Fatalf("local sync embed persisted jobs = %d, want 1", len(service.scenarioJobs.jobs))
	}
	for _, record := range service.scenarioJobs.jobs {
		if record.job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED || record.resolvedAssembly == nil || record.resolvedAssembly.Request.Kind != "text.embed" {
			service.scenarioJobs.mu.RUnlock()
			t.Fatalf("local sync embed durable capture = %+v assembly=%+v", record.job, record.resolvedAssembly)
		}
	}
	service.scenarioJobs.mu.RUnlock()
	host.mu.Lock()
	plan := host.capturedEmbedPlan
	host.mu.Unlock()
	if plan == nil || plan.RequestPath() != "/v1/embeddings" || plan.ExpectedCount() != 2 {
		t.Fatalf("captured local embedding plan = %+v", plan)
	}
}

package ai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCloudEmbedGeminiNativeProtocolCaptureAndProtectedOutput(t *testing.T) {
	var calls atomic.Int32
	var wrongWidth atomic.Bool
	var missingUsage atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/v1beta/models/gemini-embedding-2:embedContent" || r.Header.Get("Authorization") != "" || r.Header.Get("x-goog-api-key") != "test-key" {
			t.Fatalf("native path/auth: %s", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		cfg := body["embedContentConfig"].(map[string]any)
		if cfg["autoTruncate"] != false || len(body) != 2 {
			t.Fatalf("native request shape: %+v", body)
		}
		parts := body["content"].(map[string]any)["parts"].([]any)
		if len(parts) != 1 {
			t.Fatalf("aggregated input: %+v", parts)
		}
		width := 3072
		if value, ok := cfg["outputDimensionality"]; ok {
			width = int(value.(float64))
		}
		if wrongWidth.Load() {
			width++
		}
		response := map[string]any{"embedding": map[string]any{"values": make([]float64, width)}}
		if !missingUsage.Load() {
			response["usageMetadata"] = map[string]any{"promptTokenCount": 7}
		}
		_ = json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()
	f := newManagedCloudScenarioTestFixture(t, "gemini", "gemini-embedding-2", server.URL+"/v1beta/openai", Config{AllowLoopbackEndpoint: true})
	target, _ := structpb.NewStruct(map[string]any{"provider": "gemini", "providerModelId": f.descriptor.GetProviderModelId(), "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
	config := appAIConfig("app.embed", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.embed", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{
		ConnectorRef: f.connectorID, ProviderModelTarget: target, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "gemini", DriverId: "nimillm", DriverDialect: "gemini"},
	}}})
	ctx := scenarioJobUserContext("app.embed", "user-001")
	if err := overwriteAIConfigStoreForTest(ctx, f.service.aiConfigStore, "user-001", config); err != nil {
		t.Fatal(err)
	}
	spec := &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"hello", "world"}, Purpose: runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT}
	request := &runtimev1.ExecuteScenarioRequest{Head: &runtimev1.ScenarioRequestHead{AppId: "app.embed", SubjectUserId: "user-001"}, ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: spec}}}
	var fullSpace, shortSpace string
	for _, width := range []uint32{0, 3072, 768} {
		spec.Dimensions = nil
		if width > 0 {
			spec.Dimensions = proto.Uint32(width)
		}
		response, err := f.service.ExecuteScenario(ctx, request)
		if err != nil {
			t.Fatalf("width %d: %v", width, err)
		}
		expected := int(width)
		if width == 0 {
			expected = 3072
		}
		output := response.GetOutput().GetTextEmbed()
		if len(output.Vectors) != 2 || len(output.Vectors[0].Values) != expected || response.GetUsage().GetInputTokens() != 14 {
			t.Fatalf("native output/usage = %+v", response)
		}
		if width == 0 {
			fullSpace = output.SpaceId
		} else if width == 3072 && output.SpaceId != fullSpace {
			t.Fatal("explicit full width changed space")
		} else if width == 768 {
			shortSpace = output.SpaceId
		}
	}
	if shortSpace == "" || shortSpace == fullSpace {
		t.Fatal("short width shared full space")
	}
	for _, purpose := range []runtimev1.TextEmbedPurpose{runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_UNSPECIFIED, runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY} {
		spec.Purpose = purpose
		spec.Dimensions = proto.Uint32(768)
		response, err := f.service.ExecuteScenario(ctx, request)
		if err != nil || response.GetOutput().GetTextEmbed().GetSpaceId() != shortSpace {
			t.Fatalf("native purpose changed legal operation/space: %v %v", purpose, err)
		}
	}
	spec.Purpose = runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT
	beforeCalls := calls.Load()
	f.service.scenarioJobs.mu.RLock()
	beforeJobs := len(f.service.scenarioJobs.jobs)
	f.service.scenarioJobs.mu.RUnlock()
	for _, width := range []uint32{0, 127, 3073} {
		spec.Dimensions = proto.Uint32(width)
		_, err := f.service.ExecuteScenario(ctx, request)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
			t.Fatalf("invalid dimensions: %v", err)
		}
	}
	f.service.scenarioJobs.mu.RLock()
	if len(f.service.scenarioJobs.jobs) != beforeJobs || calls.Load() != beforeCalls {
		t.Error("invalid width published a Job or dispatched")
	}
	f.service.scenarioJobs.mu.RUnlock()
	spec.Dimensions = proto.Uint32(768)
	effective, err := f.service.captureCloudEmbedEffectiveInputs(ctx, request.Head, request)
	if err != nil {
		t.Fatal(err)
	}
	if effective.resolvedAssembly.EmbeddingProtocol != capabilitydriver.CloudEmbedProtocolGeminiV1 {
		t.Fatal("native protocol omitted from capture")
	}
	if effective.request.GetPurpose() != runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT {
		t.Fatal("purpose dropped from immutable capture")
	}
	// The protocol identifies different semantics from the old compatible space.
	parts := cloudEmbeddingSpaceParts(effective)
	connectorPart := parts[len(parts)-1].(*structpb.Struct)
	if connectorPart.Fields["embeddingProtocol"].GetStringValue() != "gemini/embed-content/v1" {
		t.Fatal("native space omitted protocol identity")
	}
	spec.Inputs[0] = "mutated caller"
	spec.Purpose = runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY
	*spec.Dimensions = 1536
	job, _, err := f.service.captureImmediateCloudScenarioJob(ctx, request.Head, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED, runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), nil, effective.resolvedAssembly)
	if err != nil {
		t.Fatal(err)
	}
	published, ok := f.service.scenarioJobs.cloudResolvedAssembly(job.JobId)
	if !ok {
		t.Fatal("published native capture missing")
	}
	catalog := f.service.speechCatalog
	f.service.speechCatalog = nil
	restored, err := f.service.cloudEmbedEffectiveInputsFromResolvedAssembly(published)
	f.service.speechCatalog = catalog
	if err != nil || restored.dimension != 768 || restored.mapped.Protocol() != capabilitydriver.CloudEmbedProtocolGeminiV1 || restored.mapped.Inputs()[0] != "hello" || restored.request.GetPurpose() != runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT {
		t.Fatalf("immutable native restore: %+v %v", restored, err)
	}
	for _, protocol := range []capabilitydriver.CloudEmbedProtocol{"", "unreviewed/v2", capabilitydriver.CloudEmbedProtocolCompatibleV1} {
		changed, err := cloneCloudResolvedAssembly(published)
		if err != nil {
			t.Fatal(err)
		}
		changed.EmbeddingProtocol = protocol
		if _, err := f.service.cloudEmbedEffectiveInputsFromResolvedAssembly(changed); err == nil {
			t.Fatalf("changed native protocol restored: %q", protocol)
		}
	}
	spec.Inputs[0], spec.Dimensions = "hello", proto.Uint32(768)
	wrongWidth.Store(true)
	if _, err := f.service.ExecuteScenario(ctx, request); err == nil {
		t.Fatal("wrong native width became successful")
	}
	wrongWidth.Store(false)
	protectedCtx := accountservice.ContextWithAuthorizedLocalAppDecision(ctx, accountservice.LocalAppCallerDecision{
		AccountID: "user-001", AppID: "app.embed", RegisteredAppSubject: "principal-1",
		Operation: accountservice.LocalAppOperationScenarioExecute, AuthorityClass: localappop.AuthorityClassAppAccess,
		OperationCapability: localappop.AppOperationIDScenarioExecute,
	})
	protectedRequest := &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{"hello"}, Dimensions: proto.Uint32(768)}}}
	response, err := f.service.ExecuteLocalAppScenario(protectedCtx, protectedRequest)
	if err != nil || response.GetTextEmbed().GetUsage().GetInputTokens() != 7 || response.GetTextEmbed().GetSpaceId() != shortSpace {
		t.Fatalf("protected native output = %+v %v", response, err)
	}
	missingUsage.Store(true)
	response, err = f.service.ExecuteLocalAppScenario(protectedCtx, protectedRequest)
	if err != nil || response.GetTextEmbed().Usage != nil {
		t.Fatalf("missing native usage was synthesized: %+v %v", response, err)
	}
}

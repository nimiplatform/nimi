package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestSiliconFlowProtectedEmbeddingWidthsPurposesAndSpaces(t *testing.T) {
	for _, model := range []string{"Qwen/Qwen3-Embedding-0.6B", "Qwen/Qwen3-Embedding-4B", "Qwen/Qwen3-Embedding-8B", "Qwen/Qwen3-VL-Embedding-8B"} {
		t.Run(model, func(t *testing.T) {
			var wrong atomic.Bool
			var nullElement atomic.Bool
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var b struct {
					Model      string   `json:"model"`
					Input      []string `json:"input"`
					Dimensions uint32   `json:"dimensions"`
					InputType  string   `json:"input_type"`
				}
				if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
					t.Error(err)
					return
				}
				if r.URL.Path != "/proxy/openai/v1/embeddings" || r.Header.Get("Authorization") != "Bearer test-key" || b.Model != model || len(b.Input) != 2 || b.Input[0] != "local  models\ntext" {
					t.Error("native target or input changed")
				}
				if b.InputType != "" {
					t.Error("unsupported OpenAI input_type sent")
				}
				width := int(b.Dimensions)
				if wrong.Load() {
					width++
				}
				first, second := make([]float64, width), make([]float64, width)
				first[0] = 1
				second[0] = 2
				var nativeFirst any = first
				if nullElement.Load() {
					values := make([]any, width)
					for i, n := range first {
						values[i] = n
					}
					values[2] = nil
					nativeFirst = values
				}
				if err := json.NewEncoder(w).Encode(map[string]any{"model": model, "data": []any{map[string]any{"index": 1, "embedding": second}, map[string]any{"index": 0, "embedding": nativeFirst}}, "usage": map[string]any{"prompt_tokens": 8, "total_tokens": 8}}); err != nil {
					t.Error(err)
					return
				}
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "siliconflow", model, server.URL+"/proxy/openai/v1", Config{AllowLoopbackEndpoint: true})
			target, _ := structpb.NewStruct(map[string]any{"provider": "siliconflow", "providerModelId": model, "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
			config := appAIConfig("app.embed", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.embed", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, ProviderModelTarget: target, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "siliconflow", DriverId: "nimillm", DriverDialect: "siliconflow"}}}})
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", config); err != nil {
				t.Fatal(err)
			}
			ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.embed", RegisteredAppSubject: "embed-subject", Operation: accountservice.LocalAppOperationScenarioExecute, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioExecute})
			spec := &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{"local  models\ntext", "cloud services"}, Purpose: runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT}
			request := &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: spec}}
			r, err := f.service.ExecuteLocalAppScenario(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			out := r.GetTextEmbed()
			if len(out.GetVectors()) != 2 || len(out.Vectors[0].Values) != int(capabilitydriver.SiliconFlowEmbedDimensions(model)) || out.Vectors[0].Values[0] != 1 || out.Vectors[1].Values[0] != 2 || out.GetUsage().GetInputTokens() != 8 {
				t.Fatal(out)
			}
			space := out.GetSpaceId()

			spec.Purpose = runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY
			r, err = f.service.ExecuteLocalAppScenario(ctx, request)
			if err != nil || r.GetTextEmbed().GetSpaceId() != space {
				t.Fatal("query and document space mismatch", err)
			}
			spec.Dimensions = proto.Uint32(256)
			before := calls.Load()
			spec.Dimensions = proto.Uint32(129)
			if _, err := f.service.ExecuteLocalAppScenario(ctx, request); err == nil || calls.Load() != before {
				t.Fatal("unreviewed dimension dispatched", err)
			}
			spec.Dimensions = proto.Uint32(256)
			r, err = f.service.ExecuteLocalAppScenario(ctx, request)
			if err != nil || len(r.GetTextEmbed().GetVectors()[0].GetValues()) != 256 || r.GetTextEmbed().GetSpaceId() == space {
				t.Fatal("width capture", err)
			}
			wrong.Store(true)
			if _, err = f.service.ExecuteLocalAppScenario(ctx, request); err == nil {
				t.Fatal("wrong native width succeeded")
			}
			wrong.Store(false)
			nullElement.Store(true)
			if _, err = f.service.ExecuteLocalAppScenario(ctx, request); textBehaviorReason(err) != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
				t.Fatal("native null vector element silently became zero", err)
			}
		})
	}
}

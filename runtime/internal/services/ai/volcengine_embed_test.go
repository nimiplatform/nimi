package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestVolcengineProtectedEmbeddingBatchSpacesAndPartialFailure(t *testing.T) {
	for _, model := range []string{"doubao-embedding-vision-251215", "doubao-embedding-vision-250615"} {
		t.Run(model, func(t *testing.T) {
			var query, wrongWidth, nullSecond, wrongModel, missingUsage, failSecond atomic.Bool
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var b struct {
					Model string `json:"model"`
					Input []struct {
						Type string `json:"type"`
						Text string `json:"text"`
					} `json:"input"`
					Format       string `json:"encoding_format"`
					Dimensions   uint32 `json:"dimensions"`
					Instructions string `json:"instructions"`
				}
				if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
					t.Error(err)
					return
				}
				if r.Method != "POST" || r.URL.Path != "/proxy/api/v3/embeddings/multimodal" || r.Header.Get("Authorization") != "Bearer test-key" || b.Model != model || len(b.Input) != 1 || b.Input[0].Type != "text" || b.Format != "float" {
					t.Error("native endpoint/auth or independent vector request")
					w.WriteHeader(400)
					return
				}
				first := b.Input[0].Text == "first  原文\ntext"
				if !first && b.Input[0].Text != "second" {
					t.Error("input changed", b.Input[0].Text)
				}
				if model == "doubao-embedding-vision-251215" {
					if query.Load() {
						if !strings.HasPrefix(b.Instructions, "Target_modality: text.\nInstruction:") || !strings.HasSuffix(b.Instructions, "\nQuery:") {
							t.Error("query instruction omitted")
						}
					} else if b.Instructions != "Instruction:Compress the text into one word.\nQuery:" {
						t.Error("document template changed")
					}
				} else if b.Instructions != "" {
					t.Error("older model inherited unsupported instructions")
				}
				if failSecond.Load() && !first {
					w.WriteHeader(http.StatusTooManyRequests)
					return
				}
				width := int(b.Dimensions)
				if wrongWidth.Load() {
					width++
				}
				values := make([]any, width)
				for i := range values {
					values[i] = 0.0
				}
				values[0] = 2.0
				if first {
					values[0] = 1.0
				}
				if nullSecond.Load() && !first {
					values[1] = nil
				}
				name := model
				if wrongModel.Load() {
					name = "replacement-model"
				}
				out := map[string]any{"model": name, "object": "list", "data": map[string]any{"object": "embedding", "embedding": values}}
				if !(missingUsage.Load() && !first) {
					out["usage"] = map[string]any{"prompt_tokens": 4, "total_tokens": 4}
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(out)
			}))
			defer server.Close()
			f := newManagedCloudScenarioTestFixture(t, "volcengine", model, server.URL+"/proxy/api/v3", Config{AllowLoopbackEndpoint: true})
			target, _ := structpb.NewStruct(map[string]any{"provider": "volcengine", "providerModelId": model, "remoteModelCatalogId": f.descriptor.GetRemoteModelCatalogId()})
			config := appAIConfig("app.ark-embed", &runtimev1.AIConfigCapabilityIntent{CapabilityContract: "text.embed", Route: &runtimev1.AIConfigCapabilityIntent_Cloud{Cloud: &runtimev1.AIConfigCloudIntent{ConnectorRef: f.connectorID, ProviderModelTarget: target, Implementation: &runtimev1.CapabilityImplementationIdentity{ImplementationId: "volcengine", DriverId: "nimillm", DriverDialect: "volcengine"}}}})
			if err := overwriteAIConfigStoreForTest(context.Background(), f.service.aiConfigStore, "user-001", config); err != nil {
				t.Fatal(err)
			}
			ctx := accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), accountservice.LocalAppCallerDecision{AccountID: "user-001", AppID: "app.ark-embed", RegisteredAppSubject: "ark-embed-subject", Operation: accountservice.LocalAppOperationScenarioExecute, AuthorityClass: localappop.AuthorityClassAppAccess, OperationCapability: localappop.AppOperationIDScenarioExecute})
			spec := &runtimev1.LocalAppTextEmbedScenarioSpec{Inputs: []string{"first  原文\ntext", "second"}, Purpose: runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT}
			request := &runtimev1.ExecuteLocalAppScenarioRequest{Spec: &runtimev1.ExecuteLocalAppScenarioRequest_TextEmbed{TextEmbed: spec}}
			r, err := f.service.ExecuteLocalAppScenario(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			out := r.GetTextEmbed()
			if len(out.GetVectors()) != 2 || len(out.Vectors[0].Values) != 2048 || out.Vectors[0].Values[0] != 1 || out.Vectors[1].Values[0] != 2 || out.GetUsage().GetInputTokens() != 8 || calls.Load() != 2 {
				t.Fatal("ordered native batch or reported usage lost", calls.Load())
			}
			space := out.GetSpaceId()
			query.Store(true)
			spec.Purpose = runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY
			r, err = f.service.ExecuteLocalAppScenario(ctx, request)
			if err != nil || r.GetTextEmbed().GetSpaceId() != space {
				t.Fatal("query/document space mismatch", err)
			}
			spec.Dimensions = proto.Uint32(2048)
			r, err = f.service.ExecuteLocalAppScenario(ctx, request)
			if err != nil || r.GetTextEmbed().GetSpaceId() != space {
				t.Fatal("explicit default changed space", err)
			}
			spec.Dimensions = proto.Uint32(1024)
			r, err = f.service.ExecuteLocalAppScenario(ctx, request)
			if err != nil || len(r.GetTextEmbed().GetVectors()[0].GetValues()) != 1024 || r.GetTextEmbed().GetSpaceId() == space {
				t.Fatal("reduced native width lost", err)
			}
			before := calls.Load()
			spec.Dimensions = proto.Uint32(1536)
			if _, err = f.service.ExecuteLocalAppScenario(ctx, request); err == nil || calls.Load() != before {
				t.Fatal("invalid width dispatched", err)
			}
			spec.Dimensions = proto.Uint32(1024)
			for name, flag := range map[string]*atomic.Bool{"width": &wrongWidth, "null second": &nullSecond, "model": &wrongModel, "failed second": &failSecond} {
				flag.Store(true)
				result, err := f.service.ExecuteLocalAppScenario(ctx, request)
				flag.Store(false)
				if err == nil || len(result.GetTextEmbed().GetVectors()) != 0 {
					t.Fatal("partial or invalid batch published", name, err)
				}
			}
			missingUsage.Store(true)
			r, err = f.service.ExecuteLocalAppScenario(ctx, request)
			if err != nil || r.GetTextEmbed().Usage != nil {
				t.Fatal("incomplete usage invented", err)
			}
		})
	}
}

package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestCohere5NativeRolesWidthsAndUnmodifiedInputs(t *testing.T) {
	for _, model := range []string{"embed-v5.0-pro", "embed-v5.0-fast"} {
		for _, purpose := range []runtimev1.TextEmbedPurpose{runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_UNSPECIFIED, runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_DOCUMENT, runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY} {
			t.Run(model+"/"+purpose.String(), func(t *testing.T) {
				calls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					if r.URL.Path != "/v2/embed" || r.Header.Get("Authorization") != "Bearer selected-key" {
						t.Errorf("native endpoint/auth = %s", r.URL.Path)
					}
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					role := "search_document"
					if purpose == runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_RETRIEVAL_QUERY {
						role = "search_query"
					}
					if body["model"] != model || body["input_type"] != role || body["truncate"] != "NONE" || body["output_dimension"] != float64(256) {
						t.Errorf("mapping = %+v", body)
					}
					texts := body["inputs"].([]any)
					for i, want := range []string{"first", "第二篇"} {
						got := texts[i].(map[string]any)["content"].([]any)[0].(map[string]any)
						if got["text"] != want || got["type"] != "text" {
							t.Errorf("input %d changed: %+v", i, got)
						}
					}
					values := [][]float64{make([]float64, 256), make([]float64, 256)}
					values[0][0] = 1
					values[1][0] = 2
					_ = json.NewEncoder(w).Encode(map[string]any{"embeddings": map[string]any{"float": values}, "meta": map[string]any{"tokens": map[string]any{"input_tokens": 12}}})
				}))
				defer server.Close()
				raw, _ := structpb.NewStruct(map[string]any{"provider": "cohere", "providerModelId": model, "remoteModelCatalogId": "reviewed"})
				driver, target, err := capabilitydriver.NewProductionCloudEmbedRegistry().Resolve(capabilitydriver.Identity{ImplementationID: "cohere", DriverID: "nimillm", DriverDialect: "cohere"}, raw)
				if err != nil {
					t.Fatal(err)
				}
				width := uint32(256)
				mapped, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"first", "第二篇"}, Dimensions: &width, Purpose: purpose}, nil)
				if err != nil {
					t.Fatal(err)
				}
				if mapped.Protocol() != capabilitydriver.CloudEmbedProtocolCohereV2 || mapped.DefaultDimensions() != 2048 {
					t.Fatal("native output contract not captured")
				}
				b := NewBackend("cloud-cohere", server.URL+"/compatibility/v1", "selected-key", time.Second)
				vectors, usage, err := b.EmbedCohereV2(loopbackProviderTestContext(context.Background()), model, mapped.Inputs(), mapped.Dimensions(), mapped.Purpose())
				if err != nil {
					t.Fatal(err)
				}
				result, err := driver.NormalizeResponse(mapped, capabilitydriver.CloudEmbedTransportResponse{Vectors: vectors, Usage: usage})
				if err != nil || len(result.Vectors) != 2 || result.Vectors[1].Values[0] != 2 || result.Usage != nil || calls != 1 {
					t.Fatalf("ordered result/partial usage = %+v %v calls=%d", result, err, calls)
				}
				bad := uint32(300)
				if _, err := driver.MapRequest(target, &runtimev1.TextEmbedScenarioSpec{Inputs: []string{"text"}, Dimensions: &bad}, nil); err == nil {
					t.Fatal("unsupported discrete width accepted")
				}
				vectors[0].Values[0] = structpb.NewNullValue()
				if _, err := driver.NormalizeResponse(mapped, capabilitydriver.CloudEmbedTransportResponse{Vectors: vectors}); err == nil {
					t.Fatal("null vector entry became a successful zero")
				}
			})
		}
	}
}

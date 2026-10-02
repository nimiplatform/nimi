package nimillm

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestGeminiNativeEmbeddingKeepsEachTextAndReportedUsage(t *testing.T) {
	for _, report := range []string{"complete", "absent", "partial", "zero", "negative"} {
		t.Run(report, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/v1beta/models/gemini-embedding-2:embedContent" || r.Header.Get("x-goog-api-key") != "native-key" || r.Header.Get("Authorization") != "" {
					t.Fatalf("native endpoint or credential mapping: %s", r.URL.Path)
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if len(body) != 2 {
					t.Fatalf("unexpected top-level request fields: %+v", body)
				}
				cfg := body["embedContentConfig"].(map[string]any)
				if len(cfg) != 2 || cfg["outputDimensionality"] != float64(768) || cfg["autoTruncate"] != false {
					t.Fatalf("native config = %+v", cfg)
				}
				parts := body["content"].(map[string]any)["parts"].([]any)
				if len(parts) != 1 || len(parts[0].(map[string]any)) != 1 || parts[0].(map[string]any)["text"] != []string{"first", "第二篇"}[calls-1] {
					t.Fatalf("text grouping/order = %+v", parts)
				}
				values := make([]float64, 768)
				values[0] = float64(calls)
				response := map[string]any{"embedding": map[string]any{"values": values}}
				if report == "complete" || (report == "partial" && calls == 1) {
					response["usageMetadata"] = map[string]any{"promptTokenCount": calls + 2}
				}
				if report == "zero" {
					response["usageMetadata"] = map[string]any{"promptTokenCount": 0}
				}
				if report == "negative" {
					response["usageMetadata"] = map[string]any{"promptTokenCount": -1}
				}
				_ = json.NewEncoder(w).Encode(response)
			}))
			defer server.Close()
			backend := NewBackendWithHeaders("cloud-gemini", server.URL+"/v1beta/openai", "native-key", map[string]string{"Authorization": "unused", "X-Source": "retained"}, time.Second)
			width := uint32(768)
			vectors, usage, err := backend.EmbedGeminiNative(context.Background(), "gemini-embedding-2", []string{"first", "第二篇"}, &width)
			if err != nil || calls != 2 || len(vectors) != 2 || vectors[0].Values[0].GetNumberValue() != 1 || vectors[1].Values[0].GetNumberValue() != 2 {
				t.Fatalf("vectors/calls: %v / %d / %v", vectors, calls, err)
			}
			if report == "complete" && (usage == nil || usage.InputTokens != 7 || usage.OutputTokens != 0) {
				t.Fatalf("reported usage = %+v", usage)
			}
			if report == "zero" && (usage == nil || usage.InputTokens != 0) {
				t.Fatalf("reported zero was lost: %+v", usage)
			}
			if (report == "absent" || report == "partial" || report == "negative") && usage != nil {
				t.Fatalf("unreported whole-request usage was synthesized: %+v", usage)
			}
			if backend.apiKey != "native-key" || backend.headers["Authorization"] != "unused" || backend.baseURL != server.URL+"/v1beta/openai" {
				t.Fatal("native dispatch mutated the compatible backend")
			}
		})
	}
}

func TestGeminiNativeEmbeddingRejectsBadResponsesWithoutPartialVectorsOrFallback(t *testing.T) {
	for _, failure := range []string{"empty", "width", "null", "string", "second-http", "nonfinite"} {
		t.Run(failure, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/v1beta/models/gemini-embedding-2:embedContent" {
					t.Fatalf("fallback path: %s", r.URL.Path)
				}
				if failure == "second-http" && calls == 2 {
					w.WriteHeader(http.StatusServiceUnavailable)
					return
				}
				if failure == "empty" {
					_, _ = w.Write([]byte(`{}`))
					return
				}
				values := make([]any, 768)
				for i := range values {
					values[i] = 0
				}
				if failure == "width" {
					values = values[:767]
				}
				if failure == "null" {
					values[0] = nil
				}
				if failure == "string" {
					values[0] = "0.5"
				}
				if failure == "nonfinite" {
					values[0] = json.RawMessage(`1e999`)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"embedding": map[string]any{"values": values}})
			}))
			defer server.Close()
			width := uint32(768)
			vectors, usage, err := NewBackend("cloud-gemini", server.URL+"/v1beta/openai", "key", time.Second).EmbedGeminiNative(context.Background(), "gemini-embedding-2", []string{"first", "second"}, &width)
			if err == nil || vectors != nil || usage != nil {
				t.Fatalf("bad response returned success/partial output: %v %v %v", vectors, usage, err)
			}
			expected := 1
			if failure == "second-http" {
				expected = 2
			}
			if calls != expected {
				t.Fatalf("calls = %d, want %d", calls, expected)
			}
		})
	}
}

func TestGeminiNativeEmbeddingDefaultAndIllegalWidths(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		cfg := request["embedContentConfig"].(map[string]any)
		if len(cfg) != 1 || cfg["autoTruncate"] != false {
			t.Fatalf("default config = %+v", cfg)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"embedding": map[string]any{"values": make([]float64, 3072)}})
	}))
	defer server.Close()
	b := NewBackend("cloud-gemini", server.URL+"/v1beta", "key", time.Second)
	if vectors, _, err := b.EmbedGeminiNative(context.Background(), "gemini-embedding-2", []string{"default"}, nil); err != nil || len(vectors[0].Values) != 3072 {
		t.Fatalf("default embedding: %v", err)
	}
	for _, value := range []uint32{0, 127, 3073} {
		t.Run(fmt.Sprint(value), func(t *testing.T) {
			_, _, err := b.EmbedGeminiNative(context.Background(), "gemini-embedding-2", []string{"default"}, &value)
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_INPUT_INVALID {
				t.Fatalf("invalid width = %v", err)
			}
		})
	}
	if calls != 1 {
		t.Fatalf("invalid widths dispatched: %d", calls)
	}
}

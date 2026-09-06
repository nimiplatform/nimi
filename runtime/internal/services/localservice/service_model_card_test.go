package localservice

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestGetCatalogModelCard(t *testing.T) {
	markdown := "---\nlicense: apache-2.0\n---\n# Model\n![Architecture](./assets/model.png)\n"
	for _, offerSource := range []string{"", "model-index", "huggingface"} {
		t.Run("source="+offerSource, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/org/model/resolve/"+immutableHFRevisionForTest+"/README.md" {
					t.Errorf("unexpected card path: %s", r.URL.Path)
				}
				fmt.Fprint(w, markdown)
			}))
			defer server.Close()
			svc := newTestService(t)
			svc.hfDownloadBaseURL = server.URL
			req := &runtimev1.GetCatalogModelCardRequest{}
			if offerSource == "" {
				req.ModelLocator, _ = newModelAssetModelLocator("huggingface", "org/model", immutableHFRevisionForTest)
			} else {
				req.OfferRef, _ = newModelAssetOfferRef(modelAssetOfferIdentity{sourceKind: offerSource, locator: "org/model", revision: immutableHFRevisionForTest, entryID: "model.gguf"})
			}
			card, err := svc.GetCatalogModelCard(context.Background(), req)
			if err != nil {
				t.Fatal(err)
			}
			if card.Markdown != markdown || card.BaseUrl != "https://huggingface.co/org/model/resolve/"+immutableHFRevisionForTest+"/" || card.SourceUrl != "https://huggingface.co/org/model/blob/"+immutableHFRevisionForTest+"/README.md" {
				t.Fatalf("unexpected card: %+v", card)
			}
		})
	}
}

func TestGetCatalogModelCardFailsExplicitly(t *testing.T) {
	for _, tc := range []struct {
		name     string
		status   int
		revision string
		body     string
		want     codes.Code
	}{
		{"missing", 404, "", "", codes.NotFound},
		{"gated", 401, "", "", codes.Unavailable},
		{"upstream", 503, "", "", codes.Unavailable},
		{"revision-changed", 200, strings.Repeat("b", 40), "card", codes.Unavailable},
		{"oversize", 200, "", strings.Repeat("a", hfCatalogMaxBodyBytes+1), codes.Unavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("X-Repo-Commit", tc.revision)
				w.WriteHeader(tc.status)
				fmt.Fprint(w, tc.body)
			}))
			defer server.Close()
			svc := newTestService(t)
			svc.hfDownloadBaseURL = server.URL
			locator, _ := newModelAssetModelLocator("huggingface", "org/model", immutableHFRevisionForTest)
			_, err := svc.GetCatalogModelCard(context.Background(), &runtimev1.GetCatalogModelCardRequest{ModelLocator: locator})
			if status.Code(err) != tc.want {
				t.Fatalf("error = %v, want %s", err, tc.want)
			}
		})
	}
	svc := newTestService(t)
	for _, req := range []*runtimev1.GetCatalogModelCardRequest{{}, {ModelLocator: "bad"}, {ModelLocator: "x", OfferRef: "y"}} {
		_, err := svc.GetCatalogModelCard(context.Background(), req)
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("invalid input error = %v", err)
		}
	}
}

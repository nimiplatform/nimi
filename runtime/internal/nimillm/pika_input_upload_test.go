package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func TestPikaUploadRequiresExactSignedHeadersAndDurableOwnerBeforePUT(t *testing.T) {
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, image.NewRGBA(image.Rect(0, 0, 16, 16))); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"wrong-length", "wrong-mime", "api-credential-header", "missing-owner", "persistence-rejected", "put-failed", "complete"} {
		t.Run(mode, func(t *testing.T) {
			var puts, records, deletes atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.Method {
				case "POST":
					h := map[string]string{"Content-Type": "image/png", "Content-Length": strconv.Itoa(pngBytes.Len())}
					if mode == "wrong-length" {
						h["Content-Length"] = "1"
					}
					if mode == "wrong-mime" {
						h["Content-Type"] = "image/jpeg"
					}
					if mode == "api-credential-header" {
						h["X-Api-Key"] = "test-key"
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"upload_url": endpoint + "/put", "url": endpoint + "/owned", "headers": h, "expires_in": 300, "max_bytes": 20_000_000})
				case "PUT":
					puts.Add(1)
					if records.Load() != 1 || r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
						t.Error("undurable or credentialed storage PUT")
					}
					if mode == "put-failed" {
						w.WriteHeader(500)
					} else {
						w.WriteHeader(200)
					}
				case "DELETE":
					deletes.Add(1)
					if r.URL.Query().Get("url") != endpoint+"/owned" {
						t.Error("wrong private cleanup URL")
					}
					w.WriteHeader(204)
				}
			}))
			defer server.Close()
			endpoint = server.URL
			ctx := WithCloudVideoMediaReferences(context.Background(), []CloudVideoMediaReference{{ContentIndex: 2, Reference: CapturedMediaReference{ArtifactID: "owned", MIMEType: "image/png", Bytes: pngBytes.Bytes()}}})
			if mode != "missing-owner" {
				ctx = WithPikaUploadRecorder(ctx, func(r PikaInputUpload) error {
					records.Add(1)
					if mode == "persistence-rejected" {
						return fmt.Errorf("durable write refused")
					}
					if r.URL != endpoint+"/owned" || r.ContentIndex != 2 {
						t.Error("source slot changed")
					}
					return nil
				})
			}
			cfg := MediaAdapterConfig{BaseURL: endpoint, APIKey: "test-key", AllowLoopbackEndpoint: true}
			uploads, err := PreparePikaInputs(ctx, cfg)
			if mode == "complete" {
				if err != nil || len(uploads) != 1 || !uploads[0].PutComplete || records.Load() != 2 || puts.Load() != 1 {
					t.Fatal(uploads, err, records.Load(), puts.Load())
				}
				if result := CleanupPikaInputs(ctx, cfg, uploads); result.State != "deleted" || deletes.Load() != 1 {
					t.Fatal(result)
				}
				return
			}
			if err == nil {
				t.Fatal("invalid upload admitted")
			}
			if mode == "put-failed" {
				if puts.Load() != 1 || len(uploads) != 1 || uploads[0].PutComplete {
					t.Fatal("uncertain PUT became completion", uploads)
				}
				if result := CleanupPikaInputs(ctx, cfg, uploads); result.State != "unconfirmed" || deletes.Load() != 0 {
					t.Fatal("unconfirmed PUT was deleted", result)
				}
				return
			}
			if puts.Load() != 0 {
				t.Fatal("unvalidated or unowned bytes transmitted", puts.Load())
			}
		})
	}
}

func TestPikaInputCleanupContinuesAfterOneFailureWithoutClaimingAllDeleted(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Method != "DELETE" {
			t.Error("cleanup created work")
		}
		if strings.HasSuffix(r.URL.Query().Get("url"), "/a") {
			w.WriteHeader(503)
		} else {
			w.WriteHeader(204)
		}
	}))
	defer server.Close()
	result := CleanupPikaInputs(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, []PikaInputUpload{{ContentIndex: 0, URL: "https://example.com/a", PutComplete: true}, {ContentIndex: 1, URL: "https://example.com/b", PutComplete: true}})
	if result.State != "failed" || result.Failed != 1 || result.Deleted != 1 || calls.Load() != 2 {
		t.Fatal(result, calls.Load())
	}
}

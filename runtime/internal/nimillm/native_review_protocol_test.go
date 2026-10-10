package nimillm

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestMiniMaxVideoQueryRetrievesOriginalFileAndRecognizesFail(t *testing.T) {
	for _, tc := range []struct {
		name, state, fileID, returnedID string
		mismatch                        bool
	}{
		{name: "success", state: "Success", fileID: "176844028768320", returnedID: "176844028768320"},
		{name: "fail", state: "Fail", fileID: "176844028768320", returnedID: "176844028768320"},
		{name: "above-float-exact-range", state: "Success", fileID: "9007199254740993", returnedID: "9007199254740993"},
		{name: "different-large-id", state: "Success", fileID: "9007199254740993", returnedID: "9007199254740992", mismatch: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var creates, queries, retrieves, downloads atomic.Int32
			var ready atomic.Bool
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v1/video_generation":
					creates.Add(1)
					fmt.Fprint(w, `{"task_id":"original-task"}`)
				case "/v1/query/video_generation":
					queries.Add(1)
					if r.Method != http.MethodGet || r.URL.Query().Get("task_id") != "original-task" || r.Header.Get("Authorization") != "Bearer original-key" {
						t.Error("query lost original identity/custody")
					}
					fmt.Fprintf(w, `{"task_id":"original-task","status":%q,"file_id":%q,"base_resp":{"status_code":0}}`, tc.state, tc.fileID)
				case "/v1/files/retrieve":
					retrieves.Add(1)
					if r.Method != http.MethodGet || r.URL.Query().Get("file_id") != tc.fileID || r.Header.Get("Authorization") != "Bearer original-key" {
						t.Error("retrieve lost original file/custody")
					}
					if !ready.Load() {
						w.WriteHeader(503)
						fmt.Fprint(w, `{"error":"temporarily unavailable"}`)
						return
					}
					fmt.Fprintf(w, `{"file":{"file_id":%s,"download_url":%q},"base_resp":{"status_code":0}}`, tc.returnedID, endpoint+"/asset")
				case "/asset":
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" {
						t.Error("download locator received provider credential")
					}
					w.Header().Set("Content-Type", "video/mp4")
					fmt.Fprint(w, "complete video body")
				default:
					t.Errorf("unexpected protocol step %s", r.URL.Path)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			endpoint = server.URL
			cfg := MediaAdapterConfig{BaseURL: endpoint, APIKey: "original-key", AllowLoopbackEndpoint: true}
			var receipt *NativeTaskReceipt
			ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
			_, _, id, err := ExecuteMiniMaxTask(ctx, cfg, noopJobStateUpdater{}, "job", newAsyncVideoJobRequest("scene"), "MiniMax-Hailuo-2.3", func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct { return nil })
			if !errors.Is(err, ErrNativeTaskYielded) || id != "original-task" || creates.Load() != 1 {
				t.Fatalf("create: %q %v", id, err)
			}
			observation, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt)
			if tc.state == "Fail" {
				if !terminal || err == nil || observation != nil || retrieves.Load() != 0 || downloads.Load() != 0 {
					t.Fatalf("Fail was not terminal: %v %v", terminal, err)
				}
				return
			}
			if terminal || err == nil || observation != nil || downloads.Load() != 0 {
				t.Fatalf("retrieve error became generation terminal: %v %v", terminal, err)
			}
			ready.Store(true)
			observation, terminal, err = ObserveNativeTask(context.Background(), cfg, receipt)
			if tc.mismatch {
				if err == nil || terminal || observation != nil || creates.Load() != 1 || queries.Load() != 2 || retrieves.Load() != 2 || downloads.Load() != 0 {
					t.Fatalf("different integer identity was accepted: result=%v terminal=%v err=%v downloads=%d", observation, terminal, err, downloads.Load())
				}
				return
			}
			if err != nil || !terminal || len(observation.GetArtifacts()) != 1 {
				t.Fatalf("Success/file_id did not resolve: %v %v", terminal, err)
			}
			bodies, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, observation)
			if err != nil {
				t.Fatal(err)
			}
			body := bodies[observation.Artifacts[0].GetArtifactId()]
			if body == nil || body.Stream == nil {
				t.Fatal("complete result has no body")
			}
			data, err := io.ReadAll(body.Stream)
			body.Stream.Close()
			if err != nil || string(data) != "complete video body" || creates.Load() != 1 || queries.Load() != 2 || retrieves.Load() != 2 || downloads.Load() != 1 {
				t.Fatalf("original result recovery: data=%q err=%v counts=%d/%d/%d/%d", data, err, creates.Load(), queries.Load(), retrieves.Load(), downloads.Load())
			}
		})
	}
}

func TestRunwayCreateAndQueryUseSameRequiredVersion(t *testing.T) {
	var creates, queries atomic.Int32
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/asset" {
			if r.Header.Get("Authorization") != "" {
				t.Error("asset received credential")
			}
			fmt.Fprint(w, "complete runway body")
			return
		}
		if r.Header.Get("X-Runway-Version") != runwayAPIVersion {
			t.Errorf("%s %s omitted required version", r.Method, r.URL.Path)
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/image_to_video":
			creates.Add(1)
			fmt.Fprint(w, `{"id":"runway-original"}`)
		case "/v1/tasks/runway-original":
			queries.Add(1)
			fmt.Fprintf(w, `{"id":"runway-original","status":"SUCCEEDED","output":[%q]}`, endpoint+"/asset")
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	endpoint = server.URL
	cfg := MediaAdapterConfig{BaseURL: endpoint, APIKey: "original-key", AllowLoopbackEndpoint: true, Headers: map[string]string{"x-runway-version": "not-the-protocol-version"}}
	var receipt *NativeTaskReceipt
	ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	_, _, _, err := ExecuteRunwayTask(ctx, cfg, noopJobStateUpdater{}, "job", newAsyncVideoJobRequest("scene"), "gen4_turbo")
	if !errors.Is(err, ErrNativeTaskYielded) {
		t.Fatal(err)
	}
	observation, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt)
	if err != nil || !terminal || len(observation.GetArtifacts()) != 1 || creates.Load() != 1 || queries.Load() != 1 {
		t.Fatalf("Runway query: %v %v", terminal, err)
	}
	bodies, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, observation)
	if err != nil {
		t.Fatal(err)
	}
	body := bodies[observation.Artifacts[0].GetArtifactId()]
	if body == nil || body.Stream == nil {
		t.Fatal("missing Runway result")
	}
	data, err := io.ReadAll(body.Stream)
	body.Stream.Close()
	if err != nil || string(data) != "complete runway body" {
		t.Fatalf("body=%q err=%v", data, err)
	}
}

func TestLostResponseEvidenceIsScopedToNativeCreate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		conn, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		conn.Close()
	}))
	defer server.Close()
	for _, create := range []bool{false, true} {
		ctx := mediaAdapterEndpointPolicyContext(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
		if create {
			ctx = nativeCreateRequest(ctx)
		}
		response := map[string]any{}
		err := DoJSONRequest(ctx, http.MethodPost, server.URL, "", map[string]any{"input": "fixture"}, &response)
		if err == nil || IsNativeCreateResponseUnavailable(err) != create {
			t.Fatalf("create=%v misclassified unavailable response: %v", create, err)
		}
	}
}

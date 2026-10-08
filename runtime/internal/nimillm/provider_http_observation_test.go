package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func captureProviderLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buffer bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buffer, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &buffer
}

func TestWorldLabsJSONObservationIdentifiesTransportStageWithoutSensitiveData(t *testing.T) {
	logs := captureProviderLogs(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/drop" {
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = conn.Close()
			return
		}
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"detail":"private provider body"}`))
	}))
	defer server.Close()
	ctx := WithMediaAdapterEndpointPolicy(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
	for _, path := range []string{"/drop", "/credits"} {
		var result map[string]any
		err := doJSONRequestWithHeadersAndObservation(ctx, http.MethodPost, server.URL+path+"?token=private-query", "", map[string]any{"world_prompt": "private prompt"}, &result, map[string]string{"WLT-Api-Key": "private-credential"}, time.Second, AdapterWorldLabsNative)
		if err == nil {
			t.Fatal("failed provider request succeeded")
		}
	}
	text := logs.String()
	for _, want := range []string{"backend=worldlabs_world_adapter", "phase=awaiting_response", "failure_class=", "status=402"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q: %s", want, text)
		}
	}
	for _, secret := range []string{"private-query", "private prompt", "private-credential", "private provider body"} {
		if strings.Contains(text, secret) {
			t.Fatalf("sensitive provider diagnostic leaked %q", secret)
		}
	}
}

func TestDashScopeVideoObservationsSeparateSubmitPollAndArtifactFailures(t *testing.T) {
	for _, failure := range []string{"", "submit", "poll", "artifact"} {
		t.Run("failure_"+failure, func(t *testing.T) {
			logs := captureProviderLogs(t)
			polls := 0
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("x-request-id", "request-header-1")
				stage := ""
				switch r.URL.Path {
				case "/api/v1/services/aigc/video-generation/video-synthesis":
					stage = "submit"
				case "/api/v1/tasks/task-video-1":
					stage = "poll"
				case "/private-signed-path.mp4":
					stage = "artifact"
				default:
					http.NotFound(w, r)
					return
				}
				if stage == failure {
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"message":"private raw response body"}`))
					return
				}
				if stage == "artifact" {
					w.Header().Set("Content-Type", "video/mp4")
					_, _ = w.Write([]byte("video-body"))
					return
				}
				status := "PENDING"
				if stage == "poll" {
					polls++
					if polls == 3 {
						status = "RUNNING"
					} else if polls > 3 {
						status = "SUCCEEDED"
					}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"request_id": "request-body-1",
					"output": map[string]any{"task_id": "task-video-1", "task_status": status,
						"video_url": server.URL + "/private-signed-path.mp4?access_token=private-query"},
				})
			}))
			defer server.Close()
			ctx := WithProviderPollWait(loopbackProviderTestContext(context.Background()), func(context.Context, time.Duration) error { return nil })
			result, err := (&CloudProvider{}).ExecuteMediaAdapter(ctx, AdapterAlibabaNative, "trace-video-1",
				&runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
					Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
						Mode: runtimev1.VideoMode_VIDEO_MODE_T2V,
						Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
							Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "private prompt"}},
					}}}}, "wan2.7-t2v", &RemoteTarget{Endpoint: server.URL, APIKey: "private-credential", AllowLoopback: true}, noopJobStateUpdater{})
			if (err != nil) != (failure != "") {
				t.Fatalf("failure=%q error=%v", failure, err)
			}
			for _, body := range result.ArtifactBodies {
				if body.Stream != nil {
					_ = body.Stream.Close()
				}
			}
			text := logs.String()
			for _, secret := range []string{"private-credential", "private prompt", "private raw response body", "private-signed-path", "private-query", "access_token"} {
				if strings.Contains(text, secret) {
					t.Fatalf("provider diagnostic leaked %q", secret)
				}
			}
			if !strings.Contains(text, "DashScope video submit started") || !strings.Contains(text, "phase=response") {
				t.Fatalf("submit phase missing: %s", text)
			}
			if failure == "submit" {
				if strings.Contains(text, "DashScope video submit returned") || strings.Contains(text, "DashScope video artifact fetch") {
					t.Fatalf("submit failure reached a later stage: %s", text)
				}
				return
			}
			if !strings.Contains(text, "provider_task_id=task-video-1") || !strings.Contains(text, "request_id=request-body-1") {
				t.Fatalf("confirmed provider identity missing: %s", text)
			}
			if failure == "poll" {
				if !strings.Contains(text, "path=/api/v1/tasks/task-video-1") || strings.Contains(text, "DashScope video artifact fetch") {
					t.Fatalf("poll failure stage incorrect: %s", text)
				}
				return
			}
			for _, status := range []string{"pending", "running", "succeeded"} {
				if strings.Count(text, "status="+status) != 1 {
					t.Fatalf("status transition %q missing or repeated: %s", status, text)
				}
			}
			opened := "true"
			if failure == "artifact" {
				opened = "false"
			}
			if !strings.Contains(text, "DashScope video artifact fetch started") || !strings.Contains(text, "opened="+opened) {
				t.Fatalf("artifact opening stage incorrect: %s", text)
			}
		})
	}
}

// A provider failure names how far the request got, the status and the
// provider's request ID, and never the credential, query or body.
func TestProviderHTTPObservationRecordsPhasesWithoutSecrets(t *testing.T) {
	const apiKey = "sk-test-credential-value" // pragma: allowlist secret
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/overloaded":
			w.Header().Set("x-request-id", "req_abc123")
			w.WriteHeader(529)
			_, _ = w.Write([]byte(`{"error":{"type":"overloaded_error","message":"secret body text"}}`))
		case "/v1/drop":
			connection, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				_ = connection.Close()
			}
		default:
			w.Header().Set("request-id", "req_ok_1")
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(server.Close)
	logs := captureProviderLogs(t)
	backend := newBackend("cloud-test", server.URL, apiKey, nil, 5*time.Second, server.Client().Transport, false, true)

	send := func(ctx context.Context, path string) {
		t.Helper()
		request, err := backend.newRequest(ctx, http.MethodPost, server.URL+path+"?key="+apiKey, strings.NewReader(`{"prompt":"secret prompt"}`))
		if err != nil {
			t.Fatal(err)
		}
		if response, err := backend.do(request); err == nil {
			_ = response.Body.Close()
		}
	}
	send(context.Background(), "/v1/overloaded")
	send(context.Background(), "/v1/drop")
	send(context.Background(), "/v1/ok")
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	send(canceled, "/v1/ok")

	text := logs.String()
	for _, want := range []string{
		`msg="provider http error status" backend=cloud-test method=POST path=/v1/overloaded phase=response`,
		"status=529 request_id=req_abc123",
		`msg="provider http request failed" backend=cloud-test method=POST path=/v1/drop phase=awaiting_response`,
		`msg="provider http observation" backend=cloud-test method=POST path=/v1/ok phase=response`,
		"status=200 request_id=req_ok_1",
		`msg="provider http request canceled"`,
	} {
		if !strings.Contains(text, want) {
			t.Errorf("logs lack %q:\n%s", want, text)
		}
	}
	for _, secret := range []string{apiKey, "secret prompt", "secret body text", "key="} {
		if strings.Contains(text, secret) {
			t.Fatalf("logs contain %q:\n%s", secret, text)
		}
	}
	if strings.Count(text, "provider http request failed") != 1 {
		t.Fatalf("a caller cancellation was logged as a provider failure:\n%s", text)
	}
}

func TestEndpointResolutionFailureClassSeparatesDNSFromPolicy(t *testing.T) {
	for _, test := range []struct {
		err  error
		want string
	}{
		{&net.DNSError{Err: "timeout", Name: "api.example.com", IsTimeout: true}, "dns-timeout"},
		{&net.DNSError{Err: "no such host", Name: "api.example.com", IsNotFound: true}, "dns-not-found"},
		{&net.DNSError{Err: "server misbehaving", Name: "api.example.com"}, "dns"},
		{errors.New("endpointsec: no safe IP found"), "endpoint-policy"},
	} {
		if got := endpointResolutionFailureClass(test.err); got != test.want {
			t.Errorf("class(%v) = %q, want %q", test.err, got, test.want)
		}
	}
}

package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/metadata"
)

func TestSubmitScenarioJobSpeechSynthesizeCompletes(t *testing.T) {
	speechBytes := []byte("scenario-job-speech")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
	})
	req := &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/tts",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "hello scenario job",
				},
			},
		},
	}
	submitResp, err := svc.SubmitScenarioJob(context.Background(), req)
	if err != nil {
		t.Fatalf("submit scenario job: %v", err)
	}
	if submitResp.GetJob() == nil || submitResp.GetJob().GetJobId() == "" {
		t.Fatalf("submit scenario job should return job")
	}
	if submitResp.GetJob().GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
		t.Fatalf("scenario type mismatch: %v", submitResp.GetJob().GetScenarioType())
	}

	job := waitScenarioJobTerminal(t, svc, submitResp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED {
		t.Fatalf("expected completed, got=%v reason=%v detail=%q", job.GetStatus(), job.GetReasonCode(), job.GetReasonDetail())
	}
	artifactsResp, err := svc.GetScenarioArtifacts(context.Background(), &runtimev1.GetScenarioArtifactsRequest{
		JobId: job.GetJobId(),
	})
	if err != nil {
		t.Fatalf("get scenario artifacts: %v", err)
	}
	if len(artifactsResp.GetArtifacts()) == 0 {
		t.Fatalf("expected at least one artifact")
	}
	if artifactsResp.GetArtifacts()[0].GetMimeType() == "" {
		t.Fatalf("artifact mime type should be set")
	}
}

func TestSubmitScenarioJobStoresScenarioNativeState(t *testing.T) {
	speechBytes := []byte("scenario-native-store")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
	})
	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/tts",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "scenario native store",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit scenario job: %v", err)
	}
	jobID := submitResp.GetJob().GetJobId()
	if _, ok := svc.scenarioJobs.get(jobID); !ok {
		t.Fatalf("scenario job should be tracked in scenario job store")
	}
}

func TestSubscribeScenarioJobEventsForMediaScenario(t *testing.T) {
	speechBytes := []byte("scenario-events-speech")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/speech" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(speechBytes)
	}))
	defer server.Close()

	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
	})
	submitResp, err := svc.SubmitScenarioJob(context.Background(), &runtimev1.SubmitScenarioJobRequest{
		Head: &runtimev1.ScenarioRequestHead{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/tts",
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			TimeoutMs:     30_000,
		},
		ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
		Spec: &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text: "subscribe scenario events",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("submit scenario job: %v", err)
	}

	collector := &scenarioJobEventCollector{ctx: context.Background()}
	if err := svc.SubscribeScenarioJobEvents(&runtimev1.SubscribeScenarioJobEventsRequest{
		JobId: submitResp.GetJob().GetJobId(),
	}, collector); err != nil {
		t.Fatalf("subscribe scenario job events: %v", err)
	}
	if len(collector.events) == 0 {
		t.Fatalf("expected scenario job events")
	}

	var hasTerminal bool
	for _, event := range collector.events {
		if event.GetJob() == nil {
			t.Fatalf("event job should be populated")
		}
		if event.GetJob().GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE {
			t.Fatalf("event scenario type mismatch: %v", event.GetJob().GetScenarioType())
		}
		if isTerminalScenarioJobEvent(event.GetEventType()) {
			hasTerminal = true
		}
	}
	if !hasTerminal {
		t.Fatalf("expected at least one terminal event")
	}
}

func waitScenarioJobTerminal(t *testing.T, svc *Service, jobID string, timeout time.Duration) *runtimev1.ScenarioJob {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := svc.GetScenarioJob(context.Background(), &runtimev1.GetScenarioJobRequest{JobId: jobID})
		if err != nil {
			t.Fatalf("get scenario job: %v", err)
		}
		switch resp.GetJob().GetStatus() {
		case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
			runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
			return resp.GetJob()
		}
		time.Sleep(20 * time.Millisecond)
	}
	resp, err := svc.GetScenarioJob(context.Background(), &runtimev1.GetScenarioJobRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("get scenario job: %v", err)
	}
	t.Fatalf("scenario job timeout: id=%s status=%s", jobID, resp.GetJob().GetStatus().String())
	return nil
}

type scenarioJobEventCollector struct {
	ctx    context.Context
	events []*runtimev1.ScenarioJobEvent
}

func (s *scenarioJobEventCollector) Send(event *runtimev1.ScenarioJobEvent) error {
	s.events = append(s.events, event)
	return nil
}

func (s *scenarioJobEventCollector) SetHeader(_ metadata.MD) error  { return nil }
func (s *scenarioJobEventCollector) SendHeader(_ metadata.MD) error { return nil }
func (s *scenarioJobEventCollector) SetTrailer(_ metadata.MD)       {}
func (s *scenarioJobEventCollector) Context() context.Context       { return s.ctx }
func (s *scenarioJobEventCollector) SendMsg(any) error              { return nil }
func (s *scenarioJobEventCollector) RecvMsg(any) error              { return nil }

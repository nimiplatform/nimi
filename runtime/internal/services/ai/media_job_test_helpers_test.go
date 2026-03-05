package ai

import (
	"context"
	"encoding/base64"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

func TestSubmitMediaJobImageCompletes(t *testing.T) {
	imagePayload := []byte("image-payload")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + imageB64 + `","mime_type":"image/png"}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
	})
	resp, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt:         "blue car on mars",
				Size:           "1024x1024",
				ResponseFormat: "png",
			},
		},
	})
	if err != nil {
		t.Fatalf("submit media job: %v", err)
	}
	job := waitMediaJobTerminal(t, svc, resp.GetJob().GetJobId(), 3*time.Second)
	if job.GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED {
		t.Fatalf("job status mismatch: %v", job.GetStatus())
	}
	if len(job.GetArtifacts()) == 0 {
		t.Fatalf("expected at least one artifact")
	}
	artifact := job.GetArtifacts()[0]
	if artifact.GetMimeType() == "" || artifact.GetSha256() == "" || artifact.GetSizeBytes() == 0 {
		t.Fatalf("artifact metadata must be populated: %#v", artifact)
	}
	if artifact.GetWidth() != 1024 || artifact.GetHeight() != 1024 {
		t.Fatalf("artifact image dimensions mismatch: %dx%d", artifact.GetWidth(), artifact.GetHeight())
	}
	artifactsResp, err := svc.GetMediaArtifacts(context.Background(), &runtimev1.GetMediaArtifactsRequest{
		JobId: job.GetJobId(),
	})
	if err != nil {
		t.Fatalf("get media artifacts: %v", err)
	}
	if len(artifactsResp.GetArtifacts()) == 0 {
		t.Fatalf("expected artifacts in response")
	}
}

func TestSubmitMediaJobIdempotencyReturnsSameJob(t *testing.T) {
	imagePayload := []byte("idempotent-image")
	imageB64 := base64.StdEncoding.EncodeToString(imagePayload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + imageB64 + `","mime_type":"image/png"}]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{"localai": {BaseURL: server.URL}},
	})
	req := &runtimev1.SubmitMediaJobRequest{
		AppId:          "nimi.desktop",
		SubjectUserId:  "user-001",
		ModelId:        "local/sd3",
		Modal:          runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:    runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:       runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		IdempotencyKey: "idempotent-key-1",
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "idempotent prompt",
			},
		},
	}
	firstResp, err := svc.SubmitMediaJob(context.Background(), req)
	if err != nil {
		t.Fatalf("first submit media job: %v", err)
	}
	secondResp, err := svc.SubmitMediaJob(context.Background(), req)
	if err != nil {
		t.Fatalf("second submit media job: %v", err)
	}
	if firstResp.GetJob().GetJobId() == "" || secondResp.GetJob().GetJobId() == "" {
		t.Fatalf("job id must not be empty")
	}
	if firstResp.GetJob().GetJobId() != secondResp.GetJob().GetJobId() {
		t.Fatalf("idempotency must return same job id: first=%s second=%s", firstResp.GetJob().GetJobId(), secondResp.GetJob().GetJobId())
	}
}

func waitMediaJobTerminal(t *testing.T, svc *Service, jobID string, timeout time.Duration) *runtimev1.MediaJob {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		resp, err := svc.GetMediaJob(context.Background(), &runtimev1.GetMediaJobRequest{JobId: jobID})
		if err != nil {
			t.Fatalf("get media job: %v", err)
		}
		switch resp.GetJob().GetStatus() {
		case runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_FAILED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_CANCELED,
			runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_TIMEOUT:
			return resp.GetJob()
		}
		time.Sleep(20 * time.Millisecond)
	}
	resp, err := svc.GetMediaJob(context.Background(), &runtimev1.GetMediaJobRequest{JobId: jobID})
	if err != nil {
		t.Fatalf("get media job: %v", err)
	}
	t.Fatalf("media job timeout: id=%s status=%s", jobID, resp.GetJob().GetStatus().String())
	return nil
}

func structToMapPB(t *testing.T, input map[string]any) *structpb.Struct {
	t.Helper()
	value, err := structpb.NewStruct(input)
	if err != nil {
		t.Fatalf("create structpb: %v", err)
	}
	return value
}

func testVideoT2VSpec(prompt string, durationSec int32) *runtimev1.VideoGenerationSpec {
	options := &runtimev1.VideoGenerationOptions{}
	if durationSec > 0 {
		options.DurationSec = durationSec
	}
	return &runtimev1.VideoGenerationSpec{
		Prompt: prompt,
		Mode:   runtimev1.VideoMode_VIDEO_MODE_T2V,
		Content: []*runtimev1.VideoContentItem{
			{
				Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
				Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
				Text: prompt,
			},
		},
		Options: options,
	}
}

func testVideoI2VFirstFrameSpec(prompt, firstFrameURI string) *runtimev1.VideoGenerationSpec {
	content := []*runtimev1.VideoContentItem{
		{
			Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
			Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME,
			ImageUrl: &runtimev1.VideoContentImageURL{Url: firstFrameURI},
		},
	}
	if prompt != "" {
		content = append(content, &runtimev1.VideoContentItem{
			Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
			Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
			Text: prompt,
		})
	}
	return &runtimev1.VideoGenerationSpec{
		Prompt:  prompt,
		Mode:    runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME,
		Content: content,
		Options: &runtimev1.VideoGenerationOptions{},
	}
}

func testVideoI2VFirstLastSpec(prompt, firstFrameURI, lastFrameURI string) *runtimev1.VideoGenerationSpec {
	content := []*runtimev1.VideoContentItem{
		{
			Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
			Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME,
			ImageUrl: &runtimev1.VideoContentImageURL{Url: firstFrameURI},
		},
		{
			Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
			Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_LAST_FRAME,
			ImageUrl: &runtimev1.VideoContentImageURL{Url: lastFrameURI},
		},
	}
	if prompt != "" {
		content = append(content, &runtimev1.VideoContentItem{
			Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
			Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
			Text: prompt,
		})
	}
	return &runtimev1.VideoGenerationSpec{
		Prompt:  prompt,
		Mode:    runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST,
		Content: content,
		Options: &runtimev1.VideoGenerationOptions{},
	}
}

func testVideoI2VReferenceSpec(prompt string, referenceImageURIs []string) *runtimev1.VideoGenerationSpec {
	content := make([]*runtimev1.VideoContentItem, 0, len(referenceImageURIs)+1)
	for _, uri := range referenceImageURIs {
		content = append(content, &runtimev1.VideoContentItem{
			Type:     runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL,
			Role:     runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_REFERENCE_IMAGE,
			ImageUrl: &runtimev1.VideoContentImageURL{Url: uri},
		})
	}
	if prompt != "" {
		content = append(content, &runtimev1.VideoContentItem{
			Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT,
			Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT,
			Text: prompt,
		})
	}
	return &runtimev1.VideoGenerationSpec{
		Prompt:  prompt,
		Mode:    runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE,
		Content: content,
		Options: &runtimev1.VideoGenerationOptions{},
	}
}

type mediaJobEventCollector struct {
	mu     sync.Mutex
	ctx    context.Context
	events []*runtimev1.MediaJobEvent
}

func (s *mediaJobEventCollector) Send(event *runtimev1.MediaJobEvent) error {
	cloned := proto.Clone(event)
	copyEvent, ok := cloned.(*runtimev1.MediaJobEvent)
	if !ok {
		copyEvent = &runtimev1.MediaJobEvent{}
	}
	s.mu.Lock()
	s.events = append(s.events, copyEvent)
	s.mu.Unlock()
	return nil
}

func (s *mediaJobEventCollector) snapshot() []*runtimev1.MediaJobEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*runtimev1.MediaJobEvent, 0, len(s.events))
	out = append(out, s.events...)
	return out
}

func (s *mediaJobEventCollector) SetHeader(metadata.MD) error  { return nil }
func (s *mediaJobEventCollector) SendHeader(metadata.MD) error { return nil }
func (s *mediaJobEventCollector) SetTrailer(metadata.MD)       {}
func (s *mediaJobEventCollector) Context() context.Context     { return s.ctx }
func (s *mediaJobEventCollector) SendMsg(any) error            { return nil }
func (s *mediaJobEventCollector) RecvMsg(any) error            { return nil }

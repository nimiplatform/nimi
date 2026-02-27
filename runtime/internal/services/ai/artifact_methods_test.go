package ai

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestEmbedLegacyWrapper(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/embeddings" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"embedding":[0.1,0.2,0.3]}],"usage":{"prompt_tokens":4,"total_tokens":6}}`))
	}))
	defer server.Close()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		LocalAIBaseURL: server.URL,
	})

	_, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/embedding",
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("embed invalid request code mismatch: %v", status.Code(err))
	}

	resp, err := svc.Embed(context.Background(), &runtimev1.EmbedRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/embedding",
		Inputs:        []string{"first text"},
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	})
	if err != nil {
		t.Fatalf("embed success: %v", err)
	}
	if len(resp.GetVectors()) != 1 {
		t.Fatalf("embed vectors length mismatch: %d", len(resp.GetVectors()))
	}
	if got := len(resp.GetVectors()[0].GetValues()); got != 3 {
		t.Fatalf("embed vector size mismatch: %d", got)
	}
	if resp.GetUsage().GetInputTokens() != 4 || resp.GetUsage().GetOutputTokens() != 2 {
		t.Fatalf("embed usage mismatch: input=%d output=%d", resp.GetUsage().GetInputTokens(), resp.GetUsage().GetOutputTokens())
	}
}

func TestMediaJobStatusToErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		job  *runtimev1.MediaJob
		code codes.Code
	}{
		{
			name: "nil job",
			job:  nil,
			code: codes.Internal,
		},
		{
			name: "unspecified reason defaults unavailable",
			job:  &runtimev1.MediaJob{},
			code: codes.Unavailable,
		},
		{
			name: "input invalid",
			job:  &runtimev1.MediaJob{ReasonCode: runtimev1.ReasonCode_AI_INPUT_INVALID},
			code: codes.InvalidArgument,
		},
		{
			name: "model not found",
			job:  &runtimev1.MediaJob{ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_FOUND},
			code: codes.NotFound,
		},
		{
			name: "provider timeout",
			job:  &runtimev1.MediaJob{ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT},
			code: codes.DeadlineExceeded,
		},
		{
			name: "route unsupported",
			job:  &runtimev1.MediaJob{ReasonCode: runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED},
			code: codes.FailedPrecondition,
		},
		{
			name: "content filtered",
			job:  &runtimev1.MediaJob{ReasonCode: runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED},
			code: codes.PermissionDenied,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			err := mediaJobStatusToError(tc.job)
			if status.Code(err) != tc.code {
				t.Fatalf("status code mismatch: got=%v want=%v", status.Code(err), tc.code)
			}
		})
	}
}

package knowledge

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestKnowledgeIndexLifecycle(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	buildResp, err := svc.BuildIndex(ctx, &runtimev1.BuildIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "chat-memory",
		SourceUris: []string{
			"Alice likes sci-fi novels and writes every day.",
			"Bob prefers cooking content and weekend hiking.",
		},
		Overwrite: true,
	})
	if err != nil {
		t.Fatalf("build index: %v", err)
	}
	if !buildResp.Accepted {
		t.Fatalf("build index must be accepted")
	}

	searchResp, err := svc.SearchIndex(ctx, &runtimev1.SearchIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "chat-memory",
		Query:         "sci-fi",
		TopK:          3,
	})
	if err != nil {
		t.Fatalf("search index: %v", err)
	}
	if len(searchResp.Hits) == 0 {
		t.Fatalf("search must return at least one hit")
	}

	deleteResp, err := svc.DeleteIndex(ctx, &runtimev1.DeleteIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "chat-memory",
	})
	if err != nil {
		t.Fatalf("delete index: %v", err)
	}
	if !deleteResp.Ok {
		t.Fatalf("delete index must succeed")
	}

	searchAfterDelete, err := svc.SearchIndex(ctx, &runtimev1.SearchIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "chat-memory",
		Query:         "sci-fi",
		TopK:          3,
	})
	if err != nil {
		t.Fatalf("search after delete: %v", err)
	}
	if searchAfterDelete.ReasonCode != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("expected ACTION_EXECUTED after delete, got %v", searchAfterDelete.ReasonCode)
	}
	if len(searchAfterDelete.GetHits()) != 0 {
		t.Fatalf("expected no hits after delete, got %d", len(searchAfterDelete.GetHits()))
	}
}

func TestBuildIndexExistingNoOverwriteReasonCode(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	req := &runtimev1.BuildIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "chat-memory",
		SourceUris:    []string{"memory://chat/1"},
	}

	if _, err := svc.BuildIndex(ctx, req); err != nil {
		t.Fatalf("initial build: %v", err)
	}
	_, err := svc.BuildIndex(ctx, req)
	if status.Code(err) != codes.AlreadyExists {
		t.Fatalf("expected already exists, got %v", err)
	}
	if status.Convert(err).Message() != runtimev1.ReasonCode_KNOWLEDGE_INDEX_ALREADY_EXISTS.String() {
		t.Fatalf("unexpected reason: %s", status.Convert(err).Message())
	}
}

func TestSearchIndexNotFoundReturnsEmpty(t *testing.T) {
	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	resp, err := svc.SearchIndex(context.Background(), &runtimev1.SearchIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "missing",
		Query:         "hello",
	})
	if err != nil {
		t.Fatalf("search missing index: %v", err)
	}
	if resp.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("unexpected reason code: %v", resp.GetReasonCode())
	}
	if len(resp.GetHits()) != 0 {
		t.Fatalf("expected empty hits, got %d", len(resp.GetHits()))
	}
}

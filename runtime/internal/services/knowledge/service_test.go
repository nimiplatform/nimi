package knowledge

import (
	"context"
	"io"
	"log/slog"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
	if searchAfterDelete.ReasonCode != runtimev1.ReasonCode_APP_GRANT_INVALID {
		t.Fatalf("expected APP_GRANT_INVALID after delete, got %v", searchAfterDelete.ReasonCode)
	}
}

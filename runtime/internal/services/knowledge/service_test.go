package knowledge

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestKnowledgeIndexLifecycle(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	t.Run("build and search", func(t *testing.T) {
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
	})

	t.Run("delete clears index", func(t *testing.T) {
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
	})
}

func TestBuildIndexExistingNoOverwriteReasonCode(t *testing.T) {
	t.Parallel()

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

func TestBuildIndexRejectsCapacityOverflow(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.mu.Lock()
	for i := 0; i < maxKnowledgeIndexes; i++ {
		svc.indexes[indexKey("nimi.desktop", "user-001", "idx-"+string(rune('a'+(i%26)))+string(rune('A'+((i/26)%26)))+string(rune('0'+(i%10))))] = indexRecord{
			IndexID:       "filled",
			AppID:         "nimi.desktop",
			SubjectUserID: "user-001",
		}
	}
	svc.mu.Unlock()

	_, err := svc.BuildIndex(context.Background(), &runtimev1.BuildIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "overflow",
		SourceUris:    []string{"hello"},
	})
	if status.Code(err) != codes.ResourceExhausted {
		t.Fatalf("expected resource exhausted, got %v", err)
	}
	if status.Convert(err).Message() != "knowledge index capacity exceeded" {
		t.Fatalf("unexpected message: %v", err)
	}
}

func TestSearchIndexNotFoundReturnsEmpty(t *testing.T) {
	t.Parallel()

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

func TestBuildIndexRejectsInvalidKeyParts(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	_, err := svc.BuildIndex(context.Background(), &runtimev1.BuildIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user::001",
		IndexId:       "chat-memory",
		SourceUris:    []string{"hello"},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestSearchIndexClampsTopKAndPreservesRuneBoundaries(t *testing.T) {
	t.Parallel()

	svc := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	_, err := svc.BuildIndex(ctx, &runtimev1.BuildIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "chat-memory",
		SourceUris: []string{
			"你好世界你好世界你好世界你好世界你好世界你好世界你好世界你好世界你好世界你好世界你好世界你好世界query",
			"query second result",
		},
		Overwrite: true,
	})
	if err != nil {
		t.Fatalf("build index: %v", err)
	}

	resp, err := svc.SearchIndex(ctx, &runtimev1.SearchIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "chat-memory",
		Query:         "query",
		TopK:          999,
	})
	if err != nil {
		t.Fatalf("search index: %v", err)
	}
	if len(resp.GetHits()) != 2 {
		t.Fatalf("expected 2 hits, got %d", len(resp.GetHits()))
	}
	if !utf8.ValidString(resp.GetHits()[0].GetSnippet()) {
		t.Fatalf("snippet must preserve UTF-8 boundaries")
	}
}

func TestBuildIndexLogsIgnoredOptionalFields(t *testing.T) {
	t.Parallel()

	var logBuf bytes.Buffer
	svc := New(slog.New(slog.NewTextHandler(&logBuf, nil)))

	_, err := svc.BuildIndex(context.Background(), &runtimev1.BuildIndexRequest{
		AppId:            "nimi.desktop",
		SubjectUserId:    "user-001",
		IndexId:          "chat-memory",
		SourceKind:       "uri-list",
		EmbeddingModelId: "embed-model",
		SourceUris:       []string{"hello world"},
		Options:          mustStructPB(t, map[string]any{"chunk_size": 128}),
	})
	if err != nil {
		t.Fatalf("build index: %v", err)
	}
	logged := logBuf.String()
	if !strings.Contains(logged, "knowledge build_index ignored unsupported fields") {
		t.Fatalf("expected ignored-field warning, got %q", logged)
	}
	if !strings.Contains(logged, "source_kind=uri-list") || !strings.Contains(logged, "embedding_model_id=embed-model") {
		t.Fatalf("expected ignored fields in log, got %q", logged)
	}
}

func TestSearchIndexLogsIgnoredFilters(t *testing.T) {
	t.Parallel()

	var logBuf bytes.Buffer
	svc := New(slog.New(slog.NewTextHandler(&logBuf, nil)))
	ctx := context.Background()

	_, err := svc.BuildIndex(ctx, &runtimev1.BuildIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "chat-memory",
		SourceUris:    []string{"hello world"},
	})
	if err != nil {
		t.Fatalf("build index: %v", err)
	}

	_, err = svc.SearchIndex(ctx, &runtimev1.SearchIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		IndexId:       "chat-memory",
		Query:         "hello",
		Filters:       mustStructPB(t, map[string]any{"kind": "recent"}),
	})
	if err != nil {
		t.Fatalf("search index: %v", err)
	}
	if !strings.Contains(logBuf.String(), "knowledge search_index ignored unsupported filters") {
		t.Fatalf("expected ignored filters warning, got %q", logBuf.String())
	}
}

func mustStructPB(t *testing.T, input map[string]any) *structpb.Struct {
	t.Helper()
	value, err := structpb.NewStruct(input)
	if err != nil {
		t.Fatalf("structpb.NewStruct: %v", err)
	}
	return value
}

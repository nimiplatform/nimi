package knowledge

import (
	"context"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	defaultKnowledgeTopK = 5
	maxKnowledgeTopK     = 50
	maxKnowledgeSources  = 256
	maxKnowledgeIndexes  = 512
)

type document struct {
	DocumentID string
	SourceURI  string
	Text       string
}

type indexRecord struct {
	IndexID       string
	AppID         string
	SubjectUserID string
	Documents     []document
	UpdatedAt     time.Time
}

// Service implements RuntimeKnowledgeService with in-memory indexes.
type Service struct {
	runtimev1.UnimplementedRuntimeKnowledgeServiceServer
	logger *slog.Logger

	mu      sync.RWMutex
	indexes map[string]indexRecord
}

func New(logger *slog.Logger) *Service {
	return &Service{
		logger:  logger,
		indexes: make(map[string]indexRecord),
	}
}

func (s *Service) BuildIndex(_ context.Context, req *runtimev1.BuildIndexRequest) (*runtimev1.BuildIndexResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	indexID := strings.TrimSpace(req.GetIndexId())
	if appID == "" || subjectUserID == "" || indexID == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	if err := validateIndexKeyPart(appID, subjectUserID, indexID); err != nil {
		return nil, err
	}
	if len(req.GetSourceUris()) > maxKnowledgeSources {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	s.logIgnoredBuildIndexFields(req)

	key := indexKey(appID, subjectUserID, indexID)
	now := time.Now().UTC()
	taskID := ulid.Make().String()

	docs := make([]document, 0, len(req.GetSourceUris()))
	for _, uri := range req.GetSourceUris() {
		u := strings.TrimSpace(uri)
		if u == "" {
			continue
		}
		docs = append(docs, document{
			DocumentID: ulid.Make().String(),
			SourceURI:  u,
			Text:       documentTextFromSource(u),
		})
	}

	record := indexRecord{
		IndexID:       indexID,
		AppID:         appID,
		SubjectUserID: subjectUserID,
		Documents:     docs,
		UpdatedAt:     now,
	}

	s.mu.Lock()
	_, exists := s.indexes[key]
	if exists && !req.GetOverwrite() {
		s.mu.Unlock()
		return nil, status.Error(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_INDEX_ALREADY_EXISTS.String())
	}
	if !exists && len(s.indexes) >= maxKnowledgeIndexes {
		s.mu.Unlock()
		return nil, status.Error(codes.ResourceExhausted, "knowledge index capacity exceeded")
	}
	s.indexes[key] = record
	s.mu.Unlock()

	s.logger.Info("knowledge index built", "task_id", taskID, "index_id", indexID, "documents", len(docs), "app_id", appID)
	return &runtimev1.BuildIndexResponse{TaskId: taskID, Accepted: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) SearchIndex(_ context.Context, req *runtimev1.SearchIndexRequest) (*runtimev1.SearchIndexResponse, error) {
	appID := strings.TrimSpace(req.GetAppId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	indexID := strings.TrimSpace(req.GetIndexId())
	query := strings.TrimSpace(req.GetQuery())
	if appID == "" || subjectUserID == "" || indexID == "" || query == "" {
		return nil, status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
	}
	if err := validateIndexKeyPart(appID, subjectUserID, indexID); err != nil {
		return nil, err
	}
	s.logIgnoredSearchIndexFields(req)

	s.mu.RLock()
	record, exists := s.indexes[indexKey(appID, subjectUserID, indexID)]
	s.mu.RUnlock()
	if !exists {
		return &runtimev1.SearchIndexResponse{Hits: []*runtimev1.SearchHit{}, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
	}

	topK := int(req.GetTopK())
	if topK <= 0 {
		topK = defaultKnowledgeTopK
	} else if topK > maxKnowledgeTopK {
		topK = maxKnowledgeTopK
	}

	queryLower := strings.ToLower(query)
	hits := make([]*runtimev1.SearchHit, 0, len(record.Documents))
	for _, doc := range record.Documents {
		textLower := strings.ToLower(doc.Text)
		if !strings.Contains(textLower, queryLower) {
			continue
		}
		hit := &runtimev1.SearchHit{
			DocumentId: doc.DocumentID,
			Score:      1.0,
			Snippet:    snippet(doc.Text, query),
			Metadata: &structpb.Struct{Fields: map[string]*structpb.Value{
				"source_uri": structpb.NewStringValue(doc.SourceURI),
			}},
		}
		hits = append(hits, hit)
	}

	sort.Slice(hits, func(i, j int) bool {
		if hits[i].Score == hits[j].Score {
			return hits[i].DocumentId < hits[j].DocumentId
		}
		return hits[i].Score > hits[j].Score
	})
	if len(hits) > topK {
		hits = hits[:topK]
	}

	return &runtimev1.SearchIndexResponse{Hits: hits, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func (s *Service) DeleteIndex(_ context.Context, req *runtimev1.DeleteIndexRequest) (*runtimev1.Ack, error) {
	appID := strings.TrimSpace(req.GetAppId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	indexID := strings.TrimSpace(req.GetIndexId())
	if appID == "" || subjectUserID == "" || indexID == "" {
		return &runtimev1.Ack{Ok: false, ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID, ActionHint: "set app_id, subject_user_id, index_id"}, nil
	}
	if err := validateIndexKeyPart(appID, subjectUserID, indexID); err != nil {
		return nil, err
	}

	s.mu.Lock()
	delete(s.indexes, indexKey(appID, subjectUserID, indexID))
	s.mu.Unlock()

	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}, nil
}

func snippet(text string, query string) string {
	runes := []rune(text)
	if len(runes) <= 120 {
		return text
	}
	queryLower := strings.ToLower(query)
	textLower := strings.ToLower(text)
	idx := strings.Index(textLower, queryLower)
	if idx < 0 {
		return string(runes[:120])
	}
	start := utf8.RuneCountInString(text[:idx]) - 40
	if start < 0 {
		start = 0
	}
	end := start + 120
	if end > len(runes) {
		end = len(runes)
	}
	return string(runes[start:end])
}

func indexKey(appID string, subjectUserID string, indexID string) string {
	return appID + "::" + subjectUserID + "::" + indexID
}

func validateIndexKeyPart(parts ...string) error {
	for _, part := range parts {
		if strings.Contains(part, "::") {
			return status.Error(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID.String())
		}
	}
	return nil
}

func documentTextFromSource(source string) string {
	if strings.Contains(source, "://") {
		return ""
	}
	return source
}

func (s *Service) logIgnoredBuildIndexFields(req *runtimev1.BuildIndexRequest) {
	if s.logger == nil {
		return
	}
	if strings.TrimSpace(req.GetSourceKind()) == "" && strings.TrimSpace(req.GetEmbeddingModelId()) == "" && req.GetOptions() == nil {
		return
	}
	s.logger.Warn(
		"knowledge build_index ignored unsupported fields",
		"app_id", strings.TrimSpace(req.GetAppId()),
		"index_id", strings.TrimSpace(req.GetIndexId()),
		"source_kind", strings.TrimSpace(req.GetSourceKind()),
		"embedding_model_id", strings.TrimSpace(req.GetEmbeddingModelId()),
		"has_options", req.GetOptions() != nil,
	)
}

func (s *Service) logIgnoredSearchIndexFields(req *runtimev1.SearchIndexRequest) {
	if s.logger == nil || req.GetFilters() == nil {
		return
	}
	s.logger.Warn(
		"knowledge search_index ignored unsupported filters",
		"app_id", strings.TrimSpace(req.GetAppId()),
		"index_id", strings.TrimSpace(req.GetIndexId()),
	)
}

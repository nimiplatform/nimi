package cognition

import (
	"context"
	"strings"

	cognitionknowledge "github.com/nimiplatform/nimi/nimi-cognition/knowledge"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// IngestDocument enqueues an ingest task in the typed scope.
func (s *Service) IngestDocument(ctx context.Context, req *runtimev1.IngestDocumentRequest) (*runtimev1.IngestDocumentResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	slug := strings.TrimSpace(req.GetSlug())
	content := strings.TrimSpace(req.GetContent())
	if bankID == "" || slug == "" || content == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	scope, err := s.loadAuthorizedScope(ctx, req.GetContext(), req.GetBankId(), KnowledgeActionIngest)
	if err != nil {
		return nil, err
	}
	pageID := strings.TrimSpace(req.GetPageId())
	if pageID == "" {
		pageID = newULID()
	}
	env := cognitionknowledge.IngestEnvelope{
		PageID: cognitionknowledge.PageID(pageID),
		Kind:   projectionKindForEntityType(req.GetEntityType()),
		Title:  defaultPageTitle(slug, req.GetTitle()),
		Body:   mustMarshalJSON(storedKnowledgeBody{Content: content}),
	}
	task, err := s.cognitionCore.KnowledgeService().IngestDocument(scope.ScopeID, env)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	s.rememberIngestTaskProjection(task.TaskID, scope.ScopeID, slug, defaultPageTitle(slug, req.GetTitle()))
	return &runtimev1.IngestDocumentResponse{
		TaskId:     task.TaskID,
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) rememberIngestTaskProjection(taskID, bankID, slug, title string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ingestTasks[strings.TrimSpace(taskID)] = ingestTaskProjection{
		BankID: strings.TrimSpace(bankID),
		Slug:   strings.TrimSpace(slug),
		Title:  strings.TrimSpace(title),
	}
}

func (s *Service) ingestTaskProjectionFor(taskID string) (ingestTaskProjection, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	projection, ok := s.ingestTasks[strings.TrimSpace(taskID)]
	return projection, ok
}

// GetIngestTask reads a task by id, scanning the caller's accessible
// scopes since proto envelope does not bind task to bank.
func (s *Service) GetIngestTask(ctx context.Context, req *runtimev1.GetIngestTaskRequest) (*runtimev1.GetIngestTaskResponse, error) {
	if err := validateKnowledgeContext(req.GetContext()); err != nil {
		return nil, err
	}
	taskID := strings.TrimSpace(req.GetTaskId())
	if taskID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	scopes, err := s.listAuthorizedScopes(ctx, req.GetContext())
	if err != nil {
		return nil, err
	}
	for _, scope := range scopes {
		task, err := s.cognitionCore.KnowledgeService().GetIngestTask(scope.ScopeID, taskID)
		if err != nil {
			continue
		}
		return &runtimev1.GetIngestTaskResponse{Task: s.projectIngestTask(scope.ScopeID, task)}, nil
	}
	return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
}

func cognitionTaskToRuntime(bankID string, task *cognitionknowledge.IngestTask) *runtimev1.KnowledgeIngestTask {
	if task == nil {
		return nil
	}
	status := runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_UNSPECIFIED
	switch task.Status {
	case cognitionknowledge.IngestTaskStatusQueued:
		status = runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_QUEUED
	case cognitionknowledge.IngestTaskStatusRunning:
		status = runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_RUNNING
	case cognitionknowledge.IngestTaskStatusCompleted:
		status = runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED
	case cognitionknowledge.IngestTaskStatusFailed:
		status = runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_FAILED
	}
	reason := runtimev1.ReasonCode_ACTION_EXECUTED
	if task.Status == cognitionknowledge.IngestTaskStatusFailed {
		reason = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
	return &runtimev1.KnowledgeIngestTask{
		TaskId:          task.TaskID,
		BankId:          bankID,
		PageId:          string(task.PageID),
		Status:          status,
		ProgressPercent: int32(task.ProgressPercent),
		ReasonCode:      reason,
		ActionHint:      strings.TrimSpace(task.Error),
		CreatedAt:       timestamppb.New(task.CreatedAt),
		UpdatedAt:       timestamppb.New(task.UpdatedAt),
	}
}

func (s *Service) projectIngestTask(bankID string, task *cognitionknowledge.IngestTask) *runtimev1.KnowledgeIngestTask {
	runtimeTask := cognitionTaskToRuntime(bankID, task)
	if runtimeTask == nil {
		return nil
	}
	if projection, ok := s.ingestTaskProjectionFor(runtimeTask.GetTaskId()); ok {
		if runtimeTask.GetBankId() == "" {
			runtimeTask.BankId = projection.BankID
		}
		if runtimeTask.GetSlug() == "" {
			runtimeTask.Slug = projection.Slug
		}
		if runtimeTask.GetTitle() == "" {
			runtimeTask.Title = projection.Title
		}
	}
	if runtimeTask.GetPageId() != "" && (runtimeTask.GetSlug() == "" || runtimeTask.GetTitle() == "") {
		page, err := s.resolveKnowledgePage(bankID, bankID, runtimeTask.GetPageId(), "")
		if err == nil && page != nil {
			if runtimeTask.GetSlug() == "" {
				runtimeTask.Slug = page.GetSlug()
			}
			if runtimeTask.GetTitle() == "" {
				runtimeTask.Title = page.GetTitle()
			}
		}
	}
	return runtimeTask
}

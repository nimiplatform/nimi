package knowledge

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) IngestDocument(_ context.Context, req *runtimev1.IngestDocumentRequest) (*runtimev1.IngestDocumentResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	bankID := strings.TrimSpace(req.GetBankId())
	slug := strings.TrimSpace(req.GetSlug())
	content := strings.TrimSpace(req.GetContent())
	if bankID == "" || slug == "" || content == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.Lock()
	state := s.banksByID[bankID]
	if state == nil || state.Bank == nil {
		s.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	now := time.Now().UTC()
	task := &runtimev1.KnowledgeIngestTask{
		TaskId:          ulid.Make().String(),
		BankId:          bankID,
		PageId:          strings.TrimSpace(req.GetPageId()),
		Slug:            slug,
		Title:           defaultPageTitle(slug, req.GetTitle()),
		Status:          runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_QUEUED,
		ProgressPercent: 0,
		ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
		CreatedAt:       timestamppb.New(now),
		UpdatedAt:       timestamppb.New(now),
	}
	s.ingestTasksByID[task.GetTaskId()] = &ingestTaskState{
		Task:  task,
		AppID: strings.TrimSpace(req.GetContext().GetAppId()),
	}
	if err := s.persistLocked(); err != nil {
		delete(s.ingestTasksByID, task.GetTaskId())
		s.mu.Unlock()
		return nil, err
	}
	s.mu.Unlock()

	go s.runIngestTask(cloneIngestDocumentRequest(req), task.GetTaskId())

	return &runtimev1.IngestDocumentResponse{
		TaskId:     task.GetTaskId(),
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) GetIngestTask(_ context.Context, req *runtimev1.GetIngestTaskRequest) (*runtimev1.GetIngestTaskResponse, error) {
	if err := validateRequestContext(req.GetContext()); err != nil {
		return nil, err
	}
	taskID := strings.TrimSpace(req.GetTaskId())
	if taskID == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}

	s.mu.RLock()
	taskState := s.ingestTasksByID[taskID]
	s.mu.RUnlock()
	if taskState == nil || taskState.Task == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
	}
	if err := authorizeIngestTask(req.GetContext(), taskState); err != nil {
		return nil, err
	}
	return &runtimev1.GetIngestTaskResponse{Task: cloneKnowledgeIngestTask(taskState.Task)}, nil
}

func (s *Service) runIngestTask(req *runtimev1.IngestDocumentRequest, taskID string) {
	if err := s.setIngestTaskStatus(taskID, runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_RUNNING, 25, runtimev1.ReasonCode_ACTION_EXECUTED, "", ""); err != nil {
		s.logger.Warn("knowledge ingest task start persist failed", "task_id", taskID, "error", err)
		return
	}

	page, err := s.applyIngestDocument(taskID, req)
	if err != nil {
		reason := runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		if extracted, ok := grpcerr.ExtractReasonCode(err); ok {
			reason = extracted
		}
		actionHint := ""
		if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
			actionHint = strings.TrimSpace(metadata["action_hint"])
		}
		if actionHint == "" {
			actionHint = strings.TrimSpace(err.Error())
		}
		if updateErr := s.setIngestTaskStatus(taskID, runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_FAILED, 100, reason, "", actionHint); updateErr != nil {
			s.logger.Warn("knowledge ingest task failure persist failed", "task_id", taskID, "error", updateErr)
		}
		return
	}
	if err := s.setIngestTaskStatus(taskID, runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED, 100, runtimev1.ReasonCode_ACTION_EXECUTED, page.GetPageId(), ""); err != nil {
		s.logger.Warn("knowledge ingest task completion persist failed", "task_id", taskID, "error", err)
	}
}

func (s *Service) applyIngestDocument(taskID string, req *runtimev1.IngestDocumentRequest) (*runtimev1.KnowledgePage, error) {
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()

	taskState := s.ingestTasksByID[taskID]
	if taskState == nil || taskState.Task == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
	}
	state := s.banksByID[strings.TrimSpace(req.GetBankId())]
	if state == nil || state.Bank == nil {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_BANK_NOT_FOUND)
	}
	if strings.TrimSpace(taskState.AppID) != "" && strings.TrimSpace(taskState.AppID) != strings.TrimSpace(req.GetContext().GetAppId()) {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_KNOWLEDGE_BANK_ACCESS_DENIED)
	}
	if err := authorizeBank(req.GetContext(), state.Bank); err != nil {
		return nil, err
	}
	pageID := strings.TrimSpace(req.GetPageId())
	slug := strings.TrimSpace(req.GetSlug())
	slugOwnerPageID, slugTaken := state.SlugToPage[slug]
	if pageID != "" && slugTaken && slugOwnerPageID != pageID {
		return nil, grpcerr.WithReasonCode(codes.AlreadyExists, runtimev1.ReasonCode_KNOWLEDGE_PAGE_SLUG_CONFLICT)
	}
	previousBank := cloneBankState(state)
	previousTask := cloneIngestTaskState(taskState)
	page := upsertPageLocked(state, &runtimev1.PutPageRequest{
		Context:    req.GetContext(),
		BankId:     req.GetBankId(),
		PageId:     req.GetPageId(),
		Slug:       req.GetSlug(),
		Title:      req.GetTitle(),
		Content:    req.GetContent(),
		EntityType: req.GetEntityType(),
		Metadata:   req.GetMetadata(),
	}, now)
	taskState.Task.PageId = page.GetPageId()
	taskState.Task.ProgressPercent = 80
	taskState.Task.UpdatedAt = timestamppb.New(now)
	taskState.Task.ReasonCode = runtimev1.ReasonCode_ACTION_EXECUTED
	if err := s.persistLocked(); err != nil {
		s.banksByID[state.Bank.GetBankId()] = previousBank
		s.ingestTasksByID[taskID] = previousTask
		return nil, err
	}
	return cloneKnowledgePage(page), nil
}

func (s *Service) setIngestTaskStatus(taskID string, status runtimev1.KnowledgeIngestTaskStatus, progressPercent int32, reason runtimev1.ReasonCode, pageID string, actionHint string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	taskState := s.ingestTasksByID[taskID]
	if taskState == nil || taskState.Task == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_KNOWLEDGE_INGEST_TASK_NOT_FOUND)
	}
	previous := cloneIngestTaskState(taskState)
	taskState.Task.Status = status
	taskState.Task.ProgressPercent = clampTaskProgress(progressPercent)
	taskState.Task.ReasonCode = reason
	taskState.Task.ActionHint = strings.TrimSpace(actionHint)
	if strings.TrimSpace(pageID) != "" {
		taskState.Task.PageId = strings.TrimSpace(pageID)
	}
	taskState.Task.UpdatedAt = timestamppb.New(time.Now().UTC())
	if err := s.persistLocked(); err != nil {
		s.ingestTasksByID[taskID] = previous
		return err
	}
	return nil
}

func clampTaskProgress(value int32) int32 {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

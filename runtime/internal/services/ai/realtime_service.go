package ai

import (
	"context"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
)

func (s *Service) OpenRealtimeSession(ctx context.Context, req *runtimev1.OpenRealtimeSessionRequest) (*runtimev1.OpenRealtimeSessionResponse, error) {
	if req == nil || req.GetHead() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	if _, err := scenarioAppAIConfigCaller(ctx, req.GetHead()); err != nil {
		return nil, err
	}
	return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}

func (s *Service) AppendRealtimeInput(ctx context.Context, req *runtimev1.AppendRealtimeInputRequest) (*runtimev1.AppendRealtimeInputResponse, error) {
	record, ok := s.realtimeSessions.get(req.GetSessionId())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	if err := authorizeRealtimeSession(ctx, record); err != nil {
		return nil, err
	}
	record.mu.Lock()
	closed := record.closed
	record.mu.Unlock()
	if closed {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}

	return &runtimev1.AppendRealtimeInputResponse{
		Ack: &runtimev1.Ack{
			Ok: true,
		},
		TraceId: record.traceID,
	}, nil
}

func (s *Service) ReadRealtimeEvents(req *runtimev1.ReadRealtimeEventsRequest, stream runtimev1.RuntimeAiRealtimeService_ReadRealtimeEventsServer) error {
	record, ok := s.realtimeSessions.get(req.GetSessionId())
	if !ok {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	if err := authorizeRealtimeSession(stream.Context(), record); err != nil {
		return err
	}
	backlog, ch, closed, conflict := s.realtimeSessions.claimReader(req.GetSessionId(), req.GetAfterSequence())
	if conflict {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	if ch == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	defer s.realtimeSessions.releaseReader(req.GetSessionId())
	for _, event := range backlog {
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	if closed {
		return nil
	}
	for {
		select {
		case <-stream.Context().Done():
			if err := rpcctx.ContextDoneError(stream.Context()); err == nil {
				return nil
			}
			return rpcctx.ContextDoneError(stream.Context())
		case event, ok := <-ch:
			if !ok {
				return nil
			}
			if event == nil {
				continue
			}
			if err := stream.Send(event); err != nil {
				return err
			}
		}
	}
}

func (s *Service) CloseRealtimeSession(ctx context.Context, req *runtimev1.CloseRealtimeSessionRequest) (*runtimev1.CloseRealtimeSessionResponse, error) {
	record, ok := s.realtimeSessions.get(req.GetSessionId())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	if err := authorizeRealtimeSession(ctx, record); err != nil {
		return nil, err
	}
	record.mu.Lock()
	alreadyClosed := record.closed
	record.closed = true
	record.mu.Unlock()
	if !alreadyClosed {
		s.realtimeSessions.appendEvent(record.sessionID, &runtimev1.RealtimeEvent{
			EventType: runtimev1.RealtimeEventType_REALTIME_EVENT_COMPLETED,
			TraceId:   record.traceID,
			Timestamp: timestamppb.New(time.Now().UTC()),
			Payload: &runtimev1.RealtimeEvent_Completed{
				Completed: &runtimev1.RealtimeCompleted{
					FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				},
			},
		})
	}
	s.realtimeSessions.close(record.sessionID)
	return &runtimev1.CloseRealtimeSessionResponse{
		Ack: &runtimev1.Ack{Ok: true},
	}, nil
}

func authorizeRealtimeSession(ctx context.Context, record *realtimeSessionRecord) error {
	if record == nil {
		return grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
	}
	expectedAppID := strings.TrimSpace(record.appID)
	expectedSubject := strings.TrimSpace(record.subjectUserID)
	if expectedAppID == "" || expectedSubject == "" {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	appID := incomingAppID(ctx)
	if appID == "" || expectedAppID != appID {
		return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if identity := authn.IdentityFromContext(ctx); identity != nil {
		actualSubject := strings.TrimSpace(identity.SubjectUserID)
		if actualSubject == "" || expectedSubject != actualSubject {
			return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
		}
	}
	return nil
}

func incomingAppID(ctx context.Context) string {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ""
	}
	values := md.Get(metadataAppIDKey)
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func looksLikeLocalFilePath(value string) bool {
	if strings.HasPrefix(value, "/") || strings.HasPrefix(value, "\\") {
		return true
	}
	if strings.HasPrefix(value, "./") || strings.HasPrefix(value, "../") || strings.HasPrefix(value, ".\\") || strings.HasPrefix(value, "..\\") {
		return true
	}
	if strings.HasPrefix(value, "~/") || strings.HasPrefix(value, "~\\") {
		return true
	}
	if len(value) >= 3 && value[1] == ':' && (value[2] == '\\' || value[2] == '/') {
		return true
	}
	return false
}

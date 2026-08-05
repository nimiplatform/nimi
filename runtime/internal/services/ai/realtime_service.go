package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/rpcctx"
)

type realtimeConn interface {
	Send(v any) error
	Receive(v any) error
	Close() error
}

func (s *Service) OpenRealtimeSession(ctx context.Context, req *runtimev1.OpenRealtimeSessionRequest) (*runtimev1.OpenRealtimeSessionResponse, error) {
	if req == nil || req.GetHead() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	_, intent, err := s.captureScenarioExecutionIntent(ctx, req.GetHead(), "text.generate")
	if err != nil {
		return nil, err
	}
	if intent.IsCloud() {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
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

	needsResponse := false
	for _, item := range req.GetItems() {
		if item == nil || item.Item == nil {
			continue
		}
		switch payload := item.Item.(type) {
		case *runtimev1.RealtimeInputItem_Message:
			message := payload.Message
			if message == nil {
				continue
			}
			if err := validateRealtimeTextMessage(message); err != nil {
				return nil, err
			}
			text := composeInputText("", []*runtimev1.ChatMessage{message})
			if err := sendRealtimeEnvelope(record, map[string]any{
				"type": "conversation.item.create",
				"item": map[string]any{
					"type": "message",
					"role": firstRealtimeRole(message.GetRole()),
					"content": []map[string]any{
						{
							"type": "input_text",
							"text": strings.TrimSpace(text),
						},
					},
				},
			}); err != nil {
				return nil, err
			}
			needsResponse = true
		case *runtimev1.RealtimeInputItem_Audio:
			audio := payload.Audio
			if audio == nil {
				continue
			}
			bytesValue, err := s.resolveRealtimeAudioBytes(ctx, record, audio)
			if err != nil {
				return nil, err
			}
			for _, chunk := range splitRealtimeAudio(bytesValue, 24<<10) {
				if err := sendRealtimeEnvelope(record, map[string]any{
					"type":  "input_audio_buffer.append",
					"audio": base64.StdEncoding.EncodeToString(chunk),
				}); err != nil {
					return nil, err
				}
			}
			if audio.GetEndOfTurn() {
				if err := sendRealtimeEnvelope(record, map[string]any{"type": "input_audio_buffer.commit"}); err != nil {
					return nil, err
				}
				needsResponse = true
			}
		default:
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	if needsResponse {
		if err := sendRealtimeEnvelope(record, map[string]any{
			"type": "response.create",
			"response": map[string]any{
				"modalities": []string{"text", "audio"},
			},
		}); err != nil {
			return nil, err
		}
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

func (s *Service) consumeRealtimeEvents(record *realtimeSessionRecord) {
	if record == nil {
		return
	}
	record.mu.Lock()
	conn := record.conn
	record.mu.Unlock()
	if conn == nil {
		return
	}
	for {
		var payload map[string]any
		if err := conn.Receive(&payload); err != nil {
			if !errors.Is(err, io.EOF) {
				s.realtimeSessions.appendEvent(record.sessionID, &runtimev1.RealtimeEvent{
					EventType: runtimev1.RealtimeEventType_REALTIME_EVENT_FAILED,
					TraceId:   record.traceID,
					Timestamp: timestamppb.New(time.Now().UTC()),
					Payload: &runtimev1.RealtimeEvent_Failed{
						Failed: &runtimev1.RealtimeFailed{
							ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
							ActionHint: "check_realtime_execution_host",
						},
					},
				})
			}
			s.realtimeSessions.close(record.sessionID)
			return
		}
		s.mapRealtimeEnvelope(record, payload)
	}
}

func (s *Service) mapRealtimeEnvelope(record *realtimeSessionRecord, payload map[string]any) {
	eventType := strings.TrimSpace(readMapString(payload, "type"))
	switch eventType {
	case "session.created":
		return
	case "response.text.delta", "response.output_text.delta":
		delta := strings.TrimSpace(readMapString(payload, "delta"))
		if delta == "" {
			return
		}
		s.realtimeSessions.appendEvent(record.sessionID, &runtimev1.RealtimeEvent{
			EventType: runtimev1.RealtimeEventType_REALTIME_EVENT_TEXT_DELTA,
			TraceId:   record.traceID,
			Timestamp: timestamppb.New(time.Now().UTC()),
			Payload: &runtimev1.RealtimeEvent_TextDelta{
				TextDelta: &runtimev1.RealtimeTextDelta{Text: delta},
			},
		})
	case "response.audio.delta", "response.output_audio.delta":
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(readMapString(payload, "delta")))
		if err != nil || len(decoded) == 0 {
			return
		}
		s.realtimeSessions.appendEvent(record.sessionID, &runtimev1.RealtimeEvent{
			EventType: runtimev1.RealtimeEventType_REALTIME_EVENT_AUDIO_CHUNK,
			TraceId:   record.traceID,
			Timestamp: timestamppb.New(time.Now().UTC()),
			Payload: &runtimev1.RealtimeEvent_AudioChunk{
				AudioChunk: &runtimev1.RealtimeAudioChunk{
					Chunk: decoded,
				},
			},
		})
	case "response.audio.done", "response.output_audio.done", "response.done":
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
	case "error":
		s.realtimeSessions.appendEvent(record.sessionID, &runtimev1.RealtimeEvent{
			EventType: runtimev1.RealtimeEventType_REALTIME_EVENT_FAILED,
			TraceId:   record.traceID,
			Timestamp: timestamppb.New(time.Now().UTC()),
			Payload: &runtimev1.RealtimeEvent_Failed{
				Failed: &runtimev1.RealtimeFailed{
					ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_INTERNAL,
					ActionHint: strings.TrimSpace(readNestedMapString(payload, "error", "code")),
				},
			},
		})
	}
}

func sendRealtimeEnvelope(record *realtimeSessionRecord, payload map[string]any) error {
	if record == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	record.sendMu.Lock()
	defer record.sendMu.Unlock()
	record.mu.Lock()
	closed := record.closed
	conn := record.conn
	record.mu.Unlock()
	if closed || conn == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	if err := conn.Send(payload); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err, grpcerr.ReasonOptions{
			Message: "realtime provider request could not be sent",
		})
	}
	return nil
}

func validateRealtimeTextMessage(message *runtimev1.ChatMessage) error {
	if message == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	for _, part := range message.GetParts() {
		if part == nil {
			continue
		}
		if part.GetType() != runtimev1.ChatContentPartType_CHAT_CONTENT_PART_TYPE_TEXT {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
	}
	if strings.TrimSpace(composeInputText("", []*runtimev1.ChatMessage{message})) == "" {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return nil
}

func firstRealtimeRole(role string) string {
	normalized := strings.ToLower(strings.TrimSpace(role))
	switch normalized {
	case "assistant", "system":
		return normalized
	default:
		return "user"
	}
}

func (s *Service) resolveRealtimeAudioBytes(ctx context.Context, record *realtimeSessionRecord, input *runtimev1.RealtimeAudioInput) ([]byte, error) {
	if input == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	switch source := input.Source.(type) {
	case *runtimev1.RealtimeAudioInput_AudioBytes:
		if len(source.AudioBytes) == 0 {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		return source.AudioBytes, nil
	case *runtimev1.RealtimeAudioInput_AudioUri:
		return readRealtimeLocationBytes(ctx, strings.TrimSpace(source.AudioUri))
	case *runtimev1.RealtimeAudioInput_ArtifactRef:
		ref := source.ArtifactRef
		if ref == nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if artifactID := strings.TrimSpace(ref.GetArtifactId()); artifactID != "" {
			artifact, _, ok := s.scenarioJobs.findArtifact(record.appID, record.subjectUserID, artifactID)
			if !ok || artifact == nil {
				return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
			}
			if len(artifact.GetBytes()) > 0 {
				return artifact.GetBytes(), nil
			}
			return readRealtimeLocationBytes(ctx, strings.TrimSpace(artifact.GetUri()))
		}
		if localArtifactID := strings.TrimSpace(ref.GetLocalArtifactId()); localArtifactID != "" {
			if s.localImageProfile == nil {
				return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
			}
			path, err := s.localImageProfile.ResolveManagedAssetPath(ctx, localArtifactID)
			if err != nil {
				return nil, err
			}
			return readRealtimeLocationBytes(ctx, path)
		}
	}
	return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
}

func readRealtimeLocationBytes(ctx context.Context, location string) ([]byte, error) {
	value := strings.TrimSpace(location)
	if value == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "data:") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		transport, err := endpointsec.NewPinnedTransport(ctx, value, false)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN, err, grpcerr.ReasonOptions{
				Message: "realtime input location is not allowed",
			})
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, value, nil)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{
				Message: "realtime input request could not be created",
			})
		}
		resp, err := (&http.Client{Timeout: 30 * time.Second, Transport: transport}).Do(req)
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err, grpcerr.ReasonOptions{
				Message: "realtime input could not be fetched",
			})
		}
		defer func() { _ = resp.Body.Close() }()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, maxUploadedArtifactBytes+1))
		if err != nil {
			return nil, grpcerr.WrapWithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, err, grpcerr.ReasonOptions{
				Message: "realtime input body could not be read",
			})
		}
		if len(data) == 0 {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		if len(data) > maxUploadedArtifactBytes {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
		}
		return data, nil
	}
	if strings.HasPrefix(lower, "file://") {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if looksLikeLocalFilePath(value) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
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

func splitRealtimeAudio(payload []byte, chunkSize int) [][]byte {
	if len(payload) == 0 {
		return nil
	}
	if chunkSize <= 0 {
		chunkSize = len(payload)
	}
	out := make([][]byte, 0, (len(payload)+chunkSize-1)/chunkSize)
	for start := 0; start < len(payload); start += chunkSize {
		end := start + chunkSize
		if end > len(payload) {
			end = len(payload)
		}
		out = append(out, payload[start:end])
	}
	return out
}

func readMapString(record map[string]any, key string) string {
	if record == nil {
		return ""
	}
	value, ok := record[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func readNestedMapString(record map[string]any, key string, nested string) string {
	if record == nil {
		return ""
	}
	value, ok := record[key].(map[string]any)
	if !ok {
		return ""
	}
	return readMapString(value, nested)
}

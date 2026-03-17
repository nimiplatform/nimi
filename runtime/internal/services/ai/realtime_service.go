package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"golang.org/x/net/websocket"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type realtimeConn interface {
	Send(v any) error
	Receive(v any) error
	Close() error
}

type websocketRealtimeConn struct {
	conn *websocket.Conn
}

var realtimeDialer = dialLocalAIRealtime

func (c *websocketRealtimeConn) Send(v any) error {
	return websocket.JSON.Send(c.conn, v)
}

func (c *websocketRealtimeConn) Receive(v any) error {
	return websocket.JSON.Receive(c.conn, v)
}

func (c *websocketRealtimeConn) Close() error {
	return c.conn.Close()
}

func (s *Service) OpenRealtimeSession(ctx context.Context, req *runtimev1.OpenRealtimeSessionRequest) (*runtimev1.OpenRealtimeSessionResponse, error) {
	if req == nil || req.GetHead() == nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	remoteTarget, err := s.prepareScenarioRequest(ctx, req.GetHead(), runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE)
	if err != nil {
		return nil, err
	}
	selectedProvider, routeDecision, modelResolved, _, err := s.selector.resolveProviderWithTarget(
		ctx,
		req.GetHead().GetRoutePolicy(),
		req.GetHead().GetFallback(),
		req.GetHead().GetModelId(),
		remoteTarget,
	)
	if err != nil {
		return nil, err
	}
	if routeDecision != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || inferScenarioProviderType(modelResolved, remoteTarget, selectedProvider, runtimev1.Modal_MODAL_UNSPECIFIED) != "llama" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	backend, realtimeModel, err := resolveLlamaRealtimeBackend(selectedProvider, modelResolved)
	if err != nil {
		return nil, err
	}
	conn, err := realtimeDialer(ctx, backend, realtimeModel)
	if err != nil {
		return nil, err
	}

	sessionID := "rt_" + ulid.Make().String()
	traceID := ulid.Make().String()
	record := s.realtimeSessions.create(&realtimeSessionRecord{
		sessionID:     sessionID,
		appID:         strings.TrimSpace(req.GetHead().GetAppId()),
		subjectUserID: strings.TrimSpace(req.GetHead().GetSubjectUserId()),
		modelResolved: modelResolved,
		traceID:       traceID,
		routeDecision: routeDecision,
		conn:          conn,
		events:        make([]*runtimev1.RealtimeEvent, 0, 16),
	})
	if record == nil {
		_ = conn.Close()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	s.realtimeSessions.appendEvent(sessionID, &runtimev1.RealtimeEvent{
		EventType: runtimev1.RealtimeEventType_REALTIME_EVENT_OPENED,
		TraceId:   traceID,
		Timestamp: timestamppb.New(time.Now().UTC()),
		Payload: &runtimev1.RealtimeEvent_Opened{
			Opened: &runtimev1.RealtimeSessionOpened{
				SessionId:     sessionID,
				ModelResolved: modelResolved,
				RouteDecision: routeDecision,
			},
		},
	})
	if instructions := strings.TrimSpace(req.GetSystemPrompt()); instructions != "" {
		_ = sendRealtimeEnvelope(record, map[string]any{
			"type": "session.update",
			"session": map[string]any{
				"instructions": instructions,
			},
		})
	}
	go s.consumeRealtimeEvents(record)

	return &runtimev1.OpenRealtimeSessionResponse{
		SessionId:     sessionID,
		RouteDecision: routeDecision,
		ModelResolved: modelResolved,
		TraceId:       traceID,
	}, nil
}

func (s *Service) AppendRealtimeInput(ctx context.Context, req *runtimev1.AppendRealtimeInputRequest) (*runtimev1.AppendRealtimeInputResponse, error) {
	record, ok := s.realtimeSessions.get(req.GetSessionId())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
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
			return stream.Context().Err()
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

func (s *Service) CloseRealtimeSession(_ context.Context, req *runtimev1.CloseRealtimeSessionRequest) (*runtimev1.CloseRealtimeSessionResponse, error) {
	record, ok := s.realtimeSessions.get(req.GetSessionId())
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_REALTIME_SESSION_NOT_FOUND)
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
	if record.conn != nil {
		_ = record.conn.Close()
	}
	s.realtimeSessions.close(record.sessionID)
	return &runtimev1.CloseRealtimeSessionResponse{
		Ack: &runtimev1.Ack{Ok: true},
	}, nil
}

func (s *Service) consumeRealtimeEvents(record *realtimeSessionRecord) {
	if record == nil || record.conn == nil {
		return
	}
	for {
		var payload map[string]any
		if err := record.conn.Receive(&payload); err != nil {
			if !errors.Is(err, io.EOF) {
				s.realtimeSessions.appendEvent(record.sessionID, &runtimev1.RealtimeEvent{
					EventType: runtimev1.RealtimeEventType_REALTIME_EVENT_FAILED,
					TraceId:   record.traceID,
					Timestamp: timestamppb.New(time.Now().UTC()),
					Payload: &runtimev1.RealtimeEvent_Failed{
						Failed: &runtimev1.RealtimeFailed{
							ReasonCode: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
							ActionHint: "check_llama_realtime_endpoint",
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

func resolveLlamaRealtimeBackend(selected provider, modelResolved string) (*nimillm.Backend, string, error) {
	local, ok := selected.(*localProvider)
	if !ok || local == nil {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	backend, resolvedModel := local.ResolveMediaBackend("llama/" + strings.TrimSpace(modelResolved))
	if backend == nil {
		return nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	return backend, resolvedModel, nil
}

func dialLocalAIRealtime(ctx context.Context, backend *nimillm.Backend, modelID string) (realtimeConn, error) {
	if backend == nil || strings.TrimSpace(backend.Endpoint()) == "" || strings.TrimSpace(modelID) == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	targetURL, err := url.Parse(strings.TrimSpace(backend.Endpoint()))
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	switch targetURL.Scheme {
	case "https":
		targetURL.Scheme = "wss"
	default:
		targetURL.Scheme = "ws"
	}
	targetURL.Path = "/v1/realtime"
	query := targetURL.Query()
	query.Set("model", strings.TrimSpace(modelID))
	targetURL.RawQuery = query.Encode()
	config, err := websocket.NewConfig(targetURL.String(), realtimeWebsocketOrigin(targetURL))
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL)
	}
	connection, err := websocket.DialConfig(config)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	return &websocketRealtimeConn{conn: connection}, nil
}

func realtimeWebsocketOrigin(targetURL *url.URL) string {
	if targetURL == nil {
		return "http://localhost"
	}
	scheme := "http"
	if targetURL.Scheme == "wss" || targetURL.Scheme == "https" {
		scheme = "https"
	}
	host := strings.TrimSpace(targetURL.Host)
	if host == "" {
		host = "localhost"
	}
	return scheme + "://" + host
}

func sendRealtimeEnvelope(record *realtimeSessionRecord, payload map[string]any) error {
	if record == nil || record.conn == nil {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	record.sendMu.Lock()
	defer record.sendMu.Unlock()
	if err := record.conn.Send(payload); err != nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
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
			path, err := s.localImageProfile.ResolveLocalAIArtifactPath(ctx, localArtifactID)
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
		if err := endpointsec.ValidateEndpoint(value, false); err != nil {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, value, nil)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		resp, err := (&http.Client{}).Do(req)
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, maxUploadedArtifactBytes+1))
		if err != nil {
			return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
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
		parsed, err := url.Parse(value)
		if err == nil {
			value = parsed.Path
		}
	}
	data, err := os.ReadFile(value)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if len(data) == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if len(data) > maxUploadedArtifactBytes {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_ARTIFACT_UPLOAD_TOO_LARGE)
	}
	return data, nil
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

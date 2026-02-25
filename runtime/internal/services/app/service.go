package app

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type subscriber struct {
	id            uint64
	appID         string
	subjectUserID string
	fromAppFilter map[string]bool
	ch            chan *runtimev1.AppMessageEvent
}

// Service implements RuntimeAppService with in-memory pub/sub channels.
type Service struct {
	runtimev1.UnimplementedRuntimeAppServiceServer
	logger *slog.Logger

	mu          sync.RWMutex
	nextSeq     uint64
	nextSubID   uint64
	subscribers map[uint64]subscriber
}

func New(logger *slog.Logger) *Service {
	return &Service{
		logger:      logger,
		subscribers: make(map[uint64]subscriber),
	}
}

func (s *Service) SendAppMessage(_ context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
	fromAppID := strings.TrimSpace(req.GetFromAppId())
	toAppID := strings.TrimSpace(req.GetToAppId())
	subjectUserID := strings.TrimSpace(req.GetSubjectUserId())
	messageType := strings.TrimSpace(req.GetMessageType())
	if fromAppID == "" || toAppID == "" || subjectUserID == "" || messageType == "" {
		return &runtimev1.SendAppMessageResponse{
			MessageId:  "",
			Accepted:   false,
			ReasonCode: runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID,
		}, nil
	}

	messageID := ulid.Make().String()
	traceID := ulid.Make().String()
	now := time.Now().UTC()

	receivedEvent := &runtimev1.AppMessageEvent{
		EventType:     runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_RECEIVED,
		MessageId:     messageID,
		FromAppId:     fromAppID,
		ToAppId:       toAppID,
		SubjectUserId: subjectUserID,
		MessageType:   messageType,
		Payload:       clonePayload(req.GetPayload()),
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       traceID,
		Timestamp:     timestamppb.New(now),
	}
	s.publish(receivedEvent)

	if req.GetRequireAck() {
		ackEvent := &runtimev1.AppMessageEvent{
			EventType:     runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_ACKED,
			MessageId:     messageID,
			FromAppId:     fromAppID,
			ToAppId:       toAppID,
			SubjectUserId: subjectUserID,
			MessageType:   messageType,
			ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
			TraceId:       traceID,
			Timestamp:     timestamppb.New(time.Now().UTC()),
		}
		s.publish(ackEvent)
	}

	s.logger.Info("app message sent", "message_id", messageID, "from_app_id", fromAppID, "to_app_id", toAppID, "subject_user_id", subjectUserID)
	return &runtimev1.SendAppMessageResponse{
		MessageId:  messageID,
		Accepted:   true,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
	}, nil
}

func (s *Service) SubscribeAppMessages(req *runtimev1.SubscribeAppMessagesRequest, stream runtimev1.RuntimeAppService_SubscribeAppMessagesServer) error {
	sub := s.addSubscriber(req)
	defer s.removeSubscriber(sub.id)

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case event, ok := <-sub.ch:
			if !ok {
				return nil
			}
			if err := stream.Send(event); err != nil {
				return err
			}
		}
	}
}

func (s *Service) addSubscriber(req *runtimev1.SubscribeAppMessagesRequest) subscriber {
	filter := make(map[string]bool, len(req.GetFromAppIds()))
	for _, appID := range req.GetFromAppIds() {
		trimmed := strings.TrimSpace(appID)
		if trimmed == "" {
			continue
		}
		filter[trimmed] = true
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.nextSubID++
	sub := subscriber{
		id:            s.nextSubID,
		appID:         strings.TrimSpace(req.GetAppId()),
		subjectUserID: strings.TrimSpace(req.GetSubjectUserId()),
		fromAppFilter: filter,
		ch:            make(chan *runtimev1.AppMessageEvent, 32),
	}
	s.subscribers[sub.id] = sub
	return sub
}

func (s *Service) removeSubscriber(id uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	sub, exists := s.subscribers[id]
	if !exists {
		return
	}
	delete(s.subscribers, id)
	close(sub.ch)
}

func (s *Service) publish(event *runtimev1.AppMessageEvent) {
	s.mu.Lock()
	s.nextSeq++
	event.Sequence = s.nextSeq

	// Snapshot subscribers under lock then fanout without blocking the service path.
	targets := make([]subscriber, 0, len(s.subscribers))
	for _, sub := range s.subscribers {
		targets = append(targets, sub)
	}
	s.mu.Unlock()

	for _, sub := range targets {
		if !matches(sub, event) {
			continue
		}
		eventCopy := cloneEvent(event)
		select {
		case sub.ch <- eventCopy:
			continue
		default:
		}

		// Drop oldest and push latest to preserve monotonic forward progress.
		select {
		case <-sub.ch:
		default:
		}
		select {
		case sub.ch <- eventCopy:
		default:
		}
	}
}

func matches(sub subscriber, event *runtimev1.AppMessageEvent) bool {
	if sub.appID != "" && sub.appID != event.GetToAppId() {
		return false
	}
	if sub.subjectUserID != "" && sub.subjectUserID != event.GetSubjectUserId() {
		return false
	}
	if len(sub.fromAppFilter) > 0 && !sub.fromAppFilter[event.GetFromAppId()] {
		return false
	}
	return true
}

func cloneEvent(event *runtimev1.AppMessageEvent) *runtimev1.AppMessageEvent {
	cloned := proto.Clone(event)
	copy, ok := cloned.(*runtimev1.AppMessageEvent)
	if !ok {
		return &runtimev1.AppMessageEvent{}
	}
	return copy
}

func clonePayload(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	copy, ok := cloned.(*structpb.Struct)
	if !ok {
		return nil
	}
	return copy
}

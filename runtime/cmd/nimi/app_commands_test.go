package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRunRuntimeAppSendJSON(t *testing.T) {
	service := &cmdTestRuntimeAppService{
		sendResponse: &runtimev1.SendAppMessageResponse{
			MessageId:  "msg-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeAppServer(t, service)
	defer shutdown()

	payloadFile := writeTempJSONFile(t, "app-payload-*.json", `{"note_id":"n1","title":"hello"}`)
	output, err := captureStdoutFromRun(func() error {
		return runRuntimeApp([]string{
			"send",
			"--grpc-addr", addr,
			"--from-app-id", "app.writer",
			"--to-app-id", "app.reader",
			"--payload-file", payloadFile,
			"--require-ack",
			"--session-id", "session-1",
			"--session-token", "session-token-1",
			"--json",
			"--caller-id", "cli:app-send",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeApp send: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal send output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["message_id"]) != "msg-1" {
		t.Fatalf("message id mismatch: %v", payload["message_id"])
	}
	req := service.lastSendRequest()
	if req.GetPayload().GetFields()["note_id"].GetStringValue() != "n1" {
		t.Fatalf("payload mismatch: %+v", req.GetPayload().AsMap())
	}
	md := service.lastSendMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "cli:app-send" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-session-id"); got != "session-1" {
		t.Fatalf("session-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-session-token"); got != "session-token-1" {
		t.Fatalf("session-token mismatch: %q", got)
	}
	if req.GetSubjectUserId() != "" {
		t.Fatalf("subject user id should be optional, got %q", req.GetSubjectUserId())
	}
	if req.GetMessageType() != "" {
		t.Fatalf("message type should be optional, got %q", req.GetMessageType())
	}
}

func TestRunRuntimeAppWatchJSON(t *testing.T) {
	service := &cmdTestRuntimeAppService{
		events: []*runtimev1.AppMessageEvent{
			{
				EventType:     runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_RECEIVED,
				Sequence:      1,
				MessageId:     "msg-1",
				FromAppId:     "app.writer",
				ToAppId:       "app.reader",
				SubjectUserId: "user-1",
				MessageType:   "note.created",
				Payload: &structpb.Struct{Fields: map[string]*structpb.Value{
					"note_id": structpb.NewStringValue("n1"),
				}},
				ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
				TraceId:    "trace-app-1",
				Timestamp:  timestamppb.Now(),
			},
			{
				EventType:     runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_ACKED,
				Sequence:      2,
				MessageId:     "msg-1",
				FromAppId:     "app.writer",
				ToAppId:       "app.reader",
				SubjectUserId: "user-1",
				MessageType:   "note.created",
				ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
				TraceId:       "trace-app-1",
				Timestamp:     timestamppb.Now(),
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeAppServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeApp([]string{
			"watch",
			"--grpc-addr", addr,
			"--app-id", "app.reader",
			"--subject-user-id", "user-1",
			"--json",
			"--caller-id", "cli:app-watch",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeApp watch: %v", err)
	}

	lines := splitNonEmptyLines(output)
	if len(lines) != 2 {
		t.Fatalf("watch line count mismatch: got=%d output=%q", len(lines), output)
	}
	var event map[string]any
	if unmarshalErr := json.Unmarshal([]byte(lines[0]), &event); unmarshalErr != nil {
		t.Fatalf("unmarshal watch event: %v", unmarshalErr)
	}
	if asString(event["event_type"]) != runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_RECEIVED.String() {
		t.Fatalf("event type mismatch: %v", event["event_type"])
	}

	md := service.lastWatchMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "cli:app-watch" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
}

func startCmdTestRuntimeAppServer(t *testing.T, service runtimev1.RuntimeAppServiceServer) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeAppServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

type cmdTestRuntimeAppService struct {
	runtimev1.UnimplementedRuntimeAppServiceServer

	mu sync.Mutex

	sendMD       metadata.MD
	watchMD      metadata.MD
	sendReq      *runtimev1.SendAppMessageRequest
	sendResponse *runtimev1.SendAppMessageResponse
	events       []*runtimev1.AppMessageEvent
}

func (s *cmdTestRuntimeAppService) SendAppMessage(ctx context.Context, req *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sendMD = cloneIncomingMetadata(ctx)
	s.sendReq = req
	if s.sendResponse != nil {
		return s.sendResponse, nil
	}
	return nil, errors.New("send response not configured")
}

func (s *cmdTestRuntimeAppService) SubscribeAppMessages(_ *runtimev1.SubscribeAppMessagesRequest, stream grpc.ServerStreamingServer[runtimev1.AppMessageEvent]) error {
	s.mu.Lock()
	s.watchMD = cloneIncomingMetadata(stream.Context())
	events := append([]*runtimev1.AppMessageEvent(nil), s.events...)
	s.mu.Unlock()
	for _, event := range events {
		if event == nil {
			continue
		}
		if err := stream.Send(event); err != nil {
			return err
		}
	}
	return nil
}

func (s *cmdTestRuntimeAppService) lastSendRequest() *runtimev1.SendAppMessageRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sendReq == nil {
		return &runtimev1.SendAppMessageRequest{}
	}
	return s.sendReq
}

func (s *cmdTestRuntimeAppService) lastSendMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sendMD.Copy()
}

func (s *cmdTestRuntimeAppService) lastWatchMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.watchMD.Copy()
}

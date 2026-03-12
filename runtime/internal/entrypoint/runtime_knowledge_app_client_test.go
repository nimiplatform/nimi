package entrypoint

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestKnowledgeGRPCWrappers_MetadataAndRequests(t *testing.T) {
	service := &testRuntimeKnowledgeService{
		buildResponse: &runtimev1.BuildIndexResponse{
			TaskId:     "task-index-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		searchResponse: &runtimev1.SearchIndexResponse{
			Hits: []*runtimev1.SearchHit{
				{
					DocumentId: "doc-1",
					Score:      1,
					Snippet:    "hello world",
					Metadata: &structpb.Struct{Fields: map[string]*structpb.Value{
						"source_uri": structpb.NewStringValue("memory://doc-1"),
					}},
				},
			},
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		deleteResponse: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	buildResp, err := BuildKnowledgeIndexGRPC(addr, 3*time.Second, &runtimev1.BuildIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-1",
		IndexId:       "chat-index",
		SourceKind:    "messages",
		SourceUris:    []string{"memory://chat/1"},
		Overwrite:     true,
	}, &ClientMetadata{
		CallerID: "svc:knowledge-build",
	})
	if err != nil {
		t.Fatalf("BuildKnowledgeIndexGRPC: %v", err)
	}
	if buildResp.GetTaskId() != "task-index-1" {
		t.Fatalf("task id mismatch: %s", buildResp.GetTaskId())
	}

	searchResp, err := SearchKnowledgeIndexGRPC(addr, 3*time.Second, &runtimev1.SearchIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-1",
		IndexId:       "chat-index",
		Query:         "hello",
		TopK:          5,
	}, &ClientMetadata{
		CallerID: "svc:knowledge-search",
	})
	if err != nil {
		t.Fatalf("SearchKnowledgeIndexGRPC: %v", err)
	}
	if len(searchResp.GetHits()) != 1 {
		t.Fatalf("hits mismatch: %d", len(searchResp.GetHits()))
	}

	deleteResp, err := DeleteKnowledgeIndexGRPC(addr, 3*time.Second, &runtimev1.DeleteIndexRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-1",
		IndexId:       "chat-index",
	}, &ClientMetadata{
		CallerID: "svc:knowledge-delete",
	})
	if err != nil {
		t.Fatalf("DeleteKnowledgeIndexGRPC: %v", err)
	}
	if !deleteResp.GetOk() {
		t.Fatalf("delete response not ok")
	}

	md := service.lastBuildMetadata()
	if got := firstMetadataValue(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "svc:knowledge-build" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
}

func TestAppGRPCWrappers_MetadataAndStream(t *testing.T) {
	service := &testRuntimeAppService{
		sendResponse: &runtimev1.SendAppMessageResponse{
			MessageId:  "msg-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		events: []*runtimev1.AppMessageEvent{
			{
				EventType:     runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_RECEIVED,
				Sequence:      1,
				MessageId:     "msg-1",
				FromAppId:     "app.a",
				ToAppId:       "app.b",
				SubjectUserId: "user-1",
				MessageType:   "note.created",
				ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
				TraceId:       "trace-app-1",
				Timestamp:     timestamppb.Now(),
			},
			{
				EventType:     runtimev1.AppMessageEventType_APP_MESSAGE_EVENT_ACKED,
				Sequence:      2,
				MessageId:     "msg-1",
				FromAppId:     "app.a",
				ToAppId:       "app.b",
				SubjectUserId: "user-1",
				MessageType:   "note.created",
				ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
				TraceId:       "trace-app-1",
				Timestamp:     timestamppb.Now(),
			},
		},
	}
	addr, shutdown := startTestRuntimeAppServer(t, service)
	defer shutdown()

	sendResp, err := SendAppMessageGRPC(addr, 3*time.Second, &runtimev1.SendAppMessageRequest{
		FromAppId:     "app.a",
		ToAppId:       "app.b",
		SubjectUserId: "user-1",
		MessageType:   "note.created",
		RequireAck:    true,
	}, &ClientMetadata{
		CallerID:     "svc:app-send",
		TraceID:      "trace-app-send",
		SessionID:    "session-1",
		SessionToken: "session-token-1",
	})
	if err != nil {
		t.Fatalf("SendAppMessageGRPC: %v", err)
	}
	if sendResp.GetMessageId() != "msg-1" {
		t.Fatalf("message id mismatch: %s", sendResp.GetMessageId())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	events, errCh, err := SubscribeAppMessagesGRPC(ctx, addr, &runtimev1.SubscribeAppMessagesRequest{
		AppId:         "app.b",
		SubjectUserId: "user-1",
	}, &ClientMetadata{
		CallerID: "svc:app-watch",
		TraceID:  "trace-app-watch",
	})
	if err != nil {
		t.Fatalf("SubscribeAppMessagesGRPC: %v", err)
	}

	collected := make([]*runtimev1.AppMessageEvent, 0, 2)
	for events != nil || errCh != nil {
		select {
		case streamErr, ok := <-errCh:
			if !ok {
				errCh = nil
				continue
			}
			if streamErr != nil {
				t.Fatalf("stream error: %v", streamErr)
			}
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			collected = append(collected, event)
		}
	}
	if len(collected) != 2 {
		t.Fatalf("event count mismatch: %d", len(collected))
	}
	if collected[0].GetMessageId() != "msg-1" {
		t.Fatalf("event message id mismatch: %s", collected[0].GetMessageId())
	}

	sendMD := service.lastSendMetadata()
	if got := firstMetadataValue(sendMD, "x-nimi-caller-id"); got != "svc:app-send" {
		t.Fatalf("send caller-id mismatch: %q", got)
	}
	if got := firstMetadataValue(sendMD, "x-nimi-app-id"); got != "app.a" {
		t.Fatalf("send app-id mismatch: %q", got)
	}
	if got := firstMetadataValue(sendMD, "x-nimi-session-id"); got != "session-1" {
		t.Fatalf("send session-id mismatch: %q", got)
	}
	if got := firstMetadataValue(sendMD, "x-nimi-session-token"); got != "session-token-1" {
		t.Fatalf("send session-token mismatch: %q", got)
	}
}

func startTestRuntimeKnowledgeServer(t *testing.T, service runtimev1.RuntimeKnowledgeServiceServer) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeKnowledgeServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

func startTestRuntimeAppServer(t *testing.T, service runtimev1.RuntimeAppServiceServer) (string, func()) {
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

type testRuntimeKnowledgeService struct {
	runtimev1.UnimplementedRuntimeKnowledgeServiceServer

	mu sync.Mutex

	buildMD metadata.MD

	buildResponse  *runtimev1.BuildIndexResponse
	searchResponse *runtimev1.SearchIndexResponse
	deleteResponse *runtimev1.Ack
}

func (s *testRuntimeKnowledgeService) BuildIndex(ctx context.Context, _ *runtimev1.BuildIndexRequest) (*runtimev1.BuildIndexResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buildMD = cloneMetadata(ctx)
	if s.buildResponse != nil {
		return s.buildResponse, nil
	}
	return nil, errors.New("build response not configured")
}

func (s *testRuntimeKnowledgeService) SearchIndex(context.Context, *runtimev1.SearchIndexRequest) (*runtimev1.SearchIndexResponse, error) {
	if s.searchResponse != nil {
		return s.searchResponse, nil
	}
	return nil, errors.New("search response not configured")
}

func (s *testRuntimeKnowledgeService) DeleteIndex(context.Context, *runtimev1.DeleteIndexRequest) (*runtimev1.Ack, error) {
	if s.deleteResponse != nil {
		return s.deleteResponse, nil
	}
	return nil, errors.New("delete response not configured")
}

func (s *testRuntimeKnowledgeService) lastBuildMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buildMD.Copy()
}

type testRuntimeAppService struct {
	runtimev1.UnimplementedRuntimeAppServiceServer

	mu sync.Mutex

	sendMD metadata.MD

	sendResponse *runtimev1.SendAppMessageResponse
	events       []*runtimev1.AppMessageEvent
}

func (s *testRuntimeAppService) SendAppMessage(ctx context.Context, _ *runtimev1.SendAppMessageRequest) (*runtimev1.SendAppMessageResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sendMD = cloneMetadata(ctx)
	if s.sendResponse != nil {
		return s.sendResponse, nil
	}
	return nil, errors.New("send response not configured")
}

func (s *testRuntimeAppService) SubscribeAppMessages(_ *runtimev1.SubscribeAppMessagesRequest, stream grpc.ServerStreamingServer[runtimev1.AppMessageEvent]) error {
	s.mu.Lock()
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

func (s *testRuntimeAppService) lastSendMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sendMD.Copy()
}

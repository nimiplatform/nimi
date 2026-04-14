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
		createBankResponse: &runtimev1.CreateKnowledgeBankResponse{
			Bank: &runtimev1.KnowledgeBank{
				BankId:      "bank-1",
				DisplayName: "Desktop Knowledge",
				Locator: &runtimev1.KnowledgeBankLocator{
					Scope: runtimev1.KnowledgeBankScope_KNOWLEDGE_BANK_SCOPE_APP_PRIVATE,
					Owner: &runtimev1.KnowledgeBankLocator_AppPrivate{
						AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
					},
				},
			},
		},
		putPageResponse: &runtimev1.PutPageResponse{
			Page: &runtimev1.KnowledgePage{
				PageId: "page-1",
				BankId: "bank-1",
				Slug:   "alice-profile",
				Title:  "Alice",
			},
		},
		ingestDocumentResponse: &runtimev1.IngestDocumentResponse{
			TaskId:     "ingest-task-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		getIngestTaskResponse: &runtimev1.GetIngestTaskResponse{
			Task: &runtimev1.KnowledgeIngestTask{
				TaskId:          "ingest-task-1",
				BankId:          "bank-1",
				PageId:          "page-3",
				Slug:            "alice-handbook",
				Title:           "Alice Handbook",
				Status:          runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED,
				ProgressPercent: 100,
				ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
				CreatedAt:       timestamppb.Now(),
				UpdatedAt:       timestamppb.Now(),
			},
		},
		searchResponse: &runtimev1.SearchKeywordResponse{
			Hits: []*runtimev1.KnowledgeKeywordHit{
				{
					BankId:   "bank-1",
					PageId:   "page-1",
					Slug:     "alice-profile",
					Title:    "Alice",
					Score:    1,
					Snippet:  "hello world",
					Metadata: &structpb.Struct{Fields: map[string]*structpb.Value{"entity_type": structpb.NewStringValue("person")}},
				},
			},
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		searchHybridResponse: &runtimev1.SearchHybridResponse{
			Hits: []*runtimev1.KnowledgeKeywordHit{
				{
					BankId:   "bank-1",
					PageId:   "page-2",
					Slug:     "alice-roadmap",
					Title:    "Alice Roadmap",
					Score:    0.91,
					Snippet:  "integration roadmap",
					Metadata: &structpb.Struct{Fields: map[string]*structpb.Value{"entity_type": structpb.NewStringValue("plan")}},
				},
			},
			NextPageToken: "hybrid-page-2",
			ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		addLinkResponse: &runtimev1.AddLinkResponse{
			Link: &runtimev1.KnowledgeLink{
				LinkId:     "link-1",
				BankId:     "bank-1",
				FromPageId: "page-1",
				ToPageId:   "page-2",
				LinkType:   "references",
			},
		},
		listLinksResponse: &runtimev1.ListLinksResponse{
			Links: []*runtimev1.KnowledgeGraphEdge{
				{
					Link: &runtimev1.KnowledgeLink{
						LinkId:     "link-1",
						BankId:     "bank-1",
						FromPageId: "page-1",
						ToPageId:   "page-2",
						LinkType:   "references",
					},
					FromSlug: "alice-profile",
					ToSlug:   "alice-roadmap",
				},
			},
			NextPageToken: "links-page-2",
		},
		listBacklinksResponse: &runtimev1.ListBacklinksResponse{
			Backlinks: []*runtimev1.KnowledgeGraphEdge{
				{
					Link: &runtimev1.KnowledgeLink{
						LinkId:     "link-1",
						BankId:     "bank-1",
						FromPageId: "page-1",
						ToPageId:   "page-2",
						LinkType:   "references",
					},
					FromSlug: "alice-profile",
					ToSlug:   "alice-roadmap",
				},
			},
		},
		traverseGraphResponse: &runtimev1.TraverseGraphResponse{
			Nodes: []*runtimev1.KnowledgeGraphNode{
				{BankId: "bank-1", PageId: "page-1", Slug: "alice-profile", Depth: 0},
				{BankId: "bank-1", PageId: "page-2", Slug: "alice-roadmap", Depth: 1},
			},
			NextPageToken: "graph-page-2",
		},
		removeLinkResponse: &runtimev1.RemoveLinkResponse{
			Ack: &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED},
		},
		deleteBankResponse: &runtimev1.DeleteKnowledgeBankResponse{
			Ack: &runtimev1.Ack{
				Ok:         true,
				ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
			},
		},
	}
	addr, shutdown := startTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	createResp, err := CreateKnowledgeBankGRPC(addr, 3*time.Second, &runtimev1.CreateKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
		},
		Locator: &runtimev1.PublicKnowledgeBankLocator{
			Locator: &runtimev1.PublicKnowledgeBankLocator_AppPrivate{
				AppPrivate: &runtimev1.KnowledgeAppPrivateOwner{AppId: "nimi.desktop"},
			},
		},
		DisplayName: "Desktop Knowledge",
	}, &ClientMetadata{
		CallerID: "svc:knowledge-create-bank",
	})
	if err != nil {
		t.Fatalf("CreateKnowledgeBankGRPC: %v", err)
	}
	if createResp.GetBank().GetBankId() != "bank-1" {
		t.Fatalf("bank id mismatch: %s", createResp.GetBank().GetBankId())
	}

	putResp, err := PutKnowledgePageGRPC(addr, 3*time.Second, &runtimev1.PutPageRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
		},
		BankId:  "bank-1",
		Slug:    "alice-profile",
		Title:   "Alice",
		Content: "hello world",
	}, &ClientMetadata{
		CallerID: "svc:knowledge-put-page",
	})
	if err != nil {
		t.Fatalf("PutKnowledgePageGRPC: %v", err)
	}
	if putResp.GetPage().GetPageId() != "page-1" {
		t.Fatalf("page id mismatch: %s", putResp.GetPage().GetPageId())
	}

	ingestResp, err := IngestKnowledgeDocumentGRPC(addr, 3*time.Second, &runtimev1.IngestDocumentRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
		},
		BankId:  "bank-1",
		Slug:    "alice-handbook",
		Title:   "Alice Handbook",
		Content: "async ingest body",
	}, &ClientMetadata{
		CallerID: "svc:knowledge-ingest-document",
	})
	if err != nil {
		t.Fatalf("IngestKnowledgeDocumentGRPC: %v", err)
	}
	if ingestResp.GetTaskId() != "ingest-task-1" || !ingestResp.GetAccepted() {
		t.Fatalf("ingest response mismatch: %+v", ingestResp)
	}

	getTaskResp, err := GetKnowledgeIngestTaskGRPC(addr, 3*time.Second, &runtimev1.GetIngestTaskRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
		},
		TaskId: "ingest-task-1",
	}, &ClientMetadata{
		CallerID: "svc:knowledge-get-ingest-task",
	})
	if err != nil {
		t.Fatalf("GetKnowledgeIngestTaskGRPC: %v", err)
	}
	if getTaskResp.GetTask().GetStatus() != runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED {
		t.Fatalf("get ingest task response mismatch: %+v", getTaskResp)
	}

	searchResp, err := SearchKnowledgeKeywordGRPC(addr, 3*time.Second, &runtimev1.SearchKeywordRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
		},
		BankIds: []string{"bank-1"},
		Query:   "hello",
		TopK:    5,
	}, &ClientMetadata{
		CallerID: "svc:knowledge-search",
	})
	if err != nil {
		t.Fatalf("SearchKnowledgeKeywordGRPC: %v", err)
	}
	if len(searchResp.GetHits()) != 1 {
		t.Fatalf("hits mismatch: %d", len(searchResp.GetHits()))
	}

	searchHybridResp, err := SearchKnowledgeHybridGRPC(addr, 3*time.Second, &runtimev1.SearchHybridRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
		},
		BankId:   "bank-1",
		Query:    "integration roadmap",
		PageSize: 2,
	}, &ClientMetadata{
		CallerID: "svc:knowledge-search-hybrid",
	})
	if err != nil {
		t.Fatalf("SearchKnowledgeHybridGRPC: %v", err)
	}
	if len(searchHybridResp.GetHits()) != 1 || searchHybridResp.GetNextPageToken() != "hybrid-page-2" {
		t.Fatalf("hybrid response mismatch: %+v", searchHybridResp)
	}

	addLinkResp, err := AddKnowledgeLinkGRPC(addr, 3*time.Second, &runtimev1.AddLinkRequest{
		Context:    &runtimev1.KnowledgeRequestContext{AppId: "nimi.desktop", SubjectUserId: "user-1"},
		BankId:     "bank-1",
		FromPageId: "page-1",
		ToPageId:   "page-2",
		LinkType:   "references",
	}, &ClientMetadata{CallerID: "svc:knowledge-add-link"})
	if err != nil {
		t.Fatalf("AddKnowledgeLinkGRPC: %v", err)
	}
	if addLinkResp.GetLink().GetLinkId() != "link-1" {
		t.Fatalf("add link response mismatch: %+v", addLinkResp)
	}

	listLinksResp, err := ListKnowledgeLinksGRPC(addr, 3*time.Second, &runtimev1.ListLinksRequest{
		Context:    &runtimev1.KnowledgeRequestContext{AppId: "nimi.desktop", SubjectUserId: "user-1"},
		BankId:     "bank-1",
		FromPageId: "page-1",
		PageSize:   5,
	}, &ClientMetadata{CallerID: "svc:knowledge-list-links"})
	if err != nil {
		t.Fatalf("ListKnowledgeLinksGRPC: %v", err)
	}
	if len(listLinksResp.GetLinks()) != 1 || listLinksResp.GetNextPageToken() != "links-page-2" {
		t.Fatalf("list links response mismatch: %+v", listLinksResp)
	}

	listBacklinksResp, err := ListKnowledgeBacklinksGRPC(addr, 3*time.Second, &runtimev1.ListBacklinksRequest{
		Context:  &runtimev1.KnowledgeRequestContext{AppId: "nimi.desktop", SubjectUserId: "user-1"},
		BankId:   "bank-1",
		ToPageId: "page-2",
		PageSize: 5,
	}, &ClientMetadata{CallerID: "svc:knowledge-list-backlinks"})
	if err != nil {
		t.Fatalf("ListKnowledgeBacklinksGRPC: %v", err)
	}
	if len(listBacklinksResp.GetBacklinks()) != 1 {
		t.Fatalf("backlinks response mismatch: %+v", listBacklinksResp)
	}

	traverseResp, err := TraverseKnowledgeGraphGRPC(addr, 3*time.Second, &runtimev1.TraverseGraphRequest{
		Context:    &runtimev1.KnowledgeRequestContext{AppId: "nimi.desktop", SubjectUserId: "user-1"},
		BankId:     "bank-1",
		RootPageId: "page-1",
		MaxDepth:   2,
		PageSize:   5,
	}, &ClientMetadata{CallerID: "svc:knowledge-traverse"})
	if err != nil {
		t.Fatalf("TraverseKnowledgeGraphGRPC: %v", err)
	}
	if len(traverseResp.GetNodes()) != 2 || traverseResp.GetNextPageToken() != "graph-page-2" {
		t.Fatalf("traverse response mismatch: %+v", traverseResp)
	}

	removeLinkResp, err := RemoveKnowledgeLinkGRPC(addr, 3*time.Second, &runtimev1.RemoveLinkRequest{
		Context: &runtimev1.KnowledgeRequestContext{AppId: "nimi.desktop", SubjectUserId: "user-1"},
		BankId:  "bank-1",
		LinkId:  "link-1",
	}, &ClientMetadata{CallerID: "svc:knowledge-remove-link"})
	if err != nil {
		t.Fatalf("RemoveKnowledgeLinkGRPC: %v", err)
	}
	if !removeLinkResp.GetAck().GetOk() {
		t.Fatalf("remove link response not ok")
	}

	deleteResp, err := DeleteKnowledgeBankGRPC(addr, 3*time.Second, &runtimev1.DeleteKnowledgeBankRequest{
		Context: &runtimev1.KnowledgeRequestContext{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-1",
		},
		BankId: "bank-1",
	}, &ClientMetadata{
		CallerID: "svc:knowledge-delete-bank",
	})
	if err != nil {
		t.Fatalf("DeleteKnowledgeBankGRPC: %v", err)
	}
	if !deleteResp.GetAck().GetOk() {
		t.Fatalf("delete response not ok")
	}

	md := service.lastCreateBankMetadata()
	if got := firstMetadataValue(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app-id mismatch: %q", got)
	}
	if got := firstMetadataValue(md, "x-nimi-caller-id"); got != "svc:knowledge-create-bank" {
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

	createBankMD metadata.MD

	createBankResponse     *runtimev1.CreateKnowledgeBankResponse
	putPageResponse        *runtimev1.PutPageResponse
	ingestDocumentResponse *runtimev1.IngestDocumentResponse
	getIngestTaskResponse  *runtimev1.GetIngestTaskResponse
	searchResponse         *runtimev1.SearchKeywordResponse
	searchHybridResponse   *runtimev1.SearchHybridResponse
	addLinkResponse        *runtimev1.AddLinkResponse
	removeLinkResponse     *runtimev1.RemoveLinkResponse
	listLinksResponse      *runtimev1.ListLinksResponse
	listBacklinksResponse  *runtimev1.ListBacklinksResponse
	traverseGraphResponse  *runtimev1.TraverseGraphResponse
	deleteBankResponse     *runtimev1.DeleteKnowledgeBankResponse
}

func (s *testRuntimeKnowledgeService) CreateKnowledgeBank(ctx context.Context, _ *runtimev1.CreateKnowledgeBankRequest) (*runtimev1.CreateKnowledgeBankResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createBankMD = cloneMetadata(ctx)
	if s.createBankResponse != nil {
		return s.createBankResponse, nil
	}
	return nil, errors.New("create bank response not configured")
}

func (s *testRuntimeKnowledgeService) PutPage(context.Context, *runtimev1.PutPageRequest) (*runtimev1.PutPageResponse, error) {
	if s.putPageResponse != nil {
		return s.putPageResponse, nil
	}
	return nil, errors.New("put page response not configured")
}

func (s *testRuntimeKnowledgeService) IngestDocument(context.Context, *runtimev1.IngestDocumentRequest) (*runtimev1.IngestDocumentResponse, error) {
	if s.ingestDocumentResponse != nil {
		return s.ingestDocumentResponse, nil
	}
	return nil, errors.New("ingest document response not configured")
}

func (s *testRuntimeKnowledgeService) GetIngestTask(context.Context, *runtimev1.GetIngestTaskRequest) (*runtimev1.GetIngestTaskResponse, error) {
	if s.getIngestTaskResponse != nil {
		return s.getIngestTaskResponse, nil
	}
	return nil, errors.New("get ingest task response not configured")
}

func (s *testRuntimeKnowledgeService) SearchKeyword(context.Context, *runtimev1.SearchKeywordRequest) (*runtimev1.SearchKeywordResponse, error) {
	if s.searchResponse != nil {
		return s.searchResponse, nil
	}
	return nil, errors.New("search response not configured")
}

func (s *testRuntimeKnowledgeService) SearchHybrid(context.Context, *runtimev1.SearchHybridRequest) (*runtimev1.SearchHybridResponse, error) {
	if s.searchHybridResponse != nil {
		return s.searchHybridResponse, nil
	}
	return nil, errors.New("search hybrid response not configured")
}

func (s *testRuntimeKnowledgeService) AddLink(context.Context, *runtimev1.AddLinkRequest) (*runtimev1.AddLinkResponse, error) {
	if s.addLinkResponse != nil {
		return s.addLinkResponse, nil
	}
	return nil, errors.New("add link response not configured")
}

func (s *testRuntimeKnowledgeService) RemoveLink(context.Context, *runtimev1.RemoveLinkRequest) (*runtimev1.RemoveLinkResponse, error) {
	if s.removeLinkResponse != nil {
		return s.removeLinkResponse, nil
	}
	return nil, errors.New("remove link response not configured")
}

func (s *testRuntimeKnowledgeService) ListLinks(context.Context, *runtimev1.ListLinksRequest) (*runtimev1.ListLinksResponse, error) {
	if s.listLinksResponse != nil {
		return s.listLinksResponse, nil
	}
	return nil, errors.New("list links response not configured")
}

func (s *testRuntimeKnowledgeService) ListBacklinks(context.Context, *runtimev1.ListBacklinksRequest) (*runtimev1.ListBacklinksResponse, error) {
	if s.listBacklinksResponse != nil {
		return s.listBacklinksResponse, nil
	}
	return nil, errors.New("list backlinks response not configured")
}

func (s *testRuntimeKnowledgeService) TraverseGraph(context.Context, *runtimev1.TraverseGraphRequest) (*runtimev1.TraverseGraphResponse, error) {
	if s.traverseGraphResponse != nil {
		return s.traverseGraphResponse, nil
	}
	return nil, errors.New("traverse graph response not configured")
}

func (s *testRuntimeKnowledgeService) DeleteKnowledgeBank(context.Context, *runtimev1.DeleteKnowledgeBankRequest) (*runtimev1.DeleteKnowledgeBankResponse, error) {
	if s.deleteBankResponse != nil {
		return s.deleteBankResponse, nil
	}
	return nil, errors.New("delete bank response not configured")
}

func (s *testRuntimeKnowledgeService) lastCreateBankMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createBankMD.Copy()
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

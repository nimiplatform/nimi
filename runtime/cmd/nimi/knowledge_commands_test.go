package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"os"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
)

func TestRunRuntimeKnowledgeCreateBankAndPutPageJSON(t *testing.T) {
	service := &cmdTestRuntimeKnowledgeService{
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
	}
	addr, shutdown := startCmdTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	createOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"create-bank",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--display-name", "Desktop Knowledge",
			"--json",
			"--caller-id", "cli:knowledge-create-bank",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge create-bank: %v", err)
	}
	var createPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(createOutput), &createPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal create-bank output: %v output=%q", unmarshalErr, createOutput)
	}
	if asString(createPayload["bank_id"]) != "bank-1" {
		t.Fatalf("bank id mismatch: %v", createPayload["bank_id"])
	}
	createReq := service.lastCreateBankRequest()
	if createReq.GetLocator().GetAppPrivate().GetAppId() != "nimi.desktop" {
		t.Fatalf("create bank locator mismatch: %+v", createReq.GetLocator())
	}
	md := service.lastCreateBankMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "cli:knowledge-create-bank" {
		t.Fatalf("caller-id mismatch: %q", got)
	}

	putOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"put-page",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--slug", "alice-profile",
			"--title", "Alice",
			"--content", "Alice likes sci-fi novels.",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge put-page: %v", err)
	}
	var putPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(putOutput), &putPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal put-page output: %v output=%q", unmarshalErr, putOutput)
	}
	if asString(putPayload["page_id"]) != "page-1" {
		t.Fatalf("page id mismatch: %v", putPayload["page_id"])
	}
}

func TestRunRuntimeKnowledgeIngestDocumentAndGetTaskJSON(t *testing.T) {
	service := &cmdTestRuntimeKnowledgeService{
		ingestDocumentResponse: &runtimev1.IngestDocumentResponse{
			TaskId:     "ingest-task-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		getIngestTaskResponse: &runtimev1.GetIngestTaskResponse{
			Task: &runtimev1.KnowledgeIngestTask{
				TaskId:          "ingest-task-1",
				BankId:          "bank-1",
				PageId:          "page-9",
				Slug:            "alice-handbook",
				Title:           "Alice Handbook",
				Status:          runtimev1.KnowledgeIngestTaskStatus_KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED,
				ProgressPercent: 100,
				ReasonCode:      runtimev1.ReasonCode_ACTION_EXECUTED,
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	ingestOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"ingest-document",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--slug", "alice-handbook",
			"--title", "Alice Handbook",
			"--content", "async ingest body",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge ingest-document: %v", err)
	}
	var ingestPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(ingestOutput), &ingestPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal ingest output: %v output=%q", unmarshalErr, ingestOutput)
	}
	if asString(ingestPayload["task_id"]) != "ingest-task-1" {
		t.Fatalf("task id mismatch: %#v", ingestPayload)
	}

	taskOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"get-ingest-task",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--task-id", "ingest-task-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge get-ingest-task: %v", err)
	}
	var taskPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(taskOutput), &taskPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal ingest task output: %v output=%q", unmarshalErr, taskOutput)
	}
	if asString(taskPayload["status"]) != "KNOWLEDGE_INGEST_TASK_STATUS_COMPLETED" {
		t.Fatalf("task status mismatch: %#v", taskPayload)
	}
}

func TestRunRuntimeKnowledgeSearchAndDeleteBankJSON(t *testing.T) {
	service := &cmdTestRuntimeKnowledgeService{
		searchResponse: &runtimev1.SearchKeywordResponse{
			Hits: []*runtimev1.KnowledgeKeywordHit{
				{
					BankId:  "bank-1",
					PageId:  "page-1",
					Slug:    "alice-profile",
					Title:   "Alice",
					Score:   1,
					Snippet: "hello world",
				},
			},
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		deleteBankResponse: &runtimev1.DeleteKnowledgeBankResponse{
			Ack: &runtimev1.Ack{
				Ok:         true,
				ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	searchOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"search",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--query", "hello",
			"--top-k", "3",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge search: %v", err)
	}
	var searchPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(searchOutput), &searchPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal search output: %v output=%q", unmarshalErr, searchOutput)
	}
	hits, ok := searchPayload["hits"].([]any)
	if !ok || len(hits) != 1 {
		t.Fatalf("hits mismatch: %#v", searchPayload["hits"])
	}

	deleteOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"delete-bank",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge delete-bank: %v", err)
	}
	var deletePayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(deleteOutput), &deletePayload); unmarshalErr != nil {
		t.Fatalf("unmarshal delete-bank output: %v output=%q", unmarshalErr, deleteOutput)
	}
	if !deletePayload["ok"].(bool) {
		t.Fatalf("delete ok mismatch: %#v", deletePayload["ok"])
	}
}

func TestRunRuntimeKnowledgeSearchHybridJSON(t *testing.T) {
	service := &cmdTestRuntimeKnowledgeService{
		searchHybridResponse: &runtimev1.SearchHybridResponse{
			Hits: []*runtimev1.KnowledgeKeywordHit{
				{
					BankId:  "bank-1",
					PageId:  "page-2",
					Slug:    "alice-roadmap",
					Title:   "Alice Roadmap",
					Score:   0.92,
					Snippet: "roadmap and integration planning",
				},
			},
			NextPageToken: "token-h2",
			ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	searchOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"search-hybrid",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--query", "integration roadmap",
			"--page-size", "2",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge search-hybrid: %v", err)
	}
	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(searchOutput), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal search-hybrid output: %v output=%q", unmarshalErr, searchOutput)
	}
	if asString(payload["next_page_token"]) != "token-h2" {
		t.Fatalf("next_page_token mismatch: %#v", payload["next_page_token"])
	}
	hits, ok := payload["hits"].([]any)
	if !ok || len(hits) != 1 {
		t.Fatalf("hits mismatch: %#v", payload["hits"])
	}
}

func TestRunRuntimeKnowledgeGraphCommandsJSON(t *testing.T) {
	service := &cmdTestRuntimeKnowledgeService{
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
					FromSlug: "root",
					ToSlug:   "child",
				},
			},
			NextPageToken: "links-2",
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
					FromSlug: "root",
					ToSlug:   "child",
				},
			},
		},
		traverseGraphResponse: &runtimev1.TraverseGraphResponse{
			Nodes: []*runtimev1.KnowledgeGraphNode{
				{BankId: "bank-1", PageId: "page-1", Slug: "root", Depth: 0},
				{BankId: "bank-1", PageId: "page-2", Slug: "child", Depth: 1},
			},
			NextPageToken: "graph-2",
		},
		removeLinkResponse: &runtimev1.RemoveLinkResponse{
			Ack: &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED},
		},
	}
	addr, shutdown := startCmdTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	addOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"add-link",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--from-page-id", "page-1",
			"--to-page-id", "page-2",
			"--link-type", "references",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge add-link: %v", err)
	}
	var addPayload map[string]any
	if err := json.Unmarshal([]byte(addOutput), &addPayload); err != nil {
		t.Fatalf("unmarshal add-link output: %v output=%q", err, addOutput)
	}
	if asString(addPayload["link_id"]) != "link-1" {
		t.Fatalf("add-link output mismatch: %#v", addPayload)
	}

	listOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"list-links",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--from-page-id", "page-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge list-links: %v", err)
	}
	var listPayload map[string]any
	if err := json.Unmarshal([]byte(listOutput), &listPayload); err != nil {
		t.Fatalf("unmarshal list-links output: %v output=%q", err, listOutput)
	}
	if asString(listPayload["next_page_token"]) != "links-2" {
		t.Fatalf("list-links output mismatch: %#v", listPayload)
	}

	backlinksOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"list-backlinks",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--to-page-id", "page-2",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge list-backlinks: %v", err)
	}
	var backlinksPayload map[string]any
	if err := json.Unmarshal([]byte(backlinksOutput), &backlinksPayload); err != nil {
		t.Fatalf("unmarshal list-backlinks output: %v output=%q", err, backlinksOutput)
	}
	backlinks, ok := backlinksPayload["backlinks"].([]any)
	if !ok || len(backlinks) != 1 {
		t.Fatalf("backlinks output mismatch: %#v", backlinksPayload)
	}

	traverseOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"traverse-graph",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--root-page-id", "page-1",
			"--max-depth", "2",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge traverse-graph: %v", err)
	}
	var traversePayload map[string]any
	if err := json.Unmarshal([]byte(traverseOutput), &traversePayload); err != nil {
		t.Fatalf("unmarshal traverse-graph output: %v output=%q", err, traverseOutput)
	}
	if asString(traversePayload["next_page_token"]) != "graph-2" {
		t.Fatalf("traverse-graph output mismatch: %#v", traversePayload)
	}

	removeOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"remove-link",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--link-id", "link-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge remove-link: %v", err)
	}
	var removePayload map[string]any
	if err := json.Unmarshal([]byte(removeOutput), &removePayload); err != nil {
		t.Fatalf("unmarshal remove-link output: %v output=%q", err, removeOutput)
	}
	if okValue, ok := removePayload["ok"].(bool); !ok || !okValue {
		t.Fatalf("remove-link output mismatch: %#v", removePayload)
	}
}

func TestRunRuntimeKnowledgeGetAndListBanksJSON(t *testing.T) {
	service := &cmdTestRuntimeKnowledgeService{
		getBankResponse: &runtimev1.GetKnowledgeBankResponse{
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
		listBanksResponse: &runtimev1.ListKnowledgeBanksResponse{
			Banks: []*runtimev1.KnowledgeBank{
				{
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
			NextPageToken: "token-2",
		},
	}
	addr, shutdown := startCmdTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	getOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"get-bank",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge get-bank: %v", err)
	}
	var getPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(getOutput), &getPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal get-bank output: %v output=%q", unmarshalErr, getOutput)
	}
	if asString(getPayload["bank_id"]) != "bank-1" {
		t.Fatalf("bank id mismatch: %v", getPayload["bank_id"])
	}

	listOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"list-banks",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--scope", "app-private",
			"--owner-app-id", "nimi.desktop",
			"--page-size", "10",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge list-banks: %v", err)
	}
	var listPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(listOutput), &listPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal list-banks output: %v output=%q", unmarshalErr, listOutput)
	}
	banks, ok := listPayload["banks"].([]any)
	if !ok || len(banks) != 1 {
		t.Fatalf("banks mismatch: %#v", listPayload["banks"])
	}
	if asString(listPayload["next_page_token"]) != "token-2" {
		t.Fatalf("next_page_token mismatch: %v", listPayload["next_page_token"])
	}
}

func TestRunRuntimeKnowledgeGetListAndDeletePageJSON(t *testing.T) {
	service := &cmdTestRuntimeKnowledgeService{
		getPageResponse: &runtimev1.GetPageResponse{
			Page: &runtimev1.KnowledgePage{
				PageId:  "page-1",
				BankId:  "bank-1",
				Slug:    "alice-profile",
				Title:   "Alice",
				Content: "Alice likes sci-fi novels.",
			},
		},
		listPagesResponse: &runtimev1.ListPagesResponse{
			Pages: []*runtimev1.KnowledgePage{
				{
					PageId: "page-1",
					BankId: "bank-1",
					Slug:   "alice-profile",
					Title:  "Alice",
				},
			},
			NextPageToken: "page-token-2",
		},
		deletePageResponse: &runtimev1.DeletePageResponse{
			Ack: &runtimev1.Ack{
				Ok:         true,
				ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	getOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"get-page",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--slug", "alice-profile",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge get-page: %v", err)
	}
	var getPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(getOutput), &getPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal get-page output: %v output=%q", unmarshalErr, getOutput)
	}
	if asString(getPayload["page_id"]) != "page-1" {
		t.Fatalf("page id mismatch: %v", getPayload["page_id"])
	}

	listOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"list-pages",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--entity-type", "person",
			"--page-size", "5",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge list-pages: %v", err)
	}
	var listPayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(listOutput), &listPayload); unmarshalErr != nil {
		t.Fatalf("unmarshal list-pages output: %v output=%q", unmarshalErr, listOutput)
	}
	pages, ok := listPayload["pages"].([]any)
	if !ok || len(pages) != 1 {
		t.Fatalf("pages mismatch: %#v", listPayload["pages"])
	}
	if asString(listPayload["next_page_token"]) != "page-token-2" {
		t.Fatalf("next_page_token mismatch: %v", listPayload["next_page_token"])
	}

	deleteOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"delete-page",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--bank-id", "bank-1",
			"--page-id", "page-1",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge delete-page: %v", err)
	}
	var deletePayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(deleteOutput), &deletePayload); unmarshalErr != nil {
		t.Fatalf("unmarshal delete-page output: %v output=%q", unmarshalErr, deleteOutput)
	}
	if !deletePayload["ok"].(bool) {
		t.Fatalf("delete ok mismatch: %#v", deletePayload["ok"])
	}
}

func startCmdTestRuntimeKnowledgeServer(t *testing.T, service runtimev1.RuntimeCognitionServiceServer) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeCognitionServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

type cmdTestRuntimeKnowledgeService struct {
	runtimev1.UnimplementedRuntimeCognitionServiceServer

	mu sync.Mutex

	createBankMD  metadata.MD
	createBankReq *runtimev1.CreateKnowledgeBankRequest

	createBankResponse     *runtimev1.CreateKnowledgeBankResponse
	getBankResponse        *runtimev1.GetKnowledgeBankResponse
	listBanksResponse      *runtimev1.ListKnowledgeBanksResponse
	putPageResponse        *runtimev1.PutPageResponse
	ingestDocumentResponse *runtimev1.IngestDocumentResponse
	getIngestTaskResponse  *runtimev1.GetIngestTaskResponse
	getPageResponse        *runtimev1.GetPageResponse
	listPagesResponse      *runtimev1.ListPagesResponse
	deletePageResponse     *runtimev1.DeletePageResponse
	searchResponse         *runtimev1.SearchKeywordResponse
	searchHybridResponse   *runtimev1.SearchHybridResponse
	addLinkResponse        *runtimev1.AddLinkResponse
	removeLinkResponse     *runtimev1.RemoveLinkResponse
	listLinksResponse      *runtimev1.ListLinksResponse
	listBacklinksResponse  *runtimev1.ListBacklinksResponse
	traverseGraphResponse  *runtimev1.TraverseGraphResponse
	deleteBankResponse     *runtimev1.DeleteKnowledgeBankResponse
}

func (s *cmdTestRuntimeKnowledgeService) CreateKnowledgeBank(ctx context.Context, req *runtimev1.CreateKnowledgeBankRequest) (*runtimev1.CreateKnowledgeBankResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createBankMD = cloneIncomingMetadata(ctx)
	s.createBankReq = req
	if s.createBankResponse != nil {
		return s.createBankResponse, nil
	}
	return nil, errors.New("create bank response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) GetKnowledgeBank(context.Context, *runtimev1.GetKnowledgeBankRequest) (*runtimev1.GetKnowledgeBankResponse, error) {
	if s.getBankResponse != nil {
		return s.getBankResponse, nil
	}
	return nil, errors.New("get bank response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) ListKnowledgeBanks(context.Context, *runtimev1.ListKnowledgeBanksRequest) (*runtimev1.ListKnowledgeBanksResponse, error) {
	if s.listBanksResponse != nil {
		return s.listBanksResponse, nil
	}
	return nil, errors.New("list banks response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) PutPage(context.Context, *runtimev1.PutPageRequest) (*runtimev1.PutPageResponse, error) {
	if s.putPageResponse != nil {
		return s.putPageResponse, nil
	}
	return nil, errors.New("put page response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) IngestDocument(context.Context, *runtimev1.IngestDocumentRequest) (*runtimev1.IngestDocumentResponse, error) {
	if s.ingestDocumentResponse != nil {
		return s.ingestDocumentResponse, nil
	}
	return nil, errors.New("ingest document response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) GetIngestTask(context.Context, *runtimev1.GetIngestTaskRequest) (*runtimev1.GetIngestTaskResponse, error) {
	if s.getIngestTaskResponse != nil {
		return s.getIngestTaskResponse, nil
	}
	return nil, errors.New("get ingest task response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) GetPage(context.Context, *runtimev1.GetPageRequest) (*runtimev1.GetPageResponse, error) {
	if s.getPageResponse != nil {
		return s.getPageResponse, nil
	}
	return nil, errors.New("get page response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) ListPages(context.Context, *runtimev1.ListPagesRequest) (*runtimev1.ListPagesResponse, error) {
	if s.listPagesResponse != nil {
		return s.listPagesResponse, nil
	}
	return nil, errors.New("list pages response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) DeletePage(context.Context, *runtimev1.DeletePageRequest) (*runtimev1.DeletePageResponse, error) {
	if s.deletePageResponse != nil {
		return s.deletePageResponse, nil
	}
	return nil, errors.New("delete page response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) SearchKeyword(context.Context, *runtimev1.SearchKeywordRequest) (*runtimev1.SearchKeywordResponse, error) {
	if s.searchResponse != nil {
		return s.searchResponse, nil
	}
	return nil, errors.New("search response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) SearchHybrid(context.Context, *runtimev1.SearchHybridRequest) (*runtimev1.SearchHybridResponse, error) {
	if s.searchHybridResponse != nil {
		return s.searchHybridResponse, nil
	}
	return nil, errors.New("search hybrid response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) AddLink(context.Context, *runtimev1.AddLinkRequest) (*runtimev1.AddLinkResponse, error) {
	if s.addLinkResponse != nil {
		return s.addLinkResponse, nil
	}
	return nil, errors.New("add link response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) RemoveLink(context.Context, *runtimev1.RemoveLinkRequest) (*runtimev1.RemoveLinkResponse, error) {
	if s.removeLinkResponse != nil {
		return s.removeLinkResponse, nil
	}
	return nil, errors.New("remove link response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) ListLinks(context.Context, *runtimev1.ListLinksRequest) (*runtimev1.ListLinksResponse, error) {
	if s.listLinksResponse != nil {
		return s.listLinksResponse, nil
	}
	return nil, errors.New("list links response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) ListBacklinks(context.Context, *runtimev1.ListBacklinksRequest) (*runtimev1.ListBacklinksResponse, error) {
	if s.listBacklinksResponse != nil {
		return s.listBacklinksResponse, nil
	}
	return nil, errors.New("list backlinks response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) TraverseGraph(context.Context, *runtimev1.TraverseGraphRequest) (*runtimev1.TraverseGraphResponse, error) {
	if s.traverseGraphResponse != nil {
		return s.traverseGraphResponse, nil
	}
	return nil, errors.New("traverse graph response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) DeleteKnowledgeBank(context.Context, *runtimev1.DeleteKnowledgeBankRequest) (*runtimev1.DeleteKnowledgeBankResponse, error) {
	if s.deleteBankResponse != nil {
		return s.deleteBankResponse, nil
	}
	return nil, errors.New("delete bank response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) lastCreateBankRequest() *runtimev1.CreateKnowledgeBankRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.createBankReq == nil {
		return &runtimev1.CreateKnowledgeBankRequest{}
	}
	return s.createBankReq
}

func (s *cmdTestRuntimeKnowledgeService) lastCreateBankMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.createBankMD.Copy()
}

func writeTempJSONFile(t *testing.T, pattern string, content string) string {
	t.Helper()
	file, err := os.CreateTemp(t.TempDir(), pattern)
	if err != nil {
		t.Fatalf("create temp json file: %v", err)
	}
	if _, err := file.WriteString(content); err != nil {
		t.Fatalf("write temp json file: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close temp json file: %v", err)
	}
	return file.Name()
}

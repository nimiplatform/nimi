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
	"google.golang.org/protobuf/types/known/structpb"
)

func TestRunRuntimeKnowledgeBuildJSON(t *testing.T) {
	service := &cmdTestRuntimeKnowledgeService{
		buildResponse: &runtimev1.BuildIndexResponse{
			TaskId:     "task-knowledge-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	optionsFile := writeTempJSONFile(t, "knowledge-options-*.json", `{"chunk_size": 512}`)
	output, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"build",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--index-id", "chat-index",
			"--source-uri", "memory://chat/1",
			"--source-uri", "memory://chat/2",
			"--options-file", optionsFile,
			"--json",
			"--caller-id", "cli:knowledge-build",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge build: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal build output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["task_id"]) != "task-knowledge-1" {
		t.Fatalf("task id mismatch: %v", payload["task_id"])
	}
	req := service.lastBuildRequest()
	if len(req.GetSourceUris()) != 2 {
		t.Fatalf("source uris mismatch: %v", req.GetSourceUris())
	}
	if req.GetOptions().GetFields()["chunk_size"].GetNumberValue() != 512 {
		t.Fatalf("options mismatch: %+v", req.GetOptions().AsMap())
	}
	md := service.lastBuildMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "cli:knowledge-build" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
}

func TestRunRuntimeKnowledgeSearchAndDeleteJSON(t *testing.T) {
	service := &cmdTestRuntimeKnowledgeService{
		searchResponse: &runtimev1.SearchIndexResponse{
			Hits: []*runtimev1.SearchHit{
				{
					DocumentId: "doc-1",
					Score:      1,
					Snippet:    "hello world",
					Metadata: &structpb.Struct{Fields: map[string]*structpb.Value{
						"source_uri": structpb.NewStringValue("memory://chat/1"),
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
	addr, shutdown := startCmdTestRuntimeKnowledgeServer(t, service)
	defer shutdown()

	searchOutput, err := captureStdoutFromRun(func() error {
		return runRuntimeKnowledge([]string{
			"search",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--index-id", "chat-index",
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
			"delete",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--subject-user-id", "user-1",
			"--index-id", "chat-index",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeKnowledge delete: %v", err)
	}
	var deletePayload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(deleteOutput), &deletePayload); unmarshalErr != nil {
		t.Fatalf("unmarshal delete output: %v output=%q", unmarshalErr, deleteOutput)
	}
	if !deletePayload["ok"].(bool) {
		t.Fatalf("delete ok mismatch: %#v", deletePayload["ok"])
	}
}

func startCmdTestRuntimeKnowledgeServer(t *testing.T, service runtimev1.RuntimeKnowledgeServiceServer) (string, func()) {
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

type cmdTestRuntimeKnowledgeService struct {
	runtimev1.UnimplementedRuntimeKnowledgeServiceServer

	mu sync.Mutex

	buildMD  metadata.MD
	buildReq *runtimev1.BuildIndexRequest

	buildResponse  *runtimev1.BuildIndexResponse
	searchResponse *runtimev1.SearchIndexResponse
	deleteResponse *runtimev1.Ack
}

func (s *cmdTestRuntimeKnowledgeService) BuildIndex(ctx context.Context, req *runtimev1.BuildIndexRequest) (*runtimev1.BuildIndexResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.buildMD = cloneIncomingMetadata(ctx)
	s.buildReq = req
	if s.buildResponse != nil {
		return s.buildResponse, nil
	}
	return nil, errors.New("build response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) SearchIndex(context.Context, *runtimev1.SearchIndexRequest) (*runtimev1.SearchIndexResponse, error) {
	if s.searchResponse != nil {
		return s.searchResponse, nil
	}
	return nil, errors.New("search response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) DeleteIndex(context.Context, *runtimev1.DeleteIndexRequest) (*runtimev1.Ack, error) {
	if s.deleteResponse != nil {
		return s.deleteResponse, nil
	}
	return nil, errors.New("delete response not configured")
}

func (s *cmdTestRuntimeKnowledgeService) lastBuildRequest() *runtimev1.BuildIndexRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.buildReq == nil {
		return &runtimev1.BuildIndexRequest{}
	}
	return s.buildReq
}

func (s *cmdTestRuntimeKnowledgeService) lastBuildMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.buildMD.Copy()
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

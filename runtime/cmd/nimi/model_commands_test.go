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
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestRunRuntimeModelListJSON(t *testing.T) {
	service := &cmdTestRuntimeModelService{
		listResponse: &runtimev1.ListModelsResponse{
			Models: []*runtimev1.ModelDescriptor{
				{
					ModelId:      "local/qwen2.5",
					Version:      "latest",
					Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
					Capabilities: []string{"text.generate"},
					LastHealthAt: timestamppb.Now(),
				},
				{
					ModelId:      "local/whisper-1",
					Version:      "latest",
					Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
					Capabilities: []string{"audio.transcribe"},
					LastHealthAt: timestamppb.Now(),
				},
			},
		},
	}
	addr, shutdown := startCmdTestRuntimeModelServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeModel([]string{
			"list",
			"--grpc-addr", addr,
			"--json",
			"--caller-id", "model-cli",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeModel list: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal list output: %v output=%q", unmarshalErr, output)
	}
	models, ok := payload["models"].([]any)
	if !ok || len(models) != 2 {
		t.Fatalf("models payload mismatch: %#v", payload["models"])
	}
	md := service.lastListMetadata()
	if got := firstMD(md, "x-nimi-caller-id"); got != "model-cli" {
		t.Fatalf("caller-id mismatch: %q", got)
	}
	if got := firstMD(md, "x-nimi-app-id"); got != "nimi.desktop" {
		t.Fatalf("app-id mismatch: %q", got)
	}
}

func TestRunRuntimeModelPullJSON(t *testing.T) {
	service := &cmdTestRuntimeModelService{
		pullResponse: &runtimev1.PullModelResponse{
			TaskId:     "task-1",
			Accepted:   true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
	}
	addr, shutdown := startCmdTestRuntimeModelServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeModel([]string{
			"pull",
			"--grpc-addr", addr,
			"--app-id", "nimi.desktop",
			"--model-ref", "local/qwen2.5@latest",
			"--source", "official",
			"--digest", "sha256:abc",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeModel pull: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal pull output: %v output=%q", unmarshalErr, output)
	}
	if asString(payload["task_id"]) != "task-1" {
		t.Fatalf("task id mismatch: %v", payload["task_id"])
	}
	req := service.lastPullRequest()
	if req.GetModelRef() != "local/qwen2.5@latest" {
		t.Fatalf("model-ref mismatch: %s", req.GetModelRef())
	}
	if req.GetDigest() != "sha256:abc" {
		t.Fatalf("digest mismatch: %s", req.GetDigest())
	}
}

func TestRunRuntimeModelRemoveJSON(t *testing.T) {
	service := &cmdTestRuntimeModelService{
		removeResponse: &runtimev1.Ack{
			Ok:         true,
			ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
			ActionHint: "",
		},
	}
	addr, shutdown := startCmdTestRuntimeModelServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeModel([]string{
			"remove",
			"--grpc-addr", addr,
			"--model-id", "local/qwen2.5",
			"--json",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeModel remove: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal remove output: %v output=%q", unmarshalErr, output)
	}
	if !payload["ok"].(bool) {
		t.Fatalf("remove ok mismatch: %#v", payload["ok"])
	}
	req := service.lastRemoveRequest()
	if req.GetModelId() != "local/qwen2.5" {
		t.Fatalf("model-id mismatch: %s", req.GetModelId())
	}
}

func TestRunRuntimeModelHealthJSON(t *testing.T) {
	service := &cmdTestRuntimeModelService{
		healthResponse: &runtimev1.CheckModelHealthResponse{
			Healthy:    false,
			ReasonCode: runtimev1.ReasonCode_AI_MODEL_NOT_READY,
			ActionHint: "wait for install",
		},
	}
	addr, shutdown := startCmdTestRuntimeModelServer(t, service)
	defer shutdown()

	output, err := captureStdoutFromRun(func() error {
		return runRuntimeModel([]string{
			"health",
			"--grpc-addr", addr,
			"--model-id", "local/qwen2.5",
			"--json",
			"--trace-id", "trace-health-cli",
		})
	})
	if err != nil {
		t.Fatalf("runRuntimeModel health: %v", err)
	}

	var payload map[string]any
	if unmarshalErr := json.Unmarshal([]byte(output), &payload); unmarshalErr != nil {
		t.Fatalf("unmarshal health output: %v output=%q", unmarshalErr, output)
	}
	if payload["healthy"].(bool) {
		t.Fatalf("health mismatch: %#v", payload["healthy"])
	}
	md := service.lastHealthMetadata()
	if got := firstMD(md, "x-nimi-trace-id"); got != "trace-health-cli" {
		t.Fatalf("trace-id mismatch: %q", got)
	}
	if got := service.lastHealthRequest().GetAppId(); got != "nimi.desktop" {
		t.Fatalf("health request app-id mismatch: %q", got)
	}
}

func startCmdTestRuntimeModelServer(t *testing.T, service runtimev1.RuntimeModelServiceServer) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	server := grpc.NewServer()
	runtimev1.RegisterRuntimeModelServiceServer(server, service)
	go func() {
		_ = server.Serve(listener)
	}()
	return listener.Addr().String(), func() {
		server.Stop()
		_ = listener.Close()
	}
}

type cmdTestRuntimeModelService struct {
	runtimev1.UnimplementedRuntimeModelServiceServer

	mu sync.Mutex

	listMD   metadata.MD
	pullMD   metadata.MD
	removeMD metadata.MD
	healthMD metadata.MD

	pullReq   *runtimev1.PullModelRequest
	removeReq *runtimev1.RemoveModelRequest
	healthReq *runtimev1.CheckModelHealthRequest

	listResponse   *runtimev1.ListModelsResponse
	pullResponse   *runtimev1.PullModelResponse
	removeResponse *runtimev1.Ack
	healthResponse *runtimev1.CheckModelHealthResponse
}

func (s *cmdTestRuntimeModelService) ListModels(ctx context.Context, _ *runtimev1.ListModelsRequest) (*runtimev1.ListModelsResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listMD = cloneIncomingMetadata(ctx)
	if s.listResponse != nil {
		return s.listResponse, nil
	}
	return &runtimev1.ListModelsResponse{}, nil
}

func (s *cmdTestRuntimeModelService) PullModel(ctx context.Context, req *runtimev1.PullModelRequest) (*runtimev1.PullModelResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pullMD = cloneIncomingMetadata(ctx)
	s.pullReq = req
	if s.pullResponse != nil {
		return s.pullResponse, nil
	}
	return nil, errors.New("pull response not configured")
}

func (s *cmdTestRuntimeModelService) RemoveModel(ctx context.Context, req *runtimev1.RemoveModelRequest) (*runtimev1.Ack, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.removeMD = cloneIncomingMetadata(ctx)
	s.removeReq = req
	if s.removeResponse != nil {
		return s.removeResponse, nil
	}
	return nil, errors.New("remove response not configured")
}

func (s *cmdTestRuntimeModelService) CheckModelHealth(ctx context.Context, req *runtimev1.CheckModelHealthRequest) (*runtimev1.CheckModelHealthResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.healthMD = cloneIncomingMetadata(ctx)
	s.healthReq = req
	if s.healthResponse != nil {
		return s.healthResponse, nil
	}
	return nil, errors.New("health response not configured")
}

func (s *cmdTestRuntimeModelService) lastListMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.listMD.Copy()
}

func (s *cmdTestRuntimeModelService) lastPullRequest() *runtimev1.PullModelRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pullReq == nil {
		return &runtimev1.PullModelRequest{}
	}
	return s.pullReq
}

func (s *cmdTestRuntimeModelService) lastRemoveRequest() *runtimev1.RemoveModelRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.removeReq == nil {
		return &runtimev1.RemoveModelRequest{}
	}
	return s.removeReq
}

func (s *cmdTestRuntimeModelService) lastHealthRequest() *runtimev1.CheckModelHealthRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.healthReq == nil {
		return &runtimev1.CheckModelHealthRequest{}
	}
	return s.healthReq
}

func (s *cmdTestRuntimeModelService) lastHealthMetadata() metadata.MD {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.healthMD.Copy()
}

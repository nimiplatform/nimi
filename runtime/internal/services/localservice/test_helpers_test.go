package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func mustInstallAttachedLocalModel(t *testing.T, svc *Service, req *runtimev1.InstallLocalModelRequest) *runtimev1.LocalModelRecord {
	t.Helper()
	capabilities := normalizeStringSlice(req.GetCapabilities())
	engine := defaultLocalEngine(req.GetEngine(), capabilities)
	endpoint := req.GetEndpoint()
	if endpoint == "" {
		endpoint = managedDefaultEndpointForEngine(engine)
	}
	resp, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      req.GetModelId(),
		Repo:         req.GetRepo(),
		Revision:     req.GetRevision(),
		Capabilities: capabilities,
		Engine:       engine,
		Entry:        req.GetEntry(),
		Files:        append([]string(nil), req.GetFiles()...),
		License:      req.GetLicense(),
		Hashes:       cloneStringMap(req.GetHashes()),
		Endpoint:     endpoint,
		EngineConfig: cloneStruct(req.GetEngineConfig()),
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	return resp.GetModel()
}

func mustInstallSupervisedLocalModel(t *testing.T, svc *Service, req *runtimev1.InstallLocalModelRequest) *runtimev1.LocalModelRecord {
	t.Helper()
	capabilities := normalizeStringSlice(req.GetCapabilities())
	engine := defaultLocalEngine(req.GetEngine(), capabilities)
	record, err := svc.installLocalModelRecord(
		req.GetModelId(),
		capabilities,
		engine,
		defaultString(req.GetEntry(), "./dist/index.js"),
		defaultString(req.GetLicense(), "unknown"),
		req.GetRepo(),
		defaultString(req.GetRevision(), "main"),
		req.GetHashes(),
		"",
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		"",
		req.GetEngineConfig(),
		"runtime_model_ready_after_install",
		"model installed",
	)
	if err != nil {
		t.Fatalf("install supervised local model: %v", err)
	}
	return record
}

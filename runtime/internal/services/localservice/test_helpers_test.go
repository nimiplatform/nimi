package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func mustInstallAttachedLocalModel(t *testing.T, svc *Service, req installLocalAssetParams) *runtimev1.LocalAssetRecord {
	t.Helper()
	capabilities := normalizeStringSlice(req.capabilities)
	engine := defaultLocalEngine(req.engine, capabilities)
	endpoint := req.endpoint
	if endpoint == "" {
		endpoint = managedDefaultEndpointForEngine(engine)
	}
	record, err := svc.installLocalAsset(context.Background(), installLocalAssetParams{
		assetID:      req.assetID,
		repo:         req.repo,
		revision:     req.revision,
		capabilities: capabilities,
		engine:       engine,
		entry:        req.entry,
		files:        append([]string(nil), req.files...),
		license:      req.license,
		hashes:       cloneStringMap(req.hashes),
		endpoint:     endpoint,
		engineConfig: cloneStruct(req.engineConfig),
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	return record
}

func mustInstallSupervisedLocalModel(t *testing.T, svc *Service, req installLocalAssetParams) *runtimev1.LocalAssetRecord {
	t.Helper()
	capabilities := normalizeStringSlice(req.capabilities)
	engine := defaultLocalEngine(req.engine, capabilities)
	record, err := svc.installLocalAssetRecord(
		req.assetID,
		inferAssetKindFromCapabilities(capabilities),
		capabilities,
		engine,
		defaultString(req.entry, "./dist/index.js"),
		defaultString(req.license, "unknown"),
		req.repo,
		defaultString(req.revision, "main"),
		req.hashes,
		"",
		runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_SUPERVISED,
		"",
		req.engineConfig,
		nil,
		"runtime_model_ready_after_install",
		"model installed",
	)
	if err != nil {
		t.Fatalf("install supervised local model: %v", err)
	}
	return record
}

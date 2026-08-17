package localservice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestConcurrentAdoptionOfSameResolvedDirectoryConvergesToOneModelAsset(t *testing.T) {
	svc := newTestService(t)
	directory := makeAdoptionDirectory(t, svc, "concurrent-adoption")
	ready := make(chan struct{}, 2)
	release := make(chan struct{})
	type adoptionResult struct {
		asset   *runtimev1.ModelAssetRecord
		skipped bool
		err     error
	}
	results := make(chan adoptionResult, 2)

	for index := 0; index < 2; index++ {
		ctx := &modelAssetAdoptionBarrierContext{Context: context.Background(), ready: ready, release: release}
		go func() {
			asset, skipped, err := svc.adoptResolvedModelAssetDirectory(ctx, directory, "concurrent")
			results <- adoptionResult{asset: asset, skipped: skipped, err: err}
		}()
	}
	<-ready
	<-ready
	close(release)

	first := <-results
	second := <-results
	if first.err != nil || second.err != nil {
		t.Fatalf("concurrent adoption errors = first:%v second:%v", first.err, second.err)
	}
	if first.asset == nil || second.asset == nil || first.asset.GetModelAssetId() == "" || first.asset.GetModelAssetId() != second.asset.GetModelAssetId() {
		t.Fatalf("concurrent adoption identities = first:%+v second:%+v", first.asset, second.asset)
	}
	if first.skipped == second.skipped {
		t.Fatalf("concurrent adoption idempotence = first:%t second:%t, want one committed and one skipped", first.skipped, second.skipped)
	}

	svc.mu.RLock()
	assetCount := len(svc.modelAssets)
	directoryCount := len(svc.modelAssetDirectories)
	registered := cloneModelAsset(svc.modelAssets[first.asset.GetModelAssetId()])
	svc.mu.RUnlock()
	if assetCount != 1 || directoryCount != 1 || registered == nil {
		t.Fatalf("final ModelAsset inventory = assets:%d directories:%d registered:%+v", assetCount, directoryCount, registered)
	}
	manifestPayload, err := os.ReadFile(filepath.Join(directory, localAssetManifestFileName))
	if err != nil {
		t.Fatal(err)
	}
	var manifest modelAssetManifest
	if err := json.Unmarshal(manifestPayload, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.ModelAssetID != registered.GetModelAssetId() {
		t.Fatalf("manifest identity %q differs from registered identity %q", manifest.ModelAssetID, registered.GetModelAssetId())
	}
}

type modelAssetAdoptionBarrierContext struct {
	context.Context
	once    sync.Once
	ready   chan<- struct{}
	release <-chan struct{}
}

func (ctx *modelAssetAdoptionBarrierContext) Err() error {
	ctx.once.Do(func() {
		ctx.ready <- struct{}{}
		<-ctx.release
	})
	return ctx.Context.Err()
}

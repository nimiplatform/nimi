package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	runtimecfg "github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func setExactPublicChatTextTargetForTest(
	t *testing.T,
	svc *Service,
	localModel *fakeLocalModelLister,
	asset *runtimev1.LocalAssetRecord,
) *runtimev1.RuntimeDurableTargetRef {
	t.Helper()
	if svc == nil || localModel == nil || asset == nil {
		t.Fatal("exact public chat target fixture is incomplete")
	}
	localAssetID := strings.TrimSpace(asset.GetLocalAssetId())
	logicalModelID := strings.TrimSpace(asset.GetLogicalModelId())
	if localAssetID == "" || logicalModelID == "" {
		t.Fatalf("exact public chat target asset identity is incomplete: %+v", asset)
	}
	if localModel.managedNames == nil {
		localModel.managedNames = map[string]string{}
	}
	localModel.managedNames[localAssetID] = strings.TrimSpace(asset.GetAssetId())
	readinessRef := "local_asset_readiness:v2:test:" + localAssetID
	resolver := &exactTargetLocalModelLister{
		fakeLocalModelLister: localModel,
		binding: &runtimev1.RuntimeResolvedLocalExecutionBinding{
			ReadinessRef:    readinessRef,
			LocalAssetId:    localAssetID,
			ResolvedModelId: logicalModelID,
		},
		asset: asset,
	}
	svc.SetLocalModelLister(resolver)
	return &runtimev1.RuntimeDurableTargetRef{
		Target: &runtimev1.RuntimeDurableTargetRef_LocalRuntime{
			LocalRuntime: &runtimev1.RuntimeDurableLocalTargetRef{
				Version: "v2",
				Ref: &runtimev1.RuntimeDurableLocalTargetRef_ReadinessRef{
					ReadinessRef: readinessRef,
				},
			},
		},
	}
}

func TestProviderHelpersAndRouteSelectorWrapper(t *testing.T) {
	selector := newRouteSelector(Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"llama": {BaseURL: "http://127.0.0.1:18080/v1"},
		},
	})
	if selector == nil {
		t.Fatal("selector should not be nil")
	}
	if selector.local == nil {
		t.Fatal("local provider should be initialized")
	}

	provider, route, modelResolved, _, err := selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"local/qwen2.5",
	)
	if err != nil {
		t.Fatalf("resolveProvider wrapper should succeed: %v", err)
	}
	if provider == nil || route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved == "" {
		t.Fatalf("unexpected resolveProvider result: provider=%v route=%v model=%q", provider, route, modelResolved)
	}
}

func TestRouteSelectorResolvesDefaultAliases(t *testing.T) {
	selector := newRouteSelector(Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"llama": {BaseURL: "http://127.0.0.1:18080/v1"},
		},
		// Cloud backends are always built through the DNS-pinning secured path,
		// so a reserved .example host resolves to nothing and yields no backend.
		// Loopback keeps this alias-resolution test hermetic and offline-safe
		// without relaxing the endpoint-security posture.
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"gemini": {BaseURL: "http://127.0.0.1:18091/v1", APIKey: "gemini-key"},
			"openai": {BaseURL: "http://127.0.0.1:18092/v1", APIKey: "openai-key"},
		},
		AllowLoopbackEndpoint: true,
		DefaultCloudProvider:  "openai",
		ProviderDefaultModels: map[string]string{
			"gemini": "gemini-2.5-pro",
			"openai": "gpt-5.2",
		},
	})

	_, route, modelResolved, _, err := selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"local/default",
	)
	if err != nil {
		t.Fatalf("resolve local default: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved != "qwen2.5" {
		t.Fatalf("unexpected local default resolution: route=%v model=%q", route, modelResolved)
	}

	_, route, modelResolved, _, err = selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"gemini/default",
	)
	if err != nil {
		t.Fatalf("resolve provider default: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || modelResolved != "gemini/gemini-2.5-pro" {
		t.Fatalf("unexpected provider default resolution: route=%v model=%q", route, modelResolved)
	}

	_, route, modelResolved, _, err = selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"cloud/default",
	)
	if err != nil {
		t.Fatalf("resolve cloud default: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || modelResolved != "openai/gpt-5.2" {
		t.Fatalf("unexpected cloud default resolution: route=%v model=%q", route, modelResolved)
	}
}

func TestRouteSelectorDefaultAliasErrorPreservesCauseWithoutPublishingConfigDetail(t *testing.T) {
	selector := &routeSelector{targetConfig: runtimecfg.Config{}}

	_, _, err := selector.resolveBindingRouteModel(
		runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		"cloud/default",
	)
	if err == nil || errors.Unwrap(err) == nil {
		t.Fatalf("expected preserved default alias resolution cause, got %v", err)
	}
	if got := status.Code(err); got != codes.FailedPrecondition {
		t.Fatalf("gRPC code = %s, want %s", got, codes.FailedPrecondition)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID {
		t.Fatalf("unexpected reason: got=%v ok=%v want=%v", reason, ok, runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID)
	}
	if wireMessage := status.Convert(err).Message(); strings.Contains(wireMessage, "no default cloud provider is configured") {
		t.Fatalf("wire message leaked private config detail: %q", wireMessage)
	}
}

func TestResolvePublicChatTextBindingAllowsColdLocalBackend(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})

	route, modelResolved, err := svc.ResolvePublicChatTextBinding(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		"local/gemma-4-26B-A4B-it-Q8_0",
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextBinding should not require warm local backend: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved != "gemma-4-26B-A4B-it-Q8_0" {
		t.Fatalf("unexpected public chat binding resolution: route=%v model=%q", route, modelResolved)
	}
}

func TestResolvePublicChatTextBindingPreservesCommittedCloudRouteForUnprefixedProviderModel(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		CloudProviders: map[string]nimillm.ProviderCredentials{
			"dashscope": {BaseURL: "https://dashscope.example/v1", APIKey: "fixture-key"},
		},
	})

	route, modelResolved, err := svc.ResolvePublicChatTextBinding(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		"Moonshot-Kimi-K2-Instruct",
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextBinding committed cloud route: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD || modelResolved != "Moonshot-Kimi-K2-Instruct" {
		t.Fatalf("committed cloud binding drifted: route=%v model=%q", route, modelResolved)
	}
}

func TestResolveProviderStillRequiresColdLocalBackendAvailability(t *testing.T) {
	selector := newRouteSelector(Config{})

	_, _, _, _, err := selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		"local/gemma-4-26B-A4B-it-Q8_0",
	)
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("execution route resolution must still require local availability, got err=%v reason=%v", err, reason)
	}
}

func TestResolvePublicChatTextBindingResolvesLocalDefaultAlias(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		DefaultLocalTextModel: "gemma-default",
	})

	route, modelResolved, err := svc.ResolvePublicChatTextBinding(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		"local/default",
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextBinding local/default: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved != "gemma-default" {
		t.Fatalf("unexpected public chat default binding resolution: route=%v model=%q", route, modelResolved)
	}
}

func TestResolvePublicChatTextBindingResolvesProtectedDefaultFromSupervisedAsset(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	svc.localModel = &fakeLocalModelLister{
		managedNames: map[string]string{"": "local.chat.gemma-4-e2b-it.q8-0"},
	}

	route, modelResolved, err := svc.ResolvePublicChatTextBinding(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		"local/default",
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextBinding protected local/default: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved != "local.chat.gemma-4-e2b-it.q8-0" {
		t.Fatalf("unexpected supervised public chat default resolution: route=%v model=%q", route, modelResolved)
	}
}

func TestResolvePublicChatTextContextMetadataResolvesLocalDefaultAliasThroughExactTarget(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{
		DefaultLocalTextModel: "gemma-4-e2b-it-local",
	})
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:        "local-asset-gemma-default",
		AssetId:             "local/gemma-4-e2b-it-local",
		LogicalModelId:      "gemma-4-e2b-it-local",
		Engine:              "llama",
		Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Capabilities:        []string{"text.generate"},
	}
	localModel := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{asset},
		}},
		localContexts: map[string]struct {
			window   uint64
			revision string
		}{
			"local-asset-gemma-default": {window: 65536, revision: "sha256:gemma-default"},
		},
	}
	targetRef := setExactPublicChatTextTargetForTest(t, svc, localModel, asset)

	route, modelResolved, err := svc.ResolvePublicChatTextBinding(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		"local/default",
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextBinding local/default: %v", err)
	}
	window, catalogRevision, modelRevision, provider, resolvedTargetRef, err := svc.ResolvePublicChatTextContextMetadata(
		context.Background(),
		route,
		modelResolved,
		targetRef,
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextContextMetadata local/default alias: %v", err)
	}
	if window != 32768 || catalogRevision == "" || modelRevision == "" || provider != "local" {
		t.Fatalf("context metadata = window:%d catalog:%q model:%q provider:%q", window, catalogRevision, modelRevision, provider)
	}
	if resolvedTargetRef.GetLocalRuntime().GetVersion() != "v2" ||
		resolvedTargetRef.GetLocalRuntime().GetReadinessRef() != targetRef.GetLocalRuntime().GetReadinessRef() {
		t.Fatalf("resolved target ref = %#v", resolvedTargetRef)
	}
}

func TestResolvePublicChatTextContextMetadataUsesResolvedCatalogRow(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:        "local-asset-gemma-catalog",
		AssetId:             "local/gemma-4-e2b-it-local",
		LogicalModelId:      "gemma-4-e2b-it-local",
		Engine:              "llama",
		Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Capabilities:        []string{"text.generate"},
	}
	localModel := &fakeLocalModelLister{
		localContexts: map[string]struct {
			window   uint64
			revision string
		}{
			"local-asset-gemma-catalog": {window: 65536, revision: "sha256:gemma-catalog"},
		},
	}
	targetRef := setExactPublicChatTextTargetForTest(t, svc, localModel, asset)

	window, catalogRevision, modelRevision, provider, resolvedTargetRef, err := svc.ResolvePublicChatTextContextMetadata(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		"gemma-4-e2b-it-local",
		targetRef,
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextContextMetadata: %v", err)
	}
	if window != 32768 || catalogRevision == "" || modelRevision == "" || provider != "local" {
		t.Fatalf("context metadata = window:%d catalog:%q model:%q provider:%q", window, catalogRevision, modelRevision, provider)
	}
	if resolvedTargetRef.GetLocalRuntime().GetReadinessRef() != targetRef.GetLocalRuntime().GetReadinessRef() {
		t.Fatalf("resolved target ref = %#v", resolvedTargetRef)
	}
}

func TestResolvePublicChatTextContextMetadataResolvesLocalRuntimeBindingToLogicalCatalogModel(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:         "local-asset-gemma",
		AssetId:              "local.chat.gemma-4-e2b-it.q8-0",
		LogicalModelId:       "gemma-4-e2b-it-local",
		Engine:               "llama",
		Status:               runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		DurableTargetStatus:  runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		LocalInvokeProfileId: "invoke-gemma",
		Capabilities:         []string{"text.generate"},
	}
	localModel := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{asset},
		}},
		localContexts: map[string]struct {
			window   uint64
			revision string
		}{
			"local-asset-gemma": {window: 65536, revision: "sha256:gemma"},
		},
	}
	targetRef := setExactPublicChatTextTargetForTest(t, svc, localModel, asset)

	window, _, _, provider, resolvedTargetRef, err := svc.ResolvePublicChatTextContextMetadata(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		"gemma-4-e2b-it-local",
		targetRef,
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextContextMetadata local-runtime binding: %v", err)
	}
	if window != 32768 || provider != "local" {
		t.Fatalf("context metadata = window:%d provider:%q", window, provider)
	}
	if resolvedTargetRef.GetLocalRuntime().GetReadinessRef() != targetRef.GetLocalRuntime().GetReadinessRef() {
		t.Fatalf("resolved target ref = %#v", resolvedTargetRef)
	}
}

func TestResolvePublicChatTextContextMetadataRestoresCatalogIdentityForVerifiedFileImport(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:        "imported-gemma-q8",
		AssetId:             "local-import/gemma-4-26B-A4B-it-Q8_0/import-instance",
		LogicalModelId:      "nimi/local-import-gemma-4-26b-a4b-it-q8-0-import-instance",
		Engine:              "llama",
		Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Capabilities:        []string{"text.generate"},
	}
	localModel := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{asset},
		}},
		catalogModels: map[string]string{
			"imported-gemma-q8": "gemma-4-26b-a4b-it-local",
		},
		localContexts: map[string]struct {
			window   uint64
			revision string
		}{
			"imported-gemma-q8": {window: 144384, revision: "sha256:imported-gemma-q8"},
		},
	}
	targetRef := setExactPublicChatTextTargetForTest(t, svc, localModel, asset)

	window, catalogRevision, modelRevision, provider, resolvedTargetRef, err := svc.ResolvePublicChatTextContextMetadata(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		"nimi/local-import-gemma-4-26b-a4b-it-q8-0-import-instance",
		targetRef,
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextContextMetadata verified file import: %v", err)
	}
	if window != 32768 || catalogRevision == "" || modelRevision == "" || provider != "local" {
		t.Fatalf("context metadata = window:%d catalog:%q model:%q provider:%q", window, catalogRevision, modelRevision, provider)
	}
	if got := resolvedTargetRef.GetLocalRuntime().GetReadinessRef(); got != targetRef.GetLocalRuntime().GetReadinessRef() {
		t.Fatalf("resolved target binding = %q", got)
	}
}

func TestResolvePublicChatTextContextMetadataClampsCatalogCapacityToLocalEngineContext(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:        "imported-gemma-q8",
		AssetId:             "local-import/gemma-4-26B-A4B-it-Q8_0/import-instance",
		LogicalModelId:      "nimi/local-import-gemma-4-26b-a4b-it-q8-0-import-instance",
		Engine:              "llama",
		Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Capabilities:        []string{"text.generate"},
	}
	localModel := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{asset},
		}},
		catalogModels: map[string]string{
			"imported-gemma-q8": "gemma-4-26b-a4b-it-local",
		},
		localContexts: map[string]struct {
			window   uint64
			revision string
		}{
			"imported-gemma-q8": {window: 16384, revision: "sha256:imported-gemma-q8"},
		},
	}
	targetRef := setExactPublicChatTextTargetForTest(t, svc, localModel, asset)

	window, catalogRevision, modelRevision, provider, resolvedTargetRef, err := svc.ResolvePublicChatTextContextMetadata(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		"nimi/local-import-gemma-4-26b-a4b-it-q8-0-import-instance",
		targetRef,
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextContextMetadata verified file import with engine clamp: %v", err)
	}
	if window != 16384 || catalogRevision == "" || modelRevision == "" || provider != "local" {
		t.Fatalf("context metadata = window:%d catalog:%q model:%q provider:%q", window, catalogRevision, modelRevision, provider)
	}
	if got := resolvedTargetRef.GetLocalRuntime().GetReadinessRef(); got != targetRef.GetLocalRuntime().GetReadinessRef() {
		t.Fatalf("resolved target binding = %q", got)
	}
	if got := localModel.leaseCalls; len(got) != 2 ||
		got[0] != "acquire:imported-gemma-q8:runtime_agent_text_binding" ||
		got[1] != "release:imported-gemma-q8:runtime_agent_text_binding_cleanup" {
		t.Fatalf("local text metadata lease calls = %#v", got)
	}
}

func TestResolvePublicChatTextContextMetadataUsesLiveLlamaCapacityForUncatalogedImport(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	asset := &runtimev1.LocalAssetRecord{
		LocalAssetId:        "uncataloged-gemma",
		AssetId:             "local-import/gemma-4-26B-A4B-it-Q8_0/import-instance",
		LogicalModelId:      "nimi/local-import-gemma-4-26b-a4b-it-q8-0-import-instance",
		Engine:              "llama",
		Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
		Capabilities:        []string{"text.generate"},
	}
	localModel := &fakeLocalModelLister{
		responses: []*runtimev1.ListLocalAssetsResponse{{
			Assets: []*runtimev1.LocalAssetRecord{asset},
		}},
		localContexts: map[string]struct {
			window   uint64
			revision string
		}{
			"uncataloged-gemma": {window: 144384, revision: "sha256:uncataloged-gemma"},
		},
	}
	targetRef := setExactPublicChatTextTargetForTest(t, svc, localModel, asset)

	window, catalogRevision, modelRevision, provider, resolvedTargetRef, err := svc.ResolvePublicChatTextContextMetadata(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		"nimi/local-import-gemma-4-26b-a4b-it-q8-0-import-instance",
		targetRef,
	)
	if err != nil {
		t.Fatalf("ResolvePublicChatTextContextMetadata uncataloged GGUF import: %v", err)
	}
	if window != 144384 || catalogRevision != "runtime-local-asset/v1" ||
		modelRevision != "sha256:uncataloged-gemma" || provider != "local" {
		t.Fatalf("context metadata = window:%d catalog:%q model:%q provider:%q", window, catalogRevision, modelRevision, provider)
	}
	if got := resolvedTargetRef.GetLocalRuntime().GetReadinessRef(); got != targetRef.GetLocalRuntime().GetReadinessRef() {
		t.Fatalf("resolved target binding = %q", got)
	}
}

func TestResolvePublicChatTextContextMetadataFailsClosedWithoutCapacity(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)), Config{})
	customDir := t.TempDir()
	fixture := []byte(`version: 1
provider: openai
catalog_version: missing-context-service-fixture-v1
inventory_mode: static_source
models:
  - model_id: missing-context-service-fixture
    provider: openai
    model_type: chat
    updated_at: 2026-07-11
    capabilities: [text.generate]
    fitness:
      context_length: 8192
    pricing:
      unit: token
      input: unknown
      output: unknown
      currency: USD
      as_of: 2026-07-11
      notes: Remote test row intentionally lacks context_window_tokens and forges local-only fitness metadata.
    source_ref:
      url: https://example.invalid/missing-context-service-fixture
      retrieved_at: 2026-07-11
      note: Test-only fixture.
voices: []
`)
	if err := os.WriteFile(filepath.Join(customDir, "openai.yaml"), fixture, 0o600); err != nil {
		t.Fatalf("write missing-capacity service fixture: %v", err)
	}
	resolver, err := catalog.NewResolver(catalog.ResolverConfig{CustomDir: customDir})
	if err != nil {
		t.Fatalf("create missing-capacity service resolver: %v", err)
	}
	svc.speechCatalog = resolver
	_, _, _, _, _, err = svc.ResolvePublicChatTextContextMetadata(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		"missing-context-service-fixture",
		&runtimev1.RuntimeDurableTargetRef{Target: &runtimev1.RuntimeDurableTargetRef_Cloud{Cloud: &runtimev1.RuntimeDurableCloudTargetRef{
			Version: "v2", Provider: "openai", ProviderModelId: "missing-context-service-fixture", ConnectorId: "connector-test", RemoteModelCatalogId: "catalog-test",
		}}},
	)
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_MODULE_CONFIG_INVALID {
		t.Fatalf("expected catalog metadata failure, got err=%v reason=%v", err, reason)
	}
}

func TestPreferredRouteUsesProviderRegistryRuntimePlane(t *testing.T) {
	tests := []struct {
		name  string
		model string
		want  runtimev1.RoutePolicy
	}{
		{
			name:  "explicit_cloud_prefix",
			model: "cloud/default",
			want:  runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		},
		{
			name:  "registry_remote_provider_not_hardcoded",
			model: "stepfun/step-1",
			want:  runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
		},
		{
			name:  "registry_local_provider_stays_local",
			model: "local/qwen",
			want:  runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
		{
			name:  "unknown_provider_prefix_does_not_promote_cloud",
			model: "unknown-provider/model",
			want:  runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
		{
			name:  "bare_model_defaults_local",
			model: "qwen2.5",
			want:  runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			if got := preferredRoute(tt.model); got != tt.want {
				t.Fatalf("preferredRoute(%q) = %v, want %v", tt.model, got, tt.want)
			}
		})
	}
}

func TestLocalProviderResolveModelIDPreservesExplicitEnginePrefixes(t *testing.T) {
	p := &localProvider{}

	cases := map[string]string{
		"local/qwen2.5":               "qwen2.5",
		"llama/z-image-turbo":         "llama/z-image-turbo",
		"media/flux.1-schnell":        "media/flux.1-schnell",
		"speech/qwen3-tts":            "speech/qwen3-tts",
		"sidecar/stable-audio-open-1": "sidecar/stable-audio-open-1",
	}
	for input, want := range cases {
		if got := p.ResolveModelID(input); got != want {
			t.Fatalf("ResolveModelID(%q): got=%q want=%q", input, got, want)
		}
	}
}

func TestServicePublicSettersAndAccessors(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	constructed, err := New(logger, nil, nil, nil, nil, runtimecfg.Config{})
	if err != nil {
		t.Fatalf("New should not fail with default config: %v", err)
	}
	if constructed == nil {
		t.Fatalf("New should return service instance")
	}
	svc := newTestService(logger)
	if svc.CloudProvider() == nil {
		t.Fatalf("cloud provider accessor should return non-nil")
	}
	if svc.SpeechCatalogResolver() == nil {
		t.Fatalf("speech catalog resolver should return non-nil")
	}
	svc.SetModelRegistryPersistencePath("  /tmp/registry.json  ")
	if svc.registryPath != "/tmp/registry.json" {
		t.Fatalf("registry path should be trimmed, got %q", svc.registryPath)
	}
	fakeLister := &fakeLocalModelLister{}
	svc.SetLocalModelLister(fakeLister)
	if svc.localModel != fakeLister {
		t.Fatalf("local model lister should be set")
	}
	svc.SetLocalProviderEndpoint("llama", "http://127.0.0.1:18080/v1", "")
	local, ok := svc.selector.local.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider")
	}
	backend, _, _, available := local.pickAvailabilityBackend("llama/dynamic-image")
	if backend == nil || !available {
		t.Fatalf("llama backend should be hot-swapped after endpoint injection")
	}
	if backend.Name != "local-llama" {
		t.Fatalf("unexpected llama backend name: %q", backend.Name)
	}
	svc.SetLocalProviderEndpoint("sidecar", "http://127.0.0.1:19191", "sidecar-key")
	sidecarBackend, resolvedModel, explicit, available := local.pickAvailabilityBackend("sidecar/stable-audio-open-sidecar")
	if sidecarBackend == nil || !available {
		t.Fatalf("sidecar backend should be hot-swapped after endpoint injection")
	}
	if sidecarBackend.Name != "local-sidecar" {
		t.Fatalf("unexpected sidecar backend name: %q", sidecarBackend.Name)
	}
	if resolvedModel != "stable-audio-open-sidecar" || !explicit {
		t.Fatalf("unexpected sidecar resolution: model=%q explicit=%v", resolvedModel, explicit)
	}
}

func TestNewFailsOnInvalidCustomSpeechCatalog(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	invalidDir := t.TempDir()
	invalidPath := invalidDir + ".file"
	if err := os.WriteFile(invalidPath, []byte("not-a-directory"), 0o600); err != nil {
		t.Fatalf("seed invalid custom dir path: %v", err)
	}

	_, err := New(logger, nil, nil, nil, nil, runtimecfg.Config{
		ModelCatalogCustomDir: invalidPath,
	})
	if err == nil {
		t.Fatal("expected custom speech catalog init failure")
	}
}

func TestLocalProviderCanonicalRoutingPrefersLlamaForTextAndEmbed(t *testing.T) {
	local := &localProvider{
		llama: &nimillm.Backend{Name: "local-llama"},
		media: &nimillm.Backend{Name: "local-media"},
	}

	backend, resolvedModel, explicit, available := local.pickTextBackend("local/qwen2.5")
	if backend == nil || backend.Name != "local-llama" {
		t.Fatalf("expected canonical local text backend to resolve to llama, got %#v", backend)
	}
	if resolvedModel != "qwen2.5" || !explicit || !available {
		t.Fatalf("unexpected text backend resolution: model=%q explicit=%v available=%v", resolvedModel, explicit, available)
	}

	embedBackend, embedModel, embedExplicit, embedAvailable := local.pickEmbeddingBackend("local/qwen2.5")
	if embedBackend == nil || embedBackend.Name != "local-llama" {
		t.Fatalf("expected canonical local embed backend to resolve to llama, got %#v", embedBackend)
	}
	if embedModel != "qwen2.5" || !embedExplicit || !embedAvailable {
		t.Fatalf("unexpected embed backend resolution: model=%q explicit=%v available=%v", embedModel, embedExplicit, embedAvailable)
	}
}

func TestLocalProviderCanonicalAvailabilityAndImageRouting(t *testing.T) {
	local := &localProvider{
		llama: &nimillm.Backend{Name: "local-llama"},
		media: &nimillm.Backend{Name: "local-media"},
	}

	availabilityBackend, resolvedModel, explicit, available := local.pickAvailabilityBackend("local/qwen2.5")
	if availabilityBackend == nil || availabilityBackend.Name != "local-llama" {
		t.Fatalf("expected local availability to prefer llama, got %#v", availabilityBackend)
	}
	if resolvedModel != "qwen2.5" || !explicit || !available {
		t.Fatalf("unexpected availability resolution: model=%q explicit=%v available=%v", resolvedModel, explicit, available)
	}

	imageBackend, imageModel, providerType := local.resolveMediaBackendForModal("local/flux.1-schnell", runtimev1.Modal_MODAL_IMAGE)
	if imageBackend == nil || imageBackend.Name != "local-media" {
		t.Fatalf("expected local image backend to resolve to media, got %#v", imageBackend)
	}
	if imageModel != "flux.1-schnell" || providerType != "media" {
		t.Fatalf("unexpected image resolution: model=%q providerType=%q", imageModel, providerType)
	}
}

func TestRouteSelectorUsesModalAwareLocalAvailabilityForImportedImageModel(t *testing.T) {
	selector := newRouteSelector(Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"media": {BaseURL: "http://127.0.0.1:18181/v1"},
		},
	})

	_, _, _, _, err := selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		"local-import/z-image-turbo-Q4_K_M",
	)
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE {
		t.Fatalf("default local availability should not treat imported image as text-ready, got err=%v reason=%v", err, reason)
	}

	provider, route, modelResolved, _, err := selector.resolveProviderWithTargetAndModal(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		"local-import/z-image-turbo-Q4_K_M",
		nil,
		runtimev1.Modal_MODAL_IMAGE,
	)
	if err != nil {
		t.Fatalf("image modal availability should resolve media provider: %v", err)
	}
	if provider == nil || route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved != "local-import/z-image-turbo-Q4_K_M" {
		t.Fatalf("unexpected image modal route resolution: provider=%v route=%v model=%q", provider, route, modelResolved)
	}
}

func TestLocalProviderHardCutDoesNotFallbackAcrossEngines(t *testing.T) {
	local := &localProvider{
		llama: &nimillm.Backend{Name: "local-llama"},
	}

	textBackend, resolvedModel, explicit, available := local.pickTextBackend("local/qwen2.5")
	if textBackend == nil || !available {
		t.Fatalf("text route should still resolve to llama: backend=%#v available=%v", textBackend, available)
	}
	if resolvedModel != "qwen2.5" || !explicit {
		t.Fatalf("unexpected text hard-cut resolution: model=%q explicit=%v", resolvedModel, explicit)
	}

	imageBackend, imageModel, providerType := local.resolveMediaBackendForModal("local/flux.1-schnell", runtimev1.Modal_MODAL_IMAGE)
	if imageBackend != nil || providerType != "" {
		t.Fatalf("image route must not fallback to llama: backend=%#v providerType=%q", imageBackend, providerType)
	}
	if imageModel != "flux.1-schnell" {
		t.Fatalf("unexpected image hard-cut model resolution: %q", imageModel)
	}
}

func TestLocalProviderExplicitEngineSelectionSurvivesRouting(t *testing.T) {
	selector := newRouteSelector(Config{
		LocalProviders: map[string]nimillm.ProviderCredentials{
			"llama": {BaseURL: "http://127.0.0.1:18080/v1"},
			"media": {BaseURL: "http://127.0.0.1:18181/v1"},
		},
	})

	provider, route, modelResolved, _, err := selector.resolveProvider(
		context.Background(),
		runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
		runtimev1.FallbackPolicy_FALLBACK_POLICY_ALLOW,
		"media/flux.1-schnell",
	)
	if err != nil {
		t.Fatalf("resolve explicit media route: %v", err)
	}
	if route != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL || modelResolved != "media/flux.1-schnell" {
		t.Fatalf("unexpected explicit media resolution: route=%v model=%q", route, modelResolved)
	}

	local, ok := provider.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider wrapper")
	}
	backend, resolvedModel, explicit, available := local.pickAvailabilityBackend(modelResolved)
	if backend == nil || backend.Name != "local-media" {
		t.Fatalf("explicit media route should keep media backend, got %#v", backend)
	}
	if resolvedModel != "flux.1-schnell" || !explicit || !available {
		t.Fatalf("unexpected explicit media availability: model=%q explicit=%v available=%v", resolvedModel, explicit, available)
	}
}

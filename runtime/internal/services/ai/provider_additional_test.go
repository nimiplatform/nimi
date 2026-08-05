package ai

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

func TestRouteSelectorResolvesDefaultAliases(t *testing.T) {
	selector := newRouteSelector(Config{
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
	local, ok := svc.selector.local.(*localProvider)
	if !ok || local == nil {
		t.Fatalf("expected local provider")
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

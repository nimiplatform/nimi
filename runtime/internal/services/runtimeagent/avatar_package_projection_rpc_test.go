package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type avatarPackageProjectionResolverStub struct {
	resolve func(context.Context, AvatarPackageLaunchProjectionRequest) (*runtimev1.ResolveAvatarPackageLaunchProjectionResponse, error)
}

func (s avatarPackageProjectionResolverStub) ResolveAvatarPackageLaunchProjection(ctx context.Context, req AvatarPackageLaunchProjectionRequest) (*runtimev1.ResolveAvatarPackageLaunchProjectionResponse, error) {
	return s.resolve(ctx, req)
}

func TestResolveAvatarPackageLaunchProjectionUsesInjectedResolver(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	var captured AvatarPackageLaunchProjectionRequest
	svc.SetAvatarPackageLaunchProjectionResolver(avatarPackageProjectionResolverStub{
		resolve: func(_ context.Context, req AvatarPackageLaunchProjectionRequest) (*runtimev1.ResolveAvatarPackageLaunchProjectionResponse, error) {
			captured = req
			return validRuntimeAvatarPackageProjection(), nil
		},
	})

	resp, err := svc.ResolveAvatarPackageLaunchProjection(avatarPackageReadTestContext(), &runtimev1.ResolveAvatarPackageLaunchProjectionRequest{
		Context:          avatarPackageAgentContext("desktop.app"),
		AvatarInstanceId: "avatar-instance-1",
	})
	if err != nil {
		t.Fatalf("ResolveAvatarPackageLaunchProjection: %v", err)
	}
	if resp.GetAvatarPackageRef() != "asset-market:package:package-avatar-1" {
		t.Fatalf("unexpected avatar package ref: %q", resp.GetAvatarPackageRef())
	}
	if captured.CallerAppID != "desktop.app" ||
		captured.SubjectUserID != "user-1" ||
		captured.OwnerUserID != "user-1" ||
		captured.RealmAgentID != "agent-alpha" ||
		captured.LocalAgentRef != testRuntimeAgentLocalRef("agent-alpha") ||
		captured.AvatarInstanceID != "avatar-instance-1" {
		t.Fatalf("resolver request mismatch: %+v", captured)
	}
}

func TestResolveAvatarPackageLaunchProjectionFailsClosedWithoutResolver(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)

	_, err := svc.ResolveAvatarPackageLaunchProjection(avatarPackageReadTestContext(), &runtimev1.ResolveAvatarPackageLaunchProjectionRequest{
		Context:          avatarPackageAgentContext("desktop.app"),
		AvatarInstanceId: "avatar-instance-1",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition without resolver, got %v", err)
	}
}

func TestResolveAvatarPackageLaunchProjectionRequiresProtectedScope(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetAvatarPackageLaunchProjectionResolver(avatarPackageProjectionResolverStub{
		resolve: func(context.Context, AvatarPackageLaunchProjectionRequest) (*runtimev1.ResolveAvatarPackageLaunchProjectionResponse, error) {
			return validRuntimeAvatarPackageProjection(), nil
		},
	})

	_, err := svc.ResolveAvatarPackageLaunchProjection(context.Background(), &runtimev1.ResolveAvatarPackageLaunchProjectionRequest{
		Context:          avatarPackageAgentContext("desktop.app"),
		AvatarInstanceId: "avatar-instance-1",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument without protected scope, got %v", err)
	}
}

func TestResolveAvatarPackageLaunchProjectionRejectsInvalidResolverProjection(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetAvatarPackageLaunchProjectionResolver(avatarPackageProjectionResolverStub{
		resolve: func(context.Context, AvatarPackageLaunchProjectionRequest) (*runtimev1.ResolveAvatarPackageLaunchProjectionResponse, error) {
			projection := validRuntimeAvatarPackageProjection()
			projection.BackendKind = "sprite2d"
			return projection, nil
		},
	})

	_, err := svc.ResolveAvatarPackageLaunchProjection(avatarPackageReadTestContext(), &runtimev1.ResolveAvatarPackageLaunchProjectionRequest{
		Context:          avatarPackageAgentContext("desktop.app"),
		AvatarInstanceId: "avatar-instance-1",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for unsupported backend, got %v", err)
	}
}

func TestResolveAvatarPackageLaunchProjectionRejectsBlockingDiagnostics(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	svc.SetAvatarPackageLaunchProjectionResolver(avatarPackageProjectionResolverStub{
		resolve: func(context.Context, AvatarPackageLaunchProjectionRequest) (*runtimev1.ResolveAvatarPackageLaunchProjectionResponse, error) {
			projection := validRuntimeAvatarPackageProjection()
			projection.CompatibilityDiagnostics = []*runtimev1.RuntimeAvatarPackageCompatibilityDiagnostic{{
				Code:     "missing-runtime-asset",
				Severity: "blocking",
			}}
			return projection, nil
		},
	})

	_, err := svc.ResolveAvatarPackageLaunchProjection(avatarPackageReadTestContext(), &runtimev1.ResolveAvatarPackageLaunchProjectionRequest{
		Context:          avatarPackageAgentContext("desktop.app"),
		AvatarInstanceId: "avatar-instance-1",
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition for blocking diagnostics, got %v", err)
	}
}

func avatarPackageAgentContext(appID string) *runtimev1.AgentRequestContext {
	ctx := testRuntimeAgentIdentityContext("agent-alpha")
	ctx.AppId = appID
	return ctx
}

func avatarPackageReadTestContext() context.Context {
	return envelope.WithValidatedProtectedCapability(context.Background(), "desktop.app", runtimeAgentAvatarPackageReadScope)
}

func validRuntimeAvatarPackageProjection() *runtimev1.ResolveAvatarPackageLaunchProjectionResponse {
	return &runtimev1.ResolveAvatarPackageLaunchProjectionResponse{
		AvatarPackageRef:            "asset-market:package:package-avatar-1",
		PackageKind:                 "avatar",
		PackageId:                   "package-avatar-1",
		BundleId:                    "bundle-avatar-1",
		BundleMemberAssetIds:        []string{"asset-model", "asset-texture"},
		BackendKind:                 "live2d",
		BackendCapabilityProfileRef: "avatar-capability/live2d/default",
		AvatarModelLayout: &runtimev1.RuntimeAvatarPackageModelLayout{
			LayoutVersion:    1,
			BackendKind:      "live2d",
			EntryAssetId:     "asset-model",
			RuntimeRoot:      "models/neymar",
			RequiredAssetIds: []string{"asset-model", "asset-texture"},
			Live2D: &runtimev1.RuntimeAvatarPackageLive2DLayout{
				Model3JsonAssetId: "asset-model",
				Model3JsonPath:    "models/neymar/neymar.model3.json",
			},
		},
		Provenance: &runtimev1.RuntimeAvatarPackageProvenance{
			SourceType:        "first_party_curated",
			SourceFingerprint: "sha256:avatar-package",
			AdmittedAt:        "2026-05-16T00:00:00.000Z",
			Validator:         "asset-market.avatar-package-readiness",
		},
		CompatibilityDiagnostics: []*runtimev1.RuntimeAvatarPackageCompatibilityDiagnostic{{
			Code:     "avatar-package-compatible",
			Severity: "info",
			Source:   "runtime",
		}},
		Status:             "published",
		IsReady:            true,
		ReadinessIssues:    nil,
		MaterializationRef: "materialization:avatar-package-1",
		ObservedAt:         "2026-05-16T00:01:00.000Z",
	}
}

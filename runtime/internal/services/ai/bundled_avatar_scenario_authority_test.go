package ai

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bundledavatar"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protectedprincipal"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

func bundledAvatarScenarioContext(capability string, accountID string) context.Context {
	var epoch protectedlocal.Identifier
	epoch[0] = 1
	principal := protectedprincipal.New(
		bundledavatar.AppID, bundledavatar.ProfileID, capability,
		&runtimev1.AccountProjection{AccountId: accountID, RealmEnvironmentId: "realm-test"},
		1, epoch, make(chan struct{}),
	)
	ctx := protectedprincipal.With(context.Background(), principal)
	return metadata.NewIncomingContext(ctx, metadata.Pairs("x-nimi-app-id", bundledavatar.AppID))
}

func TestBundledAvatarScenarioOwnerComesFromProtectedPrincipal(t *testing.T) {
	svc := &Service{}
	req := &runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{
		AppId:         "renderer-selected-app",
		SubjectUserId: "renderer-selected-account",
	}}

	normalized, err := svc.normalizeSubmitScenarioJobOwner(bundledAvatarScenarioContext("ai.spend.meter", "account-current"), req)
	if err != nil {
		t.Fatalf("normalize protected Avatar scenario owner: %v", err)
	}
	if got := normalized.GetHead().GetAppId(); got != bundledavatar.AppID {
		t.Fatalf("protected Avatar app id = %q, want %q", got, bundledavatar.AppID)
	}
	if got := normalized.GetHead().GetSubjectUserId(); got != "account-current" {
		t.Fatalf("protected Avatar owner = %q, want principal account", got)
	}
	if req.GetHead().GetAppId() != "renderer-selected-app" || req.GetHead().GetSubjectUserId() != "renderer-selected-account" {
		t.Fatal("normalization mutated the renderer request")
	}
}

func TestBundledAvatarScenarioWithoutProtectedPrincipalStaysUnprivileged(t *testing.T) {
	svc := &Service{}
	normalized, err := svc.normalizeSubmitScenarioJobOwner(
		context.Background(),
		&runtimev1.SubmitScenarioJobRequest{Head: &runtimev1.ScenarioRequestHead{}},
	)
	if err != nil || normalized.GetHead().GetSubjectUserId() != anonymousScenarioJobOwner {
		t.Fatalf("ordinary call must retain ordinary ownership: normalized=%v err=%v", normalized, err)
	}
}

func TestBundledAvatarScenarioReadBindsStoredJobToPrincipalAccount(t *testing.T) {
	job := &runtimev1.ScenarioJob{Head: &runtimev1.ScenarioRequestHead{
		AppId:         bundledavatar.AppID,
		SubjectUserId: "account-owner",
	}}
	service := &Service{}
	if err := service.authorizeScenarioJob(bundledAvatarScenarioContext("runtime.ai.scenario.read", "account-owner"), job); err != nil {
		t.Fatalf("owner principal should read its protected Avatar job: %v", err)
	}
	if err := service.authorizeScenarioJob(bundledAvatarScenarioContext("runtime.ai.scenario.read", "account-other"), job); status.Code(err) != codes.PermissionDenied {
		t.Fatalf("other principal must not read the job, got %v", err)
	}
}

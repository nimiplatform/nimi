package runtimeagent

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestLocalAppConfigureOperationsFailClosedBeforeOwnerState(t *testing.T) {
	enabled := true
	svc := &Service{}
	checks := map[string]func() error{
		"shared-config-get": func() error {
			_, err := svc.GetLocalAppSharedLocalAgentAIConfig(context.Background(), &runtimev1.GetLocalAppSharedLocalAgentAIConfigRequest{})
			return err
		},
		"shared-config-overwrite": func() error {
			_, err := svc.OverwriteLocalAppSharedLocalAgentAIConfig(context.Background(), &runtimev1.OverwriteLocalAppSharedLocalAgentAIConfigRequest{})
			return err
		},
		"profile-preview": func() error {
			_, err := svc.PreviewLocalAppSharedLocalAgentAIProfile(context.Background(), &runtimev1.PreviewLocalAppSharedLocalAgentAIProfileRequest{})
			return err
		},
		"profile-apply": func() error {
			_, err := svc.ApplyLocalAppSharedLocalAgentAIProfile(context.Background(), &runtimev1.ApplyLocalAppSharedLocalAgentAIProfileRequest{})
			return err
		},
		"autonomy-snapshot": func() error {
			_, err := svc.GetLocalAppAgentAutonomySnapshot(context.Background(), &runtimev1.GetLocalAppAgentAutonomySnapshotRequest{AgentHandle: "opaque"})
			return err
		},
		"autonomy-update": func() error {
			_, err := svc.UpdateLocalAppAgentAutonomy(context.Background(), &runtimev1.UpdateLocalAppAgentAutonomyRequest{
				AgentHandle: "opaque", ExpectedAutonomyRevision: 1,
				Intent: &runtimev1.LocalAppAgentAutonomyIntent{Enabled: &enabled},
			})
			return err
		},
		"presentation-snapshot": func() error {
			_, err := svc.GetLocalAppAgentPresentationSnapshot(context.Background(), &runtimev1.GetLocalAppAgentPresentationSnapshotRequest{AgentHandle: "opaque"})
			return err
		},
		"presentation-commit": func() error {
			_, err := svc.CommitLocalAppAgentPresentation(context.Background(), &runtimev1.CommitLocalAppAgentPresentationRequest{
				AgentHandle: "opaque", Intent: &runtimev1.LocalAppAgentPresentationIntent{},
			})
			return err
		},
	}
	for name, check := range checks {
		t.Run(name, func(t *testing.T) {
			err := check()
			if status.Code(err) != codes.Unavailable {
				t.Fatalf("status = %v, err=%v", status.Code(err), err)
			}
			reason, ok := grpcerr.ExtractReasonCode(err)
			if !ok || reason != runtimev1.ReasonCode_LOCAL_APP_OPERATION_UNAVAILABLE {
				t.Fatalf("reason = %v, %v", reason, ok)
			}
		})
	}
}

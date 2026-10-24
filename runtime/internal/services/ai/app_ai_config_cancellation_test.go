package ai

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type canceledAIConfigProjection struct {
	missingLoadoutProjectionResolver
	cancel context.CancelFunc
	calls  int
}

func (r *canceledAIConfigProjection) ProjectSelectedLocalLoadout(ctx context.Context, _ string) (localexecution.LoadoutOption, bool, error) {
	r.calls++
	r.cancel()
	return localexecution.LoadoutOption{}, false, ctx.Err()
}

func TestProjectionCancellationAppAIConfigStopsCapabilitiesAndReturnsCanceled(t *testing.T) {
	s := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	config := appAIConfig("app.cancel", localAppAIConfigIntent("text.generate"), localAppAIConfigIntent("image.generate"))
	if _, err := s.OverwriteAppAIConfig(protectedAppAIConfigPrincipalContext("account-a", "app.cancel"), &runtimev1.OverwriteAppAIConfigRequest{Config: config, ExpectedRevision: "0"}); err != nil {
		t.Fatal(err)
	}
	base := localAppAIConfigContext("account-a", "app.cancel", accountservice.LocalAppOperationAppAIConfigRead)
	ctx, cancel := context.WithCancel(base)
	defer cancel()
	resolver := &canceledAIConfigProjection{cancel: cancel}
	s.SetLocalExecutionResolver(resolver)
	response, err := s.GetAppAIConfig(ctx, &runtimev1.GetAppAIConfigRequest{})
	if response != nil || status.Code(err) != codes.Canceled || resolver.calls != 1 {
		t.Fatalf("canceled response=%+v code=%v calls=%d", response, status.Code(err), resolver.calls)
	}
	// Another owner's context remains usable; cancellation does not close the
	// configuration service or remove its committed intent.
	s.SetLocalExecutionResolver(missingLoadoutProjectionResolver{})
	response, err = s.GetAppAIConfig(base, &runtimev1.GetAppAIConfigRequest{})
	if err != nil || len(response.GetConfig().GetCapabilities()) != 2 {
		t.Fatalf("independent read=%+v err=%v", response, err)
	}
}

func TestProjectionCancellationAppAIConfigOptionsReturnsCanceledNotUnknown(t *testing.T) {
	s := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithCancel(localAppAIConfigContext("account-a", "app.cancel", accountservice.LocalAppOperationAppAIConfigOptionsList))
	defer cancel()
	resolver := &canceledAIConfigProjection{cancel: cancel}
	s.SetLocalExecutionResolver(resolver)
	response, err := s.ListAppAIConfigOptions(ctx, &runtimev1.ListAppAIConfigOptionsRequest{Query: &runtimev1.ListAppAIConfigOptionsRequest_LocalLoadouts{LocalLoadouts: &runtimev1.AIConfigLocalLoadoutOptionsQuery{CapabilityContract: "text.generate"}}})
	if response != nil || status.Code(err) != codes.Canceled || resolver.calls != 1 {
		t.Fatalf("canceled options=%+v err=%v calls=%d", response, err, resolver.calls)
	}
}

func TestProjectionCancellationAppAIConfigDoesNotReportMissingAfterDeadline(t *testing.T) {
	s := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx, cancel := context.WithDeadline(localAppAIConfigContext("account-a", "app.absent", accountservice.LocalAppOperationAppAIConfigRead), time.Now().Add(-time.Second))
	defer cancel()
	response, err := s.GetAppAIConfig(ctx, &runtimev1.GetAppAIConfigRequest{})
	if response != nil || status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("expired read reported missing: %+v, %v", response, err)
	}
}

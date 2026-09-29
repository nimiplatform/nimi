package grpcserver

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"github.com/nimiplatform/nimi/runtime/internal/storedformat"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func TestMaintenanceServerServesOnlyTheBoundedSurfaceWithTheTypedReason(t *testing.T) {
	manager, connection := newProtectedRPCFixture(t)
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	if err := os.MkdirAll(productControlRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	serviceStateRoot := t.TempDir()
	var restarts atomic.Int32
	refusal := storedformat.Refuse("runtimeagent.conversation", storedformat.OfflineConversion, errors.New("retired layout"))
	maintenance, err := newProtectedMaintenanceServer(
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		config.Config{AuditRingBufferSize: 64, UsageStatsBufferSize: 64},
		ProtectedServiceBindings{
			ServiceStateRoot:        serviceStateRoot,
			DesktopSessions:         manager,
			RuntimeRestartRequester: func() bool { restarts.Add(1); return true },
		},
		productControlRoot,
		localservice.ProductControlDataRootSecurityBinding{},
		filepath.Join(t.TempDir(), "runtime", "config.json"),
		refusal,
	)
	if err != nil {
		t.Fatal(err)
	}
	if maintenance.Refusal() != refusal {
		t.Fatal("maintenance lost its owner refusal")
	}
	baseListener := bufconn.Listen(1024 * 1024)
	serveDone := make(chan error, 1)
	go func() {
		serveDone <- maintenance.server.Serve(&protectedDesktopTestListener{Listener: baseListener, connection: connection})
	}()
	t.Cleanup(func() {
		maintenance.Stop(context.Background())
		_ = baseListener.Close()
		<-serveDone
	})
	clientConn, err := grpc.NewClient(
		"passthrough:///protected-maintenance-test",
		grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return baseListener.Dial() }),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = clientConn.Close() })

	if _, err := runtimev1.NewRuntimeAuthServiceClient(clientConn).OpenDesktopSession(context.Background(), &runtimev1.OpenDesktopSessionRequest{}); err != nil {
		t.Fatalf("OpenDesktopSession in maintenance: %v", err)
	}
	control := runtimev1.NewRuntimeServiceControlServiceClient(clientConn)
	state, err := control.GetRuntimeServiceState(context.Background(), &runtimev1.GetRuntimeServiceStateRequest{})
	if err != nil || state.GetMode() != runtimev1.RuntimeServiceMode_RUNTIME_SERVICE_MODE_MAINTENANCE ||
		state.GetReasonCode() != runtimev1.ReasonCode_RUNTIME_STORED_DATA_UNSUPPORTED {
		t.Fatalf("service state = %+v, %v", state, err)
	}

	machine := metadata.NewOutgoingContext(context.Background(), metadata.Pairs(
		protectedFirstPartyProfileMetadata, protectedlocal.DesktopMachineProductNativeMarker,
		"x-nimi-app-id", envelope.ProtectedDesktopAppID,
	))
	local := runtimev1.NewRuntimeLocalServiceClient(clientConn)
	if _, err := local.GetProductControlRecord(machine, &runtimev1.GetProductControlRecordRequest{}); err != nil {
		t.Fatalf("Product Control record read in maintenance: %v", err)
	}
	if _, err := local.GetProductControlSelectedDataRoot(machine, &runtimev1.GetProductControlSelectedDataRootRequest{}); err != nil {
		t.Fatalf("selected root read in maintenance: %v", err)
	}

	refused := map[string]func() error{
		"registered service, other method": func() error {
			_, callErr := local.ListModelAssets(machine, &runtimev1.ListModelAssetsRequest{})
			return callErr
		},
		"Check and Sync start": func() error {
			_, callErr := local.StartProductControlCheckSync(machine, &runtimev1.StartProductControlCheckSyncRequest{})
			return callErr
		},
		"unregistered account service": func() error {
			_, callErr := runtimev1.NewRuntimeAccountServiceClient(clientConn).GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{})
			return callErr
		},
		"developer mode readiness": func() error {
			_, callErr := runtimev1.NewRuntimeDevelopmentServiceClient(clientConn).GetDeveloperModeStatus(context.Background(), &runtimev1.GetDeveloperModeStatusRequest{})
			return callErr
		},
		"account event stream": func() error {
			stream, callErr := runtimev1.NewRuntimeAccountServiceClient(clientConn).SubscribeAccountSessionEvents(context.Background(), &runtimev1.SubscribeAccountSessionEventsRequest{})
			if callErr != nil {
				return callErr
			}
			_, callErr = stream.Recv()
			return callErr
		},
	}
	for name, call := range refused {
		callErr := call()
		reason, ok := grpcerr.ExtractReasonCode(callErr)
		if !ok || reason != runtimev1.ReasonCode_RUNTIME_STORED_DATA_UNSUPPORTED || status.Code(callErr) != codes.FailedPrecondition {
			t.Fatalf("%s: reason=%v present=%v code=%v err=%v", name, reason, ok, status.Code(callErr), callErr)
		}
	}

	restart, err := control.RequestRuntimeRestart(context.Background(), &runtimev1.RequestRuntimeRestartRequest{})
	if err != nil || !restart.GetAccepted() || restarts.Load() != 1 {
		t.Fatalf("restart in maintenance = %+v, %v (requests=%d)", restart, err, restarts.Load())
	}
	// Session results live in the maintenance plane under the service state
	// root, never in a data root.
	if _, err := os.Stat(filepath.Join(serviceStateRoot, "runtime", "maintenance", "memory.db")); err != nil {
		t.Fatalf("maintenance audit plane was not opened under the service state root: %v", err)
	}
}

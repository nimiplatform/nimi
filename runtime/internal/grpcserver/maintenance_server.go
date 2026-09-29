package grpcserver

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"path/filepath"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	authservice "github.com/nimiplatform/nimi/runtime/internal/services/auth"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	runtimeagentservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
	runtimecontrolservice "github.com/nimiplatform/nimi/runtime/internal/services/runtimecontrol"
	"github.com/nimiplatform/nimi/runtime/internal/storedformat"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
)

// maintenanceMethods is the complete bounded surface a maintenance Runtime
// serves on its verified Desktop transport (service-operations r092).
var maintenanceMethods = map[string]struct{}{
	protectedGetRuntimeServiceStateMethod:                                    {},
	protectedRequestRuntimeRestartMethod:                                     {},
	protectedOpenDesktopSessionMethod:                                        {},
	"/nimi.runtime.v1.RuntimeLocalService/GetProductControlRecord":           {},
	"/nimi.runtime.v1.RuntimeLocalService/GetProductControlSelectedDataRoot": {},
	"/nimi.runtime.v1.RuntimeLocalService/ReplaceProductControlDataRoot":     {},
}

// MaintenanceRequiredError reports that an owner refused the stored data in
// the selected data root. It carries the bounded surface Runtime serves
// instead of constructing any ordinary owner.
type MaintenanceRequiredError struct {
	Maintenance *MaintenanceServer
}

func (e *MaintenanceRequiredError) Error() string {
	if e == nil || e.Maintenance == nil {
		return "Runtime stored data refused"
	}
	return fmt.Sprintf("Runtime serves maintenance only: %v", e.Maintenance.refusal)
}

func (e *MaintenanceRequiredError) Unwrap() error {
	if e == nil || e.Maintenance == nil || e.Maintenance.refusal == nil {
		return nil
	}
	return e.Maintenance.refusal
}

// MaintenanceServer is the protected Desktop gRPC surface of a Runtime whose
// ordinary startup was refused. It holds no owner and opens nothing in the
// refused data root.
type MaintenanceServer struct {
	refusal    *storedformat.Refusal
	server     *grpc.Server
	closeAudit func()
}

// Refusal is the owner classification that put Runtime in maintenance.
func (m *MaintenanceServer) Refusal() *storedformat.Refusal {
	if m == nil {
		return nil
	}
	return m.refusal
}

// ServeVerifiedNativeDesktop serves the maintenance surface only on the native
// listener that has already verified the Desktop process.
func (m *MaintenanceServer) ServeVerifiedNativeDesktop(listener net.Listener) error {
	if m == nil || m.server == nil {
		return fmt.Errorf("protected maintenance gRPC server is unavailable")
	}
	if listener == nil {
		return fmt.Errorf("verified native Desktop listener is required")
	}
	if err := m.server.Serve(&nativeVerifiedDesktopListener{Listener: listener}); err != nil {
		return fmt.Errorf("serve protected maintenance gRPC: %w", err)
	}
	return nil
}

// Stop ends the maintenance surface, waiting for in-flight calls until ctx
// ends.
func (m *MaintenanceServer) Stop(ctx context.Context) {
	if m == nil || m.server == nil {
		return
	}
	done := make(chan struct{})
	go func() {
		m.server.GracefulStop()
		close(done)
	}()
	select {
	case <-done:
	case <-ctx.Done():
		m.server.Stop()
		<-done
	}
	if m.closeAudit != nil {
		m.closeAudit()
		m.closeAudit = nil
	}
}

// preflightProtectedStoredData runs each owner's read-only classification of
// the selected root before any owner opens it. Only a typed owner refusal is
// returned; everything else is left to the ordinary owner construction.
func preflightProtectedStoredData(cfg config.Config) *storedformat.Refusal {
	if strings.TrimSpace(cfg.DataRootRef) == "" || strings.TrimSpace(cfg.LocalStatePath) == "" {
		return nil
	}
	return runtimeagentservice.PreflightStoredConversation(cfg.LocalStatePath)
}

func newProtectedMaintenanceServer(logger *slog.Logger, cfg config.Config, bindings ProtectedServiceBindings, productControlRoot string, security localservice.ProductControlDataRootSecurityBinding, serviceConfigPath string, refusal *storedformat.Refusal) (*MaintenanceServer, error) {
	if bindings.DesktopSessions == nil || bindings.RuntimeRestartRequester == nil {
		return nil, fmt.Errorf("maintenance requires the verified Desktop session authority and restart requester")
	}
	if logger == nil {
		logger = slog.Default()
	}
	// The refused root's store is never opened. Session, transport refusal,
	// and replacement results go to a bounded maintenance audit plane under
	// the Runtime service state root instead. Without it the typed state still
	// reaches Desktop, while session opens and replacement fail as unrecorded.
	audit, closeAudit, auditErr := openMaintenanceAuditPlane(logger, cfg, bindings.ServiceStateRoot)
	if auditErr != nil {
		logger.Error("maintenance audit plane unavailable; sensitive maintenance results cannot be recorded", "error", auditErr)
	}
	productControl, err := localservice.NewProductControlMaintenance(
		logger,
		productControlRoot,
		security,
		func(dataRootRef string) error {
			return config.ValidateServiceOwnedDataRootMutation(serviceConfigPath, dataRootRef)
		},
		func(dataRootRef string) (bool, error) {
			return config.WriteServiceOwnedDataRoot(serviceConfigPath, dataRootRef)
		},
		audit,
	)
	if err != nil {
		if closeAudit != nil {
			closeAudit()
		}
		return nil, err
	}
	reason := runtimev1.ReasonCode_RUNTIME_STORED_DATA_UNSUPPORTED
	transportUnary := newUnaryProtectedDesktopTransportInterceptor(bindings.DesktopSessions, nil, nil)
	transportStream := newStreamProtectedDesktopTransportInterceptor(bindings.DesktopSessions, nil)
	server := grpc.NewServer(
		grpc.Creds(newProtectedDesktopTransportCredentials(newTransportRefusalAudit(audit, transportDesktop))),
		grpc.KeepaliveEnforcementPolicy(protectedGRPCKeepalivePolicy()),
		grpc.MaxRecvMsgSize(maxGRPCRecvMessageBytes),
		grpc.MaxSendMsgSize(maxGRPCSendMessageBytes),
		grpc.MaxConcurrentStreams(maxGRPCConcurrentStreams),
		grpc.ReadBufferSize(grpcIOBufferBytes),
		grpc.WriteBufferSize(grpcIOBufferBytes),
		// Every connection was OS-verified at accept. The gate runs first so any
		// operation outside the bounded surface, including an unregistered
		// service, returns the same typed refusal instead of a role error.
		grpc.ChainUnaryInterceptor(maintenanceUnaryGate, transportUnary),
		grpc.ChainStreamInterceptor(maintenanceStreamGate, transportStream),
		grpc.UnknownServiceHandler(func(any, grpc.ServerStream) error { return maintenanceRefusal() }),
	)
	runtimev1.RegisterRuntimeServiceControlServiceServer(server, runtimecontrolservice.NewMaintenance(
		bindings.DesktopSessions, bindings.RuntimeRestartRequester, reason,
	))
	runtimev1.RegisterRuntimeAuthServiceServer(server, authservice.NewWithDependencies(
		logger, audit, 0, 0, authservice.WithDesktopSessionManager(bindings.DesktopSessions),
	))
	runtimev1.RegisterRuntimeLocalServiceServer(server, maintenanceLocalService{productControl: productControl})
	return &MaintenanceServer{refusal: refusal, server: server, closeAudit: closeAudit}, nil
}

// openMaintenanceAuditPlane opens the bounded maintenance audit store under the
// Runtime service state root, outside every data root, with the ordinary
// record bounds.
func openMaintenanceAuditPlane(logger *slog.Logger, cfg config.Config, serviceStateRoot string) (*auditlog.Store, func(), error) {
	root := filepath.Clean(strings.TrimSpace(serviceStateRoot))
	if !filepath.IsAbs(root) {
		return nil, nil, fmt.Errorf("maintenance audit plane requires the absolute Runtime service state root")
	}
	backend, err := runtimepersistence.Open(logger, filepath.Join(root, "runtime", "maintenance", "local-state.json"))
	if err != nil {
		return nil, nil, err
	}
	store, err := auditlog.Open(backend, logger, cfg.AuditRingBufferSize, cfg.UsageStatsBufferSize)
	if err != nil {
		_ = backend.Close()
		return nil, nil, err
	}
	return store, func() { _ = backend.Close() }, nil
}

// maintenanceLocalService exposes only the Product Control maintenance reads
// and replacement; the gate refuses every other RuntimeLocalService method.
type maintenanceLocalService struct {
	runtimev1.UnimplementedRuntimeLocalServiceServer
	productControl *localservice.ProductControlMaintenance
}

func (s maintenanceLocalService) GetProductControlRecord(ctx context.Context, req *runtimev1.GetProductControlRecordRequest) (*runtimev1.ProductControlProjectionJson, error) {
	return s.productControl.GetProductControlRecord(ctx, req)
}

func (s maintenanceLocalService) GetProductControlSelectedDataRoot(ctx context.Context, req *runtimev1.GetProductControlSelectedDataRootRequest) (*runtimev1.ProductControlProjectionJson, error) {
	return s.productControl.GetProductControlSelectedDataRoot(ctx, req)
}

func (s maintenanceLocalService) ReplaceProductControlDataRoot(ctx context.Context, req *runtimev1.ReplaceProductControlDataRootRequest) (*runtimev1.ProductControlProjectionJson, error) {
	return s.productControl.ReplaceProductControlDataRoot(ctx, req)
}

func maintenanceRefusal() error {
	retryable := false
	return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_RUNTIME_STORED_DATA_UNSUPPORTED, grpcerr.ReasonOptions{
		ActionHint: "choose_new_empty_data_root",
		Retryable:  &retryable,
		Message:    "Runtime refused the stored data in the selected data root and serves maintenance only",
	})
}

func maintenanceUnaryGate(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	if info == nil {
		return nil, maintenanceRefusal()
	}
	if _, admitted := maintenanceMethods[info.FullMethod]; !admitted {
		return nil, maintenanceRefusal()
	}
	return handler(ctx, req)
}

func maintenanceStreamGate(any, grpc.ServerStream, *grpc.StreamServerInfo, grpc.StreamHandler) error {
	return maintenanceRefusal()
}

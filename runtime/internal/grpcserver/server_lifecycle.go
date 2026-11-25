package grpcserver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
)

func (s *Server) Serve() error {
	listener, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen grpc %s: %w", s.addr, err)
	}

	s.logger.Info("grpc server listening", "addr", s.addr)
	if err := s.grpcServer.Serve(listener); err != nil {
		return fmt.Errorf("serve grpc: %w", err)
	}
	return nil
}

// ServeProtected serves the dedicated native Desktop control transport. The
// listener must yield only connections wrapped after OS peer verification.
func (s *Server) ServeProtected(listener net.Listener) error {
	if s == nil || s.protectedServer == nil {
		return fmt.Errorf("protected Desktop gRPC server is unavailable")
	}
	if listener == nil {
		return fmt.Errorf("protected Desktop listener is required")
	}
	if err := s.protectedServer.Serve(listener); err != nil {
		return fmt.Errorf("serve protected Desktop gRPC: %w", err)
	}
	return nil
}

// ServeVerifiedNativeDesktop serves protected Desktop gRPC only after the
// native listener has minted an opaque OS-verified connection carrier.
func (s *Server) ServeVerifiedNativeDesktop(listener net.Listener) error {
	if listener == nil {
		return fmt.Errorf("verified native Desktop listener is required")
	}
	return s.ServeProtected(&nativeVerifiedDesktopListener{Listener: listener})
}

func (s *Server) ServeVerifiedNativeLocalApp(listener net.Listener) error {
	if s == nil || s.localAppServer == nil {
		return fmt.Errorf("protected local-app gRPC server is unavailable")
	}
	if listener == nil {
		return fmt.Errorf("verified native local-app listener is required")
	}
	if err := s.localAppServer.Serve(&nativeVerifiedLocalAppListener{Listener: listener}); err != nil {
		return fmt.Errorf("serve protected local-app gRPC: %w", err)
	}
	return nil
}

type StopResult struct {
	Shutdown ShutdownSummary
	Err      error
}

func (s *Server) BeginShutdown() {
	if s.aiSvc != nil {
		s.aiSvc.BeginRuntimeShutdown()
	}
	if s.rpcRegistry != nil {
		s.rpcRegistry.BeginShutdown()
	}
}

// Stop drains the transports and releases every owner.
func (s *Server) Stop(ctx context.Context) StopResult {
	return s.StopWithin(ctx, ctx, nil, nil)
}

// StopWithin drains transports, detached work, and the caller's daemon
// dependencies before closing the shared stores. Both contexts derive from
// the daemon's single deadline; the earlier drain limit reserves time to force
// the transports and record what actually happened.
func (s *Server) StopWithin(ctx, drainCtx context.Context, waitDependencies func() error, record func(StopResult)) StopResult {
	s.BeginShutdown()
	remoteDone := make(chan struct{})
	go func() {
		defer close(remoteDone)
		if s.remoteAccessService != nil {
			s.remoteAccessService.Close()
		}
	}()
	jobsDone := make(chan error, 1)
	go func() { jobsDone <- s.aiSvc.DrainRuntimeJobs(ctx) }()
	result := s.drain(ctx, drainCtx)

	ownersDone := make(chan error, 1)
	go func(result StopResult) {
		if s.agentSessionService != nil {
			// Quiesce AgentSession background brain turns, alarms, and recovery loops
			// before quiescing LocalAgent and Cognition owners they depend on.
			result.Err = errors.Join(result.Err, s.agentSessionService.QuiesceDataRootContext(ctx))
		}
		if result.Err == nil && s.agentService != nil {
			// The RPC gate is closed and any root handoff RPC has returned.
			// Use the Agent's owner drain before waiting on other subsystems.
			result.Err = s.agentService.QuiesceDataRootContext(ctx)
		}
		select {
		case <-remoteDone:
		case <-ctx.Done():
			result.Err = errors.Join(result.Err, fmt.Errorf("close remote access: %w", ctx.Err()))
		}
		select {
		case err := <-jobsDone:
			result.Err = errors.Join(result.Err, err)
		case <-ctx.Done():
			result.Err = errors.Join(result.Err, fmt.Errorf("drain Scenario Jobs: %w", ctx.Err()))
		}
		if waitDependencies != nil {
			result.Err = errors.Join(result.Err, waitDependencies())
		}
		result.Err = errors.Join(result.Err, ctx.Err())
		if result.Err == nil {
			result.Err = s.releaseOwners(ctx)
		}
		if record != nil {
			record(result)
		}
		result.Err = errors.Join(result.Err, ctx.Err())
		if result.Err == nil && s.persistenceBackend != nil {
			result.Err = s.persistenceBackend.Close()
		}
		ownersDone <- result.Err
	}(result)
	select {
	case result.Err = <-ownersDone:
	case <-ctx.Done():
		result.Err = errors.Join(result.Err, fmt.Errorf("Runtime owners did not finish shutdown: %w", ctx.Err()))
	}
	return result
}

func (s *Server) releaseOwners(ctx context.Context) error {
	if s.appService != nil {
		s.appService.CloseLocalAppStorage()
	}
	if s.appInstallCoordinator != nil {
		_ = s.appInstallCoordinator.Close()
	}
	if s.localService != nil {
		s.localService.StopProductControlCheckSync()
	}
	if s.agentSessionService != nil {
		_ = s.agentSessionService.Close()
	}
	if s.agentService != nil {
		s.agentService.Close()
	}
	if s.integrationService != nil {
		_ = s.integrationService.Close()
	}
	if s.appActivityService != nil {
		_ = s.appActivityService.Close()
	}
	if s.cognitionV1Owner != nil {
		_ = s.cognitionV1Owner.Close()
	}
	if s.aiSvc != nil {
		s.aiSvc.ShutdownRealtime()
	}
	if s.realmRealtimeService != nil {
		s.realmRealtimeService.Close()
	}
	if s.localService != nil {
		s.localService.Close()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	var errs []error
	if s.aiObservation != nil {
		errs = append(errs, s.aiObservation.Close())
	}
	if s.localDevelopmentStore != nil {
		errs = append(errs, s.localDevelopmentStore.Close())
	}
	if s.localAppKernel != nil {
		errs = append(errs, s.localAppKernel.Close())
	}
	return errors.Join(errs...)
}

func (s *Server) drain(ctx, drainCtx context.Context) StopResult {
	graceful := s.stopTransports((*grpc.Server).GracefulStop)
	select {
	case <-graceful:
		if s.rpcRegistry == nil || s.rpcRegistry.WaitForIdle(drainCtx) == nil {
			return s.completeTransportShutdown(false)
		}
	case <-drainCtx.Done():
	}

	result := s.completeTransportShutdown(true)
	forced := s.stopTransports((*grpc.Server).Stop)
	select {
	case <-forced:
	case <-ctx.Done():
		result.Err = fmt.Errorf("force Runtime transports to stop: %w", ctx.Err())
		return result
	}
	if s.rpcRegistry != nil {
		if err := s.rpcRegistry.WaitForIdle(ctx); err != nil {
			result.Err = fmt.Errorf("Runtime handlers remained active after force stop: %w", err)
		}
	}
	return result
}

func (s *Server) completeTransportShutdown(forced bool) StopResult {
	result := StopResult{Shutdown: ShutdownSummary{Forced: forced}}
	if s.rpcRegistry != nil {
		result.Shutdown = s.rpcRegistry.CompleteShutdown(forced)
	}
	return result
}

func (s *Server) stopTransports(stop func(*grpc.Server)) <-chan struct{} {
	var wg sync.WaitGroup
	for _, server := range []*grpc.Server{s.protectedServer, s.localAppServer, s.grpcServer} {
		if server != nil {
			wg.Go(func() { stop(server) })
		}
	}
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	return done
}

// SyncServingState maps runtime health status to grpc health checks.
func (s *Server) SyncServingState() {
	snapshot := s.state.Snapshot()
	servingStatus := healthpb.HealthCheckResponse_NOT_SERVING
	if snapshot.Status.Ready() {
		servingStatus = healthpb.HealthCheckResponse_SERVING
	}

	s.healthServer.SetServingStatus("", servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAuditService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAiService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAiRealtimeService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeLocalService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAgentService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeExternalAgentService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAuthService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeServiceControlService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAccountService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeAppService_ServiceDesc.ServiceName, servingStatus)
	s.healthServer.SetServingStatus(runtimev1.RuntimeConnectorService_ServiceDesc.ServiceName, servingStatus)
}

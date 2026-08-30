package grpcserver

import (
	"context"
	"fmt"
	"net"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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
}

func (s *Server) BeginShutdown() []activeRPCSnapshot {
	if s.rpcRegistry == nil {
		return []activeRPCSnapshot{}
	}
	return s.rpcRegistry.BeginShutdown()
}

func (s *Server) Stop(ctx context.Context) StopResult {
	defer func() {
		if s.localService != nil {
			s.localService.StopProductControlCheckSync()
		}
		if s.agentService != nil {
			s.agentService.Close()
		}
		if s.cognitionV1Owner != nil {
			_ = s.cognitionV1Owner.Close()
		}
		if s.persistenceBackend != nil {
			_ = s.persistenceBackend.Close()
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
		if s.localDevelopmentStore != nil {
			_ = s.localDevelopmentStore.Close()
		}
		if s.localAppKernel != nil {
			_ = s.localAppKernel.Close()
		}
	}()
	if s.rpcRegistry != nil {
		s.rpcRegistry.BeginShutdown()
	}
	done := make(chan struct{})
	go func() {
		if s.protectedServer != nil {
			s.protectedServer.GracefulStop()
		}
		if s.localAppServer != nil {
			s.localAppServer.GracefulStop()
		}
		s.grpcServer.GracefulStop()
		close(done)
	}()

	select {
	case <-done:
		if s.rpcRegistry == nil {
			return StopResult{}
		}
		return StopResult{Shutdown: s.rpcRegistry.CompleteShutdown(false)}
	case <-ctx.Done():
		if s.protectedServer != nil {
			s.protectedServer.Stop()
		}
		if s.localAppServer != nil {
			s.localAppServer.Stop()
		}
		s.grpcServer.Stop()
		if s.rpcRegistry == nil {
			return StopResult{}
		}
		return StopResult{Shutdown: s.rpcRegistry.CompleteShutdown(true)}
	}
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

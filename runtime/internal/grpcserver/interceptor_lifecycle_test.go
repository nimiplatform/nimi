package grpcserver

import (
	"context"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/health"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestUnaryLifecycleInterceptorAllowsLocalReadWhenStopping(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusStopping, "draining")
	interceptor := newUnaryLifecycleInterceptor(state)

	handlerCalled := false
	_, err := interceptor(
		context.Background(),
		struct{}{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeLocalService/ListLocalModels"},
		func(_ context.Context, _ any) (any, error) {
			handlerCalled = true
			return struct{}{}, nil
		},
	)
	if err != nil {
		t.Fatalf("read method should be allowed while stopping: %v", err)
	}
	if !handlerCalled {
		t.Fatalf("handler must be called for read method")
	}
}

func TestUnaryLifecycleInterceptorAllowsLocalArtifactReadsWhenStopping(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusStopping, "draining")
	interceptor := newUnaryLifecycleInterceptor(state)

	for _, fullMethod := range []string{
		"/nimi.runtime.v1.RuntimeLocalService/ListLocalArtifacts",
		"/nimi.runtime.v1.RuntimeLocalService/ListVerifiedArtifacts",
		"/nimi.runtime.v1.RuntimeLocalService/ResolveProfile",
	} {
		handlerCalled := false
		_, err := interceptor(
			context.Background(),
			struct{}{},
			&grpc.UnaryServerInfo{FullMethod: fullMethod},
			func(_ context.Context, _ any) (any, error) {
				handlerCalled = true
				return struct{}{}, nil
			},
		)
		if err != nil {
			t.Fatalf("%s should be allowed while stopping: %v", fullMethod, err)
		}
		if !handlerCalled {
			t.Fatalf("handler must be called for %s", fullMethod)
		}
	}
}

func TestUnaryLifecycleInterceptorRejectsLocalWriteWhenStopping(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusStopping, "draining")
	interceptor := newUnaryLifecycleInterceptor(state)

	handlerCalled := false
	_, err := interceptor(
		context.Background(),
		struct{}{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeLocalService/InstallLocalModel"},
		func(_ context.Context, _ any) (any, error) {
			handlerCalled = true
			return struct{}{}, nil
		},
	)
	if err == nil {
		t.Fatalf("write method must be rejected while stopping")
	}
	if handlerCalled {
		t.Fatalf("handler must not be called for rejected write method")
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("status code mismatch: got=%s want=%s", status.Code(err), codes.Unavailable)
	}
}

func TestUnaryLifecycleInterceptorAllowsScenarioReadWhenStopping(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusStopping, "draining")
	interceptor := newUnaryLifecycleInterceptor(state)

	handlerCalled := false
	_, err := interceptor(
		context.Background(),
		struct{}{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAiService/GetScenarioJob"},
		func(_ context.Context, _ any) (any, error) {
			handlerCalled = true
			return struct{}{}, nil
		},
	)
	if err != nil {
		t.Fatalf("scenario read method should be allowed while stopping: %v", err)
	}
	if !handlerCalled {
		t.Fatalf("handler must be called for scenario read method")
	}
}

func TestStreamLifecycleInterceptorAllowsRealtimeEventReadsWhenStopping(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusStopping, "draining")
	interceptor := newStreamLifecycleInterceptor(state)

	handlerCalled := false
	err := interceptor(
		struct{}{},
		&recordingServerStream{ctx: context.Background()},
		&grpc.StreamServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAiRealtimeService/ReadRealtimeEvents"},
		func(_ any, _ grpc.ServerStream) error {
			handlerCalled = true
			return nil
		},
	)
	if err != nil {
		t.Fatalf("realtime read method should be allowed while stopping: %v", err)
	}
	if !handlerCalled {
		t.Fatalf("handler must be called for realtime read method")
	}
}

func TestUnaryLifecycleInterceptorRejectsScenarioWriteWhenStopping(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusStopping, "draining")
	interceptor := newUnaryLifecycleInterceptor(state)

	handlerCalled := false
	_, err := interceptor(
		context.Background(),
		struct{}{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeAiService/SubmitScenarioJob"},
		func(_ context.Context, _ any) (any, error) {
			handlerCalled = true
			return struct{}{}, nil
		},
	)
	if err == nil {
		t.Fatalf("scenario write method must be rejected while stopping")
	}
	if handlerCalled {
		t.Fatalf("handler must not be called for rejected scenario write method")
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("status code mismatch: got=%s want=%s", status.Code(err), codes.Unavailable)
	}
}

func TestUnaryLifecycleInterceptorAllowsConnectorAndEngineReadsWhenStopping(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusStopping, "draining")
	interceptor := newUnaryLifecycleInterceptor(state)

	for _, fullMethod := range []string{
		"/nimi.runtime.v1.RuntimeConnectorService/ListConnectors",
		"/nimi.runtime.v1.RuntimeConnectorService/GetConnector",
		"/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels",
		"/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog",
		"/nimi.runtime.v1.RuntimeConnectorService/ListModelCatalogProviders",
		"/nimi.runtime.v1.RuntimeConnectorService/ListCatalogProviderModels",
		"/nimi.runtime.v1.RuntimeConnectorService/GetCatalogModelDetail",
		"/nimi.runtime.v1.RuntimeWorkflowService/GetWorkflow",
		"/nimi.runtime.v1.RuntimeWorkflowService/SubscribeWorkflowEvents",
		"/nimi.runtime.v1.RuntimeKnowledgeService/SearchIndex",
		"/nimi.runtime.v1.RuntimeAppService/SubscribeAppMessages",
		"/nimi.runtime.v1.RuntimeLocalService/ListEngines",
		"/nimi.runtime.v1.RuntimeLocalService/GetEngineStatus",
	} {
		handlerCalled := false
		_, err := interceptor(
			context.Background(),
			struct{}{},
			&grpc.UnaryServerInfo{FullMethod: fullMethod},
			func(_ context.Context, _ any) (any, error) {
				handlerCalled = true
				return struct{}{}, nil
			},
		)
		if err != nil {
			t.Fatalf("%s should be allowed while stopping: %v", fullMethod, err)
		}
		if !handlerCalled {
			t.Fatalf("handler must be called for %s", fullMethod)
		}
	}
}

func TestUnaryLifecycleInterceptorRejectsConnectorWriteWhenStopping(t *testing.T) {
	state := health.NewState()
	state.SetStatus(health.StatusStopping, "draining")
	interceptor := newUnaryLifecycleInterceptor(state)

	handlerCalled := false
	_, err := interceptor(
		context.Background(),
		struct{}{},
		&grpc.UnaryServerInfo{FullMethod: "/nimi.runtime.v1.RuntimeConnectorService/CreateConnector"},
		func(_ context.Context, _ any) (any, error) {
			handlerCalled = true
			return struct{}{}, nil
		},
	)
	if err == nil {
		t.Fatalf("connector write method must be rejected while stopping")
	}
	if handlerCalled {
		t.Fatalf("handler must not be called for rejected connector write method")
	}
	if status.Code(err) != codes.Unavailable {
		t.Fatalf("status code mismatch: got=%s want=%s", status.Code(err), codes.Unavailable)
	}
}

package integration

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
)

// A closed Runtime-owned registry, not a plugin loader or workflow engine.
type integrationAdapter struct {
	operations []*runtimev1.IntegrationOperation
	configure  func(context.Context, string, string, *runtimev1.PutIntegrationConnectionRequest, string) (target, error)
	execute    func(context.Context, target, *runtimev1.IntegrationOperation, string, string) (string, effectOutcome, error)
	receive    func(context.Context, target, string, *nativeFeed) error
}

// @nimi-authority: rule.nimi.runtime.integration.native-messaging
func (s *Service) adapterRegistry() map[string]integrationAdapter {
	result := map[string]integrationAdapter{}
	for _, id := range []string{"mcp", "telegram"} {
		result[id] = integrationAdapter{configure: s.configureInitialAdapter, execute: s.executeInitialAdapter}
	}
	for _, id := range []string{"weixin", "feishu", "qq-official", "onebot-v11"} {
		result[id] = integrationAdapter{operations: nativeOperations(id)}
	}
	result["feishu"] = integrationAdapter{operations: nativeOperations("feishu"), configure: s.configureFeishu, execute: s.executeFeishu, receive: s.receiveFeishu}
	result["weixin"] = integrationAdapter{operations: nativeOperations("weixin"), configure: s.configureWeixin, execute: s.executeWeixin, receive: s.receiveWeixin}
	result["qq-official"] = integrationAdapter{operations: nativeOperations("qq-official"), configure: s.configureQQ, execute: s.executeQQ, receive: s.receiveQQ}
	result["onebot-v11"] = integrationAdapter{operations: nativeOperations("onebot-v11"), configure: s.configureOnebot, execute: s.executeOnebot, receive: s.receiveOnebot}
	return result
}
func (s *Service) configure(ctx context.Context, account, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
	if req == nil {
		return target{}, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
	}
	adapter, ok := s.adapters[req.Adapter]
	if !ok {
		return target{}, failure(codes.InvalidArgument, "INTEGRATION_ADAPTER_UNSUPPORTED")
	}
	if err := validateConnectionConfig(req.Adapter, req.Config); err != nil {
		return target{}, err
	}
	if adapter.configure == nil {
		return target{}, failure(codes.Unavailable, "INTEGRATION_ADAPTER_NOT_READY")
	}
	return adapter.configure(ctx, account, id, req, secret)
}
func (s *Service) execute(ctx context.Context, t target, op *runtimev1.IntegrationOperation, input, secret string) (string, effectOutcome, error) {
	adapter, ok := s.adapters[t.Public.Kind]
	if !ok || adapter.execute == nil {
		return "", notDispatched, adapterError("INTEGRATION_ADAPTER_NOT_READY")
	}
	return adapter.execute(ctx, t, op, input, secret)
}

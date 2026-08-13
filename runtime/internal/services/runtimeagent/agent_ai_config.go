package runtimeagent

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	aicatalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/aiconfig"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

type sharedLocalAgentAIConfigCaller struct {
	accountNamespace string
	appID            string
}

func (s *Service) SetAIConfigStore(store aiconfig.Store) {
	if s != nil && store != nil {
		s.aiConfigStore = store
	}
}

// SetConnectorStore wires Runtime-owned current-account Connector resolution.
func (s *Service) SetConnectorStore(store *connector.ConnectorStore) {
	if s != nil {
		s.connectorStore = store
	}
}

// SetModelCatalog wires the catalog needed to resolve an AIConfig target to
// one exact current-account Connector without exposing Connector identity in
// the AIConfig contract.
func (s *Service) SetModelCatalog(modelCatalog *aicatalog.Resolver) {
	if s != nil {
		s.modelCatalog = modelCatalog
	}
}

// @nimi-authority: definition.nimi.runtime.agent-participation.ai-config-plane
// @nimi-authority: rule.nimi.runtime.agent-participation.r082
// @nimi-authority: rule.nimi.runtime.agent-participation.r169
// authorizeSharedLocalAgentAIConfig binds the singular subsystem owner to the
// authenticated account. Request context is only an exact caller assertion;
// Runtime source and individual LocalAgent selectors are forbidden.
func (s *Service) authorizeSharedLocalAgentAIConfig(
	ctx context.Context,
	requestContext *runtimev1.AgentRequestContext,
	protectedCapability string,
) (sharedLocalAgentAIConfigCaller, error) {
	if s == nil || s.isClosed() {
		return sharedLocalAgentAIConfigCaller{}, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	if requestContext == nil || !exactSharedAIConfigIdentity(requestContext.GetAppId()) ||
		strings.TrimSpace(requestContext.GetRuntimeSourceRef()) != "" ||
		strings.TrimSpace(requestContext.GetLocalAgentRef()) != "" {
		return sharedLocalAgentAIConfigCaller{}, invalidSharedLocalAgentAIConfigError()
	}

	var accountNamespace string
	if principal, protected, err := protectedAccountProductPrincipal(ctx, protectedCapability); err != nil {
		return sharedLocalAgentAIConfigCaller{}, err
	} else if protected {
		if requestContext.GetAppId() != principal.AppID {
			return sharedLocalAgentAIConfigCaller{}, unauthorizedSharedLocalAgentAIConfigError()
		}
		accountNamespace = principal.AccountID
	} else {
		identity := authn.IdentityFromContext(ctx)
		if identity == nil || !exactSharedAIConfigIdentity(identity.SubjectUserID) {
			return sharedLocalAgentAIConfigCaller{}, unauthorizedSharedLocalAgentAIConfigError()
		}
		accountNamespace = identity.SubjectUserID
	}

	if !exactSharedAIConfigIdentity(accountNamespace) ||
		requestContext.GetSubjectUserId() != accountNamespace ||
		requestContext.GetOwnerUserId() != accountNamespace {
		return sharedLocalAgentAIConfigCaller{}, unauthorizedSharedLocalAgentAIConfigError()
	}
	return sharedLocalAgentAIConfigCaller{
		accountNamespace: accountNamespace,
		appID:            requestContext.GetAppId(),
	}, nil
}

func (s *Service) readSharedLocalAgentAIConfig(
	ctx context.Context,
	accountNamespace string,
) (*runtimev1.AIConfig, bool, error) {
	if s == nil || s.aiConfigStore == nil {
		return nil, false, sharedLocalAgentAIConfigPersistenceError(fmt.Errorf("AIConfig store is unavailable"))
	}
	config, found, err := s.aiConfigStore.Get(ctx, accountNamespace, aiconfig.LocalAgentSubsystemOwner())
	if err != nil {
		return nil, false, sharedLocalAgentAIConfigPersistenceError(err)
	}
	return config, found, nil
}

func (s *Service) requireSharedLocalAgentAIConfig(
	ctx context.Context,
	accountNamespace string,
) (*runtimev1.AIConfig, error) {
	config, found, err := s.readSharedLocalAgentAIConfig(ctx, accountNamespace)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, grpcerr.WithReasonCode(codes.NotFound, runtimev1.ReasonCode_AI_CONFIG_NOT_FOUND)
	}
	return config, nil
}

func (s *Service) overwriteSharedLocalAgentAIConfig(
	ctx context.Context,
	accountNamespace string,
	capabilities []*runtimev1.AIConfigCapabilityIntent,
) (*runtimev1.AIConfig, error) {
	candidate := &runtimev1.AIConfig{
		Owner:        aiconfig.LocalAgentSubsystemOwner(),
		Capabilities: cloneAIConfigCapabilityIntents(capabilities),
	}
	canonical, err := aiconfig.Canonicalize(candidate)
	if err != nil {
		return nil, invalidSharedLocalAgentAIConfigError()
	}
	if s == nil || s.aiConfigStore == nil {
		return nil, sharedLocalAgentAIConfigPersistenceError(fmt.Errorf("AIConfig store is unavailable"))
	}
	if err := s.aiConfigStore.Overwrite(ctx, accountNamespace, canonical); err != nil {
		return nil, sharedLocalAgentAIConfigPersistenceError(err)
	}
	return canonical, nil
}

func exactSharedAIConfigIdentity(value string) bool {
	if value == "" || strings.TrimSpace(value) != value {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func invalidSharedLocalAgentAIConfigError() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONFIG_INVALID)
}

func unauthorizedSharedLocalAgentAIConfigError() error {
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_PRINCIPAL_UNAUTHORIZED)
}

func sharedLocalAgentAIConfigPersistenceError(cause error) error {
	return grpcerr.WrapWithReasonCode(
		codes.Internal,
		runtimev1.ReasonCode_AI_CONFIG_PERSISTENCE_UNAVAILABLE,
		cause,
		grpcerr.ReasonOptions{},
	)
}

func cloneAIConfig(config *runtimev1.AIConfig) *runtimev1.AIConfig {
	if config == nil {
		return nil
	}
	cloned, _ := proto.Clone(config).(*runtimev1.AIConfig)
	return cloned
}

func cloneAIConfigCapabilityIntents(values []*runtimev1.AIConfigCapabilityIntent) []*runtimev1.AIConfigCapabilityIntent {
	out := make([]*runtimev1.AIConfigCapabilityIntent, 0, len(values))
	for _, value := range values {
		if value == nil {
			out = append(out, nil)
			continue
		}
		cloned, _ := proto.Clone(value).(*runtimev1.AIConfigCapabilityIntent)
		out = append(out, cloned)
	}
	return out
}

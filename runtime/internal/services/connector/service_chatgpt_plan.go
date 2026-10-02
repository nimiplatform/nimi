package connector

import (
	"context"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
)

const (
	chatGPTPlanDefaultLabel          = "ChatGPT plan"
	chatGPTPlanRevocationTimeout     = 10 * time.Second
	chatGPTPlanRevocationUnconfirmed = "chatgpt_plan_revocation_unconfirmed"
)

// SealChatGPTPlanAuthorization validates a host-written authorization and
// returns the sealed payload with its non-secret registration projection.
// previous is the current sealed payload for explicit reauthorization.
func SealChatGPTPlanAuthorization(raw string, previous string, now time.Time) (string, *OAuthRegistration, error) {
	payload, err := normalizeChatGPTPlanAuthorization(raw, previous, now)
	if err != nil {
		return "", nil, err
	}
	credential, err := decodeChatGPTPlanCredential(payload)
	if err != nil {
		return "", nil, err
	}
	return payload, &OAuthRegistration{ClientID: credential.ClientID, AccountLabel: credential.Email}, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-connector-route
// prepareChatGPTPlanCreate admits only a Nimi-issued SIWC authorization on the
// fixed public resource; API keys, other auth profiles and endpoints fail.
func (s *Service) prepareChatGPTPlanCreate(req *runtimev1.CreateConnectorRequest, authKind runtimev1.ConnectorAuthKind, profile string, credentialJSON string) (string, *OAuthRegistration, error) {
	if authKind != runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED || profile != ChatGPTPlanAuthProfile {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	if endpoint := strings.TrimSpace(req.GetEndpoint()); endpoint != "" && endpoint != ChatGPTPlanEndpoint {
		return "", nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	return SealChatGPTPlanAuthorization(credentialJSON, "", s.store.now().UTC())
}

// prepareChatGPTPlanUpdate keeps the registration on its fixed route and turns
// a credential write into an explicit reauthorization bound to the stored
// client, account and host identity.
func (s *Service) prepareChatGPTPlanUpdate(mutations *ConnectorMutations, nextAuthKind runtimev1.ConnectorAuthKind, nextProfile string) error {
	if mutations.Endpoint != nil || nextAuthKind != runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_OAUTH_MANAGED || nextProfile != ChatGPTPlanAuthProfile {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	if mutations.SecretPayload == nil {
		return nil
	}
	raw := *mutations.SecretPayload
	mutations.SecretPayload = nil
	mutations.SealedCredential = func(existing string) (string, *OAuthRegistration, error) {
		return SealChatGPTPlanAuthorization(raw, existing, s.store.now().UTC())
	}
	return nil
}

// revokeChatGPTPlanBeforeDelete ends the renewable session for explicit
// Connector removal. Deletion proceeds either way; it reports true only when
// revocation was confirmed or the provider had already ended the session.
// The caller holds the Connector credential lock through the final deletion.
func (s *Service) revokeChatGPTPlanBeforeDelete(ctx context.Context, record ConnectorRecord) bool {
	revokeCtx, cancel := context.WithTimeout(ctx, chatGPTPlanRevocationTimeout)
	defer cancel()
	return s.store.revokeChatGPTPlanSessionLocked(revokeCtx, record.ConnectorID) != ChatGPTPlanRevocationUnconfirmed
}

// testChatGPTPlanConnector checks the renewed credential against the public
// account model list without projecting any model inventory.
func (s *Service) testChatGPTPlanConnector(ctx context.Context, record ConnectorRecord) (runtimev1.ReasonCode, string) {
	accessToken, err := s.store.OpenChatGPTPlanAccessToken(ctx, record.ConnectorID)
	if err != nil {
		return chatGPTPlanReasonOf(err), chatGPTPlanActionHintOf(err)
	}
	cloud := s.cloudProvider()
	if cloud == nil {
		return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, ""
	}
	if _, err := cloud.DiscoverChatGPTPlanModels(ctx, chatGPTPlanTarget(record, accessToken)); err != nil {
		return chatGPTPlanReasonOf(err), chatGPTPlanActionHintOf(err)
	}
	return runtimev1.ReasonCode_ACTION_EXECUTED, ""
}

func chatGPTPlanActionHintOf(err error) string {
	if metadata, ok := grpcerr.ExtractReasonMetadata(err); ok {
		return metadata["action_hint"]
	}
	return ""
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r024
// listChatGPTPlanConnectorModels serves only reviewed catalog rows and marks
// each one available when the current account lists it for display.
func (s *Service) listChatGPTPlanConnectorModels(ctx context.Context, ownerID string, record ConnectorRecord) ([]*runtimev1.ConnectorModelDescriptor, error) {
	models, err := s.listCatalogConnectorModels(ownerID, record.Provider, record)
	if err != nil {
		return nil, err
	}
	accessToken, err := s.store.OpenChatGPTPlanAccessToken(ctx, record.ConnectorID)
	if err != nil {
		return nil, err
	}
	cloud := s.cloudProvider()
	if cloud == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	inventory, err := cloud.DiscoverChatGPTPlanModels(ctx, chatGPTPlanTarget(record, accessToken))
	if err != nil {
		return nil, err
	}
	listed := make(map[string]struct{}, len(inventory))
	for _, model := range inventory {
		listed[model.ID] = struct{}{}
	}
	for _, model := range models {
		_, available := listed[model.GetProviderModelId()]
		model.Available = available
	}
	return models, nil
}

// chatGPTPlanTarget uses the Connector's fixed endpoint; the transport admits
// only the public resource, or loopback where tests explicitly allow it.
func chatGPTPlanTarget(record ConnectorRecord, accessToken string) *nimillm.RemoteTarget {
	endpoint := strings.TrimSpace(record.Endpoint)
	if endpoint == "" {
		endpoint = ChatGPTPlanEndpoint
	}
	return &nimillm.RemoteTarget{ProviderType: ChatGPTPlanProvider, Endpoint: endpoint, APIKey: accessToken}
}

func chatGPTPlanReasonOf(err error) runtimev1.ReasonCode {
	if reason, ok := grpcerr.ExtractReasonCode(err); ok {
		return reason
	}
	return runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
}

// ChatGPTPlanRevocationOutcome is what deletion may report about the provider
// session of one SIWC Connector.
type ChatGPTPlanRevocationOutcome uint8

const (
	// ChatGPTPlanRevocationUnconfirmed: no request could be sent, it failed,
	// or an earlier uncertain exchange may have left a successor session that
	// Nimi never held. Local absence of tokens never counts as sign-out.
	ChatGPTPlanRevocationUnconfirmed ChatGPTPlanRevocationOutcome = iota
	// ChatGPTPlanRevocationConfirmed: HTTP 200 for the current refresh token
	// and for every session an explicit reauthorization replaced.
	ChatGPTPlanRevocationConfirmed
	// ChatGPTPlanRevocationNotNeeded: the provider already rejected the only
	// refresh token with a documented unusable-token code.
	ChatGPTPlanRevocationNotNeeded
)

// RevokeChatGPTPlanSession attempts the exact refresh-token revocation for one
// SIWC Connector and reports only what the provider or custody confirms.
func (s *ConnectorStore) RevokeChatGPTPlanSession(ctx context.Context, connectorID string) ChatGPTPlanRevocationOutcome {
	connectorID = strings.TrimSpace(connectorID)
	unlock := s.chatGPTPlanLocks.lock(connectorID)
	defer unlock()
	return s.revokeChatGPTPlanSessionLocked(ctx, connectorID)
}

func (s *ConnectorStore) revokeChatGPTPlanSessionLocked(ctx context.Context, connectorID string) ChatGPTPlanRevocationOutcome {
	s.mu.Lock()
	payload, err := s.readStoredSecretPayloadLocked(connectorID)
	s.mu.Unlock()
	if err != nil || strings.TrimSpace(payload) == "" {
		return ChatGPTPlanRevocationUnconfirmed
	}
	credential, err := decodeChatGPTPlanCredential(payload)
	if err != nil {
		return ChatGPTPlanRevocationUnconfirmed
	}
	switch credential.State {
	case chatGPTPlanStateActive:
		current := s.revokeChatGPTPlanToken(ctx, credential.ClientID, credential.RefreshToken)
		if s.revokePriorChatGPTPlanSessions(ctx, credential) && current {
			return ChatGPTPlanRevocationConfirmed
		}
		return ChatGPTPlanRevocationUnconfirmed
	case chatGPTPlanStateRefreshPending:
		// An interrupted renewal may already have rotated this token, so a
		// successful revocation still cannot confirm the successor ended.
		s.revokeChatGPTPlanToken(ctx, credential.ClientID, credential.RefreshToken)
		s.revokePriorChatGPTPlanSessions(ctx, credential)
		return ChatGPTPlanRevocationUnconfirmed
	}
	if credential.RemoteSession == chatGPTPlanRemoteSessionEnded {
		if !s.revokePriorChatGPTPlanSessions(ctx, credential) {
			return ChatGPTPlanRevocationUnconfirmed
		}
		if len(credential.PriorSessions) > 0 {
			return ChatGPTPlanRevocationConfirmed
		}
		return ChatGPTPlanRevocationNotNeeded
	}
	if credential.RevocationToken != "" {
		s.revokeChatGPTPlanToken(ctx, credential.ClientID, credential.RevocationToken)
	}
	s.revokePriorChatGPTPlanSessions(ctx, credential)
	return ChatGPTPlanRevocationUnconfirmed
}

// revokePriorChatGPTPlanSessions revokes each session an explicit
// reauthorization replaced and reports whether all of them are known ended.
func (s *ConnectorStore) revokePriorChatGPTPlanSessions(ctx context.Context, credential chatGPTPlanCredential) bool {
	ended := !credential.PriorSessionUnconfirmed
	for _, token := range credential.PriorSessions {
		if !s.revokeChatGPTPlanToken(ctx, credential.ClientID, token) {
			ended = false
		}
	}
	return ended
}

func (s *ConnectorStore) revokeChatGPTPlanToken(ctx context.Context, clientID string, token string) bool {
	if s.chatGPTPlanRenewer == nil || !chatGPTPlanTokenValue(token) {
		return false
	}
	return s.chatGPTPlanRenewer.Revoke(ctx, clientID, token) == nil
}

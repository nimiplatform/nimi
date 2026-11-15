package runtimeagent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type realmCharacterDiscoveryReader interface {
	ListRealmCharacterSources(context.Context, string, string, string, uint32) (accountservice.RealmCharacterDiscoveryPage, error)
}

func (s *Service) SetRealmCharacterDiscoveryReader(reader realmCharacterDiscoveryReader) {
	s.realmCharacterDiscovery = reader
}

// @nimi-authority: rule.nimi.runtime.agent-service.character-discovery
func (s *Service) ListLocalAppCharacterSources(ctx context.Context, req *runtimev1.ListLocalAppCharacterSourcesRequest) (*runtimev1.ListLocalAppCharacterSourcesResponse, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, localappop.OperationCharacterSourceList)
	if !ok {
		return nil, localAppAgentAccessDenied()
	}
	if req == nil || hasRealmSourceMaterializationUnknownProtoV3(req) || len(req.Query) > 256 || len(req.Cursor) > 4096 || !utf8.ValidString(req.Query) || !utf8.ValidString(req.Cursor) || req.PageSize > 50 {
		return nil, status.Error(codes.InvalidArgument, "Invalid character catalog query")
	}
	if s.realmCharacterDiscovery == nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	size := req.PageSize
	if size == 0 {
		size = 20
	}
	page, err := s.realmCharacterDiscovery.ListRealmCharacterSources(ctx, decision.AccountID, req.Query, req.Cursor, size)
	if err != nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	if _, err := s.revalidateCharacterDiscovery(ctx, localappop.IngressCharacterSourceList, decision); err != nil {
		return nil, err
	}
	result := &runtimev1.ListLocalAppCharacterSourcesResponse{NextCursor: page.NextCursor}
	for _, item := range page.Items {
		ref := characterDiscoverySourceRef(item.SourceRef)
		partner, err := s.characterPartner(decision, ref)
		if err != nil && status.Code(err) != codes.FailedPrecondition {
			return nil, err
		}
		result.Items = append(result.Items, &runtimev1.LocalAppCharacterSource{SourceRef: ref, DisplayName: item.DisplayName, Summary: item.Summary, WorldName: item.WorldName, AvatarUrl: item.AvatarURL, Disposition: item.Disposition, Traits: item.Traits, Topics: item.Topics, Connectable: item.Connectable && err == nil, ExistingPartner: partner})
	}
	return result, nil
}

// @nimi-authority: rule.nimi.runtime.agent-service.character-discovery
func (s *Service) ConnectLocalAppCharacterSource(ctx context.Context, req *runtimev1.ConnectLocalAppCharacterSourceRequest) (*runtimev1.ConnectLocalAppCharacterSourceResponse, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, localappop.OperationCharacterSourceConnect)
	if !ok {
		return nil, localAppAgentAccessDenied()
	}
	if req == nil || hasRealmSourceMaterializationUnknownProtoV3(req) || req.RequestId == "" || strings.TrimSpace(req.RequestId) != req.RequestId || len(req.RequestId) > 128 || !utf8.ValidString(req.RequestId) || strings.ContainsFunc(req.RequestId, unicode.IsControl) {
		return nil, status.Error(codes.InvalidArgument, "Invalid character acquisition request")
	}
	ref, err := sourceMaterializationRefFromProtoV3(req.SourceRef)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "Invalid character source")
	}
	partner, err := s.characterPartner(decision, req.SourceRef)
	if err != nil {
		return nil, err
	}
	created := false
	if partner == nil {
		// Request identity remains isolated by the registered App subject. This
		// reuses the materialization ledger, not a second acquisition store.
		digest := sha256.Sum256([]byte(decision.RegisteredAppSubject + "\x00" + req.RequestId))
		result, err := s.materializeRealmSource(ctx, realmSourceMaterializationRequestV3{AccountID: decision.AccountID, RequestID: "app-acquire-" + hex.EncodeToString(digest[:]), SourceRef: ref}, func(ctx context.Context, lease RealmSourceMaterializationAccountLease, commit func(context.Context) error) error {
			if lease.AccountID != decision.AccountID || lease.Generation != decision.AccountGeneration {
				return localAppAgentAccessDenied()
			}
			return s.commitLocalAppOwnerMutation(ctx, localappop.IngressCharacterSourceConnect, decision, commit)
		})
		if err != nil {
			return nil, err
		}
		// A concurrent Home or App acquisition may have won the canonical
		// stable-Character uniqueness check. Read its result; never replay work.
		partner, err = s.characterPartner(decision, req.SourceRef)
		if err != nil {
			return nil, err
		}
		if partner == nil {
			return nil, status.Error(codes.FailedPrecondition, "Character could not become a partner. Refresh the source and try again.")
		}
		created = result.GetReasonCode() == runtimev1.RealmSourceMaterializationReasonCode_REALM_SOURCE_MATERIALIZATION_REASON_CODE_NONE && !result.GetIdempotentReplay()
	}
	if _, err := s.revalidateCharacterDiscovery(ctx, localappop.IngressCharacterSourceConnect, decision); err != nil {
		return nil, err
	}
	return &runtimev1.ConnectLocalAppCharacterSourceResponse{Partner: partner, Created: created}, nil
}

func (s *Service) revalidateCharacterDiscovery(ctx context.Context, ingress localappop.Ingress, initial accountservice.LocalAppCallerDecision) (context.Context, error) {
	if s.localAppIngressRevalidator == nil {
		return nil, localAppConversationOwnerUnavailable()
	}
	current, err := s.localAppIngressRevalidator.AuthorizeLocalAppIngress(ctx, ingress)
	if err != nil {
		return nil, err
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(current)
	if !ok || decision.SessionID != initial.SessionID || decision.AccountID != initial.AccountID || decision.RegisteredAppSubject != initial.RegisteredAppSubject || decision.AccountGeneration != initial.AccountGeneration {
		return nil, localAppAgentAccessDenied()
	}
	return current, nil
}

func (s *Service) characterPartner(decision accountservice.LocalAppCallerDecision, ref *runtimev1.CharacterSourceRefV3) (*runtimev1.LocalAppAgentReference, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.accountTerminationFencedLocked(decision.AccountID) {
		return nil, localAppAgentAccessDenied()
	}
	for _, entry := range s.agents {
		if entry == nil || entry.Agent == nil {
			continue
		}
		agent := entry.Agent
		if agent.GetOwnerUserId() != decision.AccountID || agent.GetLifecycleStatus() == runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_TERMINATED || !sameMaterializedCharacter(agent.GetSourceContextStatus().GetSourceRef(), ref) {
			continue
		}
		if agent.GetLifecycleStatus() != runtimev1.AgentLifecycleStatus_AGENT_LIFECYCLE_STATUS_ACTIVE {
			return nil, status.Error(codes.FailedPrecondition, "This partner is not currently available. Manage it in Nimi Home.")
		}
		refs, ok := projectLocalAppAgentReferencesForOperation(decision, []accountservice.LocalAgentOwnerProjection{{LocalAgentID: agent.GetLocalAgentRef(), DisplayName: agent.GetDisplayName()}}, decision.Operation)
		if !ok {
			return nil, localAppConversationOwnerUnavailable()
		}
		return refs[0], nil
	}
	return nil, nil
}

func characterDiscoverySourceRef(ref accountservice.RealmSourceMaterializationSourceRefV3) *runtimev1.CharacterSourceRefV3 {
	value := sourceMaterializationCharacterSourceRefV3{Kind: ref.Kind, ID: ref.ID, WorldID: ref.WorldID, OwnerAccountID: ref.OwnerAccountID, SourceHash: ref.SourceHash}
	if ref.WorldEntityRef != nil {
		value.WorldEntityRef = &sourceMaterializationWorldEntityRefV3{Kind: "worldEntity", WorldID: ref.WorldEntityRef.WorldID, EntityID: ref.WorldEntityRef.EntityID}
	}
	return sourceMaterializationProtoRefV3(value)
}

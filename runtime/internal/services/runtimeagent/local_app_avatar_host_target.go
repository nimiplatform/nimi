package runtimeagent

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

const avatarHostTargetRefPrefix = "avatar_target_"

// @nimi-authority: rule.nimi.runtime.agent-participation.r194
// @nimi-authority: rule.nimi.runtime.agent-participation.r195
// ResolveLocalAppAvatarHostTarget resolves one current formal-App selector to
// a generation-bounded Host-private correlation reference. The protected
// transport attaches the exact current session decision before this handler;
// no public App operation or product client projects the result.
func (s *Service) ResolveLocalAppAvatarHostTarget(
	ctx context.Context,
	req *runtimev1.ResolveLocalAppAvatarHostTargetRequest,
) (*runtimev1.ResolveLocalAppAvatarHostTargetResponse, error) {
	if req == nil || strings.TrimSpace(req.GetAgentHandle()) != req.GetAgentHandle() {
		return nil, localAppAgentAccessDenied()
	}
	resolved, _, err := s.resolveLocalAppAgent(
		ctx,
		accountservice.LocalAppOperationReferenceList,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}
	if req.ConversationAnchorId != nil {
		anchorID := req.GetConversationAnchorId()
		if strings.TrimSpace(anchorID) != anchorID {
			return nil, localAppAgentAccessDenied()
		}
		if err := s.validateLocalAppConversationResource(resolved, anchorID); err != nil {
			return nil, err
		}
	}
	targetRef := mintAvatarHostTargetRef(resolved.decision, resolved.identity.LocalAgentRef)
	if targetRef == "" {
		return nil, localAppAgentAccessDenied()
	}
	return &runtimev1.ResolveLocalAppAvatarHostTargetResponse{AvatarHostTargetRef: targetRef}, nil
}

// @nimi-authority: rule.nimi.runtime.agent-participation.r196
// RevalidateLocalAppAvatarHostTarget accepts only the Desktop built-in formal
// Host decision attached by the protected account-product transport. It
// recomputes current refs from active owner inventory and returns no identity.
func (s *Service) RevalidateLocalAppAvatarHostTarget(
	ctx context.Context,
	req *runtimev1.RevalidateLocalAppAvatarHostTargetRequest,
) (*runtimev1.RevalidateLocalAppAvatarHostTargetResponse, error) {
	if req == nil || !validAvatarHostTargetRef(req.GetAvatarHostTargetRef()) {
		return nil, localAppAgentAccessDenied()
	}
	decision, ok := authorizedLocalAppAgentDecision(ctx, accountservice.LocalAppOperationReferenceList)
	classification, classificationErr := localappop.ClassifyOperation(accountservice.LocalAppOperationReferenceList)
	if !ok || classificationErr != nil || decision.OperationCapability != string(classification.Domain) ||
		decision.AppID != "nimi.desktop" ||
		decision.TrustClass != accountservice.LocalAppTrustClassBuiltIn {
		return nil, localAppAgentAccessDenied()
	}
	inventory, err := s.ListOwnedActiveLocalAgents(ctx, decision.AccountID)
	if err != nil {
		return nil, localAppAgentAccessDenied()
	}
	matches := 0
	for _, item := range inventory {
		localAgentID := strings.TrimSpace(item.LocalAgentID)
		if localAgentID == "" || localAgentID != item.LocalAgentID {
			return nil, localAppAgentAccessDenied()
		}
		expected := mintAvatarHostTargetRef(decision, localAgentID)
		if len(expected) == len(req.GetAvatarHostTargetRef()) &&
			subtle.ConstantTimeCompare([]byte(expected), []byte(req.GetAvatarHostTargetRef())) == 1 {
			matches++
		}
	}
	if matches != 1 {
		return nil, localAppAgentAccessDenied()
	}
	return &runtimev1.RevalidateLocalAppAvatarHostTargetResponse{
		AvatarHostTargetRef: req.GetAvatarHostTargetRef(),
	}, nil
}

func validAvatarHostTargetRef(value string) bool {
	if !strings.HasPrefix(value, avatarHostTargetRefPrefix) ||
		len(value) != len(avatarHostTargetRefPrefix)+43 || strings.TrimSpace(value) != value {
		return false
	}
	for _, char := range value[len(avatarHostTargetRefPrefix):] {
		if !(char >= 'A' && char <= 'Z') && !(char >= 'a' && char <= 'z') &&
			!(char >= '0' && char <= '9') && char != '-' && char != '_' {
			return false
		}
	}
	return true
}

func mintAvatarHostTargetRef(decision accountservice.LocalAppCallerDecision, localAgentID string) string {
	accountID := strings.TrimSpace(decision.AccountID)
	localAgentID = strings.TrimSpace(localAgentID)
	if !hasLocalAppSessionID(decision.RuntimeBootEpoch[:]) || decision.AccountGeneration == 0 ||
		accountID == "" || localAgentID == "" {
		return ""
	}
	mac := hmac.New(sha256.New, decision.RuntimeBootEpoch[:])
	_, _ = mac.Write([]byte("nimi.runtime.avatar-host-target/v1\x00"))
	_, _ = mac.Write([]byte(accountID))
	_, _ = mac.Write([]byte{0})
	var generation [8]byte
	binary.BigEndian.PutUint64(generation[:], decision.AccountGeneration)
	_, _ = mac.Write(generation[:])
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(localAgentID))
	return avatarHostTargetRefPrefix + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

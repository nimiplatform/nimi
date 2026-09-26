package runtimeagent

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protocol/envelope"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/nimiplatform/nimi/runtime/internal/services/appactivity"
	"golang.org/x/net/idna"
	"google.golang.org/grpc/codes"
)

const localAppAgentHandlePrefix = "agent_ref_"

// @nimi-authority: rule.nimi.runtime.agent-participation.r197
func (s *Service) ResolveDesktopAgentReference(ctx context.Context, req *runtimev1.ResolveDesktopAgentReferenceRequest) (*runtimev1.ResolveDesktopAgentReferenceResponse, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, accountservice.LocalAppOperationReferenceList)
	if !ok || decision.AppID != envelope.ProtectedDesktopAppID || decision.TrustClass != accountservice.LocalAppTrustClassBuiltIn ||
		req == nil || req.GetLocalAgentRef() == "" || strings.TrimSpace(req.GetLocalAgentRef()) != req.GetLocalAgentRef() {
		return nil, localAppAgentAccessDenied()
	}
	inventory, err := s.ListOwnedActiveLocalAgents(ctx, decision.AccountID)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
	for _, item := range inventory {
		if item.LocalAgentID != req.GetLocalAgentRef() {
			continue
		}
		references, valid := projectLocalAppAgentReferences(decision, []accountservice.LocalAgentOwnerProjection{item})
		if !valid {
			return nil, localAppAgentAccessDenied()
		}
		return &runtimev1.ResolveDesktopAgentReferenceResponse{Reference: references[0]}, nil
	}
	return nil, localAppAgentAccessDenied()
}

// @nimi-authority: definition.nimi.runtime.agent-participation.app-consume-plane
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-009a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-agid-009b
// ListLocalAppAgentReferences projects every active LocalAgent owned by the
// current account. Raw Runtime identity remains inside this owner adapter; the
// returned handle is derived from the private technical session and is useful
// only as a selector under that exact current session.
func (s *Service) ListLocalAppAgentReferences(
	ctx context.Context,
	_ *runtimev1.ListLocalAppAgentReferencesRequest,
) (*runtimev1.ListLocalAppAgentReferencesResponse, error) {
	decision, ok := authorizedLocalAppAgentDecision(ctx, accountservice.LocalAppOperationReferenceList)
	if !ok {
		return nil, localAppAgentAccessDenied()
	}
	inventory, err := s.ListOwnedActiveLocalAgents(ctx, decision.AccountID)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
	references, ok := projectLocalAppAgentReferences(decision, inventory)
	if !ok {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE)
	}
	return &runtimev1.ListLocalAppAgentReferencesResponse{References: references}, nil
}

func authorizedLocalAppAgentDecision(
	ctx context.Context,
	operation accountservice.LocalAppOperation,
) (accountservice.LocalAppCallerDecision, bool) {
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(ctx)
	return decision, ok && decision.Operation == operation &&
		decision.AuthorityClass == localappop.AuthorityClassAppAccess &&
		hasLocalAppSessionID(decision.SessionID[:]) &&
		strings.TrimSpace(decision.AccountID) != "" &&
		strings.TrimSpace(decision.AppID) != "" &&
		strings.TrimSpace(decision.RegisteredAppSubject) != ""
}

func projectLocalAppAgentReferences(
	decision accountservice.LocalAppCallerDecision,
	inventory []accountservice.LocalAgentOwnerProjection,
) ([]*runtimev1.LocalAppAgentReference, bool) {
	return projectLocalAppAgentReferencesForOperation(decision, inventory, accountservice.LocalAppOperationReferenceList)
}

func projectLocalAppAgentReferencesForOperation(decision accountservice.LocalAppCallerDecision, inventory []accountservice.LocalAgentOwnerProjection, operation accountservice.LocalAppOperation) ([]*runtimev1.LocalAppAgentReference, bool) {
	if operation != accountservice.LocalAppOperationReferenceList && operation != localappop.OperationAgentWorkReferenceList {
		return nil, false
	}
	classification, err := localappop.ClassifyOperation(operation)
	if err != nil || decision.OperationCapability != string(classification.Domain) {
		return nil, false
	}
	if _, ok := authorizedLocalAppAgentDecision(
		accountservice.ContextWithAuthorizedLocalAppDecision(context.Background(), decision), operation,
	); !ok {
		return nil, false
	}
	seenIDs := make(map[string]struct{}, len(inventory))
	seenHandles := make(map[string]struct{}, len(inventory))
	references := make([]*runtimev1.LocalAppAgentReference, 0, len(inventory))
	for _, item := range inventory {
		localAgentID := strings.TrimSpace(item.LocalAgentID)
		displayName := strings.TrimSpace(item.DisplayName)
		if localAgentID == "" || localAgentID != item.LocalAgentID ||
			!safeLocalAppAgentDisplayName(displayName) || displayName != item.DisplayName {
			return nil, false
		}
		if _, duplicate := seenIDs[localAgentID]; duplicate {
			return nil, false
		}
		seenIDs[localAgentID] = struct{}{}
		handle := mintLocalAppAgentHandle(decision, localAgentID)
		if handle == "" {
			return nil, false
		}
		if _, duplicate := seenHandles[handle]; duplicate {
			return nil, false
		}
		seenHandles[handle] = struct{}{}
		reference := &runtimev1.LocalAppAgentReference{
			AgentHandle:      handle,
			AgentBinding:     mintLocalAppAgentBinding(decision, localAgentID),
			ActivityAgentRef: appactivity.AgentAssociationRef(decision.AccountID, localAgentID),
			DisplayName:      displayName,
		}
		if item.AvatarURL != nil && safeLocalAppAgentAvatarURL(*item.AvatarURL) {
			avatarURL := *item.AvatarURL
			reference.AvatarUrl = &avatarURL
		}
		references = append(references, reference)
	}
	return references, true
}

// Stable correlation never grants access and never replaces the current handle.
func mintLocalAppAgentBinding(decision accountservice.LocalAppCallerDecision, localAgentID string) string {
	mac := hmac.New(sha256.New, []byte(localAgentID))
	_, _ = mac.Write([]byte("nimi.runtime.app-agent-binding/v1\x00" + decision.AccountID + "\x00" + decision.RegisteredAppSubject))
	return "agent_binding_" + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func mintLocalAppAgentHandle(decision accountservice.LocalAppCallerDecision, localAgentID string) string {
	localAgentID = strings.TrimSpace(localAgentID)
	if !hasLocalAppSessionID(decision.SessionID[:]) || localAgentID == "" {
		return ""
	}
	mac := hmac.New(sha256.New, decision.SessionID[:])
	_, _ = mac.Write([]byte("nimi.runtime.local-app-agent-reference/v1\x00"))
	_, _ = mac.Write([]byte(strings.TrimSpace(decision.RegisteredAppSubject)))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(strings.TrimSpace(decision.AccountID)))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(localAgentID))
	return localAppAgentHandlePrefix + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func hasLocalAppSessionID(value []byte) bool {
	for _, item := range value {
		if item != 0 {
			return true
		}
	}
	return false
}

func safeLocalAppAgentDisplayName(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && utf8.ValidString(value) &&
		len([]byte(value)) <= 256 && !strings.ContainsAny(value, "\x00\r\n")
}

func safeLocalAppAgentAvatarURL(value string) bool {
	if value == "" || value != strings.TrimSpace(value) || len(value) > 2048 ||
		strings.ContainsFunc(value, unicode.IsControl) {
		return false
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Opaque != "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		parsed.Hostname() == "" || (parsed.Port() != "" && parsed.Port() != "443") {
		return false
	}
	// Media is interpreted by browsers. Normalize IDNA separators and names
	// before checking locality, and reject browser IPv4 number spellings too.
	asciiHost, err := idna.Lookup.ToASCII(parsed.Hostname())
	if err != nil || strings.ContainsAny(parsed.Host, "[]") {
		return false
	}
	host := strings.ToLower(strings.TrimRight(asciiHost, "."))
	if host == "localhost" || strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return false
	}
	lastLabel := host[strings.LastIndex(host, ".")+1:]
	numericHost := lastLabel != "" && strings.IndexFunc(lastLabel, func(r rune) bool { return r < '0' || r > '9' }) < 0
	if strings.HasPrefix(lastLabel, "0x") {
		numericHost = strings.IndexFunc(lastLabel[2:], func(r rune) bool { return !(r >= '0' && r <= '9' || r >= 'a' && r <= 'f') }) < 0
	}
	if host == "" || numericHost || net.ParseIP(host) != nil {
		return false
	}
	return parsed.Path == "" || strings.HasPrefix(parsed.Path, "/")
}

func localAppAgentAccessDenied() error {
	return grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_LOCAL_APP_ACCESS_DENIED)
}

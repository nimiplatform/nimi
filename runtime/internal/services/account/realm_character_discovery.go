package account

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
	"github.com/nimiplatform/nimi/runtime/internal/realmmedia"
)

type RealmCharacterDiscoveryItem struct {
	SourceRef                                    RealmSourceMaterializationSourceRefV3
	DisplayName, Summary, WorldName, Disposition string
	Traits, Topics                               []string
	AvatarURL                                    *string
	Connectable                                  bool
}

type RealmCharacterDiscoveryPage struct {
	Items      []RealmCharacterDiscoveryItem
	NextCursor string
}

// @nimi-authority: rule.nimi.runtime.agent-service.character-discovery
// The public catalog is read under current account custody; callers cannot
// choose an endpoint or obtain Realm credentials or private source packets.
func (s *Service) ListRealmCharacterSources(ctx context.Context, accountID, query, cursor string, pageSize uint32) (RealmCharacterDiscoveryPage, error) {
	params := map[string]any{"limit": float64(pageSize)}
	if query != "" {
		params["q"] = query
	}
	if cursor != "" {
		params["cursor"] = cursor
	}
	raw, err := s.readRealmCharacterDiscovery(ctx, accountID, realmUnaryRequestJSON{Query: params})
	if err != nil {
		return RealmCharacterDiscoveryPage{}, err
	}
	return decodeRealmCharacterDiscovery(raw, int(pageSize))
}

func (s *Service) readRealmCharacterDiscovery(ctx context.Context, accountID string, request realmUnaryRequestJSON) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, realmUnaryDefaultTimeout)
	defer cancel()
	credential, err := s.captureRealmSourceMaterializationCredential(ctx, accountID)
	if err != nil {
		return "", err
	}
	operation, ok := realmBrokerOperations["WorldPublicController_listCharacterCatalog"]
	if !ok {
		return "", fmt.Errorf("public character catalog unavailable")
	}
	if err := validateRealmUnaryRequestShape(operation, request); err != nil {
		return "", err
	}
	target, err := buildRealmUnaryURL(credential.baseURL, operation, request)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: realmUnaryDefaultTimeout}
	if s.realmHTTP != nil {
		copy := *s.realmHTTP
		client = &copy
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	result := s.doRealmUnaryHTTP(ctx, client, target, operation, request, credential.bearer)
	if result.err != nil {
		return "", result.err
	}
	if result.failure != nil {
		return "", fmt.Errorf("public character catalog rejected")
	}
	if err := s.RevalidateRealmSourceMaterializationAccount(ctx, credential.lease); err != nil {
		return "", err
	}
	response := projectRealmUnaryHTTPResult(result)
	if !response.GetAccepted() {
		return "", fmt.Errorf("public character catalog unavailable")
	}
	return response.GetResponseJson(), nil
}

func decodeRealmCharacterDiscovery(raw string, pageSize int) (RealmCharacterDiscoveryPage, error) {
	invalid := func() (RealmCharacterDiscoveryPage, error) {
		return RealmCharacterDiscoveryPage{}, fmt.Errorf("public character catalog contract invalid")
	}
	if len(raw) > 2*1024*1024 || jsonstrict.RejectDuplicateKeys([]byte(raw)) != nil {
		return invalid()
	}
	var page struct {
		Items []struct {
			SourceRef      json.RawMessage `json:"sourceRef"`
			ID             string          `json:"id"`
			DisplayName    string          `json:"displayName"`
			Summary        string          `json:"summary"`
			WorldName      string          `json:"worldName"`
			Role           *string         `json:"role"`
			AvatarMedia    json.RawMessage `json:"avatarMedia"`
			AvatarURL      *string         `json:"avatarUrl"`
			PortraitMedia  json.RawMessage `json:"portraitMedia"`
			PortraitURL    *string         `json:"portraitUrl"`
			VoiceSampleURL *string         `json:"voiceSampleUrl"`
			Relation       struct {
				State string `json:"state"`
			} `json:"relation"`
		} `json:"items"`
		NextCursor *string `json:"nextCursor"`
		HasMore    bool    `json:"hasMore"`
	}
	if json.Unmarshal([]byte(raw), &page) != nil || page.Items == nil || len(page.Items) > pageSize || page.HasMore != (page.NextCursor != nil) {
		return invalid()
	}
	result := RealmCharacterDiscoveryPage{Items: make([]RealmCharacterDiscoveryItem, 0, len(page.Items))}
	if page.NextCursor != nil {
		if !text(*page.NextCursor, true, 4096) {
			return invalid()
		}
		result.NextCursor = *page.NextCursor
	}
	for _, item := range page.Items {
		sourceRef, err := parseRealmCharacterDiscoverySourceRef(item.SourceRef)
		if err != nil {
			return invalid()
		}
		if item.ID != sourceRef.ID ||
			!text(item.DisplayName, true, 256) || !text(item.Summary, false, 16384) || !text(item.WorldName, true, 256) ||
			!oneOfText(item.Relation.State, "connectable", "connected", "unavailable") {
			return invalid()
		}
		avatar, err := decodeRealmCharacterDiscoveryAvatar(item.AvatarMedia, item.AvatarURL)
		if err != nil {
			return invalid()
		}
		result.Items = append(result.Items, RealmCharacterDiscoveryItem{
			SourceRef:   sourceRef,
			DisplayName: item.DisplayName,
			Summary:     item.Summary,
			WorldName:   item.WorldName,
			AvatarURL:   avatar,
			Connectable: item.Relation.State == "connectable",
		})
	}
	return result, nil
}

func parseRealmCharacterDiscoverySourceRef(raw json.RawMessage) (RealmSourceMaterializationSourceRefV3, error) {
	var sourceRef RealmSourceMaterializationSourceRefV3
	if json.Unmarshal(raw, &sourceRef) != nil {
		return RealmSourceMaterializationSourceRefV3{}, fmt.Errorf("parse character discovery sourceRef: invalid JSON")
	}
	expected, err := realmSourceMaterializationSourceRefJSON(sourceRef)
	if err != nil {
		return RealmSourceMaterializationSourceRefV3{}, fmt.Errorf("parse character discovery sourceRef: %w", err)
	}
	expectedJSON, err := canonicalRealmCharacterPublicAvatarJSON(expected)
	actualJSON, actualErr := canonicalRealmCharacterPublicAvatarJSON(raw)
	if err != nil || actualErr != nil || !bytes.Equal(expectedJSON, actualJSON) {
		return RealmSourceMaterializationSourceRefV3{}, fmt.Errorf("parse character discovery sourceRef: non-canonical representation")
	}
	return sourceRef, nil
}

func decodeRealmCharacterDiscoveryAvatar(avatarMedia json.RawMessage, avatarURL *string) (*string, error) {
	delivery, err := realmmedia.Decode(bytes.TrimSpace(avatarMedia))
	if err != nil {
		return nil, fmt.Errorf("decode character discovery avatar media: %w", err)
	}
	var candidate *string
	if delivery != nil {
		candidate = realmmedia.Image(delivery, "avatar", 160)
	} else {
		candidate = avatarURL
	}
	if candidate == nil || *candidate == "" {
		return nil, nil
	}
	if !canonicalPublicAvatarURL(candidate) {
		return nil, fmt.Errorf("decode character discovery avatar: URL is not canonical HTTPS")
	}
	selected := *candidate
	return &selected, nil
}

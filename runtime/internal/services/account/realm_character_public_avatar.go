package account

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/nimiplatform/nimi/runtime/internal/realmmedia"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

const realmCharacterPublicAvatarOperationID = "WorldPublicController_getCharacterSource"

type realmCharacterPublicSourceProjection struct {
	WorldName          string   `json:"worldName"`
	Role               *string  `json:"role"`
	Tags               []string `json:"tags"`
	CharacterBiography *struct {
		LifeEvents []struct {
			Kind  string `json:"kind"`
			Title string `json:"title"`
		} `json:"lifeEvents"`
	} `json:"characterBiography"`
	SourceRef json.RawMessage                  `json:"sourceRef"`
	Media     *realmCharacterPublicSourceMedia `json:"media"`
}

type realmCharacterPublicExternalMedia struct {
	VoiceSampleURL    *string `json:"voiceSampleUrl"`
	AvatarURL         *string `json:"avatarUrl"`
	PortraitURL       *string `json:"portraitUrl"`
	ReferenceImageURL *string `json:"referenceImageUrl"`
}

type realmCharacterPublicSourceMedia struct {
	External realmCharacterPublicExternalMedia      `json:"external"`
	Assets   *realmCharacterPublicSourceMediaAssets `json:"assets"`
}

type realmCharacterPublicSourceMediaAssets struct {
	VoiceSample    *realmCharacterPublicAsset `json:"voiceSample"`
	Avatar         *realmCharacterPublicAsset `json:"avatar"`
	Portrait       *realmCharacterPublicAsset `json:"portrait"`
	ReferenceImage *realmCharacterPublicAsset `json:"referenceImage"`
}

type realmCharacterPublicAsset struct {
	MimeType    *string         `json:"mimeType"`
	DurationSec *float64        `json:"durationSec"`
	ID          string          `json:"id"`
	ExternalURL *string         `json:"externalUrl"`
	Delivery    json.RawMessage `json:"delivery"`
}

// ResolveRealmCharacterPublicAvatar is a Runtime-private fixed Realm
// projection. Callers supply an already-owned LocalAgent source binding, never
// a Realm origin, bearer, operation id, or app-selected authority.
func (s *Service) ResolveRealmCharacterPublicAvatar(ctx context.Context, accountID string, sourceRef RealmSourceMaterializationSourceRefV3) (*string, error) {
	projection, err := s.resolveRealmCharacterPublicSource(ctx, accountID, sourceRef)
	if err != nil {
		return nil, err
	}
	return projectRealmCharacterPublicAvatar(projection)
}

func (s *Service) resolveRealmCharacterPublicSource(
	ctx context.Context,
	accountID string,
	sourceRef RealmSourceMaterializationSourceRefV3,
) (*realmCharacterPublicSourceProjection, error) {
	if s == nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: account service is unavailable")
	}
	if _, err := realmSourceMaterializationSourceRefJSON(sourceRef); err != nil {
		return nil, fmt.Errorf("resolve Realm public source binding: %w", err)
	}
	operationCtx, cancel := context.WithTimeout(ctx, realmUnaryDefaultTimeout)
	defer cancel()
	credential, err := s.captureRealmSourceMaterializationCredential(operationCtx, accountID)
	if err != nil {
		return nil, err
	}
	client := s.realmHTTP
	if client == nil {
		client = &http.Client{Timeout: realmUnaryDefaultTimeout}
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if clientCopy.Timeout <= 0 || clientCopy.Timeout > realmUnaryDefaultTimeout {
		clientCopy.Timeout = realmUnaryDefaultTimeout
	}
	read := func(operationID string, request realmUnaryRequestJSON) (string, error) {
		operation, admitted := realmBrokerOperations[operationID]
		if !admitted {
			return "", fmt.Errorf("fixed Realm public source operation unavailable")
		}
		if err := validateRealmUnaryRequestShape(operation, request); err != nil {
			return "", err
		}
		if err := s.RevalidateRealmSourceMaterializationAccount(operationCtx, credential.lease); err != nil {
			return "", err
		}
		targetURL, err := buildRealmUnaryURL(credential.baseURL, operation, request)
		if err != nil {
			return "", err
		}
		result := s.doRealmUnaryHTTP(operationCtx, &clientCopy, targetURL, operation, request, credential.bearer)
		if result.err != nil {
			return "", result.err
		}
		if result.failure != nil {
			return "", fmt.Errorf("Realm public source request rejected")
		}
		if err := s.RevalidateRealmSourceMaterializationAccount(operationCtx, credential.lease); err != nil {
			return "", err
		}
		projected := projectRealmUnaryHTTPResult(result)
		if !projected.GetAccepted() {
			return "", fmt.Errorf("Realm public source unavailable (HTTP %d)", projected.GetHttpStatus())
		}
		return projected.GetResponseJson(), nil
	}
	// A LocalAgent pins its materialized content, not the publication revision.
	// Resolve current publication by the immutable identity on every read, then
	// require the exact current public card. No stale-hash retry or source rewrite.
	operationID, pathKey := "WorldCoreController_getWorldCharacter", "characterId"
	if sourceRef.Kind == "personaCharacter" {
		operationID, pathKey = "WorldCoreController_getPersonaCharacter", "personaCharacterId"
	}
	raw, err := read(operationID, realmUnaryRequestJSON{Path: map[string]any{pathKey: sourceRef.ID}})
	if err != nil {
		return nil, err
	}
	var current struct {
		ID             string `json:"id"`
		WorldID        string `json:"worldId"`
		OwnerAccountID string `json:"ownerAccountId"`
		SourceHash     string `json:"sourceHash"`
		WorldEntityRef *struct {
			Kind     string `json:"kind"`
			WorldID  string `json:"worldId"`
			EntityID string `json:"entityId"`
		} `json:"worldEntityRef"`
	}
	if err := json.Unmarshal([]byte(raw), &current); err != nil {
		return nil, fmt.Errorf("decode current Realm source identity: %w", err)
	}
	if current.ID != sourceRef.ID || current.WorldID != sourceRef.WorldID {
		return nil, fmt.Errorf("current Realm source identity mismatch")
	}
	if sourceRef.Kind == "worldCharacter" {
		if current.WorldEntityRef == nil || current.WorldEntityRef.Kind != "worldEntity" || current.WorldEntityRef.WorldID != sourceRef.WorldEntityRef.WorldID || current.WorldEntityRef.EntityID != sourceRef.WorldEntityRef.EntityID {
			return nil, fmt.Errorf("current Realm source entity binding mismatch")
		}
	} else if current.OwnerAccountID != sourceRef.OwnerAccountID {
		return nil, fmt.Errorf("current Realm source owner mismatch")
	}
	publicationRef := sourceRef
	publicationRef.SourceHash = current.SourceHash
	expectedSourceRef, err := realmSourceMaterializationSourceRefJSON(publicationRef)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]any{"sourceRef": expectedSourceRef})
	if err != nil {
		return nil, err
	}
	raw, err = read(realmCharacterPublicAvatarOperationID, realmUnaryRequestJSON{Body: body})
	if err != nil {
		return nil, err
	}
	return decodeRealmCharacterPublicSource(raw, expectedSourceRef)
}

func decodeRealmCharacterPublicAvatar(raw string, expectedSourceRef any) (*string, error) {
	projection, err := decodeRealmCharacterPublicSource(raw, expectedSourceRef)
	if err != nil {
		return nil, err
	}
	return projectRealmCharacterPublicAvatar(projection)
}

func decodeRealmCharacterPublicSource(raw string, expectedSourceRef any) (*realmCharacterPublicSourceProjection, error) {
	var projection realmCharacterPublicSourceProjection
	if err := json.Unmarshal([]byte(raw), &projection); err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: decode public projection: %w", err)
	}
	if len(projection.SourceRef) == 0 {
		return nil, fmt.Errorf("resolve Realm character public avatar: public projection sourceRef is missing")
	}
	expectedCanonical, err := canonicalRealmCharacterPublicAvatarJSON(expectedSourceRef)
	if err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: canonicalize expected sourceRef: %w", err)
	}
	returnedCanonical, err := canonicalRealmCharacterPublicAvatarJSON(projection.SourceRef)
	if err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: canonicalize returned sourceRef: %w", err)
	}
	if !bytes.Equal(returnedCanonical, expectedCanonical) {
		return nil, fmt.Errorf("resolve Realm character public avatar: public projection sourceRef mismatch")
	}
	return &projection, nil
}

func projectRealmCharacterPublicAvatar(projection *realmCharacterPublicSourceProjection) (*string, error) {
	if projection.Media == nil {
		return nil, nil
	}
	var candidates []*string
	if assets := projection.Media.Assets; assets != nil {
		for _, asset := range []*realmCharacterPublicAsset{assets.Avatar, assets.Portrait, assets.ReferenceImage} {
			selected, err := realmCharacterPublicAssetURL(asset, "avatar")
			if err != nil {
				return nil, err
			}
			candidates = append(candidates, selected)
		}
	}
	candidates = append(candidates, projection.Media.External.AvatarURL, projection.Media.External.PortraitURL, projection.Media.External.ReferenceImageURL)
	for _, candidate := range candidates {
		if candidate == nil || *candidate == "" {
			continue
		}
		if !canonicalPublicAvatarURL(candidate) {
			return nil, fmt.Errorf("resolve Realm character public avatar: public media URL is not canonical HTTPS")
		}
		avatarURL := *candidate
		return &avatarURL, nil
	}
	return nil, nil
}

func canonicalPublicAvatarURL(value *string) bool {
	if value == nil {
		return true
	}
	if *value == "" || strings.TrimSpace(*value) != *value || !utf8.ValidString(*value) || len([]byte(*value)) > 4096 {
		return false
	}
	parsed, err := url.Parse(*value)
	return err == nil && parsed.Scheme == "https" && parsed.Hostname() != "" && parsed.User == nil && parsed.Fragment == ""
}

func realmCharacterPublicAssetURL(asset *realmCharacterPublicAsset, purpose string) (*string, error) {
	if asset == nil {
		return nil, nil
	}
	delivery, err := realmmedia.Decode(asset.Delivery)
	if err != nil {
		return nil, err
	}
	if delivery == nil {
		return asset.ExternalURL, nil
	}
	if delivery.ResourceId != asset.ID {
		return nil, fmt.Errorf("Realm media Resource identity mismatch")
	}
	if purpose == "original" {
		if delivery.OriginalUrl == "" {
			return nil, nil
		}
		return &delivery.OriginalUrl, nil
	}
	if purpose == "audio-preview" {
		if delivery.PreviewUrl == "" {
			return nil, nil
		}
		return &delivery.PreviewUrl, nil
	}
	width := int32(160)
	if purpose == "detail" {
		width = 960
	}
	return realmmedia.Image(delivery, purpose, width), nil
}

func canonicalRealmCharacterPublicAvatarJSON(value any) ([]byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var decoded any
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	if err := decoder.Decode(&decoded); err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(decoded)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(string(canonical)) == "" {
		return nil, fmt.Errorf("canonical JSON is empty")
	}
	return canonical, nil
}

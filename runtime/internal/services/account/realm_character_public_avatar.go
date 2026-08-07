package account

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

const realmCharacterPublicAvatarOperationID = "WorldPublicController_getCharacterSource"

type realmCharacterPublicSourceProjection struct {
	SourceRef json.RawMessage                  `json:"sourceRef"`
	Media     *realmCharacterPublicSourceMedia `json:"media"`
}

type realmCharacterPublicSourceMedia struct {
	AvatarURL         *string                                `json:"avatarUrl"`
	PortraitURL       *string                                `json:"portraitUrl"`
	ReferenceImageURL *string                                `json:"referenceImageUrl"`
	Assets            *realmCharacterPublicSourceMediaAssets `json:"assets"`
}

type realmCharacterPublicSourceMediaAssets struct {
	Avatar         *realmCharacterPublicAsset `json:"avatar"`
	Portrait       *realmCharacterPublicAsset `json:"portrait"`
	ReferenceImage *realmCharacterPublicAsset `json:"referenceImage"`
}

type realmCharacterPublicAsset struct {
	URL *string `json:"url"`
}

// ResolveRealmCharacterPublicAvatar is a Runtime-private fixed Realm
// projection. Callers supply an already-owned LocalAgent source binding, never
// a Realm origin, bearer, operation id, or app-selected authority.
func (s *Service) ResolveRealmCharacterPublicAvatar(
	ctx context.Context,
	accountID string,
	sourceRef RealmSourceMaterializationSourceRefV3,
) (*string, error) {
	if s == nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: account service is unavailable")
	}
	expectedSourceRef, err := realmSourceMaterializationSourceRefJSON(sourceRef)
	if err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: %w", err)
	}
	operation, admitted := realmBrokerOperations[realmCharacterPublicAvatarOperationID]
	if !admitted {
		return nil, fmt.Errorf("resolve Realm character public avatar: fixed Realm operation is unavailable")
	}
	body, err := json.Marshal(map[string]any{"sourceRef": expectedSourceRef})
	if err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: encode source binding: %w", err)
	}
	request := realmUnaryRequestJSON{Body: body}
	if err := validateRealmUnaryRequestShape(operation, request); err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: validate fixed request: %w", err)
	}

	operationCtx, operationCancel := context.WithTimeout(ctx, realmUnaryDefaultTimeout)
	defer operationCancel()
	credential, err := s.captureRealmSourceMaterializationCredential(operationCtx, accountID)
	if err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: %w", err)
	}
	if err := s.RevalidateRealmSourceMaterializationAccount(operationCtx, credential.lease); err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: %w", err)
	}
	targetURL, err := buildRealmUnaryURL(credential.baseURL, operation, request)
	if err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: build fixed Realm endpoint: %w", err)
	}

	client := s.realmHTTP
	if client == nil {
		client = &http.Client{Timeout: realmUnaryDefaultTimeout}
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	if clientCopy.Timeout <= 0 || clientCopy.Timeout > realmUnaryDefaultTimeout {
		clientCopy.Timeout = realmUnaryDefaultTimeout
	}
	result := s.doRealmUnaryHTTP(operationCtx, &clientCopy, targetURL, operation, request, credential.bearer)
	if result.err != nil {
		if callerErr := ctx.Err(); callerErr != nil {
			return nil, callerErr
		}
		return nil, fmt.Errorf("resolve Realm character public avatar: Realm request failed: %w", result.err)
	}
	if result.failure != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: Realm request was rejected")
	}
	if err := s.RevalidateRealmSourceMaterializationAccount(operationCtx, credential.lease); err != nil {
		return nil, fmt.Errorf("resolve Realm character public avatar: %w", err)
	}
	projected := projectRealmUnaryHTTPResult(result)
	if !projected.GetAccepted() {
		return nil, fmt.Errorf(
			"resolve Realm character public avatar: Realm projection failed with %s",
			projected.GetAccountReasonCode().String(),
		)
	}
	return decodeRealmCharacterPublicAvatar(projected.GetResponseJson(), expectedSourceRef)
}

func decodeRealmCharacterPublicAvatar(raw string, expectedSourceRef any) (*string, error) {
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
	if projection.Media == nil {
		return nil, nil
	}
	var avatarAssetURL, portraitAssetURL, referenceImageAssetURL *string
	if projection.Media.Assets != nil {
		avatarAssetURL = realmCharacterPublicAssetURL(projection.Media.Assets.Avatar)
		portraitAssetURL = realmCharacterPublicAssetURL(projection.Media.Assets.Portrait)
		referenceImageAssetURL = realmCharacterPublicAssetURL(projection.Media.Assets.ReferenceImage)
	}
	for _, candidate := range []*string{
		projection.Media.AvatarURL,
		avatarAssetURL,
		projection.Media.PortraitURL,
		portraitAssetURL,
		projection.Media.ReferenceImageURL,
		referenceImageAssetURL,
	} {
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

func realmCharacterPublicAssetURL(asset *realmCharacterPublicAsset) *string {
	if asset == nil {
		return nil
	}
	return asset.URL
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

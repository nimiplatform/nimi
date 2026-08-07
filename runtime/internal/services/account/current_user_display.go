package account

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
)

var ErrCurrentUserDisplayUnavailable = errors.New("current-user display unavailable")

const currentUserProfileMaxBytes int64 = 1 << 20

// CurrentUserDisplay is the complete App-facing projection. Account ids,
// email, roles, wallets, credentials, and the source DTO remain owner-private.
type CurrentUserDisplay struct {
	Handle      string
	DisplayName string
	AvatarURL   *string
}

// CurrentUserDisplay reads the display facts installed into the existing
// authenticated Account generation. It does not issue a per-App Realm request
// and does not establish a second account cache, service, or authority path.
func (s *Service) CurrentUserDisplay(ctx context.Context) (CurrentUserDisplay, error) {
	if s == nil || !s.isActivated() {
		return CurrentUserDisplay{}, ErrCurrentUserDisplayUnavailable
	}
	projection, _, _, ok := s.BindAuthenticatedRuntimeGeneration(ctx)
	if !ok || projection == nil {
		return CurrentUserDisplay{}, ErrCurrentUserDisplayUnavailable
	}
	s.mu.RLock()
	material := s.material
	authenticated := s.state == runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_AUTHENTICATED &&
		s.authenticatedRuntimeIdentity && strings.TrimSpace(material.AccountID) == strings.TrimSpace(projection.GetAccountId())
	s.mu.RUnlock()
	if !authenticated {
		return CurrentUserDisplay{}, ErrCurrentUserDisplayUnavailable
	}
	return currentUserDisplayFromMaterial(material)
}

func currentUserDisplayFromMaterial(material AccountMaterial) (CurrentUserDisplay, error) {
	handle, err := requiredCurrentUserDisplayTextValue(material.CurrentUserHandle, 160)
	if err != nil {
		return CurrentUserDisplay{}, err
	}
	displayName, err := requiredCurrentUserDisplayTextValue(material.DisplayName, 256)
	if err != nil {
		return CurrentUserDisplay{}, err
	}
	var avatarURL *string
	if material.CurrentUserAvatarURL != nil {
		avatar := *material.CurrentUserAvatarURL
		validated, avatarErr := safeCurrentUserAvatarURL(avatar, material.RealmOrigin)
		if avatarErr != nil {
			return CurrentUserDisplay{}, avatarErr
		}
		avatarURL = validated
	}
	return CurrentUserDisplay{Handle: handle, DisplayName: displayName, AvatarURL: avatarURL}, nil
}

type currentUserProfile struct {
	AccountID string
	Display   CurrentUserDisplay
}

// fetchCurrentUserProfile is called only while installing a newly exchanged
// Account session. Its strict output is folded into AccountMaterial before the
// authenticated generation becomes visible to App sessions.
func fetchCurrentUserProfile(
	ctx context.Context,
	client *http.Client,
	realmBaseURL string,
	accessToken string,
) (currentUserProfile, error) {
	base, err := url.Parse(strings.TrimRight(strings.TrimSpace(realmBaseURL), "/"))
	if err != nil || !base.IsAbs() || base.Hostname() == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	target := base.ResolveReference(&url.URL{Path: "/api/human/me"})
	token := strings.TrimSpace(accessToken)
	if token == "" || token != accessToken {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	request.Header.Set("authorization", "Bearer "+token)
	if client == nil {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	boundedClient := *client
	boundedClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := boundedClient.Do(request)
	if err != nil {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("content-type"))
	if err != nil || mediaType != "application/json" {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	limited := &io.LimitedReader{R: response.Body, N: currentUserProfileMaxBytes + 1}
	body, err := io.ReadAll(limited)
	if err != nil || len(body) == 0 || int64(len(body)) > currentUserProfileMaxBytes {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	if err := scanRealmBrokerResponseForCredentials(response.Header, body); err != nil {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	return decodeCurrentUserProfile(body, base.String())
}

func decodeCurrentUserProfile(raw []byte, realmBaseURL string) (currentUserProfile, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	if err := jsonstrict.RejectDuplicateKeys(raw); err != nil {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
	}
	accountID, err := requiredCurrentUserDisplayText(object["id"], 256)
	if err != nil {
		return currentUserProfile{}, err
	}
	handle, err := requiredCurrentUserDisplayText(object["handle"], 160)
	if err != nil {
		return currentUserProfile{}, err
	}
	displayName, err := requiredCurrentUserDisplayText(object["displayName"], 256)
	if err != nil {
		return currentUserProfile{}, err
	}
	var avatarURL *string
	if avatar, exists := object["avatarUrl"]; exists && !bytes.Equal(bytes.TrimSpace(avatar), []byte("null")) {
		var value string
		if err := json.Unmarshal(avatar, &value); err != nil {
			return currentUserProfile{}, ErrCurrentUserDisplayUnavailable
		}
		avatarURL, err = safeCurrentUserAvatarURL(value, realmBaseURL)
		if err != nil {
			return currentUserProfile{}, err
		}
	}
	return currentUserProfile{
		AccountID: accountID,
		Display:   CurrentUserDisplay{Handle: handle, DisplayName: displayName, AvatarURL: avatarURL},
	}, nil
}

func requiredCurrentUserDisplayText(raw json.RawMessage, maximum int) (string, error) {
	var value string
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return "", ErrCurrentUserDisplayUnavailable
	}
	return requiredCurrentUserDisplayTextValue(value, maximum)
}

func requiredCurrentUserDisplayTextValue(value string, maximum int) (string, error) {
	if value == "" || value != strings.TrimSpace(value) || len(value) > maximum || strings.ContainsAny(value, "\x00\r\n") {
		return "", ErrCurrentUserDisplayUnavailable
	}
	return value, nil
}

func safeCurrentUserAvatarURL(value string, realmBaseURL string) (*string, error) {
	if value == "" || value != strings.TrimSpace(value) || len(value) > 2048 {
		return nil, ErrCurrentUserDisplayUnavailable
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return nil, ErrCurrentUserDisplayUnavailable
	}
	if !parsed.IsAbs() {
		base, baseErr := url.Parse(realmBaseURL)
		if baseErr != nil || !strings.HasPrefix(value, "/") {
			return nil, ErrCurrentUserDisplayUnavailable
		}
		parsed = base.ResolveReference(parsed)
	}
	if parsed.User != nil || parsed.Opaque != "" || parsed.Hostname() == "" || parsed.RawQuery != "" ||
		parsed.ForceQuery || parsed.Fragment != "" || parsed.RawFragment != "" {
		return nil, ErrCurrentUserDisplayUnavailable
	}
	switch parsed.Scheme {
	case "https":
		if parsed.Port() != "" && parsed.Port() != "443" {
			return nil, ErrCurrentUserDisplayUnavailable
		}
	case "http":
		if (parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") || parsed.Port() != "3002" {
			return nil, ErrCurrentUserDisplayUnavailable
		}
		parsed.Host = "127.0.0.1:3002"
	default:
		return nil, ErrCurrentUserDisplayUnavailable
	}
	result := parsed.String()
	return &result, nil
}

package connector

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strings"
	"time"
)

const (
	chatGPTPlanTokenURL           = "https://auth.openai.com/api/accounts/oauth/token"
	chatGPTPlanRevocationURL      = "https://auth.openai.com/api/accounts/oauth/revoke"
	chatGPTPlanTokenResponseLimit = 64 << 10
	chatGPTPlanOAuthTimeout       = 30 * time.Second
)

// ChatGPTPlanTokenSet is one renewed SIWC token response. It stays inside the
// Connector owner until committed to sealed custody.
type ChatGPTPlanTokenSet struct {
	AccessToken  string
	RefreshToken string
	TokenType    string
	ExpiresIn    int64
	Scope        string
}

// ChatGPTPlanTokenRenewer performs only the exact SIWC refresh and revocation
// exchanges at their fixed OpenAI endpoints.
type ChatGPTPlanTokenRenewer interface {
	Renew(ctx context.Context, clientID string, refreshToken string) (ChatGPTPlanTokenSet, error)
	Revoke(ctx context.Context, clientID string, refreshToken string) error
}

type chatGPTPlanRenewalDisposition uint8

const (
	chatGPTPlanRenewalUnknown chatGPTPlanRenewalDisposition = iota
	// The refresh token never left Runtime.
	chatGPTPlanRenewalPreDispatch
	// The authorization server answered without issuing a token set, so the
	// committed refresh token was not consumed and may be retried later.
	chatGPTPlanRenewalTemporary
	// The endpoint answered with a redirect, which is never followed.
	chatGPTPlanRenewalRedirected
	// A documented code confirms the refresh token is unusable.
	chatGPTPlanRenewalTokenInvalid
	chatGPTPlanRenewalClientInvalid
	// A successful status carried an unusable token set; the refresh token
	// may already have rotated.
	chatGPTPlanRenewalContractInvalid
	// The request left Runtime but its result is unknown.
	chatGPTPlanRenewalOutcomeAmbiguous
)

type chatGPTPlanRenewalFailure struct {
	disposition chatGPTPlanRenewalDisposition
	err         error
}

func (failure *chatGPTPlanRenewalFailure) Error() string {
	if failure == nil || failure.err == nil {
		return "ChatGPT plan renewal failed"
	}
	return "ChatGPT plan renewal failed: " + failure.err.Error()
}

func (failure *chatGPTPlanRenewalFailure) Unwrap() error { return failure.err }

func newChatGPTPlanRenewalFailure(disposition chatGPTPlanRenewalDisposition, err error) error {
	return &chatGPTPlanRenewalFailure{disposition: disposition, err: err}
}

func chatGPTPlanRenewalDispositionOf(err error) chatGPTPlanRenewalDisposition {
	var failure *chatGPTPlanRenewalFailure
	if errors.As(err, &failure) {
		return failure.disposition
	}
	return chatGPTPlanRenewalUnknown
}

type chatGPTPlanHTTPRenewer struct {
	client        *http.Client
	tokenURL      string
	revocationURL string
}

// NewChatGPTPlanHTTPRenewer returns the production SIWC renewer. It never
// follows redirects, so the fixed endpoint also bounds every hop.
func NewChatGPTPlanHTTPRenewer(client *http.Client) ChatGPTPlanTokenRenewer {
	return newChatGPTPlanHTTPRenewer(client, chatGPTPlanTokenURL, chatGPTPlanRevocationURL)
}

func newChatGPTPlanHTTPRenewer(client *http.Client, tokenURL string, revocationURL string) *chatGPTPlanHTTPRenewer {
	if client == nil {
		client = &http.Client{Timeout: chatGPTPlanOAuthTimeout}
	}
	pinned := *client
	pinned.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &chatGPTPlanHTTPRenewer{client: &pinned, tokenURL: tokenURL, revocationURL: revocationURL}
}

func (renewer *chatGPTPlanHTTPRenewer) Renew(ctx context.Context, clientID string, refreshToken string) (ChatGPTPlanTokenSet, error) {
	form := url.Values{
		"grant_type": {"refresh_token"}, "client_id": {clientID}, "refresh_token": {refreshToken}, "resource": {chatGPTPlanResource},
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, renewer.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(chatGPTPlanRenewalPreDispatch, err)
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	wroteRequest := false
	request = request.WithContext(httptrace.WithClientTrace(request.Context(), &httptrace.ClientTrace{
		WroteRequest: func(httptrace.WroteRequestInfo) { wroteRequest = true },
	}))
	response, err := renewer.client.Do(request)
	if err != nil {
		if wroteRequest {
			return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(chatGPTPlanRenewalOutcomeAmbiguous, err)
		}
		return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(chatGPTPlanRenewalPreDispatch, err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(response.Body, chatGPTPlanTokenResponseLimit+1))
	if err != nil {
		return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(chatGPTPlanRenewalOutcomeAmbiguous, fmt.Errorf("read renewal response: %w", err))
	}
	if len(body) > chatGPTPlanTokenResponseLimit {
		return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(chatGPTPlanRenewalContractInvalid, errors.New("renewal response exceeds fixed bound"))
	}
	if response.StatusCode != http.StatusOK {
		return ChatGPTPlanTokenSet{}, chatGPTPlanRenewalHTTPFailure(response.StatusCode, body)
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(chatGPTPlanRenewalContractInvalid, errors.New("renewal response content type is invalid"))
	}
	var parsed struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int64  `json:"expires_in"`
		Scope        string `json:"scope"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || parsed.AccessToken == "" || parsed.RefreshToken == "" || parsed.ExpiresIn <= 0 {
		return ChatGPTPlanTokenSet{}, newChatGPTPlanRenewalFailure(chatGPTPlanRenewalContractInvalid, errors.New("renewal response is incomplete"))
	}
	return ChatGPTPlanTokenSet{
		AccessToken: parsed.AccessToken, RefreshToken: parsed.RefreshToken, TokenType: parsed.TokenType,
		ExpiresIn: parsed.ExpiresIn, Scope: parsed.Scope,
	}, nil
}

// chatGPTPlanRenewalHTTPFailure classifies a non-200 answer from the token
// endpoint. Documented unusable-token codes require explicit reauthorization
// and invalid_client makes the registration unusable. Any other answer issued
// no token set, so the committed refresh token is preserved for a later retry
// (OpenAI: preserve credentials on temporary failures and retry with backoff).
func chatGPTPlanRenewalHTTPFailure(status int, body []byte) error {
	var oauthError struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(body, &oauthError)
	switch strings.TrimSpace(oauthError.Error) {
	case "invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused":
		return newChatGPTPlanRenewalFailure(chatGPTPlanRenewalTokenInvalid, fmt.Errorf("renewal rejected: %s", oauthError.Error))
	case "invalid_client":
		return newChatGPTPlanRenewalFailure(chatGPTPlanRenewalClientInvalid, errors.New("renewal rejected the issued client"))
	}
	if status >= 300 && status < 400 {
		return newChatGPTPlanRenewalFailure(chatGPTPlanRenewalRedirected, fmt.Errorf("renewal endpoint redirected with http %d", status))
	}
	return newChatGPTPlanRenewalFailure(chatGPTPlanRenewalTemporary, fmt.Errorf("renewal endpoint returned http %d", status))
}

// Revoke ends the renewable session of one refresh token. HTTP 200 confirms
// revocation of the current token; it cannot confirm that a token which may
// already have rotated has no live successor.
func (renewer *chatGPTPlanHTTPRenewer) Revoke(ctx context.Context, clientID string, refreshToken string) error {
	form := url.Values{"token": {refreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {clientID}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, renewer.revocationURL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := renewer.client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, chatGPTPlanTokenResponseLimit))
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("revocation endpoint returned http %d", response.StatusCode)
	}
	return nil
}

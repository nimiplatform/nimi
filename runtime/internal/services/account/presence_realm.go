package account

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const realmPresenceCallbackPath = "/oauth/callback"

type realmOAuthPresenceProviderConfig struct {
	AuthorizationURL string
	TokenURL         string
	ClientID         string
	HTTPClient       *http.Client
	OpenURL          func(context.Context, string) error
	Now              func() time.Time
	Timeout          time.Duration
}

type realmOAuthPresenceProvider struct {
	authorizationURL string
	tokenURL         string
	clientID         string
	httpClient       *http.Client
	openURL          func(context.Context, string) error
	now              func() time.Time
	timeout          time.Duration
}

type realmPresenceCallback struct {
	code  string
	state string
	err   error
}

func newRealmOAuthPresenceProvider(cfg realmOAuthPresenceProviderConfig) hostPresenceProvider {
	authorizationURL := normalizeOAuthAuthorizeEndpoint(cfg.AuthorizationURL)
	tokenURL := strings.TrimSpace(cfg.TokenURL)
	clientID := strings.TrimSpace(cfg.ClientID)
	if authorizationURL == "" || tokenURL == "" || clientID == "" {
		return nil
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	openURL := cfg.OpenURL
	if openURL == nil {
		openURL = openExternalURL
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Minute
	}
	return realmOAuthPresenceProvider{
		authorizationURL: authorizationURL,
		tokenURL:         tokenURL,
		clientID:         clientID,
		httpClient:       client,
		openURL:          openURL,
		now:              now,
		timeout:          timeout,
	}
}

func (p realmOAuthPresenceProvider) RequestHostPresence(ctx context.Context, request hostPresenceRequest) (hostPresenceResult, error) {
	accountID := strings.TrimSpace(request.AccountID)
	purpose := strings.TrimSpace(request.Purpose)
	if accountID == "" || purpose == "" {
		return hostPresenceResult{Outcome: hostPresenceUnavailable}, nil
	}
	callback, err := p.startLoopbackCallback(ctx)
	if err != nil {
		return hostPresenceResult{Outcome: hostPresenceUnavailable}, err
	}
	defer callback.close()

	attempt := LoginAttempt{
		State:        randomToken(),
		Nonce:        randomToken(),
		PKCEVerifier: randomToken(),
		RedirectURI:  callback.redirectURI,
		ExpiresAt:    p.now().UTC().Add(p.timeout),
	}
	attempt.PKCEChallenge = pkceChallenge(attempt.PKCEVerifier)

	authorizationURL, err := p.authorizationURLForPresence(attempt, purpose)
	if err != nil {
		return hostPresenceResult{Outcome: hostPresenceUnavailable}, err
	}
	openURL := p.openURL
	if request.BrowserLauncher != nil {
		openURL = request.BrowserLauncher
	}
	if err := openURL(ctx, authorizationURL); err != nil {
		return hostPresenceResult{Outcome: hostPresenceUnavailable}, err
	}
	received, err := callback.wait(ctx, p.timeout)
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return hostPresenceResult{
				Outcome: hostPresenceRejected,
				Method:  runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_NIMI_REAUTH,
			}, nil
		}
		return hostPresenceResult{Outcome: hostPresenceUnavailable}, err
	}
	if received.err != nil || received.code == "" || received.state != attempt.State {
		return hostPresenceResult{
			Outcome: hostPresenceRejected,
			Method:  runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_NIMI_REAUTH,
		}, nil
	}
	material, err := p.exchangePresenceCode(ctx, attempt, received.code)
	if err != nil {
		return hostPresenceResult{Outcome: hostPresenceUnavailable}, err
	}
	if strings.TrimSpace(material.AccountID) != accountID {
		return hostPresenceResult{
			Outcome: hostPresenceRejected,
			Method:  runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_NIMI_REAUTH,
		}, nil
	}
	return hostPresenceResult{
		Outcome: hostPresenceVerified,
		Method:  runtimev1.PresenceVerificationMethod_PRESENCE_VERIFICATION_METHOD_NIMI_REAUTH,
	}, nil
}

func (p realmOAuthPresenceProvider) authorizationURLForPresence(attempt LoginAttempt, purpose string) (string, error) {
	u, err := url.Parse(p.authorizationURL)
	if err != nil {
		return "", err
	}
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", p.clientID)
	q.Set("redirect_uri", attempt.RedirectURI)
	q.Set("code_challenge", attempt.PKCEChallenge)
	q.Set("code_challenge_method", "S256")
	q.Set("state", attempt.State)
	q.Set("prompt", "login")
	q.Set("presence_purpose", purpose)
	q.Set("presence_nonce", attempt.Nonce)
	u.RawQuery = q.Encode()
	u.Fragment = ""
	return u.String(), nil
}

func (p realmOAuthPresenceProvider) exchangePresenceCode(ctx context.Context, attempt LoginAttempt, code string) (AccountMaterial, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", p.clientID)
	form.Set("code", strings.TrimSpace(code))
	form.Set("code_verifier", attempt.PKCEVerifier)
	form.Set("redirect_uri", attempt.RedirectURI)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return AccountMaterial{}, ErrLoginExchangeFailure
	}
	req.Header.Set("content-type", "application/x-www-form-urlencoded")
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return AccountMaterial{}, fmt.Errorf("%w: %v", ErrLoginExchangeFailure, err)
	}
	defer func() { _ = resp.Body.Close() }()
	return materialFromTokenResponse(resp)
}

type realmPresenceLoopback struct {
	redirectURI string
	server      *http.Server
	callbacks   <-chan realmPresenceCallback
}

func (p realmOAuthPresenceProvider) startLoopbackCallback(ctx context.Context) (realmPresenceLoopback, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return realmPresenceLoopback{}, err
	}
	callbacks := make(chan realmPresenceCallback, 1)
	redirectURI := "http://" + listener.Addr().String() + realmPresenceCallbackPath
	server := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != realmPresenceCallbackPath {
				http.NotFound(w, r)
				return
			}
			result := realmPresenceCallback{
				code:  strings.TrimSpace(r.URL.Query().Get("code")),
				state: strings.TrimSpace(r.URL.Query().Get("state")),
			}
			if result.code == "" || result.state == "" {
				result.err = ErrLoginExchangeFailure
			}
			select {
			case callbacks <- result:
			default:
			}
			w.Header().Set("content-type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte("<!doctype html><title>Nimi</title><body>Presence verification received. You can close this window.</body>"))
		}),
		BaseContext: func(net.Listener) context.Context { return ctx },
	}
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			select {
			case callbacks <- realmPresenceCallback{err: serveErr}:
			default:
			}
		}
	}()
	return realmPresenceLoopback{redirectURI: redirectURI, server: server, callbacks: callbacks}, nil
}

func (l realmPresenceLoopback) wait(ctx context.Context, timeout time.Duration) (realmPresenceCallback, error) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case result := <-l.callbacks:
		return result, result.err
	case <-ctx.Done():
		return realmPresenceCallback{}, ctx.Err()
	case <-timer.C:
		return realmPresenceCallback{}, context.DeadlineExceeded
	}
}

func (l realmPresenceLoopback) close() {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = l.server.Shutdown(shutdownCtx)
}

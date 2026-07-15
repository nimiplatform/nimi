package account

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/metadata"
)

const (
	presenceBrowserLauncherMetadata = "x-nimi-presence-browser-launcher"
	presenceBrowserLauncherPrefix   = "/v1/presence-browser/"
	presenceBrowserLauncherMaxURL   = 4096
)

var errPresenceBrowserLauncherInvalid = errors.New("protected presence browser launcher invalid")

type presenceBrowserLauncherPayload struct {
	AuthorizationURL string `json:"authorizationUrl"`
}

// WithPresenceBrowserLauncherMetadata consumes the one-shot protected Desktop
// browser endpoint from transport metadata and binds only its request-scoped
// launcher to the account presence context. The technical endpoint never
// remains available to downstream account or Realm handlers.
func WithPresenceBrowserLauncherMetadata(ctx context.Context) (context.Context, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ctx, nil
	}
	values := md.Get(presenceBrowserLauncherMetadata)
	if len(values) == 0 {
		return ctx, nil
	}
	if len(values) != 1 {
		return nil, errPresenceBrowserLauncherInvalid
	}
	endpoint, err := validatePresenceBrowserLauncherEndpoint(values[0])
	if err != nil {
		return nil, err
	}
	cleaned := md.Copy()
	cleaned.Delete(presenceBrowserLauncherMetadata)
	cleanedContext := metadata.NewIncomingContext(ctx, cleaned)
	return WithPresenceBrowserLauncher(cleanedContext, func(launchCtx context.Context, authorizationURL string) error {
		return deliverPresenceBrowserLauncherURL(launchCtx, endpoint, authorizationURL)
	}), nil
}

func validatePresenceBrowserLauncherEndpoint(raw string) (*url.URL, error) {
	if raw == "" || raw != strings.TrimSpace(raw) || len(raw) > 512 {
		return nil, errPresenceBrowserLauncherInvalid
	}
	endpoint, err := url.ParseRequestURI(raw)
	if err != nil || endpoint.Scheme != "http" || endpoint.Hostname() != "127.0.0.1" ||
		endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, errPresenceBrowserLauncherInvalid
	}
	port, err := strconv.Atoi(endpoint.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, errPresenceBrowserLauncherInvalid
	}
	nonce := strings.TrimPrefix(endpoint.EscapedPath(), presenceBrowserLauncherPrefix)
	if len(nonce) != 64 || presenceBrowserLauncherPrefix+nonce != endpoint.EscapedPath() || !lowerHexPresenceBrowserNonce(nonce) {
		return nil, errPresenceBrowserLauncherInvalid
	}
	return endpoint, nil
}

func lowerHexPresenceBrowserNonce(value string) bool {
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func deliverPresenceBrowserLauncherURL(ctx context.Context, endpoint *url.URL, authorizationURL string) error {
	if ctx == nil || endpoint == nil || authorizationURL == "" || authorizationURL != strings.TrimSpace(authorizationURL) ||
		len(authorizationURL) > presenceBrowserLauncherMaxURL {
		return errPresenceBrowserLauncherInvalid
	}
	payload, err := json.Marshal(presenceBrowserLauncherPayload{AuthorizationURL: authorizationURL})
	if err != nil {
		return fmt.Errorf("encode protected presence browser request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create protected presence browser request: %w", err)
	}
	request.Header.Set("content-type", "application/json")
	dialer := &net.Dialer{Timeout: 3 * time.Second}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(dialCtx context.Context, network, address string) (net.Conn, error) {
			if network != "tcp" || address != endpoint.Host {
				return nil, errPresenceBrowserLauncherInvalid
			}
			return dialer.DialContext(dialCtx, network, address)
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{
		Transport: transport,
		Timeout:   5 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("deliver protected presence browser request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
	if response.StatusCode != http.StatusNoContent {
		return errPresenceBrowserLauncherInvalid
	}
	return nil
}

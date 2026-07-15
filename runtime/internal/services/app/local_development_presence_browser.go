package app

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

	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/metadata"
)

const (
	localDevelopmentPresenceBrowserMetadata = "x-nimi-presence-browser-launcher"
	localDevelopmentPresenceBrowserPrefix   = "/v1/presence-browser/"
	localDevelopmentPresenceBrowserMaxURL   = 4096
)

var errLocalDevelopmentPresenceBrowserInvalid = errors.New("local development presence browser launcher invalid")

type localDevelopmentPresenceBrowserPayload struct {
	AuthorizationURL string `json:"authorizationUrl"`
}

func withLocalDevelopmentPresenceBrowser(ctx context.Context) (context.Context, error) {
	md, ok := metadata.FromIncomingContext(ctx)
	if !ok {
		return ctx, nil
	}
	values := md.Get(localDevelopmentPresenceBrowserMetadata)
	if len(values) == 0 {
		return ctx, nil
	}
	if len(values) != 1 {
		return nil, errLocalDevelopmentPresenceBrowserInvalid
	}
	endpoint, err := validateLocalDevelopmentPresenceBrowserEndpoint(values[0])
	if err != nil {
		return nil, err
	}
	cleaned := md.Copy()
	cleaned.Delete(localDevelopmentPresenceBrowserMetadata)
	cleanedContext := metadata.NewIncomingContext(ctx, cleaned)
	return accountservice.WithPresenceBrowserLauncher(cleanedContext, func(launchCtx context.Context, authorizationURL string) error {
		return deliverLocalDevelopmentPresenceBrowserURL(launchCtx, endpoint, authorizationURL)
	}), nil
}

func validateLocalDevelopmentPresenceBrowserEndpoint(raw string) (*url.URL, error) {
	if raw == "" || raw != strings.TrimSpace(raw) || len(raw) > 512 {
		return nil, errLocalDevelopmentPresenceBrowserInvalid
	}
	endpoint, err := url.ParseRequestURI(raw)
	if err != nil || endpoint.Scheme != "http" || endpoint.Hostname() != "127.0.0.1" ||
		endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, errLocalDevelopmentPresenceBrowserInvalid
	}
	port, err := strconv.Atoi(endpoint.Port())
	if err != nil || port < 1 || port > 65535 {
		return nil, errLocalDevelopmentPresenceBrowserInvalid
	}
	nonce := strings.TrimPrefix(endpoint.EscapedPath(), localDevelopmentPresenceBrowserPrefix)
	if len(nonce) != 64 || localDevelopmentPresenceBrowserPrefix+nonce != endpoint.EscapedPath() || !lowerHex(nonce) {
		return nil, errLocalDevelopmentPresenceBrowserInvalid
	}
	return endpoint, nil
}

func lowerHex(value string) bool {
	for _, char := range value {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func deliverLocalDevelopmentPresenceBrowserURL(ctx context.Context, endpoint *url.URL, authorizationURL string) error {
	if ctx == nil || endpoint == nil || authorizationURL == "" || authorizationURL != strings.TrimSpace(authorizationURL) ||
		len(authorizationURL) > localDevelopmentPresenceBrowserMaxURL {
		return errLocalDevelopmentPresenceBrowserInvalid
	}
	payload, err := json.Marshal(localDevelopmentPresenceBrowserPayload{AuthorizationURL: authorizationURL})
	if err != nil {
		return fmt.Errorf("encode local development presence browser request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("create local development presence browser request: %w", err)
	}
	request.Header.Set("content-type", "application/json")
	dialer := &net.Dialer{Timeout: 3 * time.Second}
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(dialCtx context.Context, network, address string) (net.Conn, error) {
			if network != "tcp" || address != endpoint.Host {
				return nil, errLocalDevelopmentPresenceBrowserInvalid
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
		return fmt.Errorf("deliver local development presence browser request: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 1024))
	if response.StatusCode != http.StatusNoContent {
		return errLocalDevelopmentPresenceBrowserInvalid
	}
	return nil
}

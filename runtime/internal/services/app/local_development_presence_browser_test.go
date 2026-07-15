package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"google.golang.org/grpc/metadata"
)

const testPresenceBrowserNonce = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func TestValidateLocalDevelopmentPresenceBrowserEndpoint(t *testing.T) {
	valid := "http://127.0.0.1:4567/v1/presence-browser/" + testPresenceBrowserNonce
	if _, err := validateLocalDevelopmentPresenceBrowserEndpoint(valid); err != nil {
		t.Fatalf("valid endpoint: %v", err)
	}
	for _, invalid := range []string{
		"https://127.0.0.1:4567/v1/presence-browser/" + testPresenceBrowserNonce,
		"http://localhost:4567/v1/presence-browser/" + testPresenceBrowserNonce,
		"http://127.0.0.1/v1/presence-browser/" + testPresenceBrowserNonce,
		"http://127.0.0.1:4567/v1/presence-browser/ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
		"http://127.0.0.1:4567/v1/presence-browser/short",
		"http://127.0.0.1:4567/v1/presence-browser/" + testPresenceBrowserNonce + "?reuse=1",
	} {
		if _, err := validateLocalDevelopmentPresenceBrowserEndpoint(invalid); err == nil {
			t.Fatalf("endpoint %q unexpectedly accepted", invalid)
		}
	}
}

func TestWithLocalDevelopmentPresenceBrowserScrubsTechnicalMetadata(t *testing.T) {
	endpoint := "http://127.0.0.1:4567/v1/presence-browser/" + testPresenceBrowserNonce
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		localDevelopmentPresenceBrowserMetadata, endpoint,
		"x-nimi-app-id", "nimi.desktop",
	))
	wrapped, err := withLocalDevelopmentPresenceBrowser(ctx)
	if err != nil {
		t.Fatalf("withLocalDevelopmentPresenceBrowser: %v", err)
	}
	md, ok := metadata.FromIncomingContext(wrapped)
	if !ok {
		t.Fatal("wrapped context lost incoming metadata")
	}
	if got := md.Get(localDevelopmentPresenceBrowserMetadata); len(got) != 0 {
		t.Fatalf("launcher metadata remained in context: %v", got)
	}
	if got := md.Get("x-nimi-app-id"); len(got) != 1 || got[0] != "nimi.desktop" {
		t.Fatalf("unrelated metadata changed: %v", got)
	}

	duplicate := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		localDevelopmentPresenceBrowserMetadata, endpoint,
		localDevelopmentPresenceBrowserMetadata, endpoint,
	))
	if _, err := withLocalDevelopmentPresenceBrowser(duplicate); err == nil {
		t.Fatal("duplicate launcher metadata unexpectedly accepted")
	}
}

func TestDeliverLocalDevelopmentPresenceBrowserURL(t *testing.T) {
	var received localDevelopmentPresenceBrowserPayload
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.Header.Get("content-type") != "application/json" {
			t.Fatalf("request = %s content-type=%q", request.Method, request.Header.Get("content-type"))
		}
		if request.Header.Get("origin") != "" || request.Header.Get("referer") != "" {
			t.Fatal("broker request carried browser-origin headers")
		}
		if err := json.NewDecoder(request.Body).Decode(&received); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()
	endpoint, err := validateLocalDevelopmentPresenceBrowserEndpoint(
		strings.Replace(server.URL, "localhost", "127.0.0.1", 1) + localDevelopmentPresenceBrowserPrefix + testPresenceBrowserNonce,
	)
	if err != nil {
		t.Fatalf("validate test endpoint: %v", err)
	}
	const authorizationURL = "http://localhost:3002/api/auth/oauth/authorize?prompt=login&state=opaque"
	if err := deliverLocalDevelopmentPresenceBrowserURL(context.Background(), endpoint, authorizationURL); err != nil {
		t.Fatalf("deliverLocalDevelopmentPresenceBrowserURL: %v", err)
	}
	if received.AuthorizationURL != authorizationURL {
		t.Fatalf("authorization URL = %q", received.AuthorizationURL)
	}
}

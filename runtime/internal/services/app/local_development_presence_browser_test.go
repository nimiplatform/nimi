package app

import (
	"context"
	"testing"

	"google.golang.org/grpc/metadata"
)

func TestLocalDevelopmentPresenceBrowserUsesAccountOwnedMetadataBoundary(t *testing.T) {
	const endpoint = "http://127.0.0.1:4567/v1/presence-browser/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	ctx := metadata.NewIncomingContext(context.Background(), metadata.Pairs(
		"x-nimi-presence-browser-launcher", endpoint,
		"x-nimi-app-id", "nimi.desktop",
	))
	wrapped, err := withLocalDevelopmentPresenceBrowser(ctx)
	if err != nil {
		t.Fatalf("withLocalDevelopmentPresenceBrowser: %v", err)
	}
	md, ok := metadata.FromIncomingContext(wrapped)
	if !ok || len(md.Get("x-nimi-presence-browser-launcher")) != 0 {
		t.Fatal("technical browser metadata was not consumed")
	}
	if got := md.Get("x-nimi-app-id"); len(got) != 1 || got[0] != "nimi.desktop" {
		t.Fatalf("unrelated metadata changed: %v", got)
	}
}

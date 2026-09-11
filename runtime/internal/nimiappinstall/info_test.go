package nimiappinstall

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/nimiapppackage"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
)

func TestAppInfoDownloadBindsOnlyTheSmallApprovedReleaseAsset(t *testing.T) {
	// This tests the byte downloader; document parsing is covered by nimiapppackage.
	raw := []byte("small information resource")
	digest := sha256.Sum256(raw)
	revision := strings.Repeat("a", 40)
	encode := func(value string) string { return base64.RawURLEncoding.EncodeToString([]byte(value)) }
	selector, err := publicappregistry.ParseApprovedTargetSelector("nats_v1_" + encode("publisher.app@1.2.3") + "." + encode("windows-x86_64") + "." + encode(revision))
	if err != nil {
		t.Fatal(err)
	}
	resolved := publicappregistry.ResolvedApprovedTarget{
		Selector: selector, DescriptorID: selector.DescriptorID(), RegistryRevision: revision, Visibility: "public",
		Source:  publicappregistry.Source{Repository: "https://github.com/publisher/app"},
		Release: publicappregistry.Release{Tag: "v1.2.3", Immutable: true},
		Target: publicappregistry.Target{TargetID: "windows-x86_64", AppInfo: publicappregistry.AppInfoAsset{
			AssetID: 43, AssetName: "publisher.app-1.2.3-windows-x86_64.app-info.json", AssetURL: "https://github.com/publisher/app/releases/download/v1.2.3/publisher.app-1.2.3-windows-x86_64.app-info.json", Size: int64(len(raw)), SHA256: hex.EncodeToString(digest[:]),
		}},
	}
	requests := 0
	body := raw
	downloader := newDownloader(roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.String() != resolved.Target.AppInfo.AssetURL {
			t.Fatalf("downloaded a different asset: %s", request.URL)
		}
		return downloadResponse(http.StatusOK, request, body), nil
	}), nil)
	if got, err := downloader.DownloadAppInfo(context.Background(), resolved); err != nil || string(got) != string(raw) {
		t.Fatalf("small asset download: %q %v", got, err)
	}
	body = []byte(strings.Repeat("x", len(raw)))
	if _, err := downloader.DownloadAppInfo(context.Background(), resolved); err == nil {
		t.Fatal("changed information bytes were accepted")
	}
	before := requests
	resolved.Target.AppInfo.Size = nimiapppackage.MaxAppInfoBytes + 1
	if _, err := downloader.DownloadAppInfo(context.Background(), resolved); err == nil || requests != before {
		t.Fatalf("oversized asset made a request: %v", err)
	}
	resolved.Target.AppInfo.Size = int64(len(raw))
	resolved.KillSwitch.Active = true
	if _, err := downloader.DownloadAppInfo(context.Background(), resolved); err == nil || requests != before {
		t.Fatalf("blocked target made a request: %v", err)
	}
}

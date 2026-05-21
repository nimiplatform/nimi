package appinstallgateway

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
)

func TestHTTPSDownloaderRejectsNonHTTPSLocator(t *testing.T) {
	downloader := NewHTTPSDownloader()
	descriptor := appreleasecatalog.Descriptor{
		DescriptorClass: appreleasecatalog.DescriptorClassExternalImmutableArtifact,
		Artifact:        appreleasecatalog.Artifact{Locator: "http://example.com/app.tar.gz"},
	}
	_, err := downloader.Download(context.Background(), descriptor)
	if !errors.Is(err, ErrArtifactLocatorNotHTTPS) {
		t.Fatalf("error = %v, want ErrArtifactLocatorNotHTTPS", err)
	}
}

func TestHTTPSDownloaderRejectsBundledDescriptor(t *testing.T) {
	downloader := NewHTTPSDownloader()
	descriptor := appreleasecatalog.Descriptor{
		DescriptorClass: appreleasecatalog.DescriptorClassBundledWithNimi,
		Artifact:        appreleasecatalog.Artifact{Locator: "https://example.com/app.tar.gz"},
	}
	_, err := downloader.Download(context.Background(), descriptor)
	if !errors.Is(err, ErrBundledDescriptorNotDownloadable) {
		t.Fatalf("error = %v, want ErrBundledDescriptorNotDownloadable", err)
	}
}

func TestHTTPSDownloaderDownloadsArtifact(t *testing.T) {
	body := []byte("nimi-app-artifact")
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(body)
	}))
	defer server.Close()

	downloader := NewHTTPSDownloader(WithHTTPClient(server.Client()))
	descriptor := appreleasecatalog.Descriptor{
		DescriptorClass: appreleasecatalog.DescriptorClassExternalImmutableArtifact,
		Artifact:        appreleasecatalog.Artifact{Locator: server.URL + "/app.tar.gz"},
	}
	payload, err := downloader.Download(context.Background(), descriptor)
	if err != nil {
		t.Fatalf("Download: %v", err)
	}
	if string(payload) != string(body) {
		t.Fatalf("payload = %q", payload)
	}
}

func TestHTTPSDownloaderRejectsOversizeArtifact(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(make([]byte, 64))
	}))
	defer server.Close()

	downloader := NewHTTPSDownloader(WithHTTPClient(server.Client()), WithMaxArtifactBytes(8))
	descriptor := appreleasecatalog.Descriptor{
		DescriptorClass: appreleasecatalog.DescriptorClassExternalImmutableArtifact,
		Artifact:        appreleasecatalog.Artifact{Locator: server.URL + "/big.bin"},
	}
	_, err := downloader.Download(context.Background(), descriptor)
	if !errors.Is(err, ErrArtifactTooLarge) {
		t.Fatalf("error = %v, want ErrArtifactTooLarge", err)
	}
}

func TestHTTPSDownloaderRejectsNon200(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	downloader := NewHTTPSDownloader(WithHTTPClient(server.Client()))
	descriptor := appreleasecatalog.Descriptor{
		DescriptorClass: appreleasecatalog.DescriptorClassExternalImmutableArtifact,
		Artifact:        appreleasecatalog.Artifact{Locator: server.URL + "/missing.tar.gz"},
	}
	_, err := downloader.Download(context.Background(), descriptor)
	if !errors.Is(err, ErrArtifactDownloadStatus) {
		t.Fatalf("error = %v, want ErrArtifactDownloadStatus", err)
	}
}

func TestHTTPSDownloaderRejectsDisallowedHost(t *testing.T) {
	downloader := NewHTTPSDownloader(WithAllowedArtifactHosts("trusted.example.com"))
	descriptor := appreleasecatalog.Descriptor{
		DescriptorClass: appreleasecatalog.DescriptorClassExternalImmutableArtifact,
		Artifact:        appreleasecatalog.Artifact{Locator: "https://evil.example.com/app.tar.gz"},
	}
	_, err := downloader.Download(context.Background(), descriptor)
	if !errors.Is(err, ErrArtifactLocatorHostNotAllowed) {
		t.Fatalf("error = %v, want ErrArtifactLocatorHostNotAllowed", err)
	}
}

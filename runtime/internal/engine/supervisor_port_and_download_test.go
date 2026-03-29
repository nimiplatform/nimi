package engine

import (
	"errors"
	"net"
	"testing"
)

func TestResolvePort(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	_ = ln.Close()

	resolved, err := resolvePort(port)
	if err != nil {
		t.Fatalf("resolvePort(%d): %v", port, err)
	}
	if resolved != port {
		t.Fatalf("expected port %d, got %d", port, resolved)
	}
}

func TestResolvePortOccupied(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	occupiedPort := ln.Addr().(*net.TCPAddr).Port
	_, err = resolvePort(occupiedPort)
	if err == nil {
		t.Fatal("expected occupied port resolution to fail")
	}
	if !errors.Is(err, ErrSupervisorPortUnavailable) {
		t.Fatalf("expected ErrSupervisorPortUnavailable, got %v", err)
	}
}

func TestValidateEngineDownloadRedirect(t *testing.T) {
	tests := []struct {
		name        string
		sourceURL   string
		redirectURL string
		wantErr     bool
	}{
		{
			name:        "same host https allowed",
			sourceURL:   "https://example.com/releases/file",
			redirectURL: "https://example.com/releases/file?mirror=1",
		},
		{
			name:        "github release chain allowed",
			sourceURL:   "https://github.com/ggml-org/llama.cpp/releases/download/b8575/file",
			redirectURL: "https://release-assets.githubusercontent.com/path/to/file",
		},
		{
			name:        "foreign host rejected",
			sourceURL:   "https://github.com/ggml-org/llama.cpp/releases/download/b8575/file",
			redirectURL: "https://evil.example/path/to/file",
			wantErr:     true,
		},
		{
			name:        "https downgrade rejected",
			sourceURL:   "https://github.com/ggml-org/llama.cpp/releases/download/b8575/file",
			redirectURL: "http://github.com/ggml-org/llama.cpp/releases/download/b8575/file",
			wantErr:     true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validateEngineDownloadRedirect(tc.sourceURL, tc.redirectURL)
			if tc.wantErr && err == nil {
				t.Fatal("expected redirect validation error")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected redirect validation error: %v", err)
			}
		})
	}
}

func TestValidateOfficialLlamaBackendName(t *testing.T) {
	for _, backendName := range []string{"llama-cpp", "whisper-ggml", "stablediffusion-ggml"} {
		t.Run(backendName, func(t *testing.T) {
			validated, err := validateOfficialLlamaBackendName(backendName)
			if err != nil {
				t.Fatalf("validateOfficialLlamaBackendName(%q): %v", backendName, err)
			}
			if validated != backendName {
				t.Fatalf("expected backend name %q, got %q", backendName, validated)
			}
		})
	}

	if _, err := validateOfficialLlamaBackendName("custom-backend"); err == nil {
		t.Fatal("expected unsupported backend to fail validation")
	}
}

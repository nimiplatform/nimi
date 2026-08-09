package nimillm

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const maxStreamedMediaArtifactBytes int64 = 8 * 1024 * 1024 * 1024

func detachMediaArtifactBodies(ctx context.Context, artifacts []*runtimev1.ScenarioArtifact) (map[string]*MediaArtifactBody, error) {
	if len(artifacts) == 0 {
		return nil, nil
	}
	bodies := make(map[string]*MediaArtifactBody, len(artifacts))
	cleanup := func() {
		for _, body := range bodies {
			if body != nil && body.Stream != nil {
				_ = body.Stream.Close()
			}
		}
	}
	for _, artifact := range artifacts {
		if artifact == nil || strings.TrimSpace(artifact.GetArtifactId()) == "" {
			cleanup()
			return nil, fmt.Errorf("provider artifact identity is missing")
		}
		artifactID := strings.TrimSpace(artifact.GetArtifactId())
		if _, exists := bodies[artifactID]; exists {
			cleanup()
			return nil, fmt.Errorf("provider artifact identity is duplicated")
		}
		if providerURL := strings.TrimSpace(artifact.GetUri()); providerURL != "" {
			stream, mimeType, sizeBytes, err := openBinaryArtifactStream(ctx, providerURL)
			if err != nil {
				cleanup()
				return nil, err
			}
			bodies[artifactID] = &MediaArtifactBody{Stream: stream}
			if strings.TrimSpace(artifact.GetMimeType()) == "" {
				artifact.MimeType = mimeType
			}
			if sizeBytes >= 0 {
				artifact.SizeBytes = sizeBytes
			}
			artifact.Sha256 = ""
		} else if len(artifact.GetBytes()) > 0 {
			bodies[artifactID] = &MediaArtifactBody{Bytes: append([]byte(nil), artifact.GetBytes()...)}
		} else {
			cleanup()
			return nil, fmt.Errorf("provider artifact body is missing")
		}
		artifact.Bytes = nil
		artifact.Uri = ""
	}
	return bodies, nil
}

func openBinaryArtifactStream(ctx context.Context, artifactURL string) (io.ReadCloser, string, int64, error) {
	securedURL := upgradeHTTPToHTTPS(strings.TrimSpace(artifactURL))
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodGet, securedURL, nil)
	if err != nil {
		return nil, "", -1, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, "", -1, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_ = response.Body.Close()
		return nil, "", -1, MapProviderHTTPError(response.StatusCode, nil)
	}
	if response.ContentLength > maxStreamedMediaArtifactBytes {
		_ = response.Body.Close()
		return nil, "", -1, fmt.Errorf("provider artifact exceeds Runtime custody limit")
	}
	return &boundedMediaArtifactStream{ReadCloser: response.Body, remaining: maxStreamedMediaArtifactBytes + 1},
		strings.TrimSpace(response.Header.Get("Content-Type")), response.ContentLength, nil
}

type boundedMediaArtifactStream struct {
	io.ReadCloser
	remaining int64
}

func (stream *boundedMediaArtifactStream) Read(payload []byte) (int, error) {
	if stream.remaining <= 0 {
		return 0, fmt.Errorf("provider artifact exceeds Runtime custody limit")
	}
	if int64(len(payload)) > stream.remaining {
		payload = payload[:stream.remaining]
	}
	read, err := stream.ReadCloser.Read(payload)
	stream.remaining -= int64(read)
	if stream.remaining == 0 && err == nil {
		return read, fmt.Errorf("provider artifact exceeds Runtime custody limit")
	}
	return read, err
}

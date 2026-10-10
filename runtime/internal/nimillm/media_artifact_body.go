package nimillm

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const maxStreamedMediaArtifactBytes int64 = 8 * 1024 * 1024 * 1024

func detachMediaArtifactBodies(ctx context.Context, artifacts []*runtimev1.ScenarioArtifact) (map[string]*MediaArtifactBody, error) {
	return detachMediaArtifactBodiesWithOpener(ctx, artifacts, openBinaryArtifactStream)
}

type mediaArtifactStreamOpener func(context.Context, string) (io.ReadCloser, string, int64, error)

func detachMediaArtifactBodiesWithOpener(ctx context.Context, artifacts []*runtimev1.ScenarioArtifact, opener mediaArtifactStreamOpener) (map[string]*MediaArtifactBody, error) {
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
			stream, mimeType, sizeBytes, err := opener(ctx, providerURL)
			if err != nil {
				cleanup()
				return nil, err
			}
			if strings.TrimSpace(artifact.GetMimeType()) == "" {
				artifact.MimeType = mimeType
			}
			if isImageArtifactMIME(artifact.GetMimeType()) {
				// Image bodies are small; reading their signature ahead keeps the
				// committed type true to the served bytes. Other media keep
				// streaming without read-ahead.
				buffered := bufio.NewReaderSize(stream, imageSignatureBytes)
				head, peekErr := buffered.Peek(imageSignatureBytes)
				if peekErr != nil && !errors.Is(peekErr, io.EOF) {
					_ = stream.Close()
					cleanup()
					return nil, peekErr
				}
				artifact.MimeType = imageArtifactMIMEFromBytes(artifact.GetMimeType(), head)
				stream = &peekedMediaArtifactStream{Reader: buffered, Closer: stream}
			}
			bodies[artifactID] = &MediaArtifactBody{Stream: stream}
			if sizeBytes >= 0 {
				artifact.SizeBytes = sizeBytes
			}
			artifact.Sha256 = ""
		} else if len(artifact.GetBytes()) > 0 {
			if isImageArtifactMIME(artifact.GetMimeType()) {
				artifact.MimeType = imageArtifactMIMEFromBytes(artifact.GetMimeType(), artifact.GetBytes())
			}
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

// imageSignatureBytes covers the content sniffing window for image formats.
const imageSignatureBytes = 512

func isImageArtifactMIME(mimeType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "image/")
}

// imageArtifactMIMEFromBytes lets recognizable image bytes decide the type of
// an image artifact. A provider or adapter label that disagrees with the bytes
// would make App media readers reject the committed artifact.
func imageArtifactMIMEFromBytes(declared string, payload []byte) string {
	if len(payload) > imageSignatureBytes {
		payload = payload[:imageSignatureBytes]
	}
	if detected := strings.TrimSpace(http.DetectContentType(payload)); strings.HasPrefix(detected, "image/") {
		return detected
	}
	return declared
}

type peekedMediaArtifactStream struct {
	*bufio.Reader
	io.Closer
}

func openBinaryArtifactStream(ctx context.Context, artifactURL string) (io.ReadCloser, string, int64, error) {
	return openBinaryArtifactStreamWithLimits(ctx, artifactURL, defaultMediaBodyLimits())
}

func openBinaryArtifactStreamWithLimits(ctx context.Context, artifactURL string, limits mediaBodyLimits) (io.ReadCloser, string, int64, error) {
	securedURL := upgradeHTTPToHTTPS(strings.TrimSpace(artifactURL))
	client, request, budget, err := newMediaBodyRequest(ctx, securedURL, limits)
	if err != nil {
		return nil, "", -1, err
	}
	response, err := client.Do(request)
	if err != nil {
		budget.close()
		return nil, "", -1, err
	}
	budget.headersComplete(response.ContentLength)
	response.Body = &budgetedMediaBody{ReadCloser: response.Body, budget: budget}
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

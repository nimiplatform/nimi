package nimillm

import (
	"compress/gzip"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Validate the full compressed scene while forwarding its original bytes.
// A truncated gzip, CRC error or decoded-length mismatch is an asset-stream
// failure, so the enclosing ZIP cannot be published by Runtime custody.
func verifiedSpaitialSPZStream(source io.ReadCloser) io.ReadCloser {
	reader, writer := io.Pipe()
	go func() {
		err := validateAndCopySpaitialSPZ(writer, source)
		closeErr := source.Close()
		if err == nil {
			err = closeErr
		}
		_ = writer.CloseWithError(err)
	}()
	return &spaitialSPZReadCloser{PipeReader: reader, source: source}
}

type spaitialSPZReadCloser struct {
	*io.PipeReader
	source io.Closer
}

func (stream *spaitialSPZReadCloser) Close() error {
	_ = stream.source.Close()
	return stream.PipeReader.Close()
}

func validateAndCopySpaitialSPZ(target io.Writer, source io.Reader) error {
	decoded, err := gzip.NewReader(io.TeeReader(source, target))
	if err != nil {
		return fmt.Errorf("open SPZ gzip: %w", err)
	}
	defer func() { _ = decoded.Close() }()
	var header [16]byte
	if _, err := io.ReadFull(decoded, header[:]); err != nil {
		return fmt.Errorf("read SPZ header: %w", err)
	}
	version, points := binary.LittleEndian.Uint32(header[4:]), binary.LittleEndian.Uint32(header[8:])
	if binary.LittleEndian.Uint32(header[:]) != 0x5053474e || version < 1 || version > 3 || points == 0 || points > 10_000_000 ||
		header[12] > 3 || header[13] > 24 || header[14] & ^byte(1) != 0 || header[15] != 0 {
		return fmt.Errorf("SPZ format header is unsupported or invalid")
	}
	positionBytes, rotationBytes := int64(9), int64(3)
	if version == 1 {
		positionBytes = 6
	}
	if version == 3 {
		rotationBytes = 4
	}
	shBytes := [...]int64{0, 9, 24, 45}
	expected := int64(points) * (positionBytes + 1 + 3 + 3 + rotationBytes + shBytes[header[12]])
	written, err := io.Copy(io.Discard, io.LimitReader(decoded, expected+1))
	if err != nil {
		return fmt.Errorf("validate complete SPZ: %w", err)
	}
	if written != expected {
		return fmt.Errorf("SPZ decoded payload length is incomplete or invalid")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r029
// This opener accepts only the captured Job's exact API proxy. Bearer is sent
// once to that origin; the fresh signed destination gets a new uncredentialed
// request and retains Runtime's DNS pinning and streamed custody bound.
func openSpaitialArtifactStream(ctx context.Context, cfg MediaAdapterConfig, providerJobID, kind string) (io.ReadCloser, string, int64, error) {
	if !validSpaitialID(providerJobID) || (kind != "splat" && kind != "panorama") {
		return nil, "", -1, spaitialOutputError("artifact identity invalid")
	}
	origin, err := spaitialControlOrigin(ctx, cfg.BaseURL)
	if err != nil {
		return nil, "", -1, err
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, "", -1, err
	}
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodGet, origin+"/v1/worlds/requests/"+providerJobID+"/"+kind, nil)
	if err != nil {
		return nil, "", -1, err
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	request.Header.Set("Authorization", "Bearer "+apiKey)
	response, err := client.Do(request)
	if err != nil {
		return nil, "", -1, MapProviderRequestError(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusFound {
		return nil, "", -1, spaitialOutputError("artifact proxy did not provide a signed redirect")
	}
	destination, err := url.Parse(response.Header.Get("Location"))
	if err != nil || destination.Scheme != "https" || destination.Host == "" || destination.User != nil || destination.Fragment != "" {
		// The private loopback seam is available only to owner tests, exactly
		// like every other Remote ExecutionHost HTTP boundary.
		if err != nil || destination == nil || !allowLoopbackProviderEndpointFromContext(ctx) || destination.Scheme != "http" || destination.User != nil || destination.Fragment != "" || !(destination.Hostname() == "127.0.0.1" || destination.Hostname() == "localhost" || destination.Hostname() == "::1") {
			return nil, "", -1, spaitialOutputError("signed artifact destination invalid")
		}
	}
	return openBinaryArtifactStream(ctx, strings.TrimSpace(destination.String()))
}

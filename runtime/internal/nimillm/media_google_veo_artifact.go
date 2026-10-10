package nimillm

import (
	"bufio"
	"context"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r050
// The Google API key can only accompany the exact native file-download URL
// returned by Veo. A provider-returned alternate host, port, path or redirect
// cannot receive the credential.
func validGoogleVeoArtifactURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host != "generativelanguage.googleapis.com" ||
		parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "alt=media" ||
		parsed.RawPath != "" || parsed.EscapedPath() != parsed.Path {
		return false
	}
	const prefix = "/v1beta/files/"
	const suffix = ":download"
	if !strings.HasPrefix(parsed.Path, prefix) || !strings.HasSuffix(parsed.Path, suffix) {
		return false
	}
	id := strings.TrimSuffix(strings.TrimPrefix(parsed.Path, prefix), suffix)
	if len(id) == 0 || len(id) > 128 {
		return false
	}
	for _, char := range id {
		if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '-' || char == '_') {
			return false
		}
	}
	return true
}

func openGoogleVeoArtifactStream(ctx context.Context, artifactURL string, rawAPIKey string) (io.ReadCloser, string, int64, error) {
	invalidOutput := func() error {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if !validGoogleVeoArtifactURL(artifactURL) {
		return nil, "", -1, invalidOutput()
	}
	apiKey, err := requireProviderAPIKey(rawAPIKey)
	if err != nil {
		return nil, "", -1, err
	}
	client, request, budget, err := newMediaBodyRequest(ctx, artifactURL, defaultMediaBodyLimits())
	if err != nil {
		return nil, "", -1, err
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	request.Header.Set("x-goog-api-key", apiKey)
	response, err := client.Do(request)
	if err != nil {
		budget.close()
		return nil, "", -1, MapProviderRequestError(err)
	}
	budget.headersComplete(response.ContentLength)
	response.Body = &budgetedMediaBody{ReadCloser: response.Body, budget: budget}
	if response.StatusCode != http.StatusOK {
		_ = response.Body.Close()
		if response.StatusCode >= 300 && response.StatusCode < 400 {
			return nil, "", -1, invalidOutput()
		}
		return nil, "", -1, MapProviderHTTPError(response.StatusCode, nil)
	}
	mediaType, _, parseErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if parseErr != nil || mediaType != "video/mp4" || response.ContentLength > maxStreamedMediaArtifactBytes {
		_ = response.Body.Close()
		return nil, "", -1, invalidOutput()
	}
	buffered := bufio.NewReaderSize(response.Body, 512)
	head, err := buffered.Peek(12)
	if err != nil || string(head[4:8]) != "ftyp" {
		_ = response.Body.Close()
		return nil, "", -1, invalidOutput()
	}
	stream := &boundedMediaArtifactStream{
		ReadCloser: &peekedMediaArtifactStream{Reader: buffered, Closer: response.Body},
		remaining:  maxStreamedMediaArtifactBytes + 1,
	}
	if response.ContentLength == 0 {
		_ = stream.Close()
		return nil, "", -1, invalidOutput()
	}
	return stream, "video/mp4", response.ContentLength, nil
}

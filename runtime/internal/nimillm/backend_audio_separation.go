package nimillm

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
)

// OpenAudioSeparation is the Runtime-private typed transport for the selected
// local separation Host. Its accepting consumer owns the response body.
func (b *Backend) OpenAudioSeparation(ctx context.Context, modelID string, audio io.Reader, mimeType string) (*http.Response, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for name, value := range map[string]string{"model": modelID, "mime_type": mimeType} {
		if err := writer.WriteField(name, value); err != nil {
			return nil, MapProviderRequestError(err)
		}
	}
	_, err := writer.CreateFormFile("file", transcriptionUploadFilename(mimeType))
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	prefixLength := body.Len()
	if err := writer.Close(); err != nil {
		return nil, MapProviderRequestError(err)
	}
	endpoint := b.baseURL + "/nimi/audio/separate"
	// Stream the captured source between the multipart header and trailer.
	// Owned canonical audio may exceed the public inline byte ceiling.
	envelope := body.Bytes()
	requestBody := io.MultiReader(bytes.NewReader(envelope[:prefixLength]), audio, bytes.NewReader(envelope[prefixLength:]))
	request, err := b.newRequest(ctx, http.MethodPost, endpoint, requestBody)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := b.do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer func() { _ = response.Body.Close() }()
		_, mapped := providerHTTPErrorFromResponse(response, endpoint)
		return nil, mapped
	}
	return response, nil
}

package nimillm

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
)

// OpenAudioSeparation is the Runtime-private typed transport for the selected
// local separation Host. Its accepting consumer owns the response body.
func (b *Backend) OpenAudioSeparation(ctx context.Context, modelID string, audio []byte, mimeType string) (*http.Response, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for name, value := range map[string]string{"model": modelID, "mime_type": mimeType} {
		if err := writer.WriteField(name, value); err != nil {
			return nil, MapProviderRequestError(err)
		}
	}
	file, err := writer.CreateFormFile("file", transcriptionUploadFilename(mimeType))
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	if _, err := file.Write(audio); err != nil {
		return nil, MapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return nil, MapProviderRequestError(err)
	}
	endpoint := b.baseURL + "/nimi/audio/separate"
	request, err := b.newRequest(ctx, http.MethodPost, endpoint, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := b.do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		defer response.Body.Close()
		_, mapped := providerHTTPErrorFromResponse(response, endpoint)
		return nil, mapped
	}
	return response, nil
}

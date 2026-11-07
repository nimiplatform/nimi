package nimillm

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// PikaInputUpload is private Job custody. The temporary signed PUT URL and its
// headers are never persisted or exposed to the App, and PUT is never replayed.
type PikaInputUpload struct {
	ContentIndex int    `json:"content_index"`
	URL          string `json:"url"`
	PutComplete  bool   `json:"put_complete"`
}

type pikaUploadRecorderKey struct{}
type pikaPreparedInputsKey struct{}

func WithPikaUploadRecorder(ctx context.Context, record func(PikaInputUpload) error) context.Context {
	return context.WithValue(ctx, pikaUploadRecorderKey{}, record)
}
func WithPikaPreparedInputs(ctx context.Context, uploads []PikaInputUpload) context.Context {
	return context.WithValue(ctx, pikaPreparedInputsKey{}, append([]PikaInputUpload(nil), uploads...))
}

func ValidatePikaInputUpload(upload PikaInputUpload) error {
	if upload.ContentIndex < 0 || len(upload.URL) > 8192 || !validNativeVideoArtifactURL(upload.URL) {
		return pikaOutputInvalid()
	}
	return nil
}

// PreparePikaInputs runs only after the original Job has captured authorized
// bytes. Its Host disables generation dispatch intent for these storage calls
// while retaining the current App authority and Connector outbound guards.
func PreparePikaInputs(ctx context.Context, cfg MediaAdapterConfig) ([]PikaInputUpload, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	references, _ := ctx.Value(cloudVideoMediaKey{}).([]CloudVideoMediaReference)
	if len(references) == 0 {
		return nil, nil
	}
	record, _ := ctx.Value(pikaUploadRecorderKey{}).(func(PikaInputUpload) error)
	if record == nil {
		return nil, fmt.Errorf("Pika input upload has no durable Job owner")
	}
	b, err := nativeMediaBackend(ctx, cfg, "pika")
	if err != nil {
		return nil, err
	}
	defer b.client.CloseIdleConnections()
	uploads := make([]PikaInputUpload, 0, len(references))
	for _, ref := range references {
		response, err := nativeMediaJSONRequest(ctx, b, http.MethodPost, "/v1/media/uploads", map[string]any{"content_type": ref.Reference.MIMEType, "size_bytes": len(ref.Reference.Bytes)})
		if err != nil {
			return uploads, err
		}
		var out struct {
			UploadURL string            `json:"upload_url"`
			URL       string            `json:"url"`
			Method    string            `json:"method"`
			Headers   map[string]string `json:"headers"`
			ExpiresIn int               `json:"expires_in"`
			MaxBytes  int64             `json:"max_bytes"`
		}
		err = DecodeResponseJSON(response, &out)
		_ = response.Body.Close()
		if err != nil {
			return uploads, err
		}
		item := PikaInputUpload{ContentIndex: ref.ContentIndex, URL: out.URL}
		if ValidatePikaInputUpload(item) != nil || !validNativeVideoArtifactURL(out.UploadURL) || out.Method != "" && out.Method != "PUT" || out.ExpiresIn < 1 || out.ExpiresIn > 300 || out.MaxBytes < int64(len(ref.Reference.Bytes)) {
			return uploads, pikaOutputInvalid()
		}
		headers := http.Header{}
		for name, value := range out.Headers {
			switch strings.ToLower(name) {
			case "authorization", "proxy-authorization", "x-api-key", "x-goog-api-key", "api-key", "cookie", "host", "transfer-encoding", "connection":
				return uploads, pikaOutputInvalid()
			}
			headers.Set(name, value)
		}
		length, err := strconv.ParseInt(headers.Get("Content-Length"), 10, 64)
		if err != nil || length != int64(len(ref.Reference.Bytes)) || headers.Get("Content-Type") != ref.Reference.MIMEType {
			return uploads, pikaOutputInvalid()
		}
		// Persist the owned hosted locator before transmitting any source bytes.
		if err := record(item); err != nil {
			return uploads, err
		}
		uploads = append(uploads, item)
		client, request, err := newSecuredHTTPRequest(ctx, http.MethodPut, out.UploadURL, bytes.NewReader(ref.Reference.Bytes))
		if err != nil {
			return uploads, err
		}
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		request.Header = headers
		request.ContentLength = length
		put, err := client.Do(request)
		if err != nil {
			client.CloseIdleConnections()
			return uploads, MapProviderRequestError(err)
		}
		_ = put.Body.Close()
		client.CloseIdleConnections()
		if put.StatusCode < 200 || put.StatusCode >= 300 {
			return uploads, MapProviderHTTPError(put.StatusCode, nil)
		}
		item.PutComplete = true
		uploads[len(uploads)-1] = item
		if err := record(item); err != nil {
			return uploads, err
		}
	}
	return uploads, nil
}

func pikaUnconfirmedInputs(count int) InputCleanupResult {
	return InputCleanupResult{State: "unconfirmed", Unconfirmed: count, ReasonCode: runtimev1.ReasonCode_AI_MEDIA_STORAGE_CLEANUP_UNCONFIRMED}
}

func CleanupPikaInputs(ctx context.Context, cfg MediaAdapterConfig, uploads []PikaInputUpload) InputCleanupResult {
	if len(uploads) == 0 {
		return InputCleanupResult{State: "not_required", ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
	}
	b, err := nativeMediaBackend(ctx, cfg, "pika")
	if err != nil {
		return pikaUnconfirmedInputs(len(uploads))
	}
	defer b.client.CloseIdleConnections()
	result := InputCleanupResult{State: "deleted", ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
	for _, item := range uploads {
		if ValidatePikaInputUpload(item) != nil || !item.PutComplete {
			result.Unconfirmed++
			continue
		}
		// The URL is a private upload receipt, not an arbitrary App URL. The API
		// itself verifies this org owns it; no credential is sent to that URL.
		response, err := sendNativeMediaRequest(ctx, b, http.MethodDelete, "/v1/media/uploads?url="+url.QueryEscape(item.URL), "application/json", nil)
		if err != nil {
			result.Unconfirmed++
			continue
		}
		_ = response.Body.Close()
		switch response.StatusCode {
		case http.StatusNoContent:
			result.Deleted++
		case http.StatusNotFound:
			result.Absent++
		default:
			result.Failed++
		}
	}
	if result.Unconfirmed > 0 {
		result.State = "unconfirmed"
		result.ReasonCode = runtimev1.ReasonCode_AI_MEDIA_STORAGE_CLEANUP_UNCONFIRMED
	} else if result.Failed > 0 {
		result.State = "failed"
		result.ReasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
	}
	return result
}

func pikaCapturedInputError() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID)
}

// Cleanup may observe terminality without requiring a playable output. It
// neither cancels the original job nor changes the Runtime terminal result.
func PikaOriginalTaskTerminal(ctx context.Context, cfg MediaAdapterConfig, receipt *NativeTaskReceipt) (bool, error) {
	if receipt == nil || receipt.Adapter != AdapterPikaTask || ValidateNativeTaskReceipt(receipt) != nil {
		return false, pikaOutputInvalid()
	}
	b, err := nativeMediaBackend(ctx, cfg, "pika")
	if err != nil {
		return false, err
	}
	defer b.client.CloseIdleConnections()
	response, err := nativeMediaJSONRequest(ctx, b, http.MethodGet, ResolveTaskQueryPath(pikaQueryPath, receipt.TaskID), nil)
	if err != nil {
		return false, err
	}
	defer func(cleanup func() error) { _ = cleanup() }(response.Body.Close)
	var out pikaJob
	if err := DecodeResponseJSON(response, &out); err != nil {
		return false, err
	}
	if out.ID != receipt.TaskID || !pikaJobStatus(out.Status) {
		return false, pikaOutputInvalid()
	}
	return out.Status == "completed" || out.Status == "failed" || out.Status == "cancelled", nil
}

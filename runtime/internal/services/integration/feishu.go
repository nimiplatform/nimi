package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"mime"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
	_ "golang.org/x/image/webp"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const feishuAPIBase = "https://open.feishu.cn"
const feishuMediaResourceTemplate = "/open-apis/im/v1/messages/:message_id/resources/:file_key"

// The official SDK must not log tokens, message bodies, signed URLs or files.
type silentFeishuLogger struct{}

func (silentFeishuLogger) Debug(context.Context, ...interface{}) {}
func (silentFeishuLogger) Info(context.Context, ...interface{})  {}
func (silentFeishuLogger) Warn(context.Context, ...interface{})  {}
func (silentFeishuLogger) Error(context.Context, ...interface{}) {}

type boundedFeishuHTTP struct {
	client    *http.Client
	connected atomic.Bool
}

// Only declared endpoint templates and numeric status facts enter diagnostics.
// Never resolve path parameters or log provider bodies, keys or credentials.
func (s *Service) logFeishuAPIResult(req *larkcore.ApiReq, status int, code *int) {
	stage, endpoint := "unclassified", "unclassified"
	switch req.ApiPath {
	case larkcore.TenantAccessTokenInternalUrlPath:
		stage, endpoint = "tenant-token", larkcore.TenantAccessTokenInternalUrlPath
	case "/open-apis/bot/v3/info":
		stage, endpoint = "bot-identity", "/open-apis/bot/v3/info"
	case "/open-apis/im/v1/images":
		stage, endpoint = "image-upload", "/open-apis/im/v1/images"
	case "/open-apis/im/v1/files":
		stage, endpoint = "file-upload", "/open-apis/im/v1/files"
	case feishuMediaResourceTemplate:
		stage, endpoint = "media-download", feishuMediaResourceTemplate
	case "/open-apis/im/v1/messages":
		stage, endpoint = "message-create", "/open-apis/im/v1/messages"
	case "/open-apis/im/v1/messages/:message_id/reply":
		stage, endpoint = "message-reply", "/open-apis/im/v1/messages/:message_id/reply"
	case "/open-apis/im/v1/messages/:message_id":
		stage, endpoint = "message-update", "/open-apis/im/v1/messages/:message_id"
	}
	var numericCode any
	if code != nil {
		numericCode = *code
	}
	s.logger.Info("Feishu API result", "stage", stage, "endpoint_template", endpoint,
		"http_status", status, "provider_code_present", code != nil, "provider_code", numericCode)
}

func (c *boundedFeishuHTTP) Do(req *http.Request) (*http.Response, error) {
	trace := &httptrace.ClientTrace{GotConn: func(httptrace.GotConnInfo) { c.connected.Store(true) }}
	response, err := c.client.Do(req.WithContext(httptrace.WithClientTrace(req.Context(), trace)))
	if err != nil {
		return nil, err
	}
	c.connected.Store(true)
	data, err := boundedRead(response.Body, maxOutput)
	if err != nil {
		return nil, err
	}
	response.Body = io.NopCloser(bytes.NewReader(data))
	return response, nil
}

// @nimi-authority: rule.nimi.runtime.integration.effect-outcome
// No global token cache or automatic business retry. The pinned SDK retries
// only a failed dial with caching disabled, before a business request is sent.
func (s *Service) feishuAPI(ctx context.Context, appID, secret, token string, req *larkcore.ApiReq) ([]byte, effectOutcome, error) {
	client := &boundedFeishuHTTP{client: s.platformClient()}
	config := &larkcore.Config{BaseUrl: feishuAPIBase, AppId: appID, AppSecret: secret, AppType: larkcore.AppTypeSelfBuilt, EnableTokenCache: false, HttpClient: client, Logger: silentFeishuLogger{}, Serializable: &larkcore.DefaultSerialization{}, Source: "nimi-runtime"}
	options := []larkcore.RequestOptionFunc{}
	if token == "" {
		req.SupportedAccessTokenTypes = []larkcore.AccessTokenType{larkcore.AccessTokenTypeNone}
	} else {
		req.SupportedAccessTokenTypes = []larkcore.AccessTokenType{larkcore.AccessTokenTypeTenant}
		options = append(options, larkcore.WithTenantAccessToken(token))
	}
	resp, err := larkcore.Request(ctx, req, config, options...)
	outcome := notDispatched
	if client.connected.Load() {
		outcome = effectUnknown
	}
	if err != nil {
		s.logFeishuAPIResult(req, 0, nil)
		return nil, outcome, adapterError("INTEGRATION_FEISHU_REQUEST_FAILED")
	}
	var envelope struct {
		Code *int `json:"code"`
	}
	decoded := json.Unmarshal(resp.RawBody, &envelope) == nil
	if !decoded {
		envelope.Code = nil
	}
	s.logFeishuAPIResult(req, resp.StatusCode, envelope.Code)
	if !decoded || envelope.Code == nil {
		return nil, effectUnknown, adapterError("INTEGRATION_FEISHU_RESPONSE_INVALID")
	}
	if *envelope.Code != 0 {
		if resp.StatusCode == http.StatusTooManyRequests {
			return nil, providerRejected, adapterError("INTEGRATION_RATE_LIMITED")
		}
		if *envelope.Code == 99991671 || *envelope.Code == 99991664 || *envelope.Code == 99991663 {
			return nil, providerRejected, adapterError("INTEGRATION_CREDENTIAL_EXPIRED")
		}
		return nil, providerRejected, adapterError("INTEGRATION_FEISHU_PROVIDER_REJECTED")
	}
	if resp.StatusCode != http.StatusOK {
		return nil, effectUnknown, adapterError("INTEGRATION_FEISHU_RESPONSE_INVALID")
	}
	return resp.RawBody, providerConfirmed, nil
}
func (s *Service) feishuToken(ctx context.Context, appID, secret string) (string, error) {
	data, _, err := s.feishuAPI(ctx, appID, secret, "", &larkcore.ApiReq{HttpMethod: http.MethodPost, ApiPath: larkcore.TenantAccessTokenInternalUrlPath, Body: map[string]string{"app_id": appID, "app_secret": secret}})
	if err != nil {
		return "", err
	}
	var response struct {
		Token  string `json:"tenant_access_token"`
		Expire int    `json:"expire"`
	}
	if json.Unmarshal(data, &response) != nil || response.Token == "" || len(response.Token) > 4096 || response.Expire <= 0 {
		return "", adapterError("INTEGRATION_FEISHU_IDENTITY_INVALID")
	}
	return response.Token, nil
}

// @nimi-authority: rule.nimi.runtime.integration.native-messaging
func (s *Service) configureFeishu(ctx context.Context, account, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
	if req.Config.Feishu.SetupMode != "manual" || secret == "" {
		return target{}, failure(codes.InvalidArgument, "INTEGRATION_FEISHU_SETUP_REQUIRED")
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	appID := req.Config.Feishu.AppId
	token, err := s.feishuToken(ctx, appID, secret)
	if err != nil {
		return target{}, failure(codes.Unavailable, publicAdapterError(err))
	}
	data, _, err := s.feishuAPI(ctx, appID, secret, token, &larkcore.ApiReq{HttpMethod: http.MethodGet, ApiPath: "/open-apis/bot/v3/info"})
	if err != nil {
		return target{}, failure(codes.Unavailable, publicAdapterError(err))
	}
	var info struct {
		Bot struct {
			OpenID string `json:"open_id"`
			Name   string `json:"app_name"`
		} `json:"bot"`
	}
	if json.Unmarshal(data, &info) != nil || !validExternalIdentifier(info.Bot.OpenID) {
		return target{}, failure(codes.FailedPrecondition, "INTEGRATION_FEISHU_IDENTITY_INVALID")
	}
	label := info.Bot.Name
	if label == "" || len(label) > 256 {
		label = appID
	}
	return target{Account: account, Config: proto.Clone(req.Config).(*runtimev1.IntegrationConnectionConfig), Identity: "feishu:" + appID, Subject: info.Bot.OpenID, Public: &runtimev1.IntegrationTarget{TargetRef: id, IntegrationId: "feishu", DisplayName: req.DisplayName, AccountLabel: label, Kind: "feishu", Available: true, Operations: nativeOperations("feishu")}}, nil
}

func (s *Service) executeFeishu(ctx context.Context, t target, op *runtimev1.IntegrationOperation, input, secret string) (string, effectOutcome, error) {
	if op.Name == "feishu.updates.read" {
		result, err := s.readNativeUpdates(ctx, t, secret, input)
		return result, notDispatched, err
	}
	var params nativeMessageInput
	if json.Unmarshal([]byte(input), &params) != nil {
		return "", notDispatched, adapterError("INTEGRATION_INPUT_INVALID")
	}
	call, ok := ctx.Value(invocationContextKey{}).(*invocation)
	if !ok || call == nil {
		return "", notDispatched, adapterError("INTEGRATION_SCOPE_ENDED")
	}
	var source nativeSource
	var err error
	if op.Name == "feishu.messages.reply" || op.Name == "feishu.media.fetch" {
		id := params.ReplyRef
		if op.Name == "feishu.media.fetch" {
			id = params.MediaRef
		}
		source, err = s.nativeSourceFor(t, id, op.Name == "feishu.media.fetch")
		if err != nil {
			return "", notDispatched, err
		}
		if source.MessageID == "" {
			return "", notDispatched, adapterError("INTEGRATION_SOURCE_INVALID")
		}
	}
	if err := s.admitExternalPhase(call); err != nil {
		return "", notDispatched, err
	}
	token, err := s.feishuToken(ctx, t.Config.Feishu.AppId, secret)
	if err != nil {
		return "", notDispatched, err
	}
	if op.Name == "feishu.media.fetch" {
		result, err := s.fetchFeishuMedia(call, t, secret, token, source, params.RelativePath)
		return result, notDispatched, err
	}
	msgType, content, err := s.feishuContent(call, t, secret, token, params.Body)
	if err != nil {
		return "", phaseOutcome(err), err
	}
	request := &larkcore.ApiReq{HttpMethod: http.MethodPost, ApiPath: "/open-apis/im/v1/messages", Body: map[string]any{"receive_id": params.Conversation.ID, "msg_type": msgType, "content": content}, QueryParams: larkcore.QueryParams{}}
	switch op.Name {
	case "feishu.messages.send":
		idType := "chat_id"
		if params.Conversation.Kind == "user" {
			idType = "open_id"
		}
		request.QueryParams.Set("receive_id_type", idType)
	case "feishu.messages.reply":
		request.ApiPath = "/open-apis/im/v1/messages/:message_id/reply"
		request.PathParams = larkcore.PathParams{"message_id": source.MessageID}
		request.Body = map[string]any{"msg_type": msgType, "content": content}
	case "feishu.messages.update":
		request.ApiPath = "/open-apis/im/v1/messages/:message_id"
		request.PathParams = larkcore.PathParams{"message_id": params.MessageID}
		request.HttpMethod = http.MethodPut
		request.Body = map[string]any{"msg_type": msgType, "content": content}
		if msgType == "interactive" {
			request.HttpMethod = http.MethodPatch
			request.Body = map[string]any{"content": content}
		}
	default:
		return "", notDispatched, adapterError("INTEGRATION_OPERATION_UNSUPPORTED")
	}
	if err := validateFeishuMessageRequest(request, msgType); err != nil {
		return "", notDispatched, err
	}
	if err := s.admitExternalPhase(call); err != nil {
		return "", notDispatched, err
	}
	data, outcome, err := s.feishuAPI(ctx, t.Config.Feishu.AppId, secret, token, request)
	if err != nil {
		return "", outcome, err
	}
	var response struct {
		Data struct {
			MessageID string `json:"message_id"`
		} `json:"data"`
	}
	if json.Unmarshal(data, &response) != nil {
		return "", effectUnknown, adapterError("INTEGRATION_FEISHU_RESPONSE_INVALID")
	}
	messageID := response.Data.MessageID
	if op.Name == "feishu.messages.update" {
		messageID = params.MessageID
	}
	if !validExternalIdentifier(messageID) {
		return "", effectUnknown, adapterError("INTEGRATION_FEISHU_RECEIPT_MISSING")
	}
	confirmation := "message-created"
	if op.Name == "feishu.messages.update" {
		confirmation = "provider-accepted"
	}
	return schemaJSON(map[string]string{"confirmation": confirmation, "messageId": messageID}), providerConfirmed, nil
}

// The pinned official SDK documents create/reply text at 150 KiB and cards
// at 30 KiB; PUT text is 150 KiB and PATCH cards are 30 KiB independently.
// Count the serialized platform request, including UTF-8 and outer escaping.
func validateFeishuMessageRequest(request *larkcore.ApiReq, msgType string) error {
	limit := 150 * 1024
	if msgType == "interactive" {
		limit = 30 * 1024
	}
	data, err := json.Marshal(request.Body)
	if err != nil || len(data) > limit {
		return adapterError("INTEGRATION_FEISHU_MESSAGE_TOO_LARGE")
	}
	return nil
}

func (s *Service) feishuContent(c *invocation, t target, secret, token string, body nativeBody) (string, string, error) {
	switch body.Kind {
	case "text":
		return "text", schemaJSON(map[string]string{"text": body.Text}), nil
	case "card":
		var object map[string]any
		if json.Unmarshal([]byte(body.CardJSON), &object) != nil || object == nil {
			return "", "", adapterError("INTEGRATION_CARD_INVALID")
		}
		return "interactive", body.CardJSON, nil
	case "image", "file":
		source, err := s.captureOutboundAsset(c, body.Asset)
		if err != nil {
			return "", "", err
		}
		defer source.Body.Close()
		// Validate platform limits before the SDK's multipart buffering.
		limit := int64(30 * 1024 * 1024)
		if body.Kind == "image" {
			limit = 10 * 1024 * 1024
		}
		if source.Record.SizeBytes > limit || (body.Kind == "file" && !safeNativeFileName(body.FileName)) {
			return "", "", adapterError("INTEGRATION_MEDIA_INVALID")
		}
		data, err := io.ReadAll(io.LimitReader(source.Body, source.Record.SizeBytes+1))
		if err != nil || int64(len(data)) != source.Record.SizeBytes || mediaDigest(data) != source.Record.SHA256 {
			return "", "", adapterError("INTEGRATION_MEDIA_INTEGRITY_INVALID")
		}
		if body.Kind == "image" && !validFeishuImage(data, source.Record.MediaType) {
			return "", "", adapterError("INTEGRATION_MEDIA_INVALID")
		}
		form := &larkcore.Formdata{}
		endpoint, key := "/open-apis/im/v1/files", "file_key"
		if body.Kind == "image" {
			endpoint, key = "/open-apis/im/v1/images", "image_key"
			form.AddField("image_type", "message")
			form.AddFileWithName("image", "image", bytes.NewReader(data))
		} else {
			form.AddField("file_type", "stream")
			form.AddField("file_name", body.FileName)
			form.AddFileWithName("file", body.FileName, bytes.NewReader(data))
		}
		if err := s.admitExternalPhase(c); err != nil {
			return "", "", err
		}
		resp, outcome, err := s.feishuAPI(c.ctx, t.Config.Feishu.AppId, secret, token, &larkcore.ApiReq{HttpMethod: http.MethodPost, ApiPath: endpoint, Body: form})
		if err != nil {
			return "", "", adapterPhaseError{cause: err, outcome: outcome}
		}
		var uploaded struct {
			Data map[string]string `json:"data"`
		}
		if json.Unmarshal(resp, &uploaded) != nil || !validExternalIdentifier(uploaded.Data[key]) {
			return "", "", adapterPhaseError{cause: adapterError("INTEGRATION_FEISHU_UPLOAD_INVALID"), outcome: effectUnknown}
		}
		return body.Kind, schemaJSON(map[string]string{key: uploaded.Data[key]}), nil
	}
	return "", "", adapterError("INTEGRATION_MESSAGE_KIND_UNSUPPORTED")
}
func safeNativeFileName(name string) bool {
	return name != "" && len(name) <= 255 && name == filepath.Base(name) && !strings.ContainsAny(name, "\\/\x00\r\n") && name != "." && name != ".."
}
func nativeImage(data []byte, declared string) bool {
	detected := http.DetectContentType(data)
	return detected == declared && (detected == "image/png" || detected == "image/jpeg" || detected == "image/webp" || detected == "image/gif")
}
func validFeishuImage(data []byte, declared string) bool {
	if !nativeImage(data, declared) {
		return false
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	limit := 12000
	if format == "gif" {
		limit = 2000
	}
	return err == nil && config.Width > 0 && config.Height > 0 && config.Width <= limit && config.Height <= limit
}

// @nimi-authority: rule.nimi.runtime.integration.media-handoff
func (s *Service) fetchFeishuMedia(c *invocation, t target, secret, token string, source nativeSource, relativePath string) (string, error) {
	var media struct {
		Key  string `json:"key"`
		Type string `json:"type"`
	}
	if json.Unmarshal(source.Media, &media) != nil || !validExternalIdentifier(media.Key) || (media.Type != "image" && media.Type != "file") {
		return "", adapterError("INTEGRATION_MEDIA_INVALID")
	}
	endpoint := feishuAPIBase + "/open-apis/im/v1/messages/" + url.PathEscape(source.MessageID) + "/resources/" + url.PathEscape(media.Key) + "?type=" + media.Type
	headers := http.Header{"Authorization": []string{"Bearer " + token}}
	if err := s.admitExternalPhase(c); err != nil {
		return "", err
	}
	data, responseHeaders, status, _, err := s.platformRequest(c.ctx, http.MethodGet, endpoint, headers, nil, maxMediaBytes)
	var providerCode *int
	// The SDK download contract treats HTTP 200 as file bytes. Only a rejected
	// HTTP response can supply a provider code; file contents never enter logs.
	if err == nil && status != http.StatusOK {
		var rejection struct {
			Code *int `json:"code"`
		}
		if json.Unmarshal(data, &rejection) == nil {
			providerCode = rejection.Code
		}
	}
	s.logFeishuAPIResult(&larkcore.ApiReq{ApiPath: feishuMediaResourceTemplate}, status, providerCode)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK || len(data) == 0 {
		return "", adapterError("INTEGRATION_FEISHU_DOWNLOAD_REJECTED")
	}
	mediaType, _, _ := mime.ParseMediaType(responseHeaders.Get("Content-Type"))
	if media.Type == "image" {
		mediaType = http.DetectContentType(data)
		if !nativeImage(data, mediaType) {
			return "", adapterError("INTEGRATION_MEDIA_INVALID")
		}
	}
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	return s.adoptInboundMedia(c, relativePath, appstorage.VerifiedAssetInput{MediaType: mediaType, SizeBytes: int64(len(data)), SHA256: mediaDigest(data), Body: io.NopCloser(bytes.NewReader(data))}, "transport-and-local-digest")
}

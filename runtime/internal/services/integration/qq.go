package integration

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const qqAPIBase = "https://api.sgroup.qq.com"
const qqTokenURL = "https://bots.qq.com/app/getAppAccessToken"
const qqInlineMediaLimit = 20 * 1024 * 1024

type qqReplyState struct {
	mu   sync.Mutex
	used int
	next uint32
}

func (q *qqReplyState) reserve() (uint32, func(), error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.used >= 5 || q.next >= 65535 {
		return 0, nil, adapterError("INTEGRATION_QQ_CONTEXT_EXHAUSTED")
	}
	q.used++
	q.next++
	var once sync.Once
	return q.next, func() { once.Do(func() { q.mu.Lock(); q.used--; q.mu.Unlock() }) }, nil
}
func qqCurrentContext(source nativeSource) error {
	if source.MessageID == "" || source.QQReplies == nil || source.ExpiresAt.IsZero() || !time.Now().Before(source.ExpiresAt) {
		return adapterError("INTEGRATION_QQ_CONTEXT_EXPIRED")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.integration.native-messaging
// Self-owned Go implementation of the pinned official QQ WS/API v2 protocol.
// Token, gateway session and uploads never become a consumer credential.
func (s *Service) qqToken(ctx context.Context, appID, secret string) (string, error) {
	data, status, _, err := s.platformJSON(ctx, http.MethodPost, qqTokenURL, http.Header{}, map[string]string{"appId": appID, "clientSecret": secret}, maxOutput)
	if err != nil {
		return "", err
	}
	var response struct {
		Token   string          `json:"access_token"`
		Expires json.RawMessage `json:"expires_in"`
	}
	if status != 200 || json.Unmarshal(data, &response) != nil || response.Token == "" || len(response.Token) > 16384 {
		return "", adapterError("INTEGRATION_QQ_AUTH_REJECTED")
	}
	return response.Token, nil
}
func (s *Service) qqAPI(ctx context.Context, token, method, path string, body any) ([]byte, effectOutcome, error) {
	data, status, outcome, err := s.platformJSON(ctx, method, qqAPIBase+path, http.Header{"Authorization": {"QQBot " + token}}, body, maxOutput)
	if err != nil {
		return nil, outcome, err
	}
	if status >= 500 || status >= 300 && status < 400 {
		return nil, effectUnknown, adapterError("INTEGRATION_QQ_RESPONSE_UNCONFIRMED")
	}
	var rejection struct {
		Code *int64 `json:"code"`
	}
	valid := json.Unmarshal(data, &rejection) == nil
	if valid && rejection.Code != nil && *rejection.Code != 0 {
		return nil, providerRejected, adapterError("INTEGRATION_QQ_REQUEST_REJECTED")
	}
	if status < 200 || status >= 300 {
		if status >= 400 && status < 500 {
			return nil, providerRejected, adapterError("INTEGRATION_QQ_REQUEST_REJECTED")
		}
		return nil, effectUnknown, adapterError("INTEGRATION_QQ_RESPONSE_UNCONFIRMED")
	}
	if !valid {
		return nil, effectUnknown, adapterError("INTEGRATION_QQ_RESPONSE_INVALID")
	}
	return data, outcome, nil
}
func qqGatewayURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "wss" || u.User != nil || u.Fragment != "" || u.Port() != "" && u.Port() != "443" {
		return "", adapterError("INTEGRATION_QQ_GATEWAY_INVALID")
	}
	host := strings.ToLower(u.Hostname())
	if host != "qq.com" && !strings.HasSuffix(host, ".qq.com") {
		return "", adapterError("INTEGRATION_QQ_GATEWAY_INVALID")
	}
	return u.String(), nil
}
func (s *Service) qqGateway(ctx context.Context, token string) (string, error) {
	data, _, err := s.qqAPI(ctx, token, http.MethodGet, "/gateway", nil)
	if err != nil {
		return "", err
	}
	var response struct {
		URL string `json:"url"`
	}
	if json.Unmarshal(data, &response) != nil {
		return "", adapterError("INTEGRATION_QQ_GATEWAY_INVALID")
	}
	return qqGatewayURL(response.URL)
}
func (s *Service) configureQQ(ctx context.Context, account, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
	if secret == "" {
		return target{}, failure(codes.InvalidArgument, "INTEGRATION_QQ_SECRET_REQUIRED")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	token, err := s.qqToken(ctx, req.Config.QqOfficial.AppId, secret)
	if err == nil {
		_, err = s.qqGateway(ctx, token)
	}
	if err != nil {
		return target{}, failure(codes.Unavailable, publicAdapterError(err))
	}
	appID := req.Config.QqOfficial.AppId
	return target{Account: account, Subject: appID, Identity: "qq-official:" + appID, Config: proto.Clone(req.Config).(*runtimev1.IntegrationConnectionConfig), Public: &runtimev1.IntegrationTarget{TargetRef: id, IntegrationId: "qq-official", Kind: "qq-official", DisplayName: req.DisplayName, AccountLabel: appID, Available: true, Operations: nativeOperations("qq-official")}}, nil
}
func qqMessagePath(conversation nativeConversation, resource string) (string, error) {
	if !validExternalIdentifier(conversation.ID) {
		return "", adapterError("INTEGRATION_RECIPIENT_INVALID")
	}
	scope := "users"
	if conversation.Kind == "group" {
		scope = "groups"
	} else if conversation.Kind != "c2c" {
		return "", adapterError("INTEGRATION_RECIPIENT_INVALID")
	}
	return "/v2/" + scope + "/" + url.PathEscape(conversation.ID) + "/" + resource, nil
}

// @nimi-authority: rule.nimi.runtime.integration.qq-onebot-protocol
func (s *Service) executeQQ(ctx context.Context, t target, op *runtimev1.IntegrationOperation, input, secret string) (string, effectOutcome, error) {
	if op.Name == "qq-official.updates.read" {
		result, err := s.readNativeUpdates(ctx, t, secret, input)
		return result, notDispatched, err
	}
	c, ok := ctx.Value(invocationContextKey{}).(*invocation)
	if !ok || c == nil {
		return "", notDispatched, adapterError("INTEGRATION_SCOPE_ENDED")
	}
	var params nativeMessageInput
	if json.Unmarshal([]byte(input), &params) != nil {
		return "", notDispatched, adapterError("INTEGRATION_INPUT_INVALID")
	}
	if op.Name == "qq-official.media.fetch" {
		source, err := s.nativeSourceFor(t, params.MediaRef, true)
		if err != nil {
			return "", notDispatched, err
		}
		result, err := s.fetchNativeCDN(c, source, params.RelativePath)
		return result, notDispatched, err
	}
	if op.Name != "qq-official.messages.send" && op.Name != "qq-official.messages.reply" {
		return "", notDispatched, adapterError("INTEGRATION_OPERATION_UNSUPPORTED")
	}
	var contextSource nativeSource
	refID := params.ContextRef
	if op.Name == "qq-official.messages.reply" {
		refID = params.ReplyRef
	}
	if refID != "" {
		var err error
		contextSource, err = s.nativeSourceFor(t, refID, false)
		if err != nil {
			return "", notDispatched, err
		}
		if contextSource.MessageID == "" {
			return "", notDispatched, adapterError("INTEGRATION_SOURCE_INVALID")
		}
		if op.Name == "qq-official.messages.reply" {
			params.Conversation = contextSource.Conversation
		} else if params.Conversation != contextSource.Conversation {
			return "", notDispatched, adapterError("INTEGRATION_SOURCE_INVALID")
		}
	}
	if refID == "" {
		return "", notDispatched, adapterError("INTEGRATION_QQ_CONTEXT_REQUIRED")
	}
	if err := qqCurrentContext(contextSource); err != nil {
		return "", notDispatched, err
	}
	sequence, releaseReply, err := contextSource.QQReplies.reserve()
	if err != nil {
		return "", notDispatched, err
	}
	keepReply := false
	defer func() {
		if !keepReply {
			releaseReply()
		}
	}()
	path, err := qqMessagePath(params.Conversation, "messages")
	if err != nil {
		return "", notDispatched, err
	}
	if err = s.admitExternalPhase(c); err != nil {
		return "", notDispatched, err
	}
	token, err := s.qqToken(ctx, t.Config.QqOfficial.AppId, secret)
	if err != nil {
		return "", notDispatched, err
	}
	body := map[string]any{"msg_type": 0, "content": params.Body.Text, "msg_seq": 1}
	var uploadExpires time.Time
	if refID != "" {
		body["msg_seq"] = sequence
		body["msg_id"] = contextSource.MessageID
	}
	switch params.Body.Kind {
	case "text":
	case "image", "file":
		data, release, e := s.encodedNativeAsset(c, params.Body, qqInlineMediaLimit)
		if e != nil {
			return "", notDispatched, e
		}
		defer release()
		uploadPath, _ := qqMessagePath(params.Conversation, "files")
		fileType := 1
		if params.Body.Kind == "file" {
			fileType = 4
		}
		upload := map[string]any{"file_type": fileType, "file_data": base64.StdEncoding.EncodeToString(data), "srv_send_msg": false}
		if fileType == 4 {
			upload["file_name"] = params.Body.FileName
		}
		if err = s.admitExternalPhase(c); err != nil {
			return "", notDispatched, err
		}
		if err = qqCurrentContext(contextSource); err != nil {
			return "", notDispatched, err
		}
		uploadStarted := time.Now()
		response, outcome, e := s.qqAPI(ctx, token, http.MethodPost, uploadPath, upload)
		if e != nil {
			return "", outcome, e
		}
		var receipt struct {
			UUID string `json:"file_uuid"`
			Info string `json:"file_info"`
			TTL  *int64 `json:"ttl"`
		}
		if json.Unmarshal(response, &receipt) != nil || !validExternalIdentifier(receipt.UUID) || receipt.Info == "" || len(receipt.Info) > 32768 || receipt.TTL == nil || *receipt.TTL < 0 {
			return "", effectUnknown, adapterError("INTEGRATION_QQ_UPLOAD_UNCONFIRMED")
		}
		if *receipt.TTL > 0 && (*receipt.TTL > int64((1<<63-1)/time.Second) || !time.Now().Before(uploadStarted.Add(time.Duration(*receipt.TTL)*time.Second))) {
			return "", notDispatched, adapterError("INTEGRATION_QQ_UPLOAD_EXPIRED")
		}
		if *receipt.TTL > 0 {
			uploadExpires = uploadStarted.Add(time.Duration(*receipt.TTL) * time.Second)
		}
		body["msg_type"] = 7
		body["content"] = " "
		body["media"] = map[string]string{"file_info": receipt.Info}
	default:
		return "", notDispatched, adapterError("INTEGRATION_MESSAGE_KIND_UNSUPPORTED")
	}
	if err = s.admitExternalPhase(c); err != nil {
		return "", notDispatched, err
	}
	if err = qqCurrentContext(contextSource); err != nil {
		return "", notDispatched, err
	}
	if !uploadExpires.IsZero() && !time.Now().Before(uploadExpires) {
		return "", notDispatched, adapterError("INTEGRATION_QQ_UPLOAD_EXPIRED")
	}
	response, outcome, err := s.qqAPI(ctx, token, http.MethodPost, path, body)
	keepReply = outcome != notDispatched && outcome != providerRejected
	if err != nil {
		return "", outcome, err
	}
	var receipt struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(response, &receipt) != nil || !validExternalIdentifier(receipt.ID) {
		return "", effectUnknown, adapterError("INTEGRATION_QQ_RECEIPT_MISSING")
	}
	return schemaJSON(map[string]string{"confirmation": "message-created", "messageId": receipt.ID}), providerConfirmed, nil
}

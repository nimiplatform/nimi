package integration

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const weixinAPIBase = "https://ilinkai.weixin.qq.com"
const weixinCDNBase = "https://novac2c.cdn.weixin.qq.com/c2c"

type verifiedWeixinSetupKey struct{}
type weixinCredential struct {
	Token   string `json:"token"`
	BotID   string `json:"botId"`
	BaseURL string `json:"baseUrl"`
	UserID  string `json:"userId"`
}

// Private immutable capture of the user's exact selected target. No other
// connection or account custody is consulted for QR recognition.
type weixinSetupRefresh struct {
	target     target
	secret     string
	credential weixinCredential
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
func (s *Service) captureWeixinSetupRefresh(ctx context.Context, setup *connectionSetup) error {
	return s.publishSetupChecked(ctx, setup, func(captureCtx context.Context) error {
		if setup.request.TargetRef == "" {
			return nil
		}
		current, err := s.loadTarget(captureCtx, setup.decision.AccountID, setup.request.TargetRef)
		if err != nil {
			return err
		}
		if current.Public.Kind != "weixin" || !proto.Equal(current.Config, setup.request.Config) {
			return failure(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED")
		}
		secret, err := s.captureCredential(current)
		if err != nil {
			return err
		}
		credential, err := parseWeixinCredential(secret)
		if err != nil {
			return err
		}
		if current.Identity != "weixin:"+credential.BotID {
			return adapterError("INTEGRATION_WEIXIN_CREDENTIAL_INVALID")
		}
		setup.weixinRefresh = &weixinSetupRefresh{target: current, secret: secret, credential: credential}
		return nil
	}, func() {})
}

// Called while the existing setup/management commit fence holds s.mu.
func (s *Service) checkWeixinSetupRefresh(ctx context.Context, setup *connectionSetup) error {
	captured := setup.weixinRefresh
	if captured == nil {
		return nil
	}
	current, err := s.loadTarget(ctx, setup.decision.AccountID, setup.request.TargetRef)
	if err != nil {
		return err
	}
	secret, err := s.captureCredential(current)
	if err != nil {
		return err
	}
	if current.CredentialGeneration != captured.target.CredentialGeneration || current.Identity != captured.target.Identity || !proto.Equal(current.Config, captured.target.Config) || !proto.Equal(current.Public, captured.target.Public) || secret != captured.secret {
		return failure(codes.FailedPrecondition, "INTEGRATION_CONFIGURATION_CHANGED")
	}
	return nil
}

func weixinAPIURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || !strings.HasSuffix(u.Hostname(), ".weixin.qq.com") {
		return "", adapterError("INTEGRATION_WEIXIN_ENDPOINT_INVALID")
	}
	return strings.TrimRight(u.String(), "/"), nil
}
func weixinHeaders(token string, post bool) (http.Header, error) {
	headers := http.Header{"iLink-App-Id": {"bot"}, "iLink-App-ClientVersion": {"132105"}}
	if post {
		var random [4]byte
		if _, err := rand.Read(random[:]); err != nil {
			return nil, err
		}
		headers.Set("X-WECHAT-UIN", base64.StdEncoding.EncodeToString([]byte(strconv.FormatUint(uint64(binary.BigEndian.Uint32(random[:])), 10))))
		headers.Set("AuthorizationType", "ilink_bot_token")
		if token != "" {
			headers.Set("Authorization", "Bearer "+token)
		}
	}
	return headers, nil
}
func parseWeixinCredential(raw string) (weixinCredential, error) {
	var credential weixinCredential
	if json.Unmarshal([]byte(raw), &credential) != nil || credential.Token == "" || len(credential.Token) > 4096 || !validExternalIdentifier(credential.BotID) {
		return credential, adapterError("INTEGRATION_WEIXIN_CREDENTIAL_INVALID")
	}
	base, err := weixinAPIURL(credential.BaseURL)
	if err != nil {
		return credential, err
	}
	credential.BaseURL = base
	return credential, nil
}
func (s *Service) weixinAPI(ctx context.Context, credential weixinCredential, endpoint string, input map[string]any) ([]byte, effectOutcome, error) {
	headers, err := weixinHeaders(credential.Token, true)
	if err != nil {
		return nil, notDispatched, adapterError("INTEGRATION_REQUEST_INVALID")
	}
	input["base_info"] = map[string]string{"channel_version": "2.4.9", "bot_agent": "NimiRuntime"}
	data, status, outcome, err := s.platformJSON(ctx, http.MethodPost, credential.BaseURL+"/ilink/bot/"+endpoint, headers, input, maxOutput)
	if err != nil {
		return nil, outcome, err
	}
	var response struct {
		Ret       *int `json:"ret"`
		ErrorCode *int `json:"errcode"`
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil || fields == nil || json.Unmarshal(data, &response) != nil ||
		(fields["ret"] != nil && response.Ret == nil) || (fields["errcode"] != nil && response.ErrorCode == nil) {
		s.logWeixinResponseShape(endpoint, "envelope-invalid", status, data)
		return nil, effectUnknown, adapterError("INTEGRATION_WEIXIN_RESPONSE_INVALID")
	}
	if (response.Ret != nil && *response.Ret != 0) || (response.ErrorCode != nil && *response.ErrorCode != 0) {
		if (response.Ret != nil && *response.Ret == -14) || (response.ErrorCode != nil && *response.ErrorCode == -14) {
			return nil, providerRejected, adapterError("INTEGRATION_CREDENTIAL_EXPIRED")
		}
		if status == http.StatusTooManyRequests {
			return nil, providerRejected, adapterError("INTEGRATION_RATE_LIMITED")
		}
		return nil, providerRejected, adapterError("INTEGRATION_WEIXIN_PROVIDER_REJECTED")
	}
	if status != http.StatusOK {
		s.logWeixinResponseShape(endpoint, "http-status", status, data)
		return nil, effectUnknown, adapterError("INTEGRATION_WEIXIN_RESPONSE_INVALID")
	}
	return data, providerConfirmed, nil
}

// Only fixed field names and type labels enter the existing Runtime logger.
// No provider values, URL, token, context, media key or message body is logged.
func (s *Service) logWeixinResponseShape(endpoint, stage string, httpStatus int, data []byte) {
	var fields map[string]json.RawMessage
	decoded := json.Unmarshal(data, &fields) == nil && fields != nil
	shape := func(key string) string {
		if !decoded {
			return "unavailable"
		}
		value, present := fields[key]
		if !present {
			return "absent"
		}
		value = bytes.TrimSpace(value)
		if len(value) == 0 {
			return "invalid"
		}
		switch value[0] {
		case '"':
			return "string"
		case '{':
			return "object"
		case '[':
			return "array"
		case 'n':
			return "null"
		case 't', 'f':
			return "boolean"
		default:
			return "number"
		}
	}
	s.logger.Info("Weixin response shape", "operation", endpoint, "stage", stage, "http_status", httpStatus,
		"object", decoded, "ret_type", shape("ret"), "errcode_type", shape("errcode"), "message_id_type", shape("message_id"), "msgs_type", shape("msgs"), "cursor_type", shape("get_updates_buf"))
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
// Only fixed classifications and equality flags enter the existing logger.
// A protocol terminal is not admission; comparisons require a selected refresh
// and a validated confirmed candidate. No additional custody is consulted.
func (s *Service) logWeixinSetupTerminal(setup *connectionSetup, candidate *weixinCredential) {
	identityEqual, baseEqual, scannerComparable, scannerEqual := false, false, false, false
	if captured := setup.weixinRefresh; captured != nil && candidate != nil {
		identityEqual = captured.target.Identity == "weixin:"+candidate.BotID
		baseEqual = captured.credential.BaseURL == candidate.BaseURL
		scannerComparable = captured.credential.UserID != "" && candidate.UserID != ""
		scannerEqual = scannerComparable && captured.credential.UserID == candidate.UserID
	}
	s.logger.Info("Weixin setup decision", "stage", "qr-terminal",
		"confirmed", candidate != nil, "already_bound", candidate == nil,
		"selected_refresh", setup.weixinRefresh != nil, "identity_equal", identityEqual,
		"base_equal", baseEqual, "scanner_comparable", scannerComparable, "scanner_matches_capture", scannerEqual)
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
func (s *Service) prepareWeixinSetup(ctx context.Context, setup *connectionSetup, input *runtimev1.PutIntegrationConnectionRequest) (*runtimev1.PutIntegrationConnectionRequest, error) {
	if err := s.captureWeixinSetupRefresh(ctx, setup); err != nil {
		return nil, err
	}
	localTokens := []string{}
	if setup.weixinRefresh != nil {
		localTokens = []string{setup.weixinRefresh.credential.Token}
	}
	headers, err := weixinHeaders("", true)
	if err != nil {
		return nil, err
	}
	requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	// New connections read no custody. Refresh carries only the selected target
	// token; failure never falls back to creating an unrelated bot.
	data, status, _, err := s.platformJSON(requestCtx, http.MethodPost, weixinAPIBase+"/ilink/bot/get_bot_qrcode?bot_type=3", headers, map[string]any{"local_token_list": localTokens}, maxOutput)
	cancel()
	if err != nil {
		return nil, err
	}
	var qr struct {
		Code string `json:"qrcode"`
		URL  string `json:"qrcode_img_content"`
	}
	if status != http.StatusOK || json.Unmarshal(data, &qr) != nil || qr.Code == "" || len(qr.Code) > 4096 || len(qr.URL) > 4096 {
		return nil, adapterError("INTEGRATION_WEIXIN_QR_INVALID")
	}
	u, err := url.Parse(qr.URL)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || u.Port() != "" || !strings.HasSuffix(u.Hostname(), ".weixin.qq.com") {
		return nil, adapterError("INTEGRATION_WEIXIN_QR_INVALID")
	}
	expiry := time.Now().Add(5 * time.Minute)
	checkRefresh := func(checkCtx context.Context) error { return s.checkWeixinSetupRefresh(checkCtx, setup) }
	if err := s.publishSetupChecked(ctx, setup, checkRefresh, func() {
		setup.view.Status = "awaiting-confirmation"
		setup.view.VerificationUrl = qr.URL
		if expiry.Before(setup.view.ExpiresAt.AsTime()) {
			setup.view.ExpiresAt = timestamppb.New(expiry)
		}
	}); err != nil {
		return nil, err
	}
	ctx, cancel = context.WithDeadline(ctx, expiry)
	defer cancel()
	base, redirects := weixinAPIBase, 0
	verification := ""
	for {
		if !time.Now().Before(expiry) {
			return nil, adapterError("INTEGRATION_SETUP_EXPIRED")
		}
		query := url.Values{"qrcode": {qr.Code}}
		if verification != "" {
			query.Set("verify_code", verification)
			verification = ""
		}
		headers, err := weixinHeaders("", false)
		if err != nil {
			return nil, err
		}
		requestCtx, cancel := context.WithTimeout(ctx, 35*time.Second)
		data, status, _, err := s.platformJSON(requestCtx, http.MethodGet, base+"/ilink/bot/get_qrcode_status?"+query.Encode(), headers, nil, maxOutput)
		cancel()
		if err != nil {
			return nil, err
		}
		var response struct {
			Status       string `json:"status"`
			Token        string `json:"bot_token"`
			BotID        string `json:"ilink_bot_id"`
			BaseURL      string `json:"baseurl"`
			UserID       string `json:"ilink_user_id"`
			RedirectHost string `json:"redirect_host"`
		}
		if status != http.StatusOK || json.Unmarshal(data, &response) != nil {
			return nil, adapterError("INTEGRATION_WEIXIN_QR_INVALID")
		}
		switch response.Status {
		case "wait", "scaned":
		case "scaned_but_redirect":
			if redirects >= 3 {
				return nil, adapterError("INTEGRATION_WEIXIN_ENDPOINT_INVALID")
			}
			base, err = weixinAPIURL("https://" + response.RedirectHost)
			if err != nil {
				return nil, err
			}
			redirects++
		case "need_verifycode":
			if err = s.publishSetupChecked(ctx, setup, checkRefresh, func() { setup.view.Status = "awaiting-input" }); err != nil {
				return nil, err
			}
			select {
			case verification = <-setup.codes:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		case "confirmed":
			if response.BaseURL == "" {
				response.BaseURL = base
			}
			credential := weixinCredential{Token: response.Token, BotID: response.BotID, BaseURL: response.BaseURL, UserID: response.UserID}
			input.Secret = schemaJSON(credential)
			if len(input.Secret) > 16384 {
				return nil, adapterError("INTEGRATION_WEIXIN_CREDENTIAL_INVALID")
			}
			candidate, err := parseWeixinCredential(input.Secret)
			if err != nil {
				return nil, err
			}
			s.logWeixinSetupTerminal(setup, &candidate)
			if captured := setup.weixinRefresh; captured != nil && captured.target.Identity != "weixin:"+candidate.BotID {
				if setup.newTargetDecision == nil {
					return nil, failure(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED")
				}
				if err := s.publishSetupChecked(ctx, setup, checkRefresh, func() {
					setup.view.Status = "awaiting-new-target"
					setup.view.AccountLabel = candidate.BotID
					setup.view.QrCodeUrl = ""
					setup.view.VerificationUrl = ""
				}); err != nil {
					return nil, err
				}
				// The verified candidate remains only on this bounded worker.
				// Keep setup.request's original target for every later fence;
				// only the new commit request changes its target and local name.
				select {
				case <-setup.newTargetDecision:
					input.TargetRef = ""
					input.DisplayName = ""
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			}
			return input, nil
		case "expired":
			return nil, adapterError("INTEGRATION_SETUP_EXPIRED")
		case "binded_redirect":
			s.logWeixinSetupTerminal(setup, nil)
			if setup.weixinRefresh == nil {
				return nil, adapterError("INTEGRATION_WEIXIN_NEW_CONFIRMATION_REQUIRED")
			}
			if err = s.publishSetupChecked(ctx, setup, checkRefresh, func() { setup.weixinAlreadyBound = true }); err != nil {
				return nil, err
			}
			return input, nil
		case "verify_code_blocked":
			return nil, adapterError("INTEGRATION_WEIXIN_VERIFICATION_BLOCKED")
		default:
			return nil, adapterError("INTEGRATION_WEIXIN_QR_INVALID")
		}
		if err := waitPlatformPoll(ctx, time.Second); err != nil {
			return nil, err
		}
	}
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
func (s *Service) configureWeixin(ctx context.Context, account, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
	if verified, _ := ctx.Value(verifiedWeixinSetupKey{}).(bool); !verified {
		return target{}, failure(codes.FailedPrecondition, "INTEGRATION_WEIXIN_SETUP_REQUIRED")
	}
	credential, err := parseWeixinCredential(secret)
	if err != nil {
		return target{}, failure(codes.FailedPrecondition, publicAdapterError(err))
	}
	displayName := req.DisplayName
	if strings.TrimSpace(displayName) == "" {
		// The fixed iLink confirmation has no nickname. The verified bot ID is
		// the account identity; neither the scanning user nor a Nimi profile is
		// a substitute for that identity.
		displayName = "WeChat iLink · " + credential.BotID
		if len(displayName) > 256 {
			displayName = credential.BotID
		}
	}
	return target{Account: account, Config: proto.Clone(req.Config).(*runtimev1.IntegrationConnectionConfig), Identity: "weixin:" + credential.BotID, Public: &runtimev1.IntegrationTarget{TargetRef: id, IntegrationId: "weixin", Kind: "weixin", DisplayName: displayName, AccountLabel: credential.BotID, Available: true, Operations: nativeOperations("weixin")}}, nil
}

// @nimi-authority: rule.nimi.runtime.integration.effect-outcome
func (s *Service) executeWeixin(ctx context.Context, t target, op *runtimev1.IntegrationOperation, input, secret string) (string, effectOutcome, error) {
	if op.Name == "weixin.updates.read" {
		result, err := s.readNativeUpdates(ctx, t, secret, input)
		return result, notDispatched, err
	}
	credential, err := parseWeixinCredential(secret)
	if err != nil {
		return "", notDispatched, err
	}
	var params nativeMessageInput
	if json.Unmarshal([]byte(input), &params) != nil {
		return "", notDispatched, adapterError("INTEGRATION_INPUT_INVALID")
	}
	call, ok := ctx.Value(invocationContextKey{}).(*invocation)
	if !ok || call == nil {
		return "", notDispatched, adapterError("INTEGRATION_SCOPE_ENDED")
	}
	reference := params.ContextRef
	if op.Name == "weixin.messages.reply" {
		reference = params.ReplyRef
	}
	if op.Name == "weixin.media.fetch" {
		reference = params.MediaRef
	}
	source, err := s.nativeSourceFor(t, reference, op.Name == "weixin.media.fetch")
	if err != nil {
		return "", notDispatched, err
	}
	if op.Name == "weixin.media.fetch" {
		result, err := s.fetchWeixinMedia(call, source, params.RelativePath)
		return result, notDispatched, err
	}
	if op.Name != "weixin.messages.reply" && op.Name != "weixin.messages.send" {
		return "", notDispatched, adapterError("INTEGRATION_OPERATION_UNSUPPORTED")
	}
	if source.Context == "" || (op.Name == "weixin.messages.send" && source.Conversation != params.Conversation) {
		return "", notDispatched, adapterError("INTEGRATION_WEIXIN_CONTEXT_REQUIRED")
	}
	item, err := s.weixinMessageItem(call, credential, source.Conversation.ID, params.Body)
	if err != nil {
		return "", phaseOutcome(err), err
	}
	if err := s.admitExternalPhase(call); err != nil {
		return "", notDispatched, err
	}
	data, outcome, err := s.weixinAPI(ctx, credential, "sendmessage", map[string]any{"msg": map[string]any{"from_user_id": "", "to_user_id": source.Conversation.ID, "client_id": "nimi_" + ulid.Make().String(), "message_type": 2, "message_state": 2, "context_token": source.Context, "item_list": []any{item}}})
	if err != nil {
		return "", outcome, err
	}
	var response struct {
		Ret *int            `json:"ret"`
		ID  json.RawMessage `json:"message_id"`
	}
	if json.Unmarshal(data, &response) != nil {
		s.logWeixinResponseShape("sendmessage", "send-response-invalid", http.StatusOK, data)
		return "", effectUnknown, adapterError("INTEGRATION_WEIXIN_RESPONSE_INVALID")
	}
	id, confirmation := "", "provider-accepted"
	if response.ID != nil {
		var nativeID json.Number
		if json.Unmarshal(response.ID, &nativeID) != nil {
			s.logWeixinResponseShape("sendmessage", "send-id-invalid", http.StatusOK, data)
			return "", effectUnknown, adapterError("INTEGRATION_WEIXIN_RESPONSE_INVALID")
		}
		id = nativeID.String()
		if value, err := strconv.ParseUint(id, 10, 64); err != nil || value == 0 {
			s.logWeixinResponseShape("sendmessage", "send-id-invalid", http.StatusOK, data)
			return "", effectUnknown, adapterError("INTEGRATION_WEIXIN_RESPONSE_INVALID")
		}
		confirmation = "message-created"
	} else if response.Ret == nil {
		s.logWeixinResponseShape("sendmessage", "send-confirmation-missing", http.StatusOK, data)
		return "", effectUnknown, adapterError("INTEGRATION_WEIXIN_RESPONSE_INVALID")
	}
	// Only an explicit zero ret or a valid native message ID confirms this write.
	// The generated client_id and HTTP success alone never establish acceptance.
	s.logWeixinResponseShape("sendmessage", "send-confirmed", http.StatusOK, data)
	return schemaJSON(map[string]string{"confirmation": confirmation, "messageId": id}), providerConfirmed, nil
}

type weixinMedia struct {
	Parameter   string `json:"encrypt_query_param"`
	Key         string `json:"aes_key"`
	FullURL     string `json:"full_url"`
	EncryptType int    `json:"encrypt_type"`
}
type weixinItem struct {
	Type      int             `json:"type"`
	MessageID string          `json:"msg_id"`
	Reference json.RawMessage `json:"ref_msg"`
	Text      struct {
		Text string `json:"text"`
	} `json:"text_item"`
	Image struct {
		Media weixinMedia `json:"media"`
		Key   string      `json:"aeskey"`
	} `json:"image_item"`
	File struct {
		Media  weixinMedia `json:"media"`
		Name   string      `json:"file_name"`
		Length string      `json:"len"`
	} `json:"file_item"`
	Voice struct {
		Media weixinMedia `json:"media"`
		Text  string      `json:"text"`
		Codec int         `json:"encode_type"`
	} `json:"voice_item"`
	Video struct {
		Media weixinMedia `json:"media"`
	} `json:"video_item"`
}
type weixinMessage struct {
	ID       json.Number  `json:"message_id"`
	Sequence json.Number  `json:"seq"`
	From     string       `json:"from_user_id"`
	To       string       `json:"to_user_id"`
	Group    string       `json:"group_id"`
	Type     int          `json:"message_type"`
	State    int          `json:"message_state"`
	Created  int64        `json:"create_time_ms"`
	Context  string       `json:"context_token"`
	Items    []weixinItem `json:"item_list"`
}

func (s *Service) receiveWeixin(ctx context.Context, t target, secret string, feed *nativeFeed) error {
	credential, err := parseWeixinCredential(secret)
	if err != nil {
		return err
	}
	feed.mu.Lock()
	cursor := feed.upstreamCursor
	feed.mu.Unlock()
	firstResponse := true
	for {
		requestCtx, cancel := context.WithTimeout(ctx, 40*time.Second)
		// The fixed official GetUpdatesResp declares ret and errcode optional.
		// HTTP/envelope checks and any present nonzero code still fail closed.
		data, _, err := s.weixinAPI(requestCtx, credential, "getupdates", map[string]any{"get_updates_buf": cursor})
		cancel()
		if err != nil {
			return err
		}
		if firstResponse {
			s.logWeixinResponseShape("getupdates", "first-read-envelope", http.StatusOK, data)
			firstResponse = false
		}
		var response struct {
			Messages []weixinMessage `json:"msgs"`
			Cursor   string          `json:"get_updates_buf"`
		}
		if json.Unmarshal(data, &response) != nil || len(response.Messages) > 1000 || len(response.Cursor) > nativeEventLimit {
			s.logWeixinResponseShape("getupdates", "updates-invalid", http.StatusOK, data)
			return adapterError("INTEGRATION_WEIXIN_UPDATES_INVALID")
		}
		for _, message := range response.Messages {
			if message.Type != 1 {
				continue
			}
			if err := feed.acceptWeixin(ctx, t, credential, message); err != nil {
				return err
			}
		}
		// Only the next request commits the upstream position. No next poll is
		// made after cancellation or a failed normalized buffer commit.
		cursor = response.Cursor
		feed.mu.Lock()
		feed.upstreamCursor = cursor
		feed.mu.Unlock()
		if err := waitPlatformPoll(ctx, 100*time.Millisecond); err != nil {
			return err
		}
	}
}
func (f *nativeFeed) acceptWeixin(ctx context.Context, t target, credential weixinCredential, message weixinMessage) error {
	if !validExternalIdentifier(message.From) || message.Group != "" || len(message.Context) > 4096 || len(message.Items) > 64 || len(message.Items) == 0 {
		return adapterError("INTEGRATION_WEIXIN_EVENT_INVALID")
	}
	// getupdates is authenticated by this captured bot credential. to_user_id
	// is a protocol recipient ID, not an asserted alias for ilink_bot_id.
	id := message.ID.String()
	if id == "" {
		id = message.Sequence.String()
	}
	if id != "" && !validExternalIdentifier(id) {
		return adapterError("INTEGRATION_WEIXIN_EVENT_INVALID")
	}
	if id == "" {
		id = ulid.Make().String()
	} // local event correlation, never a native message ID
	conversation := nativeConversation{Kind: "private", ID: message.From}
	event := nativeMessage{EventID: "weixin:" + id, Conversation: conversation, MessageID: message.ID.String(), SenderID: message.From, Segments: []map[string]any{}}
	if message.Created > 0 {
		event.PlatformTime = time.UnixMilli(message.Created).UTC().Format(time.RFC3339Nano)
	}
	reply := nativeSource{Conversation: conversation, MessageID: message.ID.String(), Context: message.Context}
	sources := map[int]nativeSource{}
	for _, item := range message.Items {
		if reference, err := weixinReference(item.Reference); err != nil {
			return err
		} else if reference != nil {
			event.References = append(event.References, *reference)
		}
		if item.Type == 1 {
			if utf8.RuneCountInString(item.Text.Text) > 32768 {
				return adapterError("INTEGRATION_EVENT_BOUNDS")
			}
			event.Segments = append(event.Segments, map[string]any{"kind": "text", "text": item.Text.Text})
			continue
		}
		var media weixinMedia
		kind, fileName, key, mediaType := "", "", "", "application/octet-stream"
		size := int64(0)
		switch item.Type {
		case 2:
			media, kind, key = item.Image.Media, "image", item.Image.Key
		case 3:
			media, kind = item.Voice.Media, "audio"
			if item.Voice.Text != "" {
				if utf8.RuneCountInString(item.Voice.Text) > 32768 {
					return adapterError("INTEGRATION_EVENT_BOUNDS")
				}
				event.Segments = append(event.Segments, map[string]any{"kind": "text", "text": item.Voice.Text, "origin": "platform-transcription"})
			}
			if media.Parameter == "" && media.FullURL == "" && item.Voice.Text != "" {
				continue
			}
		case 4:
			media, kind, fileName = item.File.Media, "file", item.File.Name
			if item.File.Length != "" {
				var err error
				size, err = strconv.ParseInt(item.File.Length, 10, 64)
				if err != nil || size < 1 || size > maxMediaBytes {
					return adapterError("INTEGRATION_MEDIA_INVALID")
				}
			}
		case 5:
			media, kind = item.Video.Media, "video"
		default:
			return adapterError("INTEGRATION_WEIXIN_MESSAGE_KIND_UNSUPPORTED")
		}
		if fileName != "" && !safeNativeFileName(fileName) {
			return adapterError("INTEGRATION_MEDIA_INVALID")
		}
		source := reply
		source.MediaKind = kind
		source.FileName = fileName
		source.MediaType = mediaType
		source.SizeBytes = size
		source.Media = json.RawMessage(schemaJSON(map[string]any{"media": media, "hexKey": key, "codec": item.Voice.Codec}))
		if _, _, _, err := weixinMediaAddress(source); err != nil {
			return err
		}
		sources[len(event.Segments)] = source
		event.Segments = append(event.Segments, map[string]any{"kind": kind, "mediaRef": "", "fileName": fileName, "mediaType": mediaType, "sizeBytes": size})
	}
	return f.acceptMessage(ctx, event, sources, reply, event.EventID)
}

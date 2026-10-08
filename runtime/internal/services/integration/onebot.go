package integration

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

func onebotNumericID(raw string) (int64, error) {
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 || strconv.FormatInt(id, 10) != raw {
		return 0, adapterError("INTEGRATION_ONEBOT_IDENTITY_INVALID")
	}
	return id, nil
}
func (s *Service) configureOnebot(ctx context.Context, account, id string, req *runtimev1.PutIntegrationConnectionRequest, secret string) (target, error) {
	if _, err := onebotNumericID(req.Config.OnebotV11.SelfId); err != nil {
		return target{}, failure(codes.InvalidArgument, publicAdapterError(err))
	}
	if secret == "" || len(secret) > 4096 || strings.ContainsAny(secret, "\x00\r\n") {
		return target{}, failure(codes.InvalidArgument, "INTEGRATION_ONEBOT_AUTH_REQUIRED")
	}
	t := target{Account: account, Identity: "onebot-v11:" + req.Config.OnebotV11.SelfId, Subject: req.Config.OnebotV11.SelfId, Config: proto.Clone(req.Config).(*runtimev1.IntegrationConnectionConfig), Public: &runtimev1.IntegrationTarget{TargetRef: id, IntegrationId: "onebot-v11", Kind: "onebot-v11", DisplayName: req.DisplayName, AccountLabel: req.Config.OnebotV11.SelfId, Available: true, Operations: nativeOperations("onebot-v11")}}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	b, release, err := s.acquireOnebot(ctx, t, secret)
	if err != nil {
		return target{}, failure(codes.Unavailable, publicAdapterError(err))
	}
	defer func() { release(); <-b.done }()
	if _, err = b.wait(ctx, false); err != nil {
		return target{}, failure(codes.Unavailable, publicAdapterError(err))
	}
	b.mu.Lock()
	t.OnebotImplementation, t.OnebotVersion = b.implementation, b.version
	t.Public.AccountLabel = b.name + " · " + t.Subject + " · " + b.implementation + " " + b.version
	b.mu.Unlock()
	if len(t.Public.AccountLabel) > 256 {
		t.Public.AccountLabel = t.Subject
	}
	return t, nil
}
func (s *Service) receiveOnebot(ctx context.Context, t target, secret string, f *nativeFeed) error {
	if err := s.admitNativeReception(f); err != nil {
		return err
	}
	b, release, err := s.acquireOnebot(ctx, t, secret)
	if err != nil {
		return err
	}
	defer release()
	b.mu.Lock()
	b.feed = f
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		if b.feed == f {
			b.feed = nil
		}
		b.mu.Unlock()
	}()
	wait, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if _, err = b.wait(wait, true); err != nil {
		return err
	}
	if err = s.admitNativeReception(f); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-b.ctx.Done():
		b.mu.Lock()
		err = b.failure
		b.mu.Unlock()
		if err == nil {
			err = adapterError("INTEGRATION_ONEBOT_DISCONNECTED")
		}
		return err
	}
}
func (s *Service) executeOnebot(ctx context.Context, t target, op *runtimev1.IntegrationOperation, input, secret string) (string, effectOutcome, error) {
	if op.Name == "onebot-v11.updates.read" {
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
	if op.Name == "onebot-v11.media.fetch" {
		source, err := s.nativeSourceFor(t, params.MediaRef, true)
		if err != nil {
			return "", notDispatched, err
		}
		result, err := s.fetchNativeCDN(c, source, params.RelativePath)
		return result, notDispatched, err
	}
	if op.Name != "onebot-v11.messages.send" && op.Name != "onebot-v11.messages.reply" {
		return "", notDispatched, adapterError("INTEGRATION_OPERATION_UNSUPPORTED")
	}
	if params.ContextRef != "" {
		return "", notDispatched, adapterError("INTEGRATION_CONTEXT_UNSUPPORTED")
	}
	segments := []any{}
	if op.Name == "onebot-v11.messages.reply" {
		source, err := s.nativeSourceFor(t, params.ReplyRef, false)
		if err != nil {
			return "", notDispatched, err
		}
		if _, err = strconv.ParseInt(source.MessageID, 10, 32); err != nil {
			return "", notDispatched, adapterError("INTEGRATION_SOURCE_INVALID")
		}
		params.Conversation = source.Conversation
		segments = append(segments, map[string]any{"type": "reply", "data": map[string]string{"id": source.MessageID}})
	}
	id, err := onebotNumericID(params.Conversation.ID)
	if err != nil {
		return "", notDispatched, err
	}
	action, idKey := "send_private_msg", "user_id"
	if params.Conversation.Kind == "group" {
		action, idKey = "send_group_msg", "group_id"
	} else if params.Conversation.Kind != "private" {
		return "", notDispatched, adapterError("INTEGRATION_RECIPIENT_INVALID")
	}
	switch params.Body.Kind {
	case "text":
		segments = append(segments, map[string]any{"type": "text", "data": map[string]string{"text": params.Body.Text}})
	case "image":
		data, release, err := s.encodedNativeAsset(c, params.Body, 4*1024*1024)
		if err != nil {
			return "", notDispatched, err
		}
		defer release()
		segments = append(segments, map[string]any{"type": "image", "data": map[string]string{"file": "base64://" + base64.StdEncoding.EncodeToString(data)}})
	case "file":
		return "", notDispatched, adapterError("INTEGRATION_ONEBOT_FILE_IMPLEMENTATION_REQUIRED")
	default:
		return "", notDispatched, adapterError("INTEGRATION_MESSAGE_KIND_UNSUPPORTED")
	}
	if err = s.admitExternalPhase(c); err != nil {
		return "", notDispatched, err
	}
	b, release, err := s.acquireOnebot(ctx, t, secret)
	if err != nil {
		return "", notDispatched, err
	}
	defer release()
	work, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	peer, err := b.wait(work, false)
	if err != nil {
		return "", notDispatched, err
	}
	reply, outcome, err := peer.call(work, action, map[string]any{idKey: id, "message": segments, "auto_escape": false}, func() error { return s.admitExternalPhase(c) })
	if err != nil {
		return "", outcome, err
	}
	var receipt struct {
		ID json.Number `json:"message_id"`
	}
	if json.Unmarshal(reply.Data, &receipt) != nil {
		return "", effectUnknown, adapterError("INTEGRATION_ONEBOT_RECEIPT_MISSING")
	}
	messageID := receipt.ID.String()
	if _, err = strconv.ParseInt(messageID, 10, 32); err != nil {
		return "", effectUnknown, adapterError("INTEGRATION_ONEBOT_RECEIPT_MISSING")
	}
	return schemaJSON(map[string]string{"confirmation": "message-created", "messageId": messageID}), providerConfirmed, nil
}

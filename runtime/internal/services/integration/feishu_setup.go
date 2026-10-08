package integration

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"time"

	larkregistration "github.com/larksuite/oapi-sdk-go/v3/scene/registration"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const feishuRegistrationURL = "https://accounts.feishu.cn/oauth/v1/app/registration"

type feishuRegistrationBegin struct {
	DeviceCode      string `json:"device_code"`
	VerificationURL string `json:"verification_uri_complete"`
	Interval        int    `json:"interval"`
	Expires         int    `json:"expire_in"`
}

func decodeFeishuRegistrationBegin(data []byte) (feishuRegistrationBegin, *url.URL, error) {
	var begin feishuRegistrationBegin
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &begin) != nil || json.Unmarshal(data, &fields) != nil || fields == nil || begin.DeviceCode == "" || len(begin.DeviceCode) > 4096 {
		return begin, nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_INVALID")
	}
	// The fixed official SDK defines 5s / 600s for omitted or nonpositive
	// timings. Explicit null and other noninteger wire values remain invalid.
	for _, key := range []string{"interval", "expire_in"} {
		if raw, exists := fields[key]; exists && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return begin, nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_INVALID")
		}
	}
	if begin.Interval <= 0 {
		begin.Interval = 5
	}
	if begin.Expires <= 0 {
		begin.Expires = 600
	}
	begin.Interval = min(begin.Interval, 30)
	begin.Expires = min(begin.Expires, 600)
	u, err := url.Parse(begin.VerificationURL)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || u.Port() != "" || !(u.Hostname() == "accounts.feishu.cn" || strings.HasSuffix(u.Hostname(), ".feishu.cn")) {
		return begin, nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_INVALID")
	}
	return begin, u, nil
}

// Diagnose only the fixed begin shape and bounded timings. Neither QR query,
// device code, arbitrary provider fields nor credentials enter the logger.
func (s *Service) logFeishuRegistrationBeginShape(data []byte, begin feishuRegistrationBegin, u *url.URL, valid bool) {
	var fields map[string]json.RawMessage
	decoded := json.Unmarshal(data, &fields) == nil && fields != nil
	shape := func(key string) string {
		if !decoded {
			return "unavailable"
		}
		value, exists := fields[key]
		if !exists {
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
	host := "unverified"
	interval, expires := 0, 0
	if valid && u != nil {
		host, interval, expires = u.Hostname(), begin.Interval, begin.Expires
	}
	s.logger.Info("Feishu registration begin shape", "stage", "begin", "object", decoded, "valid", valid,
		"device_code_type", shape("device_code"), "verification_uri_complete_type", shape("verification_uri_complete"),
		"interval_type", shape("interval"), "expire_in_type", shape("expire_in"),
		"interval_seconds", interval, "expire_in_seconds", expires, "verification_host", host)
}

func (s *Service) feishuRegistration(ctx context.Context, form url.Values) ([]byte, error) {
	requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	data, _, status, _, err := s.platformRequest(requestCtx, http.MethodPost, feishuRegistrationURL, http.Header{"Content-Type": []string{"application/x-www-form-urlencoded"}}, strings.NewReader(form.Encode()), maxOutput)
	if err != nil {
		return nil, err
	}
	// Registration error descriptions and response bodies can carry private
	// state. Record only the HTTP stage and fixed protocol classifications.
	var fields map[string]json.RawMessage
	decoded := json.Unmarshal(data, &fields) == nil && fields != nil
	var protocolError string
	errorState := "unavailable"
	if decoded {
		if value, exists := fields["error"]; !exists {
			errorState = "absent"
		} else if json.Unmarshal(value, &protocolError) != nil || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			errorState = "invalid"
		} else {
			switch protocolError {
			case "", "authorization_pending", "slow_down", "access_denied", "expired_token":
				errorState = protocolError
			default:
				errorState = "unrecognized"
			}
		}
	}
	s.logger.Info("Feishu registration HTTP shape", "stage", form.Get("action"), "http_status", status, "object", decoded, "error_state", errorState)
	if !decoded || errorState == "invalid" {
		return nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_INVALID")
	}
	if status != http.StatusOK {
		// OAuth device polling uses HTTP 400 for typed protocol states. The
		// fixed SDK decodes these bodies; none is a credential confirmation.
		if form.Get("action") == "poll" && status == http.StatusBadRequest {
			switch protocolError {
			case "authorization_pending", "slow_down", "access_denied", "expired_token":
				for _, key := range []string{"client_id", "client_secret"} {
					if raw, exists := fields[key]; exists {
						var credential string
						if json.Unmarshal(raw, &credential) != nil || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || credential != "" {
							return nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_INVALID")
						}
					}
				}
				return data, nil
			}
		}
		return nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_REJECTED")
	}
	return data, nil
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
// Implements the fixed official device-registration protocol with bounded I/O.
// No user scopes, default broad preset, Lark redirect, contacts or workflow APIs.
func (s *Service) prepareFeishuSetup(ctx context.Context, setup *connectionSetup, input *runtimev1.PutIntegrationConnectionRequest) (*runtimev1.PutIntegrationConnectionRequest, error) {
	data, err := s.feishuRegistration(ctx, url.Values{"action": {"begin"}, "archetype": {"PersonalAgent"}, "auth_method": {"client_secret"}, "request_user_info": {"open_id"}})
	if err != nil {
		return nil, err
	}
	begin, u, err := decodeFeishuRegistrationBegin(data)
	s.logFeishuRegistrationBeginShape(data, begin, u, err == nil)
	if err != nil {
		return nil, err
	}
	minimal := false
	addons := larkregistration.AppAddons{
		Preset: &minimal,
		Scopes: larkregistration.AppAddonsScopes{Tenant: []string{"im:message:send_as_bot", "im:message.p2p_msg:readonly", "im:message.group_at_msg:readonly", "im:resource", "im:message:readonly"}},
		Events: larkregistration.AppAddonsEvents{Items: larkregistration.AppAddonsEventItems{Tenant: []string{"im.message.receive_v1"}}},
	}
	// Project the selected SDK registration model into its wire payload. The
	// SDK RegisterApp entry uses an unbounded default HTTP client and automatic
	// Lark fallback, so this owner supplies bounded domestic-only transport.
	encoded, err := json.Marshal(map[string]any{"preset": addons.Preset, "scopes": addons.Scopes, "events": addons.Events})
	if err != nil {
		return nil, err
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err = writer.Write(encoded); err != nil {
		writer.Close()
		return nil, err
	}
	if err = writer.Close(); err != nil {
		return nil, err
	}
	query := u.Query()
	query.Set("from", "sdk")
	query.Set("tp", "sdk")
	query.Set("source", "go-sdk/nimi-runtime")
	query.Set("name", input.DisplayName)
	query.Set("addons", base64.RawURLEncoding.EncodeToString(compressed.Bytes()))
	u.RawQuery = query.Encode()
	expiry := time.Now().Add(time.Duration(begin.Expires) * time.Second)
	if err = s.publishSetup(ctx, setup, func() {
		setup.view.Status = "awaiting-confirmation"
		setup.view.VerificationUrl = u.String()
		if expiry.Before(setup.view.ExpiresAt.AsTime()) {
			setup.view.ExpiresAt = timestamppb.New(expiry)
		}
	}); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithDeadline(ctx, expiry)
	defer cancel()
	interval := time.Duration(begin.Interval) * time.Second
	for {
		if !time.Now().Before(expiry) {
			return nil, adapterError("INTEGRATION_SETUP_EXPIRED")
		}
		if err := waitPlatformPoll(ctx, interval); err != nil {
			return nil, err
		}
		data, err := s.feishuRegistration(ctx, url.Values{"action": {"poll"}, "device_code": {begin.DeviceCode}})
		if err != nil {
			return nil, err
		}
		var response struct {
			ClientID     string `json:"client_id"`
			ClientSecret string `json:"client_secret"`
			Error        string `json:"error"`
			UserInfo     struct {
				Brand string `json:"tenant_brand"`
			} `json:"user_info"`
		}
		if json.Unmarshal(data, &response) != nil {
			return nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_INVALID")
		}
		if response.UserInfo.Brand != "" && response.UserInfo.Brand != "feishu" {
			return nil, adapterError("INTEGRATION_FEISHU_DOMESTIC_REQUIRED")
		}
		switch response.Error {
		case "authorization_pending":
			continue
		case "slow_down":
			interval = min(interval+5*time.Second, 30*time.Second)
			continue
		case "access_denied":
			return nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_DENIED")
		case "expired_token":
			return nil, adapterError("INTEGRATION_SETUP_EXPIRED")
		case "":
			// The fixed official SDK also keeps polling an object without an
			// explicit error or final credentials. The setup deadline still ends it.
			if response.ClientID == "" && response.ClientSecret == "" {
				continue
			}
		default:
			return nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_REJECTED")
		}
		if !validExternalIdentifier(response.ClientID) || response.ClientSecret == "" || len(response.ClientSecret) > 16384 || response.UserInfo.Brand != "feishu" {
			return nil, adapterError("INTEGRATION_FEISHU_REGISTRATION_INVALID")
		}
		input.Config.Feishu.AppId = response.ClientID
		input.Config.Feishu.SetupMode = "manual"
		input.Secret = response.ClientSecret
		return input, nil
	}
}

func waitPlatformPoll(ctx context.Context, interval time.Duration) error {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

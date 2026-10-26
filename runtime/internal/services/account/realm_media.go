package account

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var mediaIdentifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
var mediaHex32 = regexp.MustCompile(`^[a-f0-9]{32}$`)
var mediaHex64 = regexp.MustCompile(`^[a-f0-9]{64}$`)

// @nimi-authority: rule.nimi.sdks.realm-consumer.media-capabilities
func projectRealmMediaUpload(result realmUnaryHTTPResult, request realmUnaryRequestJSON) *runtimev1.InvokeRealmUnaryResponse {
	projected := projectRealmUnaryHTTPResult(result)
	if !projected.GetAccepted() {
		return projected
	}
	invalid := func() *runtimev1.InvokeRealmUnaryResponse {
		return realmUnaryFailure(runtimev1.ReasonCode_REALM_CONTRACT_INVALID, runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_BROKER_CONTRACT_FAILED, "Realm media upload capability is invalid", result.status)
	}
	var response struct {
		ResourceID   string `json:"resourceId"`
		ResourceType string `json:"resourceType"`
		RequestID    string `json:"requestId"`
		UploadURL    string `json:"uploadUrl"`
		Transport    struct {
			Method      string `json:"method"`
			BodyKind    string `json:"bodyKind"`
			ContentType string `json:"contentType"`
		} `json:"transport"`
		ExpiresIn      int    `json:"expiresIn"`
		Status         string `json:"status"`
		DeliveryAccess string `json:"deliveryAccess"`
	}
	decoder := json.NewDecoder(bytes.NewReader(result.body))
	decoder.DisallowUnknownFields()
	var input map[string]any
	if decoder.Decode(&response) != nil || json.Unmarshal(request.Body, &input) != nil {
		return invalid()
	}
	size, sizeOK := input["sizeBytes"].(float64)
	hash, _ := input["hashSha256"].(string)
	if !sizeOK || size <= 0 || size > 2147483647 || size != float64(int64(size)) || !mediaHex64.MatchString(hash) || response.RequestID != input["requestId"] || !mediaIdentifier.MatchString(response.ResourceID) || response.Transport.Method != "PUT" || response.Transport.BodyKind != "BINARY" || response.Transport.ContentType != input["mimeType"] || response.Status != "PENDING" || response.ExpiresIn < 1 || response.ExpiresIn > 3600 {
		return invalid()
	}
	if response.ResourceType != "IMAGE" && response.ResourceType != "VIDEO" && response.ResourceType != "AUDIO" {
		return invalid()
	}
	if response.DeliveryAccess != "PUBLIC" && response.DeliveryAccess != "SIGNED" {
		return invalid()
	}
	destination, err := url.Parse(response.UploadURL)
	if err != nil || destination.Scheme != "https" || destination.User != nil || destination.Port() != "" || destination.Fragment != "" || destination.RawPath != "" {
		return invalid()
	}
	account := strings.TrimSuffix(destination.Hostname(), ".r2.cloudflarestorage.com")
	parts := strings.Split(strings.TrimPrefix(destination.Path, "/"), "/")
	if !strings.HasSuffix(destination.Hostname(), ".r2.cloudflarestorage.com") || !mediaHex32.MatchString(account) || len(parts) != 5 || parts[1] != "staging" || (parts[2] != "preview" && parts[2] != "production") || parts[3] != response.ResourceID || !mediaIdentifier.MatchString(parts[4]) {
		return invalid()
	}
	query := destination.Query()
	expiry, err := strconv.Atoi(query.Get("X-Amz-Expires"))
	issued, dateErr := time.Parse("20060102T150405Z", query.Get("X-Amz-Date"))
	if err != nil || dateErr != nil || expiry != response.ExpiresIn || query.Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" || !mediaHex64.MatchString(query.Get("X-Amz-Signature")) || time.Until(issued.Add(time.Duration(expiry)*time.Second)) > 3630*time.Second || time.Now().After(issued.Add(time.Duration(expiry)*time.Second)) {
		return invalid()
	}
	return projected
}

// Only the two typed Stream playback URL fields can contain a JWT-shaped value.
// User-authored metadata and other fields continue through the credential scanner.
func scanRealmMediaDescriptor(value map[string]any) (bool, bool) {
	id, _ := value["resourceId"].(string)
	version, _ := value["contentVersion"].(string)
	video, ok := value["video"].(map[string]any)
	if !ok || !mediaIdentifier.MatchString(id) || !mediaHex64.MatchString(version) {
		return false, false
	}
	expiry, _ := video["expiresAt"].(string)
	expires, err := time.Parse(time.RFC3339Nano, expiry)
	if err != nil {
		return true, true
	}
	var token string
	for _, pair := range [][2]string{{"hlsUrl", "video.m3u8"}, {"dashUrl", "video.mpd"}} {
		raw, _ := video[pair[0]].(string)
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Port() != "" || (u.Hostname() != "videodelivery.net" && !strings.HasSuffix(u.Hostname(), ".cloudflarestream.com")) {
			return true, true
		}
		parts := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
		if len(parts) != 3 || parts[1] != "manifest" || parts[2] != pair[1] || (token != "" && token != parts[0]) {
			return true, true
		}
		token = parts[0]
	}
	pieces := strings.Split(token, ".")
	if len(pieces) != 3 {
		return true, true
	}
	headerBytes, e1 := base64.RawURLEncoding.DecodeString(pieces[0])
	claimsBytes, e2 := base64.RawURLEncoding.DecodeString(pieces[1])
	var header struct {
		Alg string `json:"alg"`
		Typ string `json:"typ"`
		Kid string `json:"kid"`
	}
	var claims struct {
		Sub string `json:"sub"`
		Kid string `json:"kid"`
		Iat int64  `json:"iat"`
		Nbf int64  `json:"nbf"`
		Exp int64  `json:"exp"`
	}
	decode := func(raw []byte, target any) error {
		d := json.NewDecoder(bytes.NewReader(raw))
		d.DisallowUnknownFields()
		return d.Decode(target)
	}
	if e1 != nil || e2 != nil || decode(headerBytes, &header) != nil || decode(claimsBytes, &claims) != nil || header.Alg != "RS256" || header.Typ != "JWT" || header.Kid != claims.Kid || claims.Kid == "" || !mediaHex32.MatchString(claims.Sub) || claims.Exp-claims.Iat > 300 || claims.Exp <= claims.Iat || claims.Iat > time.Now().Unix()+30 || claims.Exp > time.Now().Unix()+330 || claims.Nbf != claims.Iat-30 || claims.Exp != expires.Unix() {
		return true, true
	}
	clone := make(map[string]any, len(value))
	for key, child := range value {
		clone[key] = child
	}
	videoClone := make(map[string]any, len(video))
	for key, child := range video {
		videoClone[key] = child
	}
	videoClone["hlsUrl"] = ""
	videoClone["dashUrl"] = ""
	clone["video"] = videoClone
	return true, scanRealmBrokerJSONValueWithoutMedia(clone)
}

func scanRealmBrokerJSONValueWithoutMedia(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if _, forbidden := realmBrokerCredentialKeys[normalizeRealmBrokerCredentialKey(key)]; forbidden {
				return true
			}
			if scanRealmBrokerJSONValueWithoutMedia(child) {
				return true
			}
		}
	case []any:
		for _, child := range typed {
			if scanRealmBrokerJSONValueWithoutMedia(child) {
				return true
			}
		}
	case string:
		return realmBrokerCredentialValue(typed)
	}
	return false
}

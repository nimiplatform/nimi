package account

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestMediaUploadCapabilityIsExactAndDoesNotExposeAccountCredentials(t *testing.T) {
	request := realmUnaryRequestJSON{Body: json.RawMessage(`{"requestId":"r1","mimeType":"image/png","sizeBytes":100,"hashSha256":"` + strings.Repeat("a", 64) + `"}`)}
	original := map[string]any{"resourceId": "resource1", "requestId": "r1", "resourceType": "IMAGE", "status": "PENDING", "deliveryAccess": "SIGNED", "expiresIn": 300,
		"transport": map[string]any{"method": "PUT", "bodyKind": "BINARY", "contentType": "image/png"},
		"uploadUrl": "https://" + strings.Repeat("a", 32) + ".r2.cloudflarestorage.com/nimi-media-preview/staging/preview/resource1/intent1?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=" + time.Now().UTC().Format("20060102T150405Z") + "&X-Amz-Expires=300&X-Amz-Signature=" + strings.Repeat("b", 64)}
	check := func(value map[string]any) bool {
		body, _ := json.Marshal(value)
		return projectRealmMediaUpload(realmUnaryHTTPResult{status: 201, header: http.Header{"Content-Type": {"application/json"}}, body: body}, request).GetAccepted()
	}
	if !check(original) {
		t.Fatal("exact upload capability rejected")
	}
	for name, patch := range map[string]func(map[string]any){
		"account token":     func(x map[string]any) { x["accessToken"] = "secret" },
		"identity mismatch": func(x map[string]any) { x["requestId"] = "another" },
		"original writable": func(x map[string]any) {
			x["uploadUrl"] = strings.Replace(x["uploadUrl"].(string), "/staging/preview/", "/originals/preview/", 1)
		},
		"remote destination": func(x map[string]any) {
			x["uploadUrl"] = strings.Replace(x["uploadUrl"].(string), ".r2.cloudflarestorage.com", ".attacker.test", 1)
		},
		"unbounded expiry": func(x map[string]any) { x["expiresIn"] = 7200 },
	} {
		t.Run(name, func(t *testing.T) {
			copy := map[string]any{}
			for key, value := range original {
				copy[key] = value
			}
			patch(copy)
			if check(copy) {
				t.Fatal("unbounded capability admitted")
			}
		})
	}
}

func TestTypedStreamCapabilitiesDoNotDisableAccountCredentialScanning(t *testing.T) {
	now := time.Now().Unix()
	header, _ := json.Marshal(map[string]any{"alg": "RS256", "typ": "JWT", "kid": "key1"})
	claims, _ := json.Marshal(map[string]any{"sub": strings.Repeat("a", 32), "kid": "key1", "iat": now, "nbf": now - 30, "exp": now + 300})
	token := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims) + "." + strings.Repeat("s", 100)
	delivery := map[string]any{"resourceId": "resource1", "contentVersion": strings.Repeat("b", 64), "publicationGeneration": 1, "policyVersion": "v1", "images": []any{}, "previewUrl": nil, "originalUrl": nil, "expiresAt": time.Unix(now+300, 0).UTC().Format(time.RFC3339),
		"video": map[string]any{"hlsUrl": "https://videodelivery.net/" + token + "/manifest/video.m3u8", "dashUrl": "https://videodelivery.net/" + token + "/manifest/video.mpd", "posterUrl": "https://assets-preview.nimi.ai/m/resource1/poster.webp", "expiresAt": time.Unix(now+300, 0).UTC().Format(time.RFC3339)}}
	check := func(value any) error {
		body, _ := json.Marshal(value)
		return scanRealmBrokerResponseBodyForCredentials(body)
	}
	if err := check(map[string]any{"delivery": delivery}); err != nil {
		t.Fatalf("typed playback rejected: %v", err)
	}
	for _, body := range []any{map[string]any{"delivery": delivery, "accessToken": "secret"}, map[string]any{"metadata": delivery}, map[string]any{"caption": token}} {
		if check(body) == nil {
			t.Fatal("credential scanner bypass")
		}
	}
	video := delivery["video"].(map[string]any)
	video["hlsUrl"] = "https://attacker.test/" + token + "/manifest/video.m3u8"
	if check(map[string]any{"delivery": delivery}) == nil {
		t.Fatal("arbitrary token-bearing URL admitted")
	}
}

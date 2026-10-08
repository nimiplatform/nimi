package integration

import (
	"bytes"
	"crypto/aes"
	"crypto/md5"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

func weixinCDNURL(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > nativeEventLimit || u.Scheme != "https" || u.User != nil || u.Fragment != "" || u.Port() != "" || !strings.HasSuffix(u.Hostname(), ".cdn.weixin.qq.com") {
		return "", adapterError("INTEGRATION_WEIXIN_MEDIA_ENDPOINT_INVALID")
	}
	return u.String(), nil
}
func weixinMediaAddress(source nativeSource) (string, []byte, bool, error) {
	var item struct {
		Media  weixinMedia `json:"media"`
		HexKey string      `json:"hexKey"`
	}
	if json.Unmarshal(source.Media, &item) != nil {
		return "", nil, false, adapterError("INTEGRATION_MEDIA_INVALID")
	}
	address := item.Media.FullURL
	if address == "" {
		if item.Media.Parameter == "" || len(item.Media.Parameter) > 8192 {
			return "", nil, false, adapterError("INTEGRATION_MEDIA_INVALID")
		}
		address = weixinCDNBase + "/download?encrypted_query_param=" + url.QueryEscape(item.Media.Parameter)
	}
	address, err := weixinCDNURL(address)
	if err != nil {
		return "", nil, false, err
	}
	var key []byte
	if item.HexKey != "" {
		key, err = hex.DecodeString(item.HexKey)
	} else if item.Media.Key != "" {
		key, err = base64.StdEncoding.DecodeString(item.Media.Key)
		if err == nil && len(key) == 32 {
			key, err = hex.DecodeString(string(key))
		}
	}
	if err != nil || (len(key) != 16 && (len(key) != 0 || source.MediaKind != "image")) {
		return "", nil, false, adapterError("INTEGRATION_WEIXIN_MEDIA_KEY_INVALID")
	}
	return address, key, len(key) != 0, nil
}

// @nimi-authority: rule.nimi.runtime.integration.media-handoff
// ECB is the official transport format; successful padding or an MD5 digest
// does not authenticate plaintext. No caller-visible key or URL is returned.
func weixinEncrypt(plain, key []byte) ([]byte, error) {
	if len(plain) < 1 || len(plain) > maxMediaBytes || len(key) != aes.BlockSize {
		return nil, adapterError("INTEGRATION_MEDIA_INVALID")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	padding := aes.BlockSize - len(plain)%aes.BlockSize
	result := make([]byte, len(plain)+padding)
	copy(result, plain)
	for index := len(plain); index < len(result); index++ {
		result[index] = byte(padding)
	}
	for offset := 0; offset < len(result); offset += aes.BlockSize {
		block.Encrypt(result[offset:offset+aes.BlockSize], result[offset:offset+aes.BlockSize])
	}
	return result, nil
}
func weixinDecrypt(cipher, key []byte) ([]byte, error) {
	if len(cipher) < aes.BlockSize || len(cipher) > maxMediaBytes+aes.BlockSize || len(cipher)%aes.BlockSize != 0 || len(key) != aes.BlockSize {
		return nil, adapterError("INTEGRATION_WEIXIN_CIPHERTEXT_INVALID")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	result := make([]byte, len(cipher))
	for offset := 0; offset < len(cipher); offset += aes.BlockSize {
		block.Decrypt(result[offset:offset+aes.BlockSize], cipher[offset:offset+aes.BlockSize])
	}
	padding := int(result[len(result)-1])
	if padding < 1 || padding > aes.BlockSize {
		return nil, adapterError("INTEGRATION_WEIXIN_PADDING_INVALID")
	}
	valid := 1
	for index := 0; index < padding; index++ {
		valid &= subtle.ConstantTimeByteEq(result[len(result)-1-index], byte(padding))
	}
	if valid != 1 || len(result)-padding < 1 || len(result)-padding > maxMediaBytes {
		return nil, adapterError("INTEGRATION_WEIXIN_PADDING_INVALID")
	}
	return result[:len(result)-padding], nil
}

func (s *Service) fetchWeixinMedia(c *invocation, source nativeSource, relativePath string) (string, error) {
	address, key, encrypted, err := weixinMediaAddress(source)
	if err != nil {
		return "", err
	}
	limit := int64(maxMediaBytes)
	if encrypted {
		limit += aes.BlockSize
	}
	if err := s.admitExternalPhase(c); err != nil {
		return "", err
	}
	data, headers, status, _, err := s.platformRequest(c.ctx, http.MethodGet, address, http.Header{}, nil, limit)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK || len(data) == 0 {
		return "", adapterError("INTEGRATION_WEIXIN_DOWNLOAD_REJECTED")
	}
	integrity := "transport-and-local-digest"
	if encrypted {
		data, err = weixinDecrypt(data, key)
		if err != nil {
			return "", err
		}
		integrity = "decrypted-unverified"
	}
	if source.SizeBytes > 0 && int64(len(data)) != source.SizeBytes {
		return "", adapterError("INTEGRATION_MEDIA_INTEGRITY_INVALID")
	}
	mediaType, _, _ := mime.ParseMediaType(headers.Get("Content-Type"))
	if source.MediaKind == "image" {
		mediaType = http.DetectContentType(data)
		if !nativeImage(data, mediaType) {
			return "", adapterError("INTEGRATION_MEDIA_INVALID")
		}
	} else if encrypted {
		mediaType = "application/octet-stream"
	}
	if source.MediaKind == "audio" {
		var item struct {
			Codec int `json:"codec"`
		}
		_ = json.Unmarshal(source.Media, &item)
		mediaType = map[int]string{1: "audio/L16", 5: "audio/amr", 6: "audio/silk", 7: "audio/mpeg", 8: "audio/ogg"}[item.Codec]
	}
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	return s.adoptInboundMedia(c, relativePath, appstorage.VerifiedAssetInput{MediaType: mediaType, SizeBytes: int64(len(data)), SHA256: mediaDigest(data), Body: io.NopCloser(bytes.NewReader(data))}, integrity)
}

func (s *Service) weixinMessageItem(c *invocation, credential weixinCredential, peer string, body nativeBody) (any, error) {
	if body.Kind == "text" {
		return map[string]any{"type": 1, "text_item": map[string]string{"text": body.Text}}, nil
	}
	if body.Kind != "image" && body.Kind != "file" {
		return nil, adapterError("INTEGRATION_MESSAGE_KIND_UNSUPPORTED")
	}
	if body.Kind == "file" && !safeNativeFileName(body.FileName) {
		return nil, adapterError("INTEGRATION_MEDIA_INVALID")
	}
	source, err := s.captureOutboundAsset(c, body.Asset)
	if err != nil {
		return nil, err
	}
	defer source.Body.Close()
	plain, err := io.ReadAll(io.LimitReader(source.Body, source.Record.SizeBytes+1))
	if err != nil || int64(len(plain)) != source.Record.SizeBytes || mediaDigest(plain) != source.Record.SHA256 {
		return nil, adapterError("INTEGRATION_MEDIA_INTEGRITY_INVALID")
	}
	if body.Kind == "image" && !nativeImage(plain, source.Record.MediaType) {
		return nil, adapterError("INTEGRATION_MEDIA_INVALID")
	}
	var key, fileKey [16]byte
	if _, err = rand.Read(key[:]); err != nil {
		return nil, err
	}
	if _, err = rand.Read(fileKey[:]); err != nil {
		return nil, err
	}
	cipher, err := weixinEncrypt(plain, key[:])
	if err != nil {
		return nil, err
	}
	keyHex, fileKeyHex := hex.EncodeToString(key[:]), hex.EncodeToString(fileKey[:])
	digest := md5.Sum(plain)
	mediaType := 3
	if body.Kind == "image" {
		mediaType = 1
	}
	if err := s.admitExternalPhase(c); err != nil {
		return nil, err
	}
	response, outcome, err := s.weixinAPI(c.ctx, credential, "getuploadurl", map[string]any{"filekey": fileKeyHex, "media_type": mediaType, "to_user_id": peer, "rawsize": len(plain), "rawfilemd5": hex.EncodeToString(digest[:]), "filesize": len(cipher), "no_need_thumb": true, "aeskey": keyHex})
	if err != nil {
		return nil, adapterPhaseError{cause: err, outcome: outcome}
	}
	var upload struct {
		Parameter string `json:"upload_param"`
		URL       string `json:"upload_full_url"`
	}
	if json.Unmarshal(response, &upload) != nil {
		return nil, adapterError("INTEGRATION_WEIXIN_UPLOAD_INVALID")
	}
	endpoint := upload.URL
	if endpoint == "" {
		if upload.Parameter == "" || len(upload.Parameter) > 8192 {
			return nil, adapterError("INTEGRATION_WEIXIN_UPLOAD_INVALID")
		}
		endpoint = weixinCDNBase + "/upload?encrypted_query_param=" + url.QueryEscape(upload.Parameter) + "&filekey=" + url.QueryEscape(fileKeyHex)
	}
	endpoint, err = weixinCDNURL(endpoint)
	if err != nil {
		return nil, err
	}
	if err := s.admitExternalPhase(c); err != nil {
		return nil, err
	}
	_, headers, status, outcome, err := s.platformRequest(c.ctx, http.MethodPost, endpoint, http.Header{"Content-Type": {"application/octet-stream"}}, bytes.NewReader(cipher), maxOutput)
	if err != nil {
		return nil, adapterPhaseError{cause: err, outcome: outcome}
	}
	parameter := headers.Get("x-encrypted-param")
	if status != http.StatusOK || parameter == "" || len(parameter) > 8192 {
		return nil, adapterPhaseError{cause: adapterError("INTEGRATION_WEIXIN_UPLOAD_UNCONFIRMED"), outcome: effectUnknown}
	}
	media := map[string]any{"encrypt_query_param": parameter, "aes_key": base64.StdEncoding.EncodeToString([]byte(keyHex)), "encrypt_type": 1}
	if body.Kind == "image" {
		return map[string]any{"type": 2, "image_item": map[string]any{"media": media, "mid_size": len(cipher)}}, nil
	}
	return map[string]any{"type": 4, "file_item": map[string]any{"media": media, "file_name": body.FileName, "len": strconv.Itoa(len(plain))}}, nil
}

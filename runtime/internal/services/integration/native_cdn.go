package integration

import (
	"bytes"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

// Protocol-supplied QQ attachment URLs remain private and use a closed Tencent
// CDN host boundary. Redirects and local protocol-end file paths are refused.
// @nimi-authority: rule.nimi.runtime.integration.media-handoff
func (s *Service) nativeCDNURL(raw string) (string, error) {
	schemeClass, hostClass := "other", "unparsed"
	reject := func(stage string) (string, error) {
		s.logger.Info("QQ attachment location rejected", "stage", stage, "scheme_class", schemeClass, "host_class", hostClass)
		return "", adapterError("INTEGRATION_MEDIA_LOCATION_UNAVAILABLE")
	}
	if len(raw) > 8192 {
		return reject("bounds")
	}
	// The pinned official DTO resolves protocol-relative attachment URLs to
	// HTTPS. Explicit HTTP is never upgraded, and every guard still follows.
	candidate := strings.TrimSpace(raw)
	if strings.HasPrefix(candidate, "//") {
		schemeClass = "network_path"
		candidate = "https:" + candidate
	}
	if len(candidate) > 8192 {
		return reject("bounds")
	}
	u, err := url.Parse(candidate)
	if err != nil {
		return reject("parse")
	}
	if schemeClass != "network_path" {
		switch u.Scheme {
		case "https", "http":
			schemeClass = u.Scheme
		case "":
			schemeClass = "absent"
		}
	}
	host := strings.ToLower(u.Hostname())
	switch {
	case host == "qpic.cn" || strings.HasSuffix(host, ".qpic.cn"):
		hostClass = "qpic"
	case host == "qq.com" || strings.HasSuffix(host, ".qq.com"):
		hostClass = "qq_com"
	case host == "multimedia.nt.qq.com.cn":
		hostClass = "multimedia_nt_qq_com_cn"
	case host == "":
		hostClass = "absent"
	default:
		hostClass = "other"
	}
	if u.Scheme != "https" {
		return reject("scheme")
	}
	if u.User != nil {
		return reject("userinfo")
	}
	if u.Fragment != "" {
		return reject("fragment")
	}
	if u.Port() != "" && u.Port() != "443" {
		return reject("port")
	}
	if hostClass != "qpic" && hostClass != "qq_com" && hostClass != "multimedia_nt_qq_com_cn" {
		return reject("host")
	}
	return u.String(), nil
}

// @nimi-authority: rule.nimi.runtime.integration.media-handoff
func (s *Service) fetchNativeCDN(c *invocation, source nativeSource, relativePath string) (string, error) {
	endpoint, err := s.nativeCDNURL(source.Context)
	if err != nil {
		return "", err
	}
	if err = s.admitExternalPhase(c); err != nil {
		return "", err
	}
	data, headers, status, _, err := s.platformRequest(c.ctx, http.MethodGet, endpoint, http.Header{}, nil, maxMediaBytes)
	if err != nil {
		return "", err
	}
	if status != 200 || len(data) == 0 {
		return "", adapterError("INTEGRATION_MEDIA_DOWNLOAD_REJECTED")
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
	}
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	return s.adoptInboundMedia(c, relativePath, appstorage.VerifiedAssetInput{MediaType: mediaType, SizeBytes: int64(len(data)), SHA256: mediaDigest(data), Body: io.NopCloser(bytes.NewReader(data))}, "transport-and-local-digest")
}

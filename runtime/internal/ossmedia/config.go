// Package ossmedia owns the bounded OSS input-storage configuration and wire
// transport used by Remote ExecutionHost. It never selects a provider or model.
package ossmedia

import (
	"errors"
	"regexp"
	"strings"
)

type Config struct {
	Region    string `json:"region"`
	Bucket    string `json:"bucket"`
	KeyPrefix string `json:"key_prefix"`
}

type Credentials struct {
	Config          Config `json:"config"`
	AccessKeyID     string `json:"access_key_id"`
	AccessKeySecret string `json:"access_key_secret"`
	SecurityToken   string `json:"security_token,omitempty"`
}

var regionPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,31}$`)
var bucketPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$`)
var prefixSegmentPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`)

// @nimi-authority: rule.nimi.runtime.ai-provider.oss-input-storage
func Validate(value *Credentials) error {
	invalid := errors.New("invalid OSS input-storage configuration or credential")
	if value == nil || !regionPattern.MatchString(value.Config.Region) || !bucketPattern.MatchString(value.Config.Bucket) {
		return invalid
	}
	prefix := value.Config.KeyPrefix
	if len(prefix) < 2 || len(prefix) > 128 || !strings.HasSuffix(prefix, "/") {
		return invalid
	}
	for _, part := range strings.Split(strings.TrimSuffix(prefix, "/"), "/") {
		if !prefixSegmentPattern.MatchString(part) {
			return invalid
		}
	}
	for _, secret := range []string{value.AccessKeyID, value.AccessKeySecret, value.SecurityToken} {
		if len(secret) > 8192 || strings.ContainsFunc(secret, func(r rune) bool { return r < 33 || r > 126 }) {
			return invalid
		}
	}
	if value.AccessKeyID == "" || len(value.AccessKeyID) > 256 || value.AccessKeySecret == "" || len(value.AccessKeySecret) > 1024 {
		return invalid
	}
	return nil
}

func (c Config) Endpoint() string { return "https://oss-" + c.Region + ".aliyuncs.com" }

func (c *Credentials) Clear() {
	if c != nil {
		c.AccessKeyID = ""
		c.AccessKeySecret = ""
		c.SecurityToken = ""
	}
}

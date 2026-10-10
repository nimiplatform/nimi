package productrelease

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type Asset struct {
	Name      string `json:"name"`
	URL       string `json:"url"`
	Size      int64  `json:"size"`
	SHA256    string `json:"sha256"`
	Installer string `json:"installer"`
}
type Compatibility struct {
	MinimumProductVersion string `json:"minimumProductVersion"`
	MinimumOSVersion      string `json:"minimumOsVersion"`
	DataPolicy            string `json:"dataPolicy"`
}
type Release struct {
	Schema         string        `json:"schema"`
	ReleaseID      string        `json:"releaseId"`
	Version        string        `json:"version"`
	Channel        string        `json:"channel"`
	Target         string        `json:"target"`
	PublishedAt    string        `json:"publishedAt"`
	ExpiresAt      string        `json:"expiresAt"`
	SourceRevision string        `json:"sourceRevision"`
	Components     Components    `json:"components"`
	Compatibility  Compatibility `json:"compatibility"`
	Asset          Asset         `json:"asset"`
}

func VerifyRelease(raw json.RawMessage, publicKey string, now time.Time) (Release, error) {
	var release Release
	var envelope Envelope
	key, err := base64.StdEncoding.Strict().DecodeString(publicKey)
	if err != nil || len(key) != 32 {
		return release, fmt.Errorf("UPDATE_TRUST_NOT_CONFIGURED")
	}
	if len(raw) > 128*1024 || decodeClosed(raw, &envelope) != nil {
		return release, fmt.Errorf("UPDATE_METADATA_INVALID")
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(envelope.Payload)
	if err != nil || len(payload) > 64*1024 {
		return release, fmt.Errorf("UPDATE_METADATA_INVALID")
	}
	signature, err := base64.StdEncoding.Strict().DecodeString(envelope.Signature)
	if err != nil || !ed25519.Verify(key, payload, signature) {
		return release, fmt.Errorf("UPDATE_SIGNATURE_INVALID")
	}
	if err := decodeClosed(payload, &release); err != nil {
		return release, err
	}
	probe := Identity{Schema: "nimi-windows-product-identity/v1", ReleaseID: release.ReleaseID, Version: release.Version, Channel: release.Channel, Target: release.Target, SourceRevision: release.SourceRevision, Components: release.Components, Files: map[string]string{"Nimi.exe": release.Asset.SHA256, "NimiProductUpdater.exe": release.Asset.SHA256, "runtime/nimi.exe": release.Components.Runtime.SHA256, "resources/app.asar": release.Components.Desktop.SHA256}}
	if release.Schema != "nimi-product-release/v1" || probe.Validate() != nil {
		return release, fmt.Errorf("UPDATE_COHORT_INVALID")
	}
	published, e1 := time.Parse(time.RFC3339Nano, release.PublishedAt)
	expires, e2 := time.Parse(time.RFC3339Nano, release.ExpiresAt)
	utc := regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$`)
	if e1 != nil || e2 != nil || !utc.MatchString(release.PublishedAt) || !utc.MatchString(release.ExpiresAt) || !expires.After(published) || published.After(now.Add(5*time.Minute)) {
		return release, fmt.Errorf("UPDATE_METADATA_INVALID")
	}
	if !expires.After(now) {
		return release, fmt.Errorf("UPDATE_METADATA_EXPIRED")
	}
	if release.Compatibility.DataPolicy != "owner-approved-forward" || !regexp.MustCompile(`^[0-9]+\.[0-9]+(?:\.[0-9]+)?$`).MatchString(release.Compatibility.MinimumOSVersion) {
		return release, fmt.Errorf("UPDATE_COMPATIBILITY_INVALID")
	}
	name := "Nimi-" + release.Version + "-windows-amd64.exe"
	if order, err := CompareVersions(release.Compatibility.MinimumProductVersion, release.Version); err != nil || order > 0 {
		return release, fmt.Errorf("UPDATE_COMPATIBILITY_INVALID")
	}
	if release.Asset.Installer != "windows-exe" || release.Asset.Name != name || release.Asset.Size < 1 || release.Asset.Size > 4*1024*1024*1024 || release.Asset.URL != "https://github.com/nimiplatform/nimi/releases/download/"+url.PathEscape(release.ReleaseID)+"/"+name {
		return release, fmt.Errorf("UPDATE_ASSET_INVALID")
	}
	return release, nil
}

func CompareVersions(left, right string) (int, error) {
	pattern := regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(beta|rc)\.([1-9][0-9]*))?$`)
	a, b := pattern.FindStringSubmatch(left), pattern.FindStringSubmatch(right)
	if a == nil || b == nil {
		return 0, fmt.Errorf("invalid version")
	}
	for i := 1; i <= 3; i++ {
		x, _ := new(big.Int).SetString(a[i], 10)
		y, _ := new(big.Int).SetString(b[i], 10)
		if n := x.Cmp(y); n != 0 {
			return n, nil
		}
	}
	rank := func(v string) int {
		if v == "beta" {
			return 0
		}
		if v == "rc" {
			return 1
		}
		return 2
	}
	if n := rank(a[4]) - rank(b[4]); n != 0 {
		return n, nil
	}
	if a[4] == "" {
		return 0, nil
	}
	x, _ := new(big.Int).SetString(a[5], 10)
	y, _ := new(big.Int).SetString(b[5], 10)
	return x.Cmp(y), nil
}
func CheckCompatibility(release Release, current, osVersion string) error {
	newer, err := CompareVersions(release.Version, current)
	if err != nil || newer <= 0 {
		return fmt.Errorf("UPDATE_COMPATIBILITY_INVALID")
	}
	minimum, err := CompareVersions(current, release.Compatibility.MinimumProductVersion)
	if err != nil || minimum < 0 {
		return fmt.Errorf("UPDATE_COMPATIBILITY_INVALID")
	}
	left, right := strings.Split(osVersion, "."), strings.Split(release.Compatibility.MinimumOSVersion, ".")
	for i := 0; i < 3; i++ {
		a, b := "0", "0"
		if i < len(left) {
			a = left[i]
		}
		if i < len(right) {
			b = right[i]
		}
		x, ok := new(big.Int).SetString(a, 10)
		y, yes := new(big.Int).SetString(b, 10)
		if !ok || !yes {
			return fmt.Errorf("UPDATE_COMPATIBILITY_INVALID")
		}
		if n := x.Cmp(y); n > 0 {
			return nil
		} else if n < 0 {
			return fmt.Errorf("UPDATE_COMPATIBILITY_INVALID")
		}
	}
	return nil
}

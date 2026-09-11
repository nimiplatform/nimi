package nimiapppackage

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"image/png"
	"net/url"
	"reflect"
	"strings"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/runtime/internal/appaccess"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
	"gopkg.in/yaml.v3"
)

const MaxAppInfoBytes = 1024 * 1024

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042a
type AppInfo struct {
	Format                          string               `json:"format"`
	AppID                           string               `json:"app_id"`
	Version                         string               `json:"version"`
	TargetID                        string               `json:"target_id"`
	DisplayName                     string               `json:"display_name"`
	Summary                         string               `json:"summary"`
	Icon                            AppInfoIcon          `json:"icon"`
	ReadmeMarkdown                  string               `json:"readme_markdown"`
	ReleaseNotesMarkdown            string               `json:"release_notes_markdown"`
	License                         AppInfoLicense       `json:"license"`
	AppAccess                       []string             `json:"app_access"`
	CapabilityContractRefs          []string             `json:"capability_contract_refs"`
	RequiredStandardizedFeatureRefs []string             `json:"required_standardized_feature_refs"`
	StoragePolicy                   AppInfoStoragePolicy `json:"storage_policy"`
	Author                          string               `json:"author"`
	HomepageURL                     string               `json:"homepage_url"`
	SupportURL                      string               `json:"support_url"`
}

type AppInfoIcon struct {
	MediaType  string `json:"media_type"`
	DataBase64 string `json:"data_base64"`
}
type AppInfoLicense struct {
	Identifier string `json:"identifier"`
	Text       string `json:"text"`
}
type AppInfoStorageDisclosure struct {
	PathPattern      string `json:"path_pattern" yaml:"path_pattern"`
	Purpose          string `json:"purpose" yaml:"purpose"`
	ExpectedSizeBand string `json:"expected_size_band" yaml:"expected_size_band"`
}
type AppInfoStoragePolicy struct {
	Kind                string                     `json:"kind" yaml:"kind"`
	OSStorageDisclosure []AppInfoStorageDisclosure `json:"os_storage_disclosure" yaml:"os_storage_disclosure"`
}
type AppInfoExpectation struct {
	SHA256                          string
	DisplayName                     string
	LicenseIdentifier               string
	CapabilityContractRefs          []string
	RequiredStandardizedFeatureRefs []string
	StoragePolicy                   AppInfoStoragePolicy
}

func ParseAppInfo(raw []byte) (AppInfo, error) {
	var info AppInfo
	invalid := func(field string) (AppInfo, error) {
		return AppInfo{}, fmt.Errorf("App info %s: %w", field, ErrInvalidPackage)
	}
	if len(raw) == 0 || len(raw) > MaxAppInfoBytes || !utf8.Valid(raw) || jsonstrict.Decode(raw, &info) != nil {
		return invalid("document")
	}
	if info.Format != "nimi.app-info/v1" || !localAppID.MatchString(info.AppID) || !infoText(info.Version, 200) || !infoText(info.TargetID, 200) {
		return invalid("identity or format")
	}
	if !infoText(info.DisplayName, 120) || !infoText(info.Summary, 280) {
		return invalid("display name or summary")
	}
	if info.Icon.MediaType != "image/png" {
		return invalid("icon media type")
	}
	icon, err := base64.StdEncoding.Strict().DecodeString(info.Icon.DataBase64)
	if err != nil || base64.StdEncoding.EncodeToString(icon) != info.Icon.DataBase64 {
		return invalid("icon encoding")
	}
	if err := ValidateAppIcon(icon); err != nil {
		return AppInfo{}, err
	}
	if (info.ReadmeMarkdown != "" && !infoDocument(info.ReadmeMarkdown, 96*1024)) || (info.ReleaseNotesMarkdown != "" && !infoDocument(info.ReleaseNotesMarkdown, 32*1024)) || !infoDocument(info.License.Text, 128*1024) || !infoText(info.License.Identifier, 200) {
		return invalid("documentation or license")
	}
	if !infoRefs(info.AppAccess) || !infoRefs(info.CapabilityContractRefs) || !infoRefs(info.RequiredStandardizedFeatureRefs) {
		return invalid("requirements declaration")
	}
	if _, _, err := appaccess.ResolveDeclaration(info.AppAccess); err != nil {
		return invalid("App Access declaration")
	}
	switch info.StoragePolicy.Kind {
	case "nimi-mediated-default":
		if info.StoragePolicy.OSStorageDisclosure != nil {
			return invalid("mediated storage disclosure")
		}
	case "app-owned-os-storage":
		if len(info.StoragePolicy.OSStorageDisclosure) == 0 || len(info.StoragePolicy.OSStorageDisclosure) > 40 {
			return invalid("OS storage disclosure")
		}
		for _, item := range info.StoragePolicy.OSStorageDisclosure {
			if !infoText(item.PathPattern, 500) || !infoText(item.Purpose, 500) || !infoText(item.ExpectedSizeBand, 500) {
				return invalid("OS storage item")
			}
		}
	default:
		return invalid("storage kind")
	}
	if (info.Author != "" && !infoText(info.Author, 200)) || !infoURL(info.HomepageURL) || !infoURL(info.SupportURL) {
		return invalid("author or links")
	}
	return info, nil
}

func infoText(value string, max int) bool {
	return utf8.ValidString(value) && value != "" && strings.TrimSpace(value) == value && !strings.ContainsAny(value, "\x00\r\n") && utf8.RuneCountInString(value) <= max
}
func infoDocument(value string, max int) bool {
	return utf8.ValidString(value) && strings.TrimSpace(value) != "" && len(value) <= max && !strings.ContainsRune(value, 0)
}
func infoRefs(refs []string) bool {
	if refs == nil {
		return false
	}
	seen := make(map[string]bool, len(refs))
	for _, ref := range refs {
		if !infoText(ref, 200) || seen[ref] {
			return false
		}
		seen[ref] = true
	}
	return true
}
func infoURL(value string) bool {
	if value == "" {
		return true
	}
	u, err := url.Parse(value)
	return infoText(value, 2048) && err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil
}

func ValidateAppIcon(raw []byte) error {
	invalid := fmt.Errorf("App icon must be a complete, visible, square static PNG (128–1024 px, at most 512 KiB): %w", ErrInvalidPackage)
	if len(raw) < 33 || len(raw) > 512*1024 || !bytes.Equal(raw[:8], []byte("\x89PNG\r\n\x1a\n")) {
		return invalid
	}
	ended := false
	for offset := 8; offset+12 <= len(raw); {
		size := uint64(binary.BigEndian.Uint32(raw[offset:]))
		if size+12 > uint64(len(raw)-offset) {
			return invalid
		}
		kind := string(raw[offset+4 : offset+8])
		if kind == "acTL" {
			return invalid
		}
		offset += int(size) + 12
		if kind == "IEND" {
			ended = size == 0 && offset == len(raw)
			break
		}
	}
	if !ended {
		return invalid
	}
	config, err := png.DecodeConfig(bytes.NewReader(raw))
	if err != nil || config.Width < 128 || config.Width > 1024 || config.Width != config.Height {
		return invalid
	}
	decoded, err := png.Decode(bytes.NewReader(raw))
	if err != nil {
		return invalid
	}
	for y := 0; y < config.Height; y++ {
		for x := 0; x < config.Width; x++ {
			_, _, _, alpha := decoded.At(x, y).RGBA()
			if alpha != 0 {
				return nil
			}
		}
	}
	return invalid
}

func ValidateAppInfoSelection(info AppInfo, raw []byte, expected Expected) error {
	if info.AppID != expected.AppID || info.Version != expected.Version || info.TargetID != expected.TargetID || !equalStrings(info.AppAccess, expected.AppAccess) {
		return fmt.Errorf("App info selection differs: %w", ErrInvalidPackage)
	}
	if approved := expected.AppInfo; approved != nil {
		digest := sha256.Sum256(raw)
		if hex.EncodeToString(digest[:]) != approved.SHA256 || info.DisplayName != approved.DisplayName || info.License.Identifier != approved.LicenseIdentifier || !equalStrings(info.CapabilityContractRefs, approved.CapabilityContractRefs) || !equalStrings(info.RequiredStandardizedFeatureRefs, approved.RequiredStandardizedFeatureRefs) || !reflect.DeepEqual(info.StoragePolicy, approved.StoragePolicy) {
			return fmt.Errorf("App info differs from reviewed target: %w", ErrPackageIntegrity)
		}
	}
	return nil
}

func validateAppInfoDeclaration(info AppInfo, declarationRaw, licenseRaw []byte) error {
	var declaration struct {
		DisplayName                     string               `yaml:"display_name"`
		CapabilityContractRefs          []string             `yaml:"capability_contract_refs"`
		RequiredStandardizedFeatureRefs []string             `yaml:"required_standardized_feature_refs"`
		StoragePolicy                   AppInfoStoragePolicy `yaml:"storage_policy"`
	}
	if yaml.Unmarshal(declarationRaw, &declaration) != nil || declaration.CapabilityContractRefs == nil || declaration.RequiredStandardizedFeatureRefs == nil || declaration.DisplayName != info.DisplayName || !equalStrings(declaration.CapabilityContractRefs, info.CapabilityContractRefs) || !equalStrings(declaration.RequiredStandardizedFeatureRefs, info.RequiredStandardizedFeatureRefs) || !reflect.DeepEqual(declaration.StoragePolicy, info.StoragePolicy) || string(licenseRaw) != info.License.Text {
		return fmt.Errorf("App info differs from packaged declaration or LICENSE: %w", ErrInvalidPackage)
	}
	return nil
}

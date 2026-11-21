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
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/nimiplatform/nimi/runtime/internal/appaccess"
	"github.com/nimiplatform/nimi/runtime/internal/appidentity"
	"github.com/nimiplatform/nimi/runtime/internal/appsafety"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
	"gopkg.in/yaml.v3"
)

const MaxAppInfoBytes = 1024 * 1024

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042a
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-042d
// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-043c
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
	// Optional publisher safety declaration; nil means undeclared. The same v1
	// parser reads documents with and without it.
	SafetyProfile *appsafety.Profile `json:"safety_profile,omitempty"`
	// Optional structured Storefront metadata and static image-digest manifest.
	Storefront *AppInfoStorefront `json:"storefront,omitempty"`
}

type AppInfoStorefrontHighlight struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

type AppInfoStorefrontLocale struct {
	DisplayName          string                       `json:"display_name,omitempty"`
	Summary              string                       `json:"summary,omitempty"`
	Tags                 []string                     `json:"tags,omitempty"`
	Highlights           []AppInfoStorefrontHighlight `json:"highlights,omitempty"`
	IntroductionMarkdown string                       `json:"introduction_markdown,omitempty"`
}

type AppInfoStorefrontImageRef struct {
	MediaType string `json:"media_type"`
	Width     uint32 `json:"width"`
	Height    uint32 `json:"height"`
	Size      uint64 `json:"size"`
	SHA256    string `json:"sha256"`
}

type AppInfoStorefrontCover struct {
	Default AppInfoStorefrontImageRef            `json:"default"`
	Locales map[string]AppInfoStorefrontImageRef `json:"locales,omitempty"`
}

type AppInfoStorefrontGalleryItem struct {
	ID      string                               `json:"id"`
	Kind    string                               `json:"kind"`
	Default AppInfoStorefrontImageRef            `json:"default"`
	Locales map[string]AppInfoStorefrontImageRef `json:"locales,omitempty"`
	Caption map[string]string                    `json:"caption,omitempty"`
}

type AppInfoStorefrontMedia struct {
	Cover   *AppInfoStorefrontCover        `json:"cover,omitempty"`
	Gallery []AppInfoStorefrontGalleryItem `json:"gallery,omitempty"`
}

type AppInfoStorefront struct {
	Category      string                             `json:"category"`
	DefaultLocale string                             `json:"default_locale"`
	Locales       map[string]AppInfoStorefrontLocale `json:"locales,omitempty"`
	Media         *AppInfoStorefrontMedia            `json:"media,omitempty"`
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
	SafetyProfile                   *appsafety.Profile
}

func ParseAppInfo(raw []byte) (AppInfo, error) {
	var info AppInfo
	invalid := func(field string) (AppInfo, error) {
		return AppInfo{}, fmt.Errorf("App info %s: %w", field, ErrInvalidPackage)
	}
	if len(raw) == 0 || len(raw) > MaxAppInfoBytes || !utf8.Valid(raw) || jsonstrict.Decode(raw, &info) != nil {
		return invalid("document")
	}
	if info.Format != "nimi.app-info/v1" || !appidentity.Valid(info.AppID) || !infoText(info.Version, 200) || !infoText(info.TargetID, 200) {
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
	if !infoDocument(info.ReadmeMarkdown, 96*1024) || (info.ReleaseNotesMarkdown != "" && !infoDocument(info.ReleaseNotesMarkdown, 32*1024)) || !infoDocument(info.License.Text, 128*1024) || !infoText(info.License.Identifier, 200) {
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
	if err := appsafety.Validate(info.SafetyProfile); err != nil {
		return invalid(err.Error())
	}
	if err := validateAppInfoStorefront(info.Storefront); err != nil {
		return invalid(err.Error())
	}
	return info, nil
}

var (
	storefrontLocalePattern    = regexp.MustCompile(`^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$`)
	storefrontGalleryIDPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)
	storefrontSHA256Pattern    = regexp.MustCompile(`^[0-9a-f]{64}$`)
	storefrontCategories       = map[string]struct{}{
		"companions-worlds":       {},
		"lifestyle":               {},
		"writing-notes":           {},
		"design-diagrams":         {},
		"audio-music":             {},
		"video-media":             {},
		"research-learning":       {},
		"productivity-automation": {},
		"developer-tools":         {},
	}
)

func validStorefrontLocale(value string) bool {
	return len(value) <= 16 && storefrontLocalePattern.MatchString(value)
}

func validateStorefrontImageRef(ref AppInfoStorefrontImageRef, minW, maxW, minH, maxH uint32) error {
	if ref.MediaType != "image/webp" && ref.MediaType != "image/png" {
		return fmt.Errorf("storefront image media type")
	}
	if ref.Width < minW || ref.Width > maxW || ref.Height < minH || ref.Height > maxH {
		return fmt.Errorf("storefront image dimensions")
	}
	if ref.Size == 0 || ref.Size > 512*1024 || !storefrontSHA256Pattern.MatchString(ref.SHA256) {
		return fmt.Errorf("storefront image size or sha256")
	}
	return nil
}

func validateAppInfoStorefront(sf *AppInfoStorefront) error {
	if sf == nil {
		return nil
	}
	if _, ok := storefrontCategories[sf.Category]; !ok {
		return fmt.Errorf("storefront category")
	}
	if !validStorefrontLocale(sf.DefaultLocale) {
		return fmt.Errorf("storefront default_locale")
	}
	if len(sf.Locales) > 16 {
		return fmt.Errorf("storefront locales count")
	}
	for locale, entry := range sf.Locales {
		if !validStorefrontLocale(locale) {
			return fmt.Errorf("storefront locale key")
		}
		if locale == sf.DefaultLocale {
			if entry.DisplayName != "" || entry.Summary != "" || entry.IntroductionMarkdown != "" {
				return fmt.Errorf("storefront default locale duplicates top-level fields")
			}
		} else {
			if entry.DisplayName != "" && !infoText(entry.DisplayName, 120) {
				return fmt.Errorf("storefront localized display_name")
			}
			if entry.Summary != "" && !infoText(entry.Summary, 280) {
				return fmt.Errorf("storefront localized summary")
			}
			if entry.IntroductionMarkdown != "" && !infoDocument(entry.IntroductionMarkdown, 96*1024) {
				return fmt.Errorf("storefront localized introduction_markdown")
			}
		}
		if len(entry.Tags) > 5 {
			return fmt.Errorf("storefront tags count")
		}
		seenTags := make(map[string]struct{}, len(entry.Tags))
		for _, tag := range entry.Tags {
			if !infoText(tag, 32) {
				return fmt.Errorf("storefront tag")
			}
			if _, dup := seenTags[tag]; dup {
				return fmt.Errorf("storefront duplicate tag")
			}
			seenTags[tag] = struct{}{}
		}
		if len(entry.Highlights) > 4 {
			return fmt.Errorf("storefront highlights count")
		}
		for _, h := range entry.Highlights {
			if !infoText(h.Title, 60) || !infoText(h.Description, 200) {
				return fmt.Errorf("storefront highlight")
			}
		}
	}
	if sf.Media != nil {
		if sf.Media.Cover == nil && len(sf.Media.Gallery) == 0 {
			return fmt.Errorf("storefront media empty")
		}
		if sf.Media.Cover != nil {
			if err := validateStorefrontImageRef(sf.Media.Cover.Default, 800, 2560, 450, 1600); err != nil {
				return err
			}
			if len(sf.Media.Cover.Locales) > 15 {
				return fmt.Errorf("storefront cover locales count")
			}
			for locale, ref := range sf.Media.Cover.Locales {
				if !validStorefrontLocale(locale) || locale == sf.DefaultLocale {
					return fmt.Errorf("storefront cover locale")
				}
				if err := validateStorefrontImageRef(ref, 800, 2560, 450, 1600); err != nil {
					return err
				}
			}
		}
		if len(sf.Media.Gallery) > 6 {
			return fmt.Errorf("storefront gallery count")
		}
		seenIDs := make(map[string]struct{}, len(sf.Media.Gallery))
		for _, item := range sf.Media.Gallery {
			if !storefrontGalleryIDPattern.MatchString(item.ID) || item.Kind != "image" {
				return fmt.Errorf("storefront gallery item")
			}
			if _, dup := seenIDs[item.ID]; dup {
				return fmt.Errorf("storefront duplicate gallery id")
			}
			seenIDs[item.ID] = struct{}{}
			if err := validateStorefrontImageRef(item.Default, 640, 2560, 360, 1600); err != nil {
				return err
			}
			if len(item.Locales) > 15 {
				return fmt.Errorf("storefront gallery locales count")
			}
			for locale, ref := range item.Locales {
				if !validStorefrontLocale(locale) || locale == sf.DefaultLocale {
					return fmt.Errorf("storefront gallery locale")
				}
				if err := validateStorefrontImageRef(ref, 640, 2560, 360, 1600); err != nil {
					return err
				}
			}
			if len(item.Caption) > 16 {
				return fmt.Errorf("storefront gallery caption count")
			}
			for locale, text := range item.Caption {
				if !validStorefrontLocale(locale) || !infoText(text, 200) {
					return fmt.Errorf("storefront gallery caption")
				}
			}
		}
	}
	return nil
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
		if hex.EncodeToString(digest[:]) != approved.SHA256 || info.DisplayName != approved.DisplayName || info.License.Identifier != approved.LicenseIdentifier || !equalStrings(info.CapabilityContractRefs, approved.CapabilityContractRefs) || !equalStrings(info.RequiredStandardizedFeatureRefs, approved.RequiredStandardizedFeatureRefs) || !reflect.DeepEqual(info.StoragePolicy, approved.StoragePolicy) || !appsafety.Equal(info.SafetyProfile, approved.SafetyProfile) {
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
		SafetyProfile                   *appsafety.Profile   `yaml:"safety_profile"`
	}
	if yaml.Unmarshal(declarationRaw, &declaration) != nil || declaration.CapabilityContractRefs == nil || declaration.RequiredStandardizedFeatureRefs == nil || declaration.DisplayName != info.DisplayName || !equalStrings(declaration.CapabilityContractRefs, info.CapabilityContractRefs) || !equalStrings(declaration.RequiredStandardizedFeatureRefs, info.RequiredStandardizedFeatureRefs) || !reflect.DeepEqual(declaration.StoragePolicy, info.StoragePolicy) || !appsafety.Equal(declaration.SafetyProfile, info.SafetyProfile) || string(licenseRaw) != info.License.Text {
		return fmt.Errorf("App info differs from packaged declaration or LICENSE: %w", ErrInvalidPackage)
	}
	return nil
}

package productrelease

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const IdentityFile = "nimi-product-identity.json"
const MaxIdentityBytes = 128 * 1024

type Envelope struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}
type Component struct {
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
}
type Components struct {
	Desktop Component `json:"desktop"`
	Runtime Component `json:"runtime"`
	Avatar  Component `json:"avatar"`
}
type Identity struct {
	Schema         string            `json:"schema"`
	ReleaseID      string            `json:"releaseId"`
	Version        string            `json:"version"`
	Channel        string            `json:"channel"`
	Target         string            `json:"target"`
	SourceRevision string            `json:"sourceRevision"`
	Components     Components        `json:"components"`
	Files          map[string]string `json:"files"`
}

func decodeClosed(raw []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("decode admission: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("admission trailing content")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.service-operations.r054
func VerifyIdentity(raw []byte, publicKey string) (Identity, error) {
	var identity Identity
	var envelope Envelope
	key, err := base64.StdEncoding.Strict().DecodeString(publicKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return identity, fmt.Errorf("product trust not configured")
	}
	if len(raw) > MaxIdentityBytes || decodeClosed(raw, &envelope) != nil {
		return identity, fmt.Errorf("invalid identity envelope")
	}
	payload, err := base64.StdEncoding.Strict().DecodeString(envelope.Payload)
	if err != nil || len(payload) > 64*1024 {
		return identity, fmt.Errorf("invalid identity payload")
	}
	signature, err := base64.StdEncoding.Strict().DecodeString(envelope.Signature)
	if err != nil || !ed25519.Verify(key, payload, signature) {
		return identity, fmt.Errorf("invalid publisher signature")
	}
	if err := decodeClosed(payload, &identity); err != nil {
		return identity, err
	}
	if err := identity.Validate(); err != nil {
		return Identity{}, err
	}
	return identity, nil
}

func (identity Identity) Validate() error {
	version := regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(beta|rc)\.([1-9][0-9]*))?$`)
	sha := regexp.MustCompile(`^[a-f0-9]{64}$`)
	if identity.Schema != "nimi-windows-product-identity/v1" || identity.Target != "windows-amd64" || identity.Channel != "beta" || !version.MatchString(identity.Version) || identity.ReleaseID != "nimi/v"+identity.Version || !regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(identity.SourceRevision) || len(identity.Files) > 8192 {
		return fmt.Errorf("invalid product identity")
	}
	for _, component := range []Component{identity.Components.Desktop, identity.Components.Runtime, identity.Components.Avatar} {
		if !version.MatchString(component.Version) || !sha.MatchString(component.SHA256) {
			return fmt.Errorf("invalid product cohort")
		}
	}
	seen := make(map[string]bool)
	for name, digest := range identity.Files {
		if !ValidRelativeFile(name) || !sha.MatchString(digest) || seen[strings.ToLower(name)] {
			return fmt.Errorf("invalid product inventory")
		}
		seen[strings.ToLower(name)] = true
	}
	for _, name := range []string{"Nimi.exe", "runtime/nimi.exe", "NimiProductUpdater.exe", "resources/app.asar"} {
		if !sha.MatchString(identity.Files[name]) {
			return fmt.Errorf("required product role missing")
		}
	}
	if identity.Files["runtime/nimi.exe"] != identity.Components.Runtime.SHA256 || identity.Files["resources/app.asar"] != identity.Components.Desktop.SHA256 {
		return fmt.Errorf("cohort inventory mismatch")
	}
	return nil
}

func ValidRelativeFile(name string) bool {
	if name == "" || len(name) > 240 || strings.ContainsAny(name, `\:<>"|?*`) || strings.HasPrefix(name, "/") {
		return false
	}
	device := regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)`)
	for _, part := range strings.Split(name, "/") {
		if part == "" || part == "." || part == ".." || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") || device.MatchString(part) {
			return false
		}
		for _, c := range part {
			if c < 32 {
				return false
			}
		}
	}
	return true
}

func FileSHA256(file string) (string, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", fmt.Errorf("open inventory file: %w", err)
	}
	// This handle is read-only; the hash result depends on the read outcome.
	defer func() { _ = f.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("hash inventory file: %w", err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func VerifyInventory(root string, identity Identity) error {
	if err := identity.Validate(); err != nil {
		return err
	}
	seen := make(map[string]bool)
	err := filepath.WalkDir(root, func(file string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in product")
		}
		if entry.IsDir() {
			return nil
		}
		name, err := filepath.Rel(root, file)
		if err != nil {
			return err
		}
		name = filepath.ToSlash(name)
		if name == IdentityFile {
			return nil
		}
		if !entry.Type().IsRegular() || identity.Files[name] == "" {
			return fmt.Errorf("unadmitted product file")
		}
		digest, err := FileSHA256(file)
		if err != nil {
			return err
		}
		if digest != identity.Files[name] {
			return fmt.Errorf("product byte mismatch")
		}
		seen[name] = true
		return nil
	})
	if err != nil {
		return fmt.Errorf("verify product inventory: %w", err)
	}
	if len(seen) != len(identity.Files) {
		return fmt.Errorf("incomplete product inventory")
	}
	return nil
}

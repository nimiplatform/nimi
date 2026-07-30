package runtimeagent

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"path"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	maxPresentationAvatarAssetBytes     = 64 << 20
	maxPresentationBackgroundAssetBytes = 16 << 20
	maxPresentationLive2DExpandedBytes  = 128 << 20
	maxPresentationLive2DEntries        = 512
)

type validatedPresentationAsset struct {
	ref         string
	role        runtimev1.AgentPresentationAssetRole
	backendKind runtimev1.AgentPresentationBackendKind
	fileName    string
	mediaType   string
	sha256      string
	content     []byte
	kind        string
}

type presentationAssetRecord struct {
	Ref           string
	LocalAgentRef string
	Role          runtimev1.AgentPresentationAssetRole
	BackendKind   runtimev1.AgentPresentationBackendKind
	FileName      string
	MediaType     string
	SHA256        string
	Content       []byte
}

func presentationValidationError(reason runtimev1.ReasonCode, category, role, mediaType, backendKind, message, actionHint string) error {
	metadata := map[string]string{"validation_category": category}
	if role != "" {
		metadata["asset_role"] = role
	}
	if mediaType != "" {
		metadata["media_type"] = mediaType
	}
	if backendKind != "" {
		metadata["backend_kind"] = backendKind
	}
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, reason, grpcerr.ReasonOptions{
		ActionHint: actionHint,
		Message:    message,
		Metadata:   metadata,
	})
}

func validatePresentationAssetMaterials(localAgentRef string, materials []*runtimev1.AgentPresentationAssetMaterial) (map[runtimev1.AgentPresentationAssetRole]*validatedPresentationAsset, error) {
	validated := make(map[runtimev1.AgentPresentationAssetRole]*validatedPresentationAsset, len(materials))
	for _, material := range materials {
		if material == nil {
			return nil, presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID, "structure", "", "", "", "Presentation asset material is missing.", "select_presentation_asset_again")
		}
		role := material.GetRole()
		roleLabel := presentationAssetRoleLabel(role)
		if roleLabel == "" || validated[role] != nil {
			return nil, presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID, "structure", roleLabel, material.GetMediaType(), "", "Presentation asset role is missing or duplicated.", "select_presentation_asset_again")
		}
		fileName := strings.TrimSpace(material.GetFileName())
		mediaType := strings.ToLower(strings.TrimSpace(material.GetMediaType()))
		content := material.GetContent()
		if fileName == "" || fileName != path.Base(fileName) || strings.ContainsAny(fileName, `/\\`) || len(fileName) > 255 || len(content) == 0 {
			return nil, presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID, "structure", roleLabel, mediaType, "", "Presentation asset material has an invalid file name or empty content.", "select_presentation_asset_again")
		}
		limit := maxPresentationAvatarAssetBytes
		if role == runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND {
			limit = maxPresentationBackgroundAssetBytes
		}
		if len(content) > limit {
			return nil, presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_TOO_LARGE, "size", roleLabel, mediaType, "", "Presentation asset exceeds the Runtime intake size limit.", "select_smaller_presentation_asset")
		}
		digest := sha256.Sum256(content)
		digestHex := hex.EncodeToString(digest[:])
		if material.GetSha256() == "" || material.GetSha256() != digestHex {
			return nil, presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH, "integrity", roleLabel, mediaType, "", "Presentation asset integrity does not match the imported material.", "select_presentation_asset_again")
		}
		kind, err := validatePresentationAssetStructure(role, fileName, mediaType, content)
		if err != nil {
			return nil, err
		}
		refDigest := sha256.Sum256(append([]byte(localAgentRef+"\x00"+roleLabel+"\x00"), content...))
		validated[role] = &validatedPresentationAsset{
			ref:  presentationOfficialAssetRef(role, kind, hex.EncodeToString(refDigest[:])[:12]),
			role: role, fileName: fileName, mediaType: mediaType, sha256: digestHex,
			content: append([]byte(nil), content...), kind: kind,
		}
	}
	return validated, nil
}

func validatePresentationAssetStructure(role runtimev1.AgentPresentationAssetRole, fileName, mediaType string, content []byte) (string, error) {
	roleLabel := presentationAssetRoleLabel(role)
	lowerName := strings.ToLower(fileName)
	if role == runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND {
		if err := validatePresentationImage(lowerName, mediaType, content); err != nil {
			return "", presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_TYPE_INVALID, "type", roleLabel, mediaType, "", "Background material must be a structurally valid PNG or JPEG image.", "select_supported_image_asset")
		}
		return "image", nil
	}
	if (strings.HasSuffix(lowerName, ".vrm") || mediaType == "model/gltf-binary") && validatePresentationVRM(content) == nil {
		return "vrm", nil
	}
	if strings.HasSuffix(lowerName, ".zip") || mediaType == "application/zip" {
		if err := validatePresentationLive2DArchive(content); err != nil {
			if err == errPresentationLive2DDependencyMissing {
				return "", presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING, "dependency", roleLabel, mediaType, "live2d", "Live2D package is missing a required model dependency.", "repair_live2d_package_dependencies")
			}
			return "", presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID, "structure", roleLabel, mediaType, "live2d", "Live2D package structure is invalid.", "select_valid_live2d_package")
		}
		return "live2d", nil
	}
	if err := validatePresentationImage(lowerName, mediaType, content); err == nil {
		return "image", nil
	}
	return "", presentationValidationError(runtimev1.ReasonCode_AGENT_PRESENTATION_ASSET_TYPE_INVALID, "type", roleLabel, mediaType, "", "Avatar material type is not supported by Runtime.", "select_supported_presentation_asset")
}

func validatePresentationVRM(content []byte) error {
	if len(content) < 20 || string(content[:4]) != "glTF" || binary.LittleEndian.Uint32(content[4:8]) != 2 || int(binary.LittleEndian.Uint32(content[8:12])) != len(content) {
		return fmt.Errorf("invalid VRM glTF header")
	}
	if binary.LittleEndian.Uint32(content[16:20]) != 0x4e4f534a {
		return fmt.Errorf("VRM JSON chunk is missing")
	}
	jsonLength := int(binary.LittleEndian.Uint32(content[12:16]))
	if jsonLength <= 0 || 20+jsonLength > len(content) || !json.Valid(bytes.TrimRight(content[20:20+jsonLength], " \x00")) {
		return fmt.Errorf("VRM JSON chunk is invalid")
	}
	return nil
}

var errPresentationLive2DDependencyMissing = fmt.Errorf("live2d dependency missing")

func validatePresentationLive2DArchive(content []byte) error {
	reader, err := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if err != nil || len(reader.File) == 0 || len(reader.File) > maxPresentationLive2DEntries {
		return fmt.Errorf("invalid live2d zip")
	}
	files := make(map[string]*zip.File, len(reader.File))
	var modelPath string
	expanded := uint64(0)
	for _, file := range reader.File {
		name := path.Clean(strings.ReplaceAll(file.Name, `\\`, "/"))
		if name == "." || strings.HasPrefix(name, "/") || name == ".." || strings.HasPrefix(name, "../") || file.FileInfo().IsDir() {
			continue
		}
		if name != file.Name || files[name] != nil {
			return fmt.Errorf("unsafe live2d archive path")
		}
		expanded += file.UncompressedSize64
		if expanded > maxPresentationLive2DExpandedBytes {
			return fmt.Errorf("live2d expanded size exceeds limit")
		}
		files[name] = file
		if strings.HasSuffix(strings.ToLower(name), ".model3.json") {
			if modelPath != "" {
				return fmt.Errorf("multiple live2d manifests")
			}
			modelPath = name
		}
	}
	if modelPath == "" {
		return errPresentationLive2DDependencyMissing
	}
	manifestBytes, err := readBoundedZipFile(files[modelPath], 2<<20)
	if err != nil {
		return err
	}
	var manifest struct {
		Version        int             `json:"Version"`
		FileReferences json.RawMessage `json:"FileReferences"`
	}
	if json.Unmarshal(manifestBytes, &manifest) != nil || manifest.Version < 3 || len(manifest.FileReferences) == 0 {
		return fmt.Errorf("invalid live2d manifest")
	}
	var refs any
	var required struct {
		Moc      string   `json:"Moc"`
		Textures []string `json:"Textures"`
	}
	if json.Unmarshal(manifest.FileReferences, &refs) != nil || json.Unmarshal(manifest.FileReferences, &required) != nil {
		return fmt.Errorf("invalid live2d file references")
	}
	if strings.TrimSpace(required.Moc) == "" || len(required.Textures) == 0 {
		return errPresentationLive2DDependencyMissing
	}
	dependencies := make([]string, 0)
	collectPresentationDependencyStrings(refs, "", &dependencies)
	base := path.Dir(modelPath)
	for _, dependency := range dependencies {
		resolved := path.Clean(path.Join(base, strings.ReplaceAll(dependency, `\\`, "/")))
		if resolved == ".." || strings.HasPrefix(resolved, "../") || files[resolved] == nil {
			return errPresentationLive2DDependencyMissing
		}
	}
	return nil
}

func collectPresentationDependencyStrings(value any, field string, out *[]string) {
	switch typed := value.(type) {
	case string:
		switch strings.ToLower(field) {
		case "moc", "textures", "physics", "pose", "displayinfo", "userdata", "file", "sound":
			if strings.TrimSpace(typed) != "" {
				*out = append(*out, typed)
			}
		}
	case []any:
		for _, item := range typed {
			collectPresentationDependencyStrings(item, field, out)
		}
	case map[string]any:
		for key, item := range typed {
			collectPresentationDependencyStrings(item, key, out)
		}
	}
}

func readBoundedZipFile(file *zip.File, limit int64) ([]byte, error) {
	reader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = reader.Close() }()
	content, err := io.ReadAll(io.LimitReader(reader, limit+1))
	if err != nil || int64(len(content)) > limit {
		return nil, fmt.Errorf("read live2d manifest: %w", err)
	}
	return content, nil
}

func validatePresentationImage(fileName, mediaType string, content []byte) error {
	if !((strings.HasSuffix(fileName, ".png") && mediaType == "image/png") ||
		((strings.HasSuffix(fileName, ".jpg") || strings.HasSuffix(fileName, ".jpeg")) && mediaType == "image/jpeg")) {
		return fmt.Errorf("unsupported image type")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 16384 || config.Height > 16384 ||
		(mediaType == "image/png" && format != "png") || (mediaType == "image/jpeg" && format != "jpeg") {
		return fmt.Errorf("invalid image structure")
	}
	return nil
}

func presentationAssetRoleLabel(role runtimev1.AgentPresentationAssetRole) string {
	switch role {
	case runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR:
		return "avatar"
	case runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND:
		return "background"
	default:
		return ""
	}
}

func presentationOfficialAssetRef(role runtimev1.AgentPresentationAssetRole, kind, suffix string) string {
	if role == runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND {
		return "bg_" + suffix
	}
	return kind + "_" + suffix
}

func presentationAssetBackendCompatible(asset *validatedPresentationAsset, backend runtimev1.AgentPresentationBackendKind) bool {
	if asset == nil || asset.role == runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_BACKGROUND {
		return asset != nil && asset.kind == "image"
	}
	switch backend {
	case runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_VRM:
		return asset.kind == "vrm"
	case runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_LIVE2D:
		return asset.kind == "live2d"
	case runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_SPRITE2D,
		runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_CANVAS2D:
		return asset.kind == "image"
	default:
		return false
	}
}

func (s *Service) presentationAssetByRef(ctx context.Context, localAgentRef, assetRef string) (*presentationAssetRecord, bool, error) {
	if s == nil || s.backend == nil {
		return nil, false, fmt.Errorf("presentation asset store unavailable")
	}
	row := s.backend.DB().QueryRowContext(ctx, `SELECT asset_ref, local_agent_ref, asset_role, backend_kind, file_name, media_type, sha256, content FROM runtime_agent_presentation_asset WHERE asset_ref = ? AND local_agent_ref = ?`, assetRef, localAgentRef)
	record := &presentationAssetRecord{}
	var role, backend int32
	if err := row.Scan(&record.Ref, &record.LocalAgentRef, &role, &backend, &record.FileName, &record.MediaType, &record.SHA256, &record.Content); err != nil {
		if err == sql.ErrNoRows {
			return nil, false, nil
		}
		return nil, false, fmt.Errorf("query presentation asset: %w", err)
	}
	record.Role = runtimev1.AgentPresentationAssetRole(role)
	record.BackendKind = runtimev1.AgentPresentationBackendKind(backend)
	return record, true, nil
}

func (s *Service) recoverPresentationAssetStore(ctx context.Context) error {
	if s == nil || s.backend == nil {
		return fmt.Errorf("presentation asset store unavailable")
	}
	retained := make(map[string]string)
	s.mu.RLock()
	for localAgentRef, entry := range s.agents {
		for _, profile := range []*runtimev1.AgentPresentationProfile{entry.Agent.GetPresentationProfile(), entry.Agent.GetPreviousPresentationProfile()} {
			for _, ref := range presentationProfileAssetRefs(profile) {
				if ref != "" {
					retained[ref] = localAgentRef
				}
			}
		}
	}
	s.mu.RUnlock()
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT asset_ref, local_agent_ref, sha256, byte_length, content FROM runtime_agent_presentation_asset`)
	if err != nil {
		return fmt.Errorf("recover presentation assets: %w", err)
	}
	var orphaned []string
	for rows.Next() {
		var ref, localAgentRef, digest string
		var byteLength int
		var content []byte
		if err := rows.Scan(&ref, &localAgentRef, &digest, &byteLength, &content); err != nil {
			_ = rows.Close()
			return err
		}
		sum := sha256.Sum256(content)
		if byteLength != len(content) || digest != hex.EncodeToString(sum[:]) {
			_ = rows.Close()
			return fmt.Errorf("presentation asset %s integrity mismatch", ref)
		}
		if retained[ref] != localAgentRef {
			orphaned = append(orphaned, ref)
		}
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(orphaned) == 0 {
		return nil
	}
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		for _, ref := range orphaned {
			if _, err := tx.Exec(`DELETE FROM runtime_agent_presentation_asset WHERE asset_ref = ?`, ref); err != nil {
				return fmt.Errorf("cleanup orphaned presentation asset: %w", err)
			}
		}
		return nil
	})
}

func presentationAssetCommitHook(localAgentRef string, imported map[runtimev1.AgentPresentationAssetRole]*validatedPresentationAsset, retainedRefs []string) runtimeAgentStateTxHook {
	retain := make(map[string]struct{}, len(retainedRefs))
	for _, ref := range retainedRefs {
		if strings.TrimSpace(ref) != "" {
			retain[ref] = struct{}{}
		}
	}
	return func(tx *sql.Tx) error {
		for _, asset := range imported {
			if asset == nil {
				continue
			}
			if _, err := tx.Exec(`INSERT INTO runtime_agent_presentation_asset(asset_ref, local_agent_ref, asset_role, backend_kind, file_name, media_type, sha256, byte_length, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(asset_ref) DO UPDATE SET local_agent_ref=excluded.local_agent_ref, asset_role=excluded.asset_role, backend_kind=excluded.backend_kind, file_name=excluded.file_name, media_type=excluded.media_type, sha256=excluded.sha256, byte_length=excluded.byte_length, content=excluded.content`, asset.ref, localAgentRef, int32(asset.role), int32(asset.backendKind), asset.fileName, asset.mediaType, asset.sha256, len(asset.content), asset.content, time.Now().UTC().Format(time.RFC3339)); err != nil {
				return fmt.Errorf("store official presentation asset: %w", err)
			}
		}
		rows, err := tx.Query(`SELECT asset_ref FROM runtime_agent_presentation_asset WHERE local_agent_ref = ?`, localAgentRef)
		if err != nil {
			return fmt.Errorf("list presentation assets for cleanup: %w", err)
		}
		var orphaned []string
		for rows.Next() {
			var ref string
			if err := rows.Scan(&ref); err != nil {
				_ = rows.Close()
				return err
			}
			if _, ok := retain[ref]; !ok {
				orphaned = append(orphaned, ref)
			}
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, ref := range orphaned {
			if _, err := tx.Exec(`DELETE FROM runtime_agent_presentation_asset WHERE local_agent_ref = ? AND asset_ref = ?`, localAgentRef, ref); err != nil {
				return fmt.Errorf("cleanup replaced presentation asset: %w", err)
			}
		}
		return nil
	}
}

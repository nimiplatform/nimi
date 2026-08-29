package runtimeagent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *Service) GetAgentPresentationAsset(
	ctx context.Context,
	req *runtimev1.GetAgentPresentationAssetRequest,
) (*runtimev1.GetAgentPresentationAssetResponse, error) {
	if req == nil || strings.TrimSpace(req.GetAgentHandle()) == "" || strings.TrimSpace(req.GetAssetRef()) == "" {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	resolved, _, err := s.resolveLocalAppAgent(
		ctx,
		accountservice.LocalAppOperationPresentationSnapshot,
		req.GetAgentHandle(),
	)
	if err != nil {
		return nil, err
	}

	assetRef := strings.TrimSpace(req.GetAssetRef())
	profile := resolved.entry.GetPresentationProfile()
	resourcePack := resolved.entry.GetResourcePackSelection()
	isAvatar := profile != nil && strings.TrimSpace(profile.GetAvatarAssetRef()) == assetRef
	isResourcePack := resourcePack != nil && strings.TrimSpace(resourcePack.GetAssetRef()) == assetRef
	if !isAvatar && !isResourcePack {
		return nil, status.Error(codes.NotFound, "presentation asset not found")
	}

	localAgentRef := resolved.identity.LocalAgentRef
	record, exists, err := s.presentationAssetByRef(ctx, localAgentRef, assetRef)
	if err != nil {
		return nil, status.Error(codes.Internal, "read presentation asset")
	}
	if !exists {
		return nil, status.Error(codes.NotFound, "presentation asset not found")
	}
	valid := isAvatar && validCommittedAvatarAssetRecord(record, localAgentRef, assetRef, profile.GetBackendKind())
	if isResourcePack {
		valid = validCommittedResourcePackRecord(record, localAgentRef, assetRef, resourcePack)
	}
	if !valid {
		return nil, status.Error(codes.DataLoss, "committed presentation asset integrity mismatch")
	}

	return &runtimev1.GetAgentPresentationAssetResponse{
		AssetRef:    record.Ref,
		Role:        record.Role,
		BackendKind: record.BackendKind,
		FileName:    record.FileName,
		MediaType:   record.MediaType,
		Content:     append([]byte(nil), record.Content...),
		Sha256:      record.SHA256,
	}, nil
}

func validCommittedResourcePackRecord(
	record *presentationAssetRecord,
	localAgentRef string,
	assetRef string,
	selection *runtimev1.AgentResourcePackSelection,
) bool {
	if record == nil || selection == nil ||
		record.Ref != assetRef || record.LocalAgentRef != localAgentRef ||
		record.Role != runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_RESOURCE_PACK ||
		record.BackendKind != runtimev1.AgentPresentationBackendKind_AGENT_PRESENTATION_BACKEND_KIND_UNSPECIFIED ||
		record.ByteLength != len(record.Content) || record.ByteLength <= 0 || record.ByteLength > maxResourcePackArchiveBytes ||
		selection.GetAssetRef() != assetRef || validateResourcePackSelection(selection) != nil {
		return false
	}
	digest := sha256.Sum256(record.Content)
	if record.SHA256 != hex.EncodeToString(digest[:]) {
		return false
	}
	_, err := validatePresentationResourcePackArchive(record.Content)
	return err == nil
}

func validCommittedAvatarAssetRecord(
	record *presentationAssetRecord,
	localAgentRef string,
	assetRef string,
	backendKind runtimev1.AgentPresentationBackendKind,
) bool {
	if record == nil ||
		record.Ref != assetRef ||
		record.LocalAgentRef != localAgentRef ||
		record.Role != runtimev1.AgentPresentationAssetRole_AGENT_PRESENTATION_ASSET_ROLE_AVATAR ||
		record.BackendKind != backendKind ||
		record.ByteLength != len(record.Content) ||
		record.ByteLength <= 0 ||
		record.ByteLength > maxPresentationAvatarAssetBytes {
		return false
	}
	digest := sha256.Sum256(record.Content)
	return record.SHA256 == hex.EncodeToString(digest[:])
}

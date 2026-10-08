package integration

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

const maxMediaBytes = 32 * 1024 * 1024

type outboundAsset struct {
	RelativePath string `json:"relativePath"`
	SHA256       string `json:"sha256"`
	MediaType    string `json:"mediaType"`
	SizeBytes    int64  `json:"sizeBytes"`
}

// @nimi-authority: rule.nimi.runtime.integration.media-handoff
func (s *Service) captureOutboundAsset(c *invocation, input outboundAsset) (*appstorage.AssetSource, error) {
	if s.assets == nil || input.SizeBytes < 1 || input.SizeBytes > maxMediaBytes || input.MediaType == "" || !strings.HasPrefix(input.SHA256, "sha256:") {
		return nil, adapterError("INTEGRATION_MEDIA_INVALID")
	}
	owner := appstorage.ManagedOwner{AccountID: c.decision.AccountID, RegisteredAppSubject: c.decision.RegisteredAppSubject}
	source, err := s.assets.OpenOwnedIntegrationAsset(c.ctx, owner, input.RelativePath)
	if err != nil {
		return nil, adapterError("INTEGRATION_MEDIA_UNAVAILABLE")
	}
	if source.Record.SizeBytes != input.SizeBytes || source.Record.MediaType != input.MediaType || source.Record.SHA256 != input.SHA256 {
		_ = source.Body.Close()
		return nil, adapterError("INTEGRATION_MEDIA_INTEGRITY_INVALID")
	}
	return source, nil
}

// @nimi-authority: rule.nimi.runtime.integration.final-publication
// The asset owner prepares a verified candidate without s.mu. Its final guard
// holds s.mu and the exact protected session fence across both atomic publish
// and terminal call recording. Revocation never observes an unrecorded gap
// between the legal asset commit and this invocation's completed fact.
func (s *Service) adoptInboundMedia(c *invocation, relativePath string, input appstorage.VerifiedAssetInput, integrity string) (string, error) {
	if integrity != "protocol-authenticated" && integrity != "transport-and-local-digest" && integrity != "decrypted-unverified" {
		if input.Body != nil {
			_ = input.Body.Close()
		}
		return "", adapterError("INTEGRATION_MEDIA_INTEGRITY_INVALID")
	}
	if s.assets == nil || input.SizeBytes < 1 || input.SizeBytes > maxMediaBytes {
		if input.Body != nil {
			_ = input.Body.Close()
		}
		return "", adapterError("INTEGRATION_MEDIA_INVALID")
	}
	owner := appstorage.ManagedOwner{AccountID: c.decision.AccountID, RegisteredAppSubject: c.decision.RegisteredAppSubject}
	var result string
	_, err := s.assets.AdoptOwnedIntegrationMedia(c.ctx, owner, relativePath, input, func(record appstorage.AssetRecord, publish func() error) error {
		encoded, err := json.Marshal(map[string]any{"asset": map[string]any{
			"relativePath": record.RelativePath, "sha256": record.SHA256,
			"mediaType": record.MediaType, "sizeBytes": record.SizeBytes,
			"createdAt": record.CreatedAt, "modifiedAt": record.ModifiedAt,
		}, "integrity": integrity})
		if err != nil {
			return err
		}
		value, err := decodeJSON(string(encoded), maxOutput)
		if err == nil {
			err = validateSchema(c.op.OutputSchemaJson, value)
		}
		if err != nil {
			return err
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.withCallCommitLocked(c, func(commitCtx context.Context) error {
			if err := publish(); err != nil {
				return err
			}
			result = string(encoded)
			if !s.finishLockedInContext(commitCtx, c, "completed", result, "", nil) {
				// Atomic publication already happened. Keep the owned asset
				// attribution in the uncertain in-memory fact for observation
				// and cleanup; record failure cannot make it an effect-free stop.
				c.fact.ResultJson = result
				return adapterError("INTEGRATION_RESULT_RECORD_UNAVAILABLE")
			}
			return nil
		})
	})
	return result, err
}

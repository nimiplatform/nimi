package connector

import (
	"encoding/json"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/ossmedia"
	"google.golang.org/grpc/codes"
)

type storedMediaCredential struct {
	APIKey       string                `json:"api_key"`
	MediaStorage *ossmedia.Credentials `json:"media_storage"`
}

// @nimi-authority: rule.nimi.runtime.ai-provider.oss-input-storage
func parseMediaStorageUpdate(provider string, kind runtimev1.ConnectorAuthKind, update *runtimev1.ConnectorMediaStorageUpdate, creating bool) (*ossmedia.Credentials, error) {
	invalid := grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	if provider != "dashscope" || kind != runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY || update == nil {
		return nil, invalid
	}
	switch change := update.GetChange().(type) {
	case *runtimev1.ConnectorMediaStorageUpdate_Remove:
		if creating || !change.Remove {
			return nil, invalid
		}
		return nil, nil
	case *runtimev1.ConnectorMediaStorageUpdate_Oss:
		input := change.Oss
		if input == nil || input.Config == nil {
			return nil, invalid
		}
		value := &ossmedia.Credentials{Config: ossmedia.Config{Region: input.Config.Region, Bucket: input.Config.Bucket, KeyPrefix: input.Config.KeyPrefix}, AccessKeyID: input.AccessKeyId, AccessKeySecret: input.AccessKeySecret, SecurityToken: input.SecurityToken}
		if ossmedia.Validate(value) != nil {
			return nil, invalid
		}
		return value, nil
	default:
		return nil, invalid
	}
}

func encodeMediaCredential(apiKey string, storage *ossmedia.Credentials) (string, error) {
	if storage == nil {
		return apiKey, nil
	}
	data, err := json.Marshal(storedMediaCredential{APIKey: apiKey, MediaStorage: storage})
	return string(data), err
}

func decodeMediaCredential(record ConnectorRecord, payload string) (*ossmedia.Credentials, error) {
	if record.MediaStorage == nil {
		return nil, nil
	}
	invalid := fmt.Errorf("captured OSS credential does not match its connection configuration")
	if record.Provider != "dashscope" || normalizeAuthKind(record.AuthKind) != runtimev1.ConnectorAuthKind_CONNECTOR_AUTH_KIND_API_KEY {
		return nil, invalid
	}
	var decoded storedMediaCredential
	if json.Unmarshal([]byte(payload), &decoded) != nil || decoded.APIKey == "" || ossmedia.Validate(decoded.MediaStorage) != nil || decoded.MediaStorage.Config != *record.MediaStorage {
		return nil, invalid
	}
	return decoded.MediaStorage, nil
}

func mediaStorageProjection(value *ossmedia.Config) *runtimev1.ConnectorOSSStorage {
	if value == nil {
		return nil
	}
	return &runtimev1.ConnectorOSSStorage{Region: value.Region, Bucket: value.Bucket, KeyPrefix: value.KeyPrefix}
}

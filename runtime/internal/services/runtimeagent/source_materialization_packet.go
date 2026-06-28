package runtimeagent

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	sourceMaterializationPacketMetadataKey    = "sourceMaterializationPacket"
	sourceMaterializationMetadataKey          = "sourceMaterialization"
	sourceMaterializationPacketSchema         = "realm.source-materialization-packet/v1"
	sourceMaterializationWorldCharacterSchema = "realm.world-character-core/v1"
	sourceMaterializationRealmPersonaSchema   = "realm.persona/v1"
	sourceMaterializationAudienceDesktop      = "nimi.desktop.local-agent.materialization"
	sourceMaterializationHMACSecretEnv        = "SOURCE_MATERIALIZATION_PACKET_HMAC_SECRET"
	runtimeSourceRefPrefix                    = "runtime-source:"
)

var admittedSourceMaterializationPayloadSchemas = map[string]string{
	"worldCharacter": sourceMaterializationWorldCharacterSchema,
	"realmPersona":   sourceMaterializationRealmPersonaSchema,
}

type verifiedSourceMaterializationPacket struct {
	PacketID              string
	PacketHash            string
	Nonce                 string
	SourceKind            string
	SourceID              string
	SourceWorldID         string
	SourceContentRevision float64
	SourceContentHash     string
	RuntimeSourceRef      string
	ExpiresAt             time.Time
	ConsumedAt            time.Time
}

func runtimeSourceRequiresMaterializationPacket(runtimeSourceRef string) bool {
	return strings.HasPrefix(strings.TrimSpace(runtimeSourceRef), runtimeSourceRefPrefix)
}

func verifySourceMaterializationPacketForInitialize(
	reqMetadata *structpb.Struct,
	identity localAgentIdentity,
	now time.Time,
) (*verifiedSourceMaterializationPacket, error) {
	if !runtimeSourceRequiresMaterializationPacket(identity.RuntimeSourceRef) {
		return nil, nil
	}
	if reqMetadata == nil || reqMetadata.GetFields()[sourceMaterializationPacketMetadataKey] == nil {
		return nil, status.Error(codes.InvalidArgument, "source materialization packet is required")
	}
	packetValue := reqMetadata.GetFields()[sourceMaterializationPacketMetadataKey]
	packetStruct := packetValue.GetStructValue()
	if packetStruct == nil {
		return nil, status.Error(codes.InvalidArgument, "source materialization packet must be an object")
	}
	packet := packetStruct.AsMap()
	verified, err := verifySourceMaterializationPacketObject(packet, identity, now)
	if err != nil {
		return nil, err
	}
	return verified, nil
}

func verifySourceMaterializationPacketObject(
	packet map[string]any,
	identity localAgentIdentity,
	now time.Time,
) (*verifiedSourceMaterializationPacket, error) {
	schemaVersion, err := requiredPacketString(packet, "packetSchemaVersion")
	if err != nil {
		return nil, err
	}
	if schemaVersion != sourceMaterializationPacketSchema {
		return nil, status.Error(codes.InvalidArgument, "source materialization packet schema is not admitted")
	}
	packetID, err := requiredPacketString(packet, "packetId")
	if err != nil {
		return nil, err
	}
	sourceKind, err := requiredPacketString(packet, "sourceKind")
	if err != nil {
		return nil, err
	}
	sourceID, err := requiredPacketString(packet, "sourceId")
	if err != nil {
		return nil, err
	}
	sourceWorldID, err := requiredPacketString(packet, "sourceWorldId")
	if err != nil {
		return nil, err
	}
	sourceContentRevision, err := requiredPacketNumber(packet, "sourceContentRevision")
	if err != nil {
		return nil, err
	}
	sourceContentHash, err := requiredPacketString(packet, "sourceContentHash")
	if err != nil {
		return nil, err
	}
	issuedAtRaw, err := requiredPacketString(packet, "issuedAt")
	if err != nil {
		return nil, err
	}
	expiresAtRaw, err := requiredPacketString(packet, "expiresAt")
	if err != nil {
		return nil, err
	}
	nonce, err := requiredPacketString(packet, "nonce")
	if err != nil {
		return nil, err
	}
	packetHash, err := requiredPacketString(packet, "packetHash")
	if err != nil {
		return nil, err
	}
	packetProof, err := requiredPacketString(packet, "packetProof")
	if err != nil {
		return nil, err
	}
	audience, err := requiredPacketString(packet, "intendedRuntimeAudience")
	if err != nil {
		return nil, err
	}
	if audience != sourceMaterializationAudienceDesktop {
		return nil, status.Error(codes.InvalidArgument, "source materialization packet audience is not admitted")
	}
	runtimeSourceRef, err := requiredPacketString(packet, "runtimeSourceRef")
	if err != nil {
		return nil, err
	}
	if runtimeSourceRef != identity.RuntimeSourceRef {
		return nil, status.Error(codes.InvalidArgument, "source materialization packet runtime_source_ref mismatch")
	}
	if _, ok := packet["sourceDisplayMetadata"].(map[string]any); !ok {
		return nil, status.Error(codes.InvalidArgument, "source materialization packet display metadata is required")
	}
	payload, ok := packet["payload"].(map[string]any)
	if !ok {
		return nil, status.Error(codes.InvalidArgument, "source materialization packet payload is required")
	}
	if err := validateSourceMaterializationPayload(sourceKind, payload, sourceContentHash); err != nil {
		return nil, err
	}
	if _, err := parsePacketTime(issuedAtRaw, "issuedAt"); err != nil {
		return nil, err
	}
	expiresAt, err := parsePacketTime(expiresAtRaw, "expiresAt")
	if err != nil {
		return nil, err
	}
	if !now.UTC().Before(expiresAt) {
		return nil, status.Error(codes.InvalidArgument, "source materialization packet is expired")
	}
	unsignedPacket := map[string]any{
		"packetSchemaVersion":     schemaVersion,
		"packetId":                packetID,
		"sourceKind":              sourceKind,
		"sourceId":                sourceID,
		"sourceWorldId":           sourceWorldID,
		"sourceContentRevision":   sourceContentRevision,
		"sourceContentHash":       sourceContentHash,
		"issuedAt":                issuedAtRaw,
		"expiresAt":               expiresAtRaw,
		"nonce":                   nonce,
		"intendedRuntimeAudience": audience,
		"runtimeSourceRef":        runtimeSourceRef,
		"sourceDisplayMetadata":   packet["sourceDisplayMetadata"],
		"payload":                 packet["payload"],
	}
	computedHash, err := hashCanonicalJSON(unsignedPacket)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "source materialization packet hash failed: %v", err)
	}
	if computedHash != packetHash {
		return nil, status.Error(codes.PermissionDenied, "source materialization packet hash mismatch")
	}
	expectedProof, err := signSourceMaterializationPacketProof(packetHash, identity.OwnerUserID, nonce, audience)
	if err != nil {
		return nil, err
	}
	if !hmac.Equal([]byte(expectedProof), []byte(packetProof)) {
		return nil, status.Error(codes.PermissionDenied, "source materialization packet proof mismatch")
	}
	return &verifiedSourceMaterializationPacket{
		PacketID:              packetID,
		PacketHash:            packetHash,
		Nonce:                 nonce,
		SourceKind:            sourceKind,
		SourceID:              sourceID,
		SourceWorldID:         sourceWorldID,
		SourceContentRevision: sourceContentRevision,
		SourceContentHash:     sourceContentHash,
		RuntimeSourceRef:      runtimeSourceRef,
		ExpiresAt:             expiresAt,
		ConsumedAt:            now.UTC(),
	}, nil
}

func validateSourceMaterializationPayload(sourceKind string, payload map[string]any, sourceContentHash string) error {
	expectedSchema, ok := admittedSourceMaterializationPayloadSchemas[sourceKind]
	if !ok {
		return status.Error(codes.InvalidArgument, "source materialization packet source kind is not admitted")
	}
	schemaVersion, err := requiredPacketString(payload, "schemaVersion")
	if err != nil {
		return err
	}
	if schemaVersion != expectedSchema {
		return status.Error(codes.InvalidArgument, "source materialization packet payload schema is not admitted for source kind")
	}
	payloadContentHash, err := requiredPacketString(payload, "contentHash")
	if err != nil {
		return err
	}
	if payloadContentHash != sourceContentHash {
		return status.Error(codes.InvalidArgument, "source materialization packet payload content hash mismatch")
	}
	return nil
}

func requiredPacketString(packet map[string]any, key string) (string, error) {
	value, ok := packet[key]
	if !ok {
		return "", status.Errorf(codes.InvalidArgument, "source materialization packet missing %s", key)
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", status.Errorf(codes.InvalidArgument, "source materialization packet %s must be a non-empty string", key)
	}
	return strings.TrimSpace(text), nil
}

func requiredPacketNumber(packet map[string]any, key string) (float64, error) {
	value, ok := packet[key]
	if !ok {
		return 0, status.Errorf(codes.InvalidArgument, "source materialization packet missing %s", key)
	}
	number, ok := value.(float64)
	if !ok || !isFiniteFloat64(number) {
		return 0, status.Errorf(codes.InvalidArgument, "source materialization packet %s must be a finite number", key)
	}
	return number, nil
}

func parsePacketTime(raw string, field string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(raw))
	if err != nil {
		return time.Time{}, status.Errorf(codes.InvalidArgument, "source materialization packet %s is invalid", field)
	}
	return parsed.UTC(), nil
}

func signSourceMaterializationPacketProof(packetHash string, ownerID string, nonce string, audience string) (string, error) {
	secret := strings.TrimSpace(os.Getenv(sourceMaterializationHMACSecretEnv))
	if secret == "" {
		return "", status.Error(codes.FailedPrecondition, sourceMaterializationHMACSecretEnv+" is required")
	}
	proofPayloadHash, err := hashCanonicalJSON(map[string]any{
		"packetHash":              packetHash,
		"ownerId":                 ownerID,
		"nonce":                   nonce,
		"intendedRuntimeAudience": audience,
	})
	if err != nil {
		return "", status.Errorf(codes.InvalidArgument, "source materialization packet proof payload failed: %v", err)
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(proofPayloadHash))
	return "hmac-sha256:" + hex.EncodeToString(mac.Sum(nil)), nil
}

func consumeSourceMaterializationPacketNonce(ctx context.Context, backend interface {
	WriteTx(context.Context, func(*sql.Tx) error) error
}, verified *verifiedSourceMaterializationPacket, identity localAgentIdentity) error {
	if verified == nil || backend == nil {
		return nil
	}
	return backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(
			`DELETE FROM runtime_source_materialization_nonce WHERE expires_at <= ?`,
			time.Now().UTC().Format(time.RFC3339Nano),
		); err != nil {
			return fmt.Errorf("purge expired source materialization nonce: %w", err)
		}
		result, err := tx.Exec(
			`INSERT OR IGNORE INTO runtime_source_materialization_nonce(nonce, packet_hash, local_agent_ref, runtime_source_ref, expires_at, consumed_at) VALUES (?, ?, ?, ?, ?, ?)`,
			verified.Nonce,
			verified.PacketHash,
			identity.LocalAgentRef,
			identity.RuntimeSourceRef,
			verified.ExpiresAt.Format(time.RFC3339Nano),
			verified.ConsumedAt.Format(time.RFC3339Nano),
		)
		if err != nil {
			return fmt.Errorf("consume source materialization nonce: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return fmt.Errorf("consume source materialization nonce affected rows: %w", err)
		}
		if affected == 0 {
			return status.Error(codes.AlreadyExists, "source materialization packet nonce was already consumed")
		}
		return nil
	})
}

func sanitizeInitializeAgentMetadata(metadata *structpb.Struct, verified *verifiedSourceMaterializationPacket) (*structpb.Struct, error) {
	if metadata == nil && verified == nil {
		return nil, nil
	}
	result := map[string]any{}
	if metadata != nil {
		for key, value := range metadata.AsMap() {
			if key == sourceMaterializationPacketMetadataKey {
				continue
			}
			result[key] = value
		}
	}
	if verified != nil {
		result[sourceMaterializationMetadataKey] = map[string]any{
			"packetId":              verified.PacketID,
			"packetHash":            verified.PacketHash,
			"sourceKind":            verified.SourceKind,
			"sourceId":              verified.SourceID,
			"sourceWorldId":         verified.SourceWorldID,
			"sourceContentRevision": verified.SourceContentRevision,
			"sourceContentHash":     verified.SourceContentHash,
			"runtimeSourceRef":      verified.RuntimeSourceRef,
			"consumedAt":            verified.ConsumedAt.Format(time.RFC3339Nano),
		}
	}
	if len(result) == 0 {
		return nil, nil
	}
	sanitized, err := structpb.NewStruct(result)
	if err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "initialize agent metadata is invalid: %v", err)
	}
	return sanitized, nil
}

func hashCanonicalJSON(value any) (string, error) {
	canonical, err := canonicalJSON(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:]), nil
}

func canonicalJSON(value any) (string, error) {
	switch typed := value.(type) {
	case nil:
		return "null", nil
	case string:
		encoded, err := json.Marshal(typed)
		return string(encoded), err
	case bool:
		if typed {
			return "true", nil
		}
		return "false", nil
	case int:
		return strconv.Itoa(typed), nil
	case int64:
		return strconv.FormatInt(typed, 10), nil
	case float64:
		if !isFiniteFloat64(typed) {
			return "", fmt.Errorf("canonicalJSON received a non-finite number")
		}
		if typed == math.Trunc(typed) {
			return strconv.FormatInt(int64(typed), 10), nil
		}
		return strconv.FormatFloat(typed, 'f', -1, 64), nil
	case []any:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			canonical, err := canonicalJSON(item)
			if err != nil {
				return "", err
			}
			items = append(items, canonical)
		}
		return "[" + strings.Join(items, ",") + "]", nil
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		entries := make([]string, 0, len(keys))
		for _, key := range keys {
			encodedKey, err := json.Marshal(key)
			if err != nil {
				return "", err
			}
			child, err := canonicalJSON(typed[key])
			if err != nil {
				return "", err
			}
			entries = append(entries, string(encodedKey)+":"+child)
		}
		return "{" + strings.Join(entries, ",") + "}", nil
	default:
		return "", fmt.Errorf("canonicalJSON received a non-JSON value %T", value)
	}
}

func isFiniteFloat64(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

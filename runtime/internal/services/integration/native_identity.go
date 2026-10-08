package integration

import (
	"context"
	"encoding/json"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.integration.native-messaging
func (s *Service) checkNativeIdentityLocked(ctx context.Context, next target) error {
	if !isNativeAdapter(next.Public.Kind) {
		return nil
	}
	if next.Identity == "" {
		return failure(codes.FailedPrecondition, "INTEGRATION_IDENTITY_UNVERIFIED")
	}
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT config_json FROM runtime_integration_target`)
	if err != nil {
		return failure(codes.Unavailable, "INTEGRATION_TARGET_UNAVAILABLE")
	}
	defer rows.Close()
	for rows.Next() {
		var raw string
		var current target
		if rows.Scan(&raw) != nil || json.Unmarshal([]byte(raw), &current) != nil || current.Public == nil {
			return failure(codes.Unavailable, "INTEGRATION_TARGET_UNAVAILABLE")
		}
		if current.Public.Kind == next.Public.Kind && current.Identity == next.Identity && current.Public.TargetRef != next.Public.TargetRef {
			return failure(codes.AlreadyExists, "INTEGRATION_IDENTITY_ALREADY_CONNECTED")
		}
	}
	return rows.Err()
}

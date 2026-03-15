package ai

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/authn"
)

func catalogSubjectUserIDFromContext(ctx context.Context) string {
	identity := authn.IdentityFromContext(ctx)
	if identity == nil {
		return ""
	}
	return strings.TrimSpace(identity.SubjectUserID)
}

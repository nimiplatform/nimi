package localservice

import (
	"github.com/nimiplatform/nimi/runtime/internal/auditredaction"

	"google.golang.org/protobuf/types/known/structpb"
)

func maskLocalAuditFields(fields map[string]*structpb.Value) {
	auditredaction.MaskSensitiveFields(fields)
}

package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *Service) loadTarget(ctx context.Context, account, id string) (target, error) {
	var raw string
	var t target
	if err := s.backend.DB().QueryRowContext(ctx, `SELECT config_json FROM runtime_integration_target WHERE account_id=? AND target_ref=?`, account, id).Scan(&raw); err != nil {
		return t, failure(codes.NotFound, "INTEGRATION_TARGET_NOT_FOUND")
	}
	if err := json.Unmarshal([]byte(raw), &t); err != nil || t.Public == nil {
		return t, failure(codes.Unavailable, "INTEGRATION_TARGET_UNAVAILABLE")
	}
	return t, nil
}
func (s *Service) saveTarget(ctx context.Context, t target) error {
	raw, err := json.Marshal(t)
	if err != nil {
		return err
	}
	_, err = s.backend.DB().ExecContext(ctx, `INSERT INTO runtime_integration_target(account_id,target_ref,config_json) VALUES(?,?,?) ON CONFLICT(account_id,target_ref) DO UPDATE SET config_json=excluded.config_json`, t.Account, t.Public.TargetRef, string(raw))
	return err
}
func (s *Service) targets(ctx context.Context, d accountservice.LocalAppCallerDecision) ([]*runtimev1.IntegrationTarget, error) {
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT config_json FROM runtime_integration_target WHERE account_id=? ORDER BY target_ref`, d.AccountID)
	if err != nil {
		return nil, failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
	}
	var stored []target
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			_ = rows.Close()
			return nil, err
		}
		var t target
		if err := json.Unmarshal([]byte(raw), &t); err != nil {
			_ = rows.Close()
			return nil, err
		}
		stored = append(stored, t)
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, err
	}
	result := make([]*runtimev1.IntegrationTarget, 0, len(stored))
	for _, t := range stored {
		if t.Public == nil {
			continue
		}
		p := proto.Clone(t.Public).(*runtimev1.IntegrationTarget)
		p.Available = true
		if p.Kind == "telegram" && t.TelegramBotID <= 0 {
			p.Available = false
		}
		if p.Kind == "app" {
			s.mu.Lock()
			provider := s.providers[p.TargetRef]
			p.Available = provider != nil && s.scopeLive(provider.ctx, provider.decision, localappop.IngressIntegrationProviderPoll)
			s.mu.Unlock()
		}
		for _, op := range p.Operations {
			if s.permitted(ctx, d.AccountID, d.RegisteredAppSubject, p.TargetRef, op.Name) {
				p.PermittedOperations = append(p.PermittedOperations, op.Name)
			}
		}
		result = append(result, p)
	}
	return result, nil
}
func (s *Service) ListIntegrationCatalog(ctx context.Context, _ *runtimev1.ListIntegrationCatalogRequest) (*runtimev1.ListIntegrationCatalogResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationCatalogList)
	if err != nil {
		return nil, err
	}
	targets, err := s.targets(ctx, d)
	return &runtimev1.ListIntegrationCatalogResponse{Targets: targets}, err
}
func (s *Service) ListIntegrationConnections(ctx context.Context, _ *runtimev1.ListIntegrationConnectionsRequest) (*runtimev1.ListIntegrationConnectionsResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationConnectionList)
	if err != nil {
		return nil, err
	}
	targets, err := s.targets(ctx, d)
	if err != nil {
		return nil, err
	}
	result := &runtimev1.ListIntegrationConnectionsResponse{}
	for _, t := range targets {
		if t.Kind != "app" {
			result.Connections = append(result.Connections, t)
		}
	}
	return result, nil
}
func (s *Service) permitted(ctx context.Context, account, subject, targetID, operation string) bool {
	var raw string
	if err := s.backend.DB().QueryRowContext(ctx, `SELECT operations_json FROM runtime_integration_permission WHERE account_id=? AND consumer_subject=? AND target_ref=?`, account, subject, targetID).Scan(&raw); err != nil {
		return false
	}
	var ops []string
	if json.Unmarshal([]byte(raw), &ops) != nil {
		return false
	}
	for _, op := range ops {
		if op == operation {
			return true
		}
	}
	return false
}
func (s *Service) saveFact(ctx context.Context, d accountservice.LocalAppCallerDecision, c *runtimev1.IntegrationCall) error {
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `INSERT INTO runtime_integration_call(call_id,account_id,consumer_subject,target_ref,operation,status,error_code,consumer_display_name,created_ms,updated_ms,target_display_name,account_label) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(call_id) DO UPDATE SET status=excluded.status,error_code=excluded.error_code,updated_ms=excluded.updated_ms`, c.CallId, d.AccountID, d.RegisteredAppSubject, c.TargetRef, c.Operation, c.Status, c.ErrorCode, c.ConsumerDisplayName, c.CreatedAt.AsTime().UnixMilli(), c.UpdatedAt.AsTime().UnixMilli(), c.TargetDisplayName, c.AccountLabel)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `DELETE FROM runtime_integration_call WHERE account_id=? AND status!='accepted' AND (created_ms<? OR call_id IN (SELECT call_id FROM runtime_integration_call WHERE account_id=? ORDER BY created_ms DESC LIMIT -1 OFFSET 10000))`, d.AccountID, time.Now().Add(-retention).UnixMilli(), d.AccountID)
		return err
	})
}

type scanner interface{ Scan(...any) error }

func scanFact(row scanner) (*runtimev1.IntegrationCall, error) {
	c := &runtimev1.IntegrationCall{}
	var created, updated int64
	err := row.Scan(&c.CallId, &c.TargetRef, &c.Operation, &c.Status, &c.ErrorCode, &c.ConsumerDisplayName, &created, &updated, &c.TargetDisplayName, &c.AccountLabel)
	c.CreatedAt = timestamppb.New(time.UnixMilli(created))
	c.UpdatedAt = timestamppb.New(time.UnixMilli(updated))
	return c, err
}

const factColumns = `call_id,target_ref,operation,status,error_code,consumer_display_name,created_ms,updated_ms,target_display_name,account_label`

// Public facts use the same known outcome on every read surface. A failed
// terminal write cannot turn an ended invocation back into "accepted".
// The caller has already selected the persisted account/subject scope.
func (s *Service) knownFactLocked(fact *runtimev1.IntegrationCall, account string) *runtimev1.IntegrationCall {
	if current := s.calls[fact.CallId]; current != nil && current.decision.AccountID == account {
		return cloneCall(current.fact, false)
	}
	if fact.Status == "accepted" {
		fact.Status, fact.ErrorCode = "unconfirmed", "INTEGRATION_EXECUTOR_UNAVAILABLE"
	}
	return fact
}

func (s *Service) loadFact(ctx context.Context, d accountservice.LocalAppCallerDecision, id string) (*runtimev1.IntegrationCall, error) {
	c, err := scanFact(s.backend.DB().QueryRowContext(ctx, `SELECT `+factColumns+` FROM runtime_integration_call WHERE account_id=? AND consumer_subject=? AND call_id=? AND created_ms>=?`, d.AccountID, d.RegisteredAppSubject, id, time.Now().Add(-retention).UnixMilli()))
	if err != nil {
		return nil, failure(codes.NotFound, "INTEGRATION_CALL_NOT_FOUND")
	}
	return c, nil
}
func (s *Service) listFacts(ctx context.Context, d accountservice.LocalAppCallerDecision, limit uint32, manage bool) ([]*runtimev1.IntegrationCall, error) {
	if limit == 0 {
		limit = 50
	}
	if limit > 100 {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_PAGE_LIMIT")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneCallsLocked(time.Now())
	query := `SELECT ` + factColumns + ` FROM runtime_integration_call WHERE account_id=? AND created_ms>=?`
	args := []any{d.AccountID, time.Now().Add(-retention).UnixMilli()}
	if !manage {
		query += ` AND consumer_subject=?`
		args = append(args, d.RegisteredAppSubject)
	}
	query += ` ORDER BY created_ms DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.backend.DB().QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	var result []*runtimev1.IntegrationCall
	for rows.Next() {
		c, err := scanFact(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, s.knownFactLocked(c, d.AccountID))
	}
	return result, rows.Err()
}
func (s *Service) ListIntegrationCalls(ctx context.Context, req *runtimev1.ListIntegrationCallsRequest) (*runtimev1.ListIntegrationCallsResponse, error) {
	d, err := s.decision(ctx, localappop.OperationIntegrationCallList)
	if err != nil {
		return nil, err
	}
	calls, err := s.listFacts(ctx, d, req.GetLimit(), false)
	return &runtimev1.ListIntegrationCallsResponse{Calls: calls}, err
}
func (s *Service) consumerList(ctx context.Context, account string) ([]Consumer, []*runtimev1.IntegrationConsumer, error) {
	if s.registrations == nil {
		return nil, nil, failure(codes.Unavailable, "INTEGRATION_REGISTRATIONS_UNAVAILABLE")
	}
	consumers, err := s.registrations.Consumers(ctx)
	if err != nil {
		return nil, nil, err
	}
	public := make([]*runtimev1.IntegrationConsumer, 0, len(consumers))
	for _, c := range consumers {
		public = append(public, consumerProjection(account, c))
	}
	return consumers, public, nil
}

func consumerProjection(account string, c Consumer) *runtimev1.IntegrationConsumer {
	kind := c.SourceKind
	switch kind {
	case "development", "installed", "platform":
	default:
		kind = "unknown"
	}
	return &runtimev1.IntegrationConsumer{ConsumerRef: ref("icons_", account, c.Subject), AppId: c.AppID, DisplayName: c.DisplayName, SourceKind: kind}
}

func (s *Service) consumerDisplayName(ctx context.Context, d accountservice.LocalAppCallerDecision) string {
	if s.registrations != nil {
		consumer, found, err := s.registrations.DescribeConsumer(ctx, d.RegisteredAppSubject)
		if err == nil && found && consumer.Subject == d.RegisteredAppSubject && consumer.AppID == d.AppID && strings.TrimSpace(consumer.DisplayName) != "" && len(consumer.DisplayName) <= 512 {
			return consumer.DisplayName
		}
	}
	return d.AppID
}

// @nimi-authority: rule.nimi.runtime.integration.inbound
// Called under the configuration/admission lock before credential persistence.
// The upstream getMe ID, never a username or token spelling, owns the cursor.
func (s *Service) checkTelegramIdentityLocked(ctx context.Context, t target) error {
	if t.Public.Kind != "telegram" {
		return nil
	}
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT config_json FROM runtime_integration_target WHERE account_id=?`, t.Account)
	if err != nil {
		return failure(codes.Unavailable, "INTEGRATION_TARGET_UNAVAILABLE")
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var raw string
		var existing target
		if err := rows.Scan(&raw); err != nil {
			return failure(codes.Unavailable, "INTEGRATION_TARGET_UNAVAILABLE")
		}
		if json.Unmarshal([]byte(raw), &existing) != nil || existing.Public == nil {
			return failure(codes.Unavailable, "INTEGRATION_TARGET_UNAVAILABLE")
		}
		if existing.Public.Kind != "telegram" {
			continue
		}
		if existing.Public.TargetRef == t.Public.TargetRef {
			if existing.TelegramBotID > 0 && existing.TelegramBotID != t.TelegramBotID {
				return failure(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED")
			}
		} else if existing.TelegramBotID == t.TelegramBotID {
			return failure(codes.AlreadyExists, "INTEGRATION_TELEGRAM_BOT_ALREADY_CONNECTED")
		}
	}
	return rows.Err()
}

// @nimi-authority: rule.nimi.runtime.integration.standing-permission
func (s *Service) GetIntegrationManagement(ctx context.Context, _ *runtimev1.GetIntegrationManagementRequest) (*runtimev1.GetIntegrationManagementResponse, error) {
	d, err := s.management(ctx, localappop.OperationIntegrationManagementGet)
	if err != nil {
		return nil, err
	}
	targets, err := s.targets(ctx, d)
	if err != nil {
		return nil, err
	}
	_, consumers, err := s.consumerList(ctx, d.AccountID)
	if err != nil {
		return nil, err
	}
	calls, err := s.listFacts(ctx, d, 100, true)
	if err != nil {
		return nil, err
	}
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT consumer_subject,target_ref,operations_json FROM runtime_integration_permission WHERE account_id=?`, d.AccountID)
	if err != nil {
		return nil, err
	}
	var permissions []*runtimev1.IntegrationPermission
	var subjects []string
	for rows.Next() {
		var subject, id, raw string
		if err := rows.Scan(&subject, &id, &raw); err != nil {
			_ = rows.Close()
			return nil, err
		}
		var ops []string
		if err := json.Unmarshal([]byte(raw), &ops); err != nil {
			_ = rows.Close()
			return nil, err
		}
		subjects = append(subjects, subject)
		permissions = append(permissions, &runtimev1.IntegrationPermission{ConsumerRef: ref("icons_", d.AccountID, subject), TargetRef: id, Operations: ops})
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, err
	}
	// Only the account's saved permission subjects select these descriptions.
	// This optional display lookup never adds an ineligible App to Consumers.
	descriptions := make(map[string]*runtimev1.IntegrationConsumer)
	for index, subject := range subjects {
		description, known := descriptions[subject]
		if !known {
			consumer, found, err := s.registrations.DescribeConsumer(ctx, subject)
			if err == nil && found && consumer.Subject == subject && consumer.AppID != "" && consumer.DisplayName != "" {
				description = consumerProjection(d.AccountID, consumer)
			}
			descriptions[subject] = description
		}
		permissions[index].Consumer = description
	}
	return &runtimev1.GetIntegrationManagementResponse{Targets: targets, Consumers: consumers, Permissions: permissions, Calls: calls}, nil
}
func (s *Service) SetIntegrationPermission(ctx context.Context, req *runtimev1.SetIntegrationPermissionRequest) (*runtimev1.SetIntegrationPermissionResponse, error) {
	d, err := s.management(ctx, localappop.OperationIntegrationPermissionSet)
	if err != nil {
		return nil, err
	}
	if req == nil {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
	}
	if len(req.Operations) == 0 {
		return s.revokeIntegrationPermission(ctx, d, req)
	}
	t, err := s.loadTarget(ctx, d.AccountID, req.TargetRef)
	if err != nil {
		return nil, err
	}
	consumers, _, err := s.consumerList(ctx, d.AccountID)
	if err != nil {
		return nil, err
	}
	subject := ""
	var consumer *runtimev1.IntegrationConsumer
	for _, c := range consumers {
		if ref("icons_", d.AccountID, c.Subject) == req.ConsumerRef {
			subject = c.Subject
			consumer = consumerProjection(d.AccountID, c)
			break
		}
	}
	if subject == "" {
		return nil, failure(codes.NotFound, "INTEGRATION_CONSUMER_NOT_FOUND")
	}
	seen := map[string]bool{}
	for _, op := range req.Operations {
		if seen[op] || operation(t, op) == nil {
			return nil, failure(codes.InvalidArgument, "INTEGRATION_PERMISSION_INVALID")
		}
		seen[op] = true
	}
	ops := append([]string{}, req.Operations...)
	sort.Strings(ops)
	raw, _ := json.Marshal(ops)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.quiesced.Load() {
		return nil, failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
	}
	if _, err := s.loadTarget(ctx, d.AccountID, req.TargetRef); err != nil {
		return nil, err
	}
	_, err = s.backend.DB().ExecContext(ctx, `INSERT INTO runtime_integration_permission(account_id,consumer_subject,target_ref,operations_json) VALUES(?,?,?,?) ON CONFLICT(account_id,consumer_subject,target_ref) DO UPDATE SET operations_json=excluded.operations_json`, d.AccountID, subject, req.TargetRef, string(raw))
	if err != nil {
		return nil, failure(codes.Unavailable, "INTEGRATION_PERMISSION_UNAVAILABLE")
	}
	for _, c := range s.calls {
		if c.decision.AccountID == d.AccountID && c.decision.RegisteredAppSubject == subject && c.target.Public.TargetRef == req.TargetRef && !seen[c.op.Name] {
			s.cancelInvocationLocked(c)
		}
	}
	return &runtimev1.SetIntegrationPermissionResponse{Permission: &runtimev1.IntegrationPermission{ConsumerRef: req.ConsumerRef, TargetRef: req.TargetRef, Operations: ops, Consumer: consumer}}, nil
}

// Revocation follows an existing account-owned permission, even when its App
// is no longer eligible or its target is unavailable. It cannot create a grant.
func (s *Service) revokeIntegrationPermission(ctx context.Context, d accountservice.LocalAppCallerDecision, req *runtimev1.SetIntegrationPermissionRequest) (*runtimev1.SetIntegrationPermissionResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.quiesced.Load() {
		return nil, failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
	}
	rows, err := s.backend.DB().QueryContext(ctx, `SELECT consumer_subject FROM runtime_integration_permission WHERE account_id=? AND target_ref=?`, d.AccountID, req.TargetRef)
	if err != nil {
		return nil, failure(codes.Unavailable, "INTEGRATION_PERMISSION_UNAVAILABLE")
	}
	subject := ""
	for rows.Next() {
		var candidate string
		if err := rows.Scan(&candidate); err != nil {
			_ = rows.Close()
			return nil, failure(codes.Unavailable, "INTEGRATION_PERMISSION_UNAVAILABLE")
		}
		if ref("icons_", d.AccountID, candidate) == req.ConsumerRef {
			subject = candidate
		}
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, failure(codes.Unavailable, "INTEGRATION_PERMISSION_UNAVAILABLE")
	}
	if subject == "" {
		return nil, failure(codes.NotFound, "INTEGRATION_PERMISSION_NOT_FOUND")
	}
	if _, err := s.backend.DB().ExecContext(ctx, `UPDATE runtime_integration_permission SET operations_json='[]' WHERE account_id=? AND consumer_subject=? AND target_ref=?`, d.AccountID, subject, req.TargetRef); err != nil {
		return nil, failure(codes.Unavailable, "INTEGRATION_PERMISSION_UNAVAILABLE")
	}
	for _, c := range s.calls {
		if c.decision.AccountID == d.AccountID && c.decision.RegisteredAppSubject == subject && c.target.Public.TargetRef == req.TargetRef {
			s.cancelInvocationLocked(c)
		}
	}
	return &runtimev1.SetIntegrationPermissionResponse{Permission: &runtimev1.IntegrationPermission{ConsumerRef: req.ConsumerRef, TargetRef: req.TargetRef, Operations: []string{}}}, nil
}

// @nimi-authority: rule.nimi.runtime.integration.custody
func (s *Service) PutIntegrationConnection(ctx context.Context, req *runtimev1.PutIntegrationConnectionRequest) (*runtimev1.PutIntegrationConnectionResponse, error) {
	d, err := s.management(ctx, localappop.OperationIntegrationConnectionPut)
	if err != nil {
		return nil, err
	}
	if req == nil || len(strings.TrimSpace(req.DisplayName)) == 0 || len(req.DisplayName) > 256 || len(req.AccountLabel) > 256 || len(req.Secret) > 16384 {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_INPUT_INVALID")
	}
	id := req.TargetRef
	var previous *target
	if id == "" {
		id = "icon_" + ulid.Make().String()
	} else {
		old, err := s.loadTarget(ctx, d.AccountID, id)
		if err != nil {
			return nil, err
		}
		previous = &old
		if old.Public.Kind != req.Adapter || old.Endpoint != req.Endpoint {
			return nil, failure(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED")
		}
	}
	secret := req.Secret
	if previous != nil {
		storedSecret := ""
		if s.secrets != nil {
			storedSecret, _, err = s.secrets.ReadSecret("integration:" + id)
			if err != nil {
				return nil, failure(codes.Unavailable, "INTEGRATION_CREDENTIAL_UNAVAILABLE")
			}
		}
		if secret != "" && secret != storedSecret {
			return nil, failure(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED")
		}
		secret = storedSecret
	}
	t, err := s.configure(ctx, d.AccountID, id, req, secret)
	if err != nil {
		return nil, err
	}
	if previous != nil && !compatibleOperations(previous.Public.Operations, t.Public.Operations) {
		return nil, failure(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.quiesced.Load() {
		return nil, failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
	}
	if previous != nil {
		current, err := s.loadTarget(ctx, d.AccountID, id)
		if err != nil {
			return nil, err
		}
		currentSecret, err := s.captureCredential(current)
		if err != nil {
			return nil, err
		}
		if current.Public.Kind != req.Adapter || current.Endpoint != req.Endpoint || currentSecret != secret || !compatibleOperations(current.Public.Operations, t.Public.Operations) {
			return nil, failure(codes.FailedPrecondition, "INTEGRATION_NEW_TARGET_REQUIRED")
		}
	}
	if err := s.checkTelegramIdentityLocked(ctx, t); err != nil {
		return nil, err
	}
	if previous == nil && secret != "" {
		if s.secrets == nil {
			return nil, failure(codes.Unavailable, "INTEGRATION_CUSTODY_UNAVAILABLE")
		}
		if err := s.secrets.WriteSecret("integration:"+id, secret); err != nil {
			return nil, failure(codes.Unavailable, "INTEGRATION_CUSTODY_UNAVAILABLE")
		}
	}
	if err := s.saveTarget(ctx, t); err != nil {
		if previous == nil && secret != "" && s.secrets != nil {
			_ = s.secrets.DeleteSecret("integration:" + id)
		}
		return nil, fmt.Errorf("integration save connection: %w", err)
	}
	return &runtimev1.PutIntegrationConnectionResponse{Connection: t.Public}, nil
}
func (s *Service) RemoveIntegrationConnection(ctx context.Context, req *runtimev1.RemoveIntegrationConnectionRequest) (*runtimev1.RemoveIntegrationConnectionResponse, error) {
	d, err := s.management(ctx, localappop.OperationIntegrationConnectionRemove)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.quiesced.Load() {
		return nil, failure(codes.Unavailable, "INTEGRATION_UNAVAILABLE")
	}
	t, err := s.loadTarget(ctx, d.AccountID, req.GetTargetRef())
	if err != nil {
		return nil, err
	}
	if t.Public.Kind == "app" {
		return nil, failure(codes.InvalidArgument, "INTEGRATION_PROVIDER_TARGET")
	}
	for _, c := range s.calls {
		if c.decision.AccountID == d.AccountID && c.target.Public.TargetRef == t.Public.TargetRef {
			s.cancelInvocationLocked(c)
		}
	}
	// Drain this connection's receiver before deleting its cursor/cache, so
	// a late accepted poll cannot recreate records for a removed target.
	if r := s.receivers[t.Public.TargetRef]; r != nil {
		r.cancel()
		stopCtx, stopCancel := context.WithTimeout(ctx, terminalRecordTimeout)
		defer stopCancel()
		select {
		case <-stopCtx.Done():
			return nil, failure(codes.Unavailable, "INTEGRATION_RECEIVER_UNAVAILABLE")
		case <-r.done:
		}
		delete(s.receivers, t.Public.TargetRef)
	}
	err = s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		for _, table := range []string{"runtime_integration_permission", "runtime_integration_update", "runtime_integration_receiver", "runtime_integration_target"} {
			if _, err := tx.ExecContext(ctx, `DELETE FROM `+table+` WHERE account_id=? AND target_ref=?`, d.AccountID, t.Public.TargetRef); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if s.secrets != nil {
		if err := s.secrets.DeleteSecret("integration:" + t.Public.TargetRef); err != nil {
			return nil, failure(codes.Unavailable, "INTEGRATION_CUSTODY_UNAVAILABLE")
		}
	}
	return &runtimev1.RemoveIntegrationConnectionResponse{Removed: true}, nil
}

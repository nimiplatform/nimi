package aiconfig

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	v1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

var ErrRecordInvalid = errors.New("invalid AIConfig record edit")
var ErrRecordMissing = errors.New("AIConfig record is missing")

const initialConfigRef = "main"

type RecordSnapshot struct {
	Config  *v1.AIConfig
	Record  *v1.AppAIConfigRecord
	Records []*v1.AppAIConfigRecord
}

func (s RecordSnapshot) Revision() string {
	if s.Record == nil {
		return InitialRevision
	}
	return s.Record.Revision
}

type RecordStore interface {
	ReadRecord(context.Context, string, *v1.AIConfigOwner, string, bool) (RecordSnapshot, error)
	EditRecord(context.Context, string, string, *v1.AIConfig, *v1.AppAIConfigRecordEdit) (RecordSnapshot, bool, error)
}
type records map[string]memoryRow

func ValidRecordRef(ref string) bool {
	if ref == initialConfigRef {
		return true
	}
	if len(ref) != 32 {
		return false
	}
	_, err := hex.DecodeString(ref)
	return err == nil && strings.ToLower(ref) == ref
}
func validName(s string) bool {
	return s != "" && strings.TrimSpace(s) == s && utf8.ValidString(s) && utf8.RuneCountInString(s) <= 128 && strings.IndexFunc(s, unicode.IsControl) < 0
}
func (rr records) selected(ref string) string {
	if ref != "" {
		return ref
	}
	for k, v := range rr {
		if v.isDefault {
			return k
		}
	}
	return ""
}
func (rr records) snapshot(ref string, directory bool) RecordSnapshot {
	var out RecordSnapshot
	selected := rr.selected(ref)
	for k, v := range rr {
		meta := &v1.AppAIConfigRecord{ConfigRef: k, Name: v.name, Revision: encodeRevision(v.revision), IsDefault: v.isDefault}
		if k == selected {
			out.Record = meta
			out.Config = cloneConfig(v.config)
		}
		if directory {
			out.Records = append(out.Records, meta)
		}
	}
	sort.Slice(out.Records, func(i, j int) bool { return out.Records[i].ConfigRef < out.Records[j].ConfigRef })
	return out
}
func (rr records) edit(key storeKey, expected uint64, candidate *v1.AIConfig, edit *v1.AppAIConfigRecordEdit) (RecordSnapshot, bool, error) {
	bad := func() (RecordSnapshot, bool, error) { return RecordSnapshot{}, false, ErrRecordInvalid }
	ref := edit.GetConfigRef()
	if ref != "" && !ValidRecordRef(ref) || key.ownerKind != storeOwnerKindApp && edit != nil {
		return bad()
	}
	selected := rr.selected(ref)
	row, found := rr[selected]
	name := "Default"
	for _, r := range rr {
		if r.revision == 0 {
			return RecordSnapshot{}, false, ErrInvalidPersistedConfig
		}
	}
	if edit.GetCreateName() != "" {
		name = edit.GetCreateName()
		if !validName(name) || ref != "" || expected != 0 || len(rr) >= 64 {
			return bad()
		}
		for k, r := range rr {
			if r.name == name {
				return rr.snapshot(k, false), false, nil
			}
		}
		var id [16]byte
		if _, e := rand.Read(id[:]); e != nil {
			return RecordSnapshot{}, false, e
		}
		selected = hex.EncodeToString(id[:])
		if _, collision := rr[selected]; collision {
			return bad()
		}
		row = memoryRow{}
		found = false
	} else if !found && ref != "" {
		return RecordSnapshot{}, false, ErrRecordMissing
	}
	if found && row.revision != expected || !found && expected != 0 {
		return rr.snapshot(selected, false), false, nil
	}
	if !found {
		if edit != nil && edit.Change != nil && edit.GetCreateName() == "" {
			return bad()
		}
		if selected == "" {
			selected = initialConfigRef
		}
		row = memoryRow{config: candidate, name: name, isDefault: len(rr) == 0, revision: 1}
		rr[selected] = row
		return rr.snapshot(selected, false), true, nil
	}
	if edit != nil && edit.Change != nil {
		if len(candidate.GetCapabilities()) != 0 || ref == "" {
			return bad()
		}
		switch x := edit.Change.(type) {
		case *v1.AppAIConfigRecordEdit_RenameTo:
			if !validName(x.RenameTo) {
				return bad()
			}
			for k, r := range rr {
				if k != ref && r.name == x.RenameTo {
					return bad()
				}
			}
			if row.name == x.RenameTo {
				return rr.snapshot(selected, false), true, nil
			}
			row.name = x.RenameTo
		case *v1.AppAIConfigRecordEdit_MakeDefault:
			if !x.MakeDefault {
				return bad()
			}
			if row.isDefault {
				return rr.snapshot(selected, false), true, nil
			}
			oldRef := rr.selected("")
			old := rr[oldRef]
			old.isDefault = false
			old.revision++
			if old.revision == 0 {
				return bad()
			}
			rr[oldRef] = old
			if row.revision < old.revision {
				row.revision = old.revision
			}
			row.isDefault = true
		case *v1.AppAIConfigRecordEdit_DeleteRecord:
			if !x.DeleteRecord || row.isDefault {
				return bad()
			}
			delete(rr, ref)
			return rr.snapshot("", false), true, nil
		default:
			return bad()
		}
	} else {
		if proto.Equal(row.config, candidate) {
			return rr.snapshot(selected, false), true, nil
		}
		row.config = candidate
	}
	row.revision++
	if row.revision == 0 {
		return bad()
	}
	rr[selected] = row
	return rr.snapshot(selected, false), true, nil
}
func checkedEdit(account, expected string, config *v1.AIConfig) (storeKey, uint64, *v1.AIConfig, error) {
	c, e := Canonicalize(config)
	if e != nil {
		return storeKey{}, 0, nil, e
	}
	k, e := canonicalStoreKey(account, c.Owner)
	if e != nil {
		return k, 0, nil, e
	}
	rev, e := parseRevision(expected)
	return k, rev, c, e
}
func (s *MemoryStore) ownerRecords(k storeKey) records {
	rr := records{}
	for key, row := range s.rows {
		ref := key.ref
		key.ref = ""
		if key == k {
			rr[ref] = row
		}
	}
	return rr
}
func (s *MemoryStore) ReadRecord(ctx context.Context, account string, owner *v1.AIConfigOwner, ref string, list bool) (RecordSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return RecordSnapshot{}, err
	}
	k, e := canonicalStoreKey(account, owner)
	if e != nil {
		return RecordSnapshot{}, e
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.ownerRecords(k).snapshot(ref, list), nil
}
func (s *MemoryStore) EditRecord(ctx context.Context, account, expected string, config *v1.AIConfig, edit *v1.AppAIConfigRecordEdit) (RecordSnapshot, bool, error) {
	if err := ctx.Err(); err != nil {
		return RecordSnapshot{}, false, err
	}
	k, rev, c, e := checkedEdit(account, expected, config)
	if e != nil {
		return RecordSnapshot{}, false, e
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rr := s.ownerRecords(k)
	out, ok, e := rr.edit(k, rev, c, edit)
	if e == nil && ok {
		if edit.GetDeleteRecord() {
			k.ref = edit.ConfigRef
			delete(s.rows, k)
		}
		for ref, row := range rr {
			k.ref = ref
			s.rows[k] = row
		}
	}
	return out, ok, e
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readSQLRecords(ctx context.Context, db queryer, k storeKey, ref string, all bool) (records, error) {
	query := "SELECT config_ref,display_name,is_default,revision,config_blob FROM runtime_ai_config WHERE account_namespace=? AND owner_kind=? AND owner_id=?"
	args := []any{k.accountNamespace, k.ownerKind, k.ownerID}
	if !all {
		if ref == "" {
			query += " AND is_default=1"
		} else {
			query += " AND config_ref=?"
			args = append(args, ref)
		}
	}
	rs, e := db.QueryContext(ctx, query, args...)
	if e != nil {
		return nil, e
	}
	defer rs.Close()
	rr := records{}
	for rs.Next() {
		var r memoryRow
		var id string
		var raw []byte
		if e = rs.Scan(&id, &r.name, &r.isDefault, &r.revision, &raw); e != nil {
			return nil, e
		}
		if r.revision == 0 || !ValidRecordRef(id) || !validName(r.name) {
			return nil, invalidPersistedConfig("invalid record metadata")
		}
		c := &v1.AIConfig{}
		if e = proto.Unmarshal(raw, c); e != nil {
			return nil, invalidPersistedConfig("decode: %v", e)
		}
		r.config, e = Canonicalize(c)
		if e != nil {
			return nil, invalidPersistedConfig("invalid config: %v", e)
		}
		actual, e := canonicalStoreKey(k.accountNamespace, r.config.Owner)
		if e != nil || actual != k {
			return nil, invalidPersistedConfig("owner does not match storage key")
		}
		if k.ownerKind == storeOwnerKindRuntimeLocalAgentSubsystem && (id != initialConfigRef || !r.isDefault) {
			return nil, invalidPersistedConfig("LocalAgent configuration must be singular")
		}
		rr[id] = r
	}
	if e := rs.Err(); e != nil {
		return nil, e
	}
	if all && len(rr) > 0 && rr.selected("") == "" {
		return nil, invalidPersistedConfig("missing default record")
	}
	return rr, nil
}
func (s *SQLiteStore) ReadRecord(ctx context.Context, account string, owner *v1.AIConfigOwner, ref string, list bool) (RecordSnapshot, error) {
	k, e := canonicalStoreKey(account, owner)
	if e != nil {
		return RecordSnapshot{}, e
	}
	rr, e := readSQLRecords(ctx, s.backend.DB(), k, ref, list)
	if e != nil {
		return RecordSnapshot{}, e
	}
	return rr.snapshot(ref, list), nil
}
func (s *SQLiteStore) EditRecord(ctx context.Context, account, expected string, config *v1.AIConfig, edit *v1.AppAIConfigRecordEdit) (out RecordSnapshot, ok bool, err error) {
	k, rev, c, e := checkedEdit(account, expected, config)
	if e != nil {
		return out, false, e
	}
	err = s.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		rr, e := readSQLRecords(ctx, tx, k, "", true)
		if e != nil {
			return e
		}
		before := map[string]uint64{}
		for ref, row := range rr {
			before[ref] = row.revision
		}
		out, ok, e = rr.edit(k, rev, c, edit)
		if e != nil || !ok {
			return e
		}
		// Retire changed rows first, so switching the unique default never
		// transiently conflicts. Unchanged records keep their own revisions.
		for ref, n := range before {
			if r, exists := rr[ref]; !exists || r.revision != n {
				if _, e = tx.ExecContext(ctx, "DELETE FROM runtime_ai_config WHERE account_namespace=? AND owner_kind=? AND owner_id=? AND config_ref=?", account, k.ownerKind, k.ownerID, ref); e != nil {
					return e
				}
			}
		}
		for ref, r := range rr {
			if before[ref] == r.revision {
				continue
			}
			raw, e := proto.MarshalOptions{Deterministic: true}.Marshal(r.config)
			if e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "INSERT INTO runtime_ai_config(account_namespace,owner_kind,owner_id,config_ref,display_name,is_default,revision,config_blob) VALUES(?,?,?,?,?,?,?,?)", account, k.ownerKind, k.ownerID, ref, r.name, r.isDefault, r.revision, raw); e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		return RecordSnapshot{}, false, fmt.Errorf("edit AIConfig: %w", err)
	}
	return out, ok, nil
}
func getDefault(s RecordStore, ctx context.Context, account string, owner *v1.AIConfigOwner) (*v1.AIConfig, string, bool, error) {
	r, e := s.ReadRecord(ctx, account, owner, "", false)
	return r.Config, r.Revision(), r.Record != nil, e
}
func putDefault(s RecordStore, ctx context.Context, account, expected string, c *v1.AIConfig) (*v1.AIConfig, string, bool, error) {
	r, ok, e := s.EditRecord(ctx, account, expected, c, nil)
	return r.Config, r.Revision(), ok, e
}
func (s *MemoryStore) Get(ctx context.Context, a string, o *v1.AIConfigOwner) (*v1.AIConfig, string, bool, error) {
	return getDefault(s, ctx, a, o)
}
func (s *MemoryStore) Overwrite(ctx context.Context, a, r string, c *v1.AIConfig) (*v1.AIConfig, string, bool, error) {
	return putDefault(s, ctx, a, r, c)
}
func (s *SQLiteStore) Get(ctx context.Context, a string, o *v1.AIConfigOwner) (*v1.AIConfig, string, bool, error) {
	return getDefault(s, ctx, a, o)
}
func (s *SQLiteStore) Overwrite(ctx context.Context, a, r string, c *v1.AIConfig) (*v1.AIConfig, string, bool, error) {
	return putDefault(s, ctx, a, r, c)
}

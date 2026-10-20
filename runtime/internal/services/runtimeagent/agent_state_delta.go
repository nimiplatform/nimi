package runtimeagent

import (
	"context"
	"database/sql"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// @nimi-authority: rule.nimi.runtime.agent-service.r021
// The caller holds the Agent mutex until this transaction commits, and retains
// responsibility for rollback and post-commit broadcasts.
func (r *runtimeAgentStateRepository) persistAgentDelta(entry *agentEntry, events []*runtimev1.AgentEvent, sequence uint64, hook runtimeAgentStateTxHook) error {
	return r.persistAgentDeltaContext(context.Background(), entry, events, sequence, hook)
}

func (r *runtimeAgentStateRepository) persistAgentDeltaContext(ctx context.Context, entry *agentEntry, events []*runtimev1.AgentEvent, sequence uint64, hook runtimeAgentStateTxHook) error {
	if r == nil || r.backend == nil {
		return fmt.Errorf("Runtime Agent persistence unavailable")
	}
	return r.backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if entry != nil {
			ref, err := localAgentRefForEntry(entry)
			if err != nil {
				return err
			}
			agentRaw, err := protojson.Marshal(entry.Agent)
			if err != nil {
				return err
			}
			stateRaw, err := protojson.Marshal(entry.State)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_local_agent(local_agent_ref,agent_json) VALUES(?,?) ON CONFLICT(local_agent_ref) DO UPDATE SET agent_json=excluded.agent_json WHERE agent_json<>excluded.agent_json`, ref, string(agentRaw)); err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_local_agent_state_projection(local_agent_ref,state_json) VALUES(?,?) ON CONFLICT(local_agent_ref) DO UPDATE SET state_json=excluded.state_json WHERE state_json<>excluded.state_json`, ref, string(stateRaw)); err != nil {
				return err
			}
			if err := persistAgentLifeTx(tx, ref, entry.Life); err != nil {
				return err
			}
		}
		for _, event := range events {
			raw, err := protojson.Marshal(event)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO runtime_local_agent_event_log(sequence,local_agent_ref,event_type,timestamp,event_json) VALUES(?,?,?,?,?)`, event.GetSequence(), event.GetLocalAgentRef(), int(event.GetEventType()), timestampString(event.GetTimestamp()), string(raw)); err != nil {
				return err
			}
		}
		if sequence > maxEventLogSize {
			// Agent deletion leaves sequence gaps. Match the in-memory window by
			// retained row count, not by the distance from the high-water mark.
			if _, err := tx.Exec(`DELETE FROM runtime_local_agent_event_log WHERE sequence < (SELECT sequence FROM runtime_local_agent_event_log ORDER BY sequence DESC LIMIT 1 OFFSET ?)`, maxEventLogSize-1); err != nil {
				return err
			}
		}
		if hook != nil {
			if err := hook(tx); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES('state_initialized','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES('agent_event_sequence',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, encodeSequenceValue(sequence))
		return err
	})
}

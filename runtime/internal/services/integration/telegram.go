package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"
)

type telegramReceiver struct {
	mu         sync.Mutex
	epoch      string
	readers    int
	cancel     context.CancelFunc
	pollCancel context.CancelFunc
	wake       chan struct{}
	err        error
	ctx        context.Context
	done       chan struct{}
}
type telegramUpdate struct {
	UpdateID  int64  `json:"updateId"`
	ChatID    string `json:"chatId"`
	MessageID int64  `json:"messageId"`
	Text      string `json:"text"`
	FromID    string `json:"fromId"`
	Date      int64  `json:"date"`
}

func receiverCursor(epoch string, id int64) string { return epoch + ":" + strconv.FormatInt(id, 10) }
func (r *telegramReceiver) notify()                { close(r.wake); r.wake = make(chan struct{}) }

// @nimi-authority: rule.nimi.runtime.integration.inbound
// Exactly one receiver loop exists per connection. With no bounded readers it
// performs no upstream request. App business waiting remains outside Runtime.
func (s *Service) readTelegramUpdates(ctx context.Context, t target, secret, input string) (string, error) {
	var params struct {
		Cursor  string   `json:"cursor"`
		WaitMS  int      `json:"waitMs"`
		ChatIDs []string `json:"chatIds"`
	}
	if err := json.Unmarshal([]byte(input), &params); err != nil {
		return "", adapterError("INTEGRATION_INPUT_INVALID")
	}
	if params.WaitMS < 0 || params.WaitMS > 25000 || len(params.ChatIDs) == 0 {
		return "", adapterError("INTEGRATION_INPUT_INVALID")
	}
	s.mu.Lock()
	if s.closed || s.quiesced.Load() {
		s.mu.Unlock()
		return "", context.Canceled
	}
	r := s.receivers[t.Public.TargetRef]
	if r != nil && closed(r.done) {
		delete(s.receivers, t.Public.TargetRef)
		r = nil
	}
	if r == nil {
		ownerCtx, cancel := context.WithCancel(s.ctx)
		r = &telegramReceiver{epoch: ulid.Make().String(), cancel: cancel, wake: make(chan struct{}), ctx: ownerCtx, done: make(chan struct{})}
		s.receivers[t.Public.TargetRef] = r
		s.workers.Add(1)
		go s.receiveTelegram(ownerCtx, t, secret, r)
	}
	ownerEnded := r.ctx.Err() != nil
	s.mu.Unlock()
	if ownerEnded {
		return "", adapterError("INTEGRATION_RECEIVER_UNAVAILABLE")
	}
	if err := s.pruneTelegram(ctx, t); err != nil {
		return "", err
	}
	last, floor, err := s.telegramPosition(ctx, t)
	if err != nil {
		return "", err
	}
	after := last
	if params.Cursor != "" {
		parts := strings.Split(params.Cursor, ":")
		if len(parts) != 2 || parts[0] != r.epoch {
			return "", adapterError("INTEGRATION_CURSOR_EXPIRED")
		}
		after, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil || after < 0 || after > last {
			return "", adapterError("INTEGRATION_CURSOR_INVALID")
		}
		if after < floor {
			return "", adapterError("INTEGRATION_CURSOR_EXPIRED")
		}
	}
	r.mu.Lock()
	r.readers++
	if r.readers == 1 {
		r.err = nil
	}
	r.notify()
	r.mu.Unlock()
	defer func() {
		r.mu.Lock()
		r.readers--
		if r.readers == 0 && r.pollCancel != nil {
			r.pollCancel()
		}
		r.notify()
		r.mu.Unlock()
	}()
	deadline := time.NewTimer(time.Duration(params.WaitMS) * time.Millisecond)
	defer deadline.Stop()
	allowed := map[string]bool{}
	for _, id := range params.ChatIDs {
		allowed[id] = true
	}
	for {
		r.mu.Lock()
		wake := r.wake
		receiveErr := r.err
		r.mu.Unlock()
		_, floor, err = s.telegramPosition(ctx, t)
		if err != nil {
			return "", err
		}
		if after < floor {
			return "", adapterError("INTEGRATION_CURSOR_EXPIRED")
		}
		rows, err := s.backend.DB().QueryContext(ctx, `SELECT sequence,payload FROM runtime_integration_update WHERE account_id=? AND target_ref=? AND sequence>? ORDER BY sequence LIMIT 1000`, t.Account, t.Public.TargetRef, after)
		if err != nil {
			return "", err
		}
		updates := []telegramUpdate{}
		for rows.Next() {
			var seq int64
			var raw string
			if err := rows.Scan(&seq, &raw); err != nil {
				_ = rows.Close()
				return "", err
			}
			var update telegramUpdate
			if err := json.Unmarshal([]byte(raw), &update); err != nil {
				_ = rows.Close()
				return "", err
			}
			after = seq
			if allowed[update.ChatID] {
				updates = append(updates, update)
			}
		}
		err = rows.Err()
		_ = rows.Close()
		if err != nil {
			return "", err
		}
		result := func() (string, error) {
			data, err := json.Marshal(map[string]any{"cursor": receiverCursor(r.epoch, after), "updates": updates})
			return string(data), err
		}
		if len(updates) > 0 {
			return result()
		}
		if receiveErr != nil {
			return "", receiveErr
		}
		if params.WaitMS == 0 {
			return result()
		}
		select {
		case <-r.ctx.Done():
			return "", adapterError("INTEGRATION_RECEIVER_UNAVAILABLE")
		case <-ctx.Done():
			return "", ctx.Err()
		case <-deadline.C:
			return result()
		case <-wake:
		}
	}
}
func (s *Service) telegramPosition(ctx context.Context, t target) (int64, int64, error) {
	var last, floor int64
	err := s.backend.DB().QueryRowContext(ctx, `SELECT last_sequence,replay_floor_sequence FROM runtime_integration_receiver WHERE account_id=? AND target_ref=?`, t.Account, t.Public.TargetRef).Scan(&last, &floor)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, nil
	}
	return last, floor, err
}
func (s *Service) pruneTelegram(ctx context.Context, t target) error {
	return s.backend.WriteTx(ctx, func(tx *sql.Tx) error { return pruneTelegramTx(ctx, tx, t) })
}
func pruneTelegramTx(ctx context.Context, tx *sql.Tx, t target) error {
	var expired int64
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(sequence),0) FROM runtime_integration_update WHERE account_id=? AND target_ref=? AND (received_ms<? OR sequence IN (SELECT sequence FROM runtime_integration_update WHERE account_id=? AND target_ref=? ORDER BY sequence DESC LIMIT -1 OFFSET 1000))`, t.Account, t.Public.TargetRef, time.Now().Add(-24*time.Hour).UnixMilli(), t.Account, t.Public.TargetRef).Scan(&expired); err != nil {
		return err
	}
	if expired == 0 {
		return nil
	}
	if _, err := tx.ExecContext(ctx, `UPDATE runtime_integration_receiver SET replay_floor_sequence=MAX(replay_floor_sequence,?) WHERE account_id=? AND target_ref=?`, expired, t.Account, t.Public.TargetRef); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM runtime_integration_update WHERE account_id=? AND target_ref=? AND sequence<=?`, t.Account, t.Public.TargetRef, expired)
	return err
}
func (s *Service) receiveTelegram(ctx context.Context, t target, secret string, r *telegramReceiver) {
	defer s.workers.Done()
	defer close(r.done)
	fail := func(err error) {
		if ctx.Err() != nil {
			return
		}
		r.mu.Lock()
		r.err = err
		r.notify()
		r.mu.Unlock()
	}
	for ctx.Err() == nil {
		r.mu.Lock()
		wake := r.wake
		active := r.readers > 0 && r.err == nil
		var pollCtx context.Context
		var pollCancel context.CancelFunc
		if active {
			pollCtx, pollCancel = context.WithCancel(ctx)
			r.pollCancel = pollCancel
		}
		r.mu.Unlock()
		if !active {
			select {
			case <-ctx.Done():
				return
			case <-wake:
				continue
			}
		}
		var offset int64
		err := s.backend.DB().QueryRowContext(pollCtx, `SELECT next_offset FROM runtime_integration_receiver WHERE account_id=? AND target_ref=?`, t.Account, t.Public.TargetRef).Scan(&offset)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			canceled := pollCtx.Err() != nil
			pollCancel()
			if canceled {
				continue
			}
			fail(err)
			continue
		}
		var incoming []struct {
			UpdateID int64 `json:"update_id"`
			Message  *struct {
				MessageID int64  `json:"message_id"`
				Date      int64  `json:"date"`
				Text      string `json:"text"`
				Chat      struct {
					ID int64 `json:"id"`
				} `json:"chat"`
				From struct {
					ID int64 `json:"id"`
				} `json:"from"`
			} `json:"message"`
		}
		_, err = s.telegramRequest(pollCtx, secret, "getUpdates", map[string]any{"offset": offset, "timeout": 5, "limit": 100, "allowed_updates": []string{"message"}}, &incoming)
		canceled := pollCtx.Err() != nil
		if err != nil || canceled {
			pollCancel()
			if !canceled {
				fail(err)
			}
			continue
		}
		if len(incoming) > 0 {
			err = s.backend.WriteTx(pollCtx, func(tx *sql.Tx) error {
				var seq int64
				queryErr := tx.QueryRowContext(pollCtx, `SELECT last_sequence FROM runtime_integration_receiver WHERE account_id=? AND target_ref=?`, t.Account, t.Public.TargetRef).Scan(&seq)
				if queryErr != nil && !errors.Is(queryErr, sql.ErrNoRows) {
					return queryErr
				}
				for _, raw := range incoming {
					if raw.UpdateID < offset {
						continue
					}
					offset = raw.UpdateID + 1
					if raw.Message == nil {
						continue
					}
					seq++
					m := raw.Message
					update := telegramUpdate{UpdateID: raw.UpdateID, ChatID: strconv.FormatInt(m.Chat.ID, 10), MessageID: m.MessageID, Text: m.Text, FromID: strconv.FormatInt(m.From.ID, 10), Date: m.Date}
					encoded, err := json.Marshal(update)
					if err != nil {
						return err
					}
					if _, err := tx.ExecContext(pollCtx, `INSERT INTO runtime_integration_update(account_id,target_ref,update_id,sequence,payload,received_ms) VALUES(?,?,?,?,?,?)`, t.Account, t.Public.TargetRef, update.UpdateID, seq, string(encoded), time.Now().UnixMilli()); err != nil {
						return err
					}
				}
				if _, err := tx.ExecContext(pollCtx, `INSERT INTO runtime_integration_receiver(account_id,target_ref,next_offset,last_sequence,replay_floor_sequence) VALUES(?,?,?,?,0) ON CONFLICT(account_id,target_ref) DO UPDATE SET next_offset=excluded.next_offset,last_sequence=excluded.last_sequence`, t.Account, t.Public.TargetRef, offset, seq); err != nil {
					return err
				}
				return pruneTelegramTx(pollCtx, tx, t)
			})
		}
		canceled = pollCtx.Err() != nil
		pollCancel()
		if err != nil {
			if !canceled {
				fail(err)
			}
			continue
		}
		if len(incoming) > 0 {
			r.mu.Lock()
			r.notify()
			r.mu.Unlock()
		}
	}
}

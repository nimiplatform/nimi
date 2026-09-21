package capabilitydriver

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
)

const (
	MusicTerminationUnknown     = "unknown"
	MusicTerminationModelEnd    = "model-end"
	MusicTerminationBudgetLimit = "budget-limit"
)

type yue2OutputObserver struct {
	mu      sync.Mutex
	lines   [2][]byte
	discard [2]bool
	values  map[string]int
	err     error
}

func (o *yue2OutputObserver) Observe(stream int, chunk []byte) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if stream < 0 || stream > 1 {
		o.err = fmt.Errorf("YuE2 output stream is invalid")
		return
	}
	for _, ch := range chunk {
		if ch == '\n' {
			if !o.discard[stream] {
				o.line(string(o.lines[stream]))
			}
			o.lines[stream] = o.lines[stream][:0]
			o.discard[stream] = false
		} else if !o.discard[stream] {
			if len(o.lines[stream]) == 4096 {
				o.discard[stream] = true
				o.lines[stream] = o.lines[stream][:0]
			} else {
				o.lines[stream] = append(o.lines[stream], ch)
			}
		}
	}
}

func (o *yue2OutputObserver) line(line string) {
	if !strings.HasPrefix(line, "[TIMING ts=") {
		return
	}
	fields := strings.Fields(line)
	if len(fields) != 4 {
		return
	}
	key := fields[2]
	if key != "yue2.semantic.truncated" && key != "yue2.semantic.abc_truncated" && key != "yue2.semantic.tokens" {
		return
	}
	if o.values == nil {
		o.values = map[string]int{}
	}
	if _, duplicate := o.values[key]; duplicate {
		o.err = fmt.Errorf("YuE2 emitted duplicate termination evidence")
		return
	}
	value, err := strconv.Atoi(fields[3])
	if err != nil || value < 0 || (key != "yue2.semantic.tokens" && value > 1) {
		o.err = fmt.Errorf("YuE2 emitted invalid termination evidence")
		return
	}
	o.values[key] = value
}

func (o *yue2OutputObserver) Facts() (MusicInferenceFacts, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	for i := range o.lines {
		if !o.discard[i] && len(o.lines[i]) > 0 {
			o.line(string(o.lines[i]))
			o.lines[i] = nil
		}
	}
	if o.err != nil {
		return MusicInferenceFacts{}, o.err
	}
	truncated, ok := o.values["yue2.semantic.truncated"]
	abc, abcOK := o.values["yue2.semantic.abc_truncated"]
	tokens, tokensOK := o.values["yue2.semantic.tokens"]
	if !ok || !abcOK || !tokensOK || tokens < 1 {
		return MusicInferenceFacts{}, fmt.Errorf("YuE2 did not provide complete termination evidence")
	}
	termination := MusicTerminationModelEnd
	if truncated == 1 {
		termination = MusicTerminationBudgetLimit
	}
	return MusicInferenceFacts{Termination: termination, SemanticTokens: tokens, GeneratedScoreTruncated: abc == 1}, nil
}

package musicscore

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"sort"
)

const MIDIResolution = 1000 // -25 SMPTE frames/second, 40 ticks/frame.
const MaxMIDIBytes = 16 << 20
const maxMIDITick = 600 * MIDIResolution

type MIDINote struct {
	StartTick uint32
	EndTick   uint32
	Pitch     int
}

type midiEvent struct {
	tick    uint32
	channel byte
	pitch   byte
	on      bool
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-note-events-output
func MarshalNoteMIDI(notes []MIDINote) ([]byte, error) {
	if len(notes) > 100000 {
		return nil, fmt.Errorf("MIDI note count exceeds its bound")
	}
	ordered := append([]MIDINote(nil), notes...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].StartTick != ordered[j].StartTick {
			return ordered[i].StartTick < ordered[j].StartTick
		}
		if ordered[i].EndTick != ordered[j].EndTick {
			return ordered[i].EndTick < ordered[j].EndTick
		}
		return ordered[i].Pitch < ordered[j].Pitch
	})
	// Channels only distinguish overlapping equal pitches. No program or voice
	// identity is emitted, and channel 9 is avoided because GM treats it as drums.
	var occupied [128][16]uint32
	events := make([]midiEvent, 0, len(notes)*2)
	for _, n := range ordered {
		if n.Pitch < 0 || n.Pitch > 127 || n.EndTick <= n.StartTick || n.EndTick > maxMIDITick {
			return nil, fmt.Errorf("MIDI note pitch or span is invalid")
		}
		channel := -1
		for c := 0; c < 16; c++ {
			if c != 9 && occupied[n.Pitch][c] <= n.StartTick {
				channel = c
				break
			}
		}
		if channel < 0 {
			return nil, fmt.Errorf("MIDI equal-pitch overlap exceeds the admitted channel encoding")
		}
		occupied[n.Pitch][channel] = n.EndTick
		events = append(events, midiEvent{n.StartTick, byte(channel), byte(n.Pitch), true}, midiEvent{n.EndTick, byte(channel), byte(n.Pitch), false})
	}
	sort.SliceStable(events, func(i, j int) bool {
		if events[i].tick != events[j].tick {
			return events[i].tick < events[j].tick
		}
		if events[i].on != events[j].on {
			return !events[i].on
		}
		if events[i].channel != events[j].channel {
			return events[i].channel < events[j].channel
		}
		return events[i].pitch < events[j].pitch
	})
	var track bytes.Buffer
	var previous uint32
	for _, e := range events {
		writeMIDIDelta(&track, e.tick-previous)
		previous = e.tick
		if e.on {
			track.Write([]byte{0x90 | e.channel, e.pitch, 64})
		} else {
			track.Write([]byte{0x80 | e.channel, e.pitch, 0})
		}
	}
	track.Write([]byte{0, 0xff, 0x2f, 0})
	var result bytes.Buffer
	result.Write([]byte{'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 0, 0, 1, 0xe7, 40, 'M', 'T', 'r', 'k'})
	_ = binary.Write(&result, binary.BigEndian, uint32(track.Len()))
	result.Write(track.Bytes())
	data := result.Bytes()
	if _, err := ParseNoteMIDI(data); err != nil {
		return nil, err
	}
	return data, nil
}

func writeMIDIDelta(output *bytes.Buffer, value uint32) {
	var encoded [4]byte
	index := len(encoded) - 1
	encoded[index] = byte(value & 127)
	for value >>= 7; value != 0; value >>= 7 {
		index--
		encoded[index] = byte(value&127) | 128
	}
	output.Write(encoded[index:])
}

// ParseNoteMIDI validates the entire admitted note-event SMF dialect, including
// running status, note pairing, its bounded clock and the exact final chunk.
// It does not turn an arbitrary MIDI file into a transcription result.
func ParseNoteMIDI(data []byte) ([]MIDINote, error) {
	bad := func() ([]MIDINote, error) {
		return nil, fmt.Errorf("note-event MIDI structure, timing or pairing is invalid")
	}
	if len(data) < 26 || len(data) > MaxMIDIBytes || !bytes.Equal(data[:18], []byte{'M', 'T', 'h', 'd', 0, 0, 0, 6, 0, 0, 0, 1, 0xe7, 40, 'M', 'T', 'r', 'k'}) || uint64(binary.BigEndian.Uint32(data[18:22])) != uint64(len(data)-22) {
		return bad()
	}
	var start [16][128]uint32
	var active [16][128]bool
	notes := make([]MIDINote, 0)
	var tick uint32
	var running byte
	index := 22
	for index < len(data) {
		var delta uint32
		terminated := false
		for count := 0; count < 4; count++ {
			if index >= len(data) {
				return bad()
			}
			b := data[index]
			index++
			delta = delta<<7 | uint32(b&127)
			if b < 128 {
				terminated = true
				break
			}
		}
		if !terminated || delta > maxMIDITick-tick || index >= len(data) {
			return bad()
		}
		tick += delta
		status := data[index]
		if status >= 128 {
			index++
		} else {
			status = running
		}
		if status == 0xff {
			if index+2 != len(data) || data[index] != 0x2f || data[index+1] != 0 {
				return bad()
			}
			for _, row := range active {
				for _, value := range row {
					if value {
						return bad()
					}
				}
			}
			return notes, nil
		}
		if (status&0xf0 != 0x80 && status&0xf0 != 0x90) || status&15 == 9 || index+2 > len(data) {
			return bad()
		}
		running = status
		channel, pitch, velocity := status&15, data[index], data[index+1]
		index += 2
		if pitch > 127 || velocity > 127 {
			return bad()
		}
		if status&0xf0 == 0x90 && velocity != 0 {
			if velocity != 64 || active[channel][pitch] {
				return bad()
			}
			start[channel][pitch], active[channel][pitch] = tick, true
		} else {
			if velocity != 0 || !active[channel][pitch] || tick <= start[channel][pitch] {
				return bad()
			}
			notes = append(notes, MIDINote{start[channel][pitch], tick, int(pitch)})
			if len(notes) > 100000 {
				return bad()
			}
			active[channel][pitch] = false
		}
	}
	return bad()
}

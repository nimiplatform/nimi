package capabilitydriver

// Count GIF image descriptors without allocating decoded animation frames.
func singleFrameGIF(data []byte) bool {
	if len(data) < 13 {
		return false
	}
	pos, frames := 13, 0
	if data[10]&0x80 != 0 {
		pos += 3 * (1 << ((data[10] & 7) + 1))
	}
	skipBlocks := func() bool {
		for pos < len(data) {
			size := int(data[pos])
			pos++
			if size == 0 {
				return true
			}
			pos += size
		}
		return false
	}
	for pos < len(data) {
		tag := data[pos]
		pos++
		switch tag {
		case 0x3b:
			return frames == 1 && pos == len(data)
		case 0x21:
			pos++
			if pos > len(data) || !skipBlocks() {
				return false
			}
		case 0x2c:
			frames++
			if frames > 1 || pos+9 > len(data) {
				return false
			}
			flags := data[pos+8]
			pos += 9
			if flags&0x80 != 0 {
				pos += 3 * (1 << ((flags & 7) + 1))
			}
			pos++
			if pos > len(data) || !skipBlocks() {
				return false
			}
		default:
			return false
		}
	}
	return false
}

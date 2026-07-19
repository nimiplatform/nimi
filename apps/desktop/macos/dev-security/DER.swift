import Foundation

enum DER {
    static func sequence(_ values: [Data]) -> Data {
        wrap(tag: 0x30, body: concatenate(values))
    }

    static func set(_ values: [Data]) -> Data {
        wrap(tag: 0x31, body: concatenate(values))
    }

    static func explicit(_ number: UInt8, _ value: Data) -> Data {
        precondition(number < 31)
        return wrap(tag: 0xa0 | number, body: value)
    }

    static func integer(_ bytes: Data) -> Data {
        var normalized = Array(bytes.drop(while: { $0 == 0 }))
        if normalized.isEmpty { normalized = [0] }
        if normalized[0] & 0x80 != 0 { normalized.insert(0, at: 0) }
        return wrap(tag: 0x02, body: Data(normalized))
    }

    static func integer(_ value: UInt64) -> Data {
        var value = value
        var bytes = [UInt8]()
        repeat {
            bytes.insert(UInt8(value & 0xff), at: 0)
            value >>= 8
        } while value != 0
        return integer(Data(bytes))
    }

    static func boolean(_ value: Bool) -> Data {
        wrap(tag: 0x01, body: Data([value ? 0xff : 0x00]))
    }

    static func null() -> Data {
        wrap(tag: 0x05, body: Data())
    }

    static func octetString(_ value: Data) -> Data {
        wrap(tag: 0x04, body: value)
    }

    static func bitString(_ value: Data, unusedBits: UInt8 = 0) -> Data {
        precondition(unusedBits < 8)
        return wrap(tag: 0x03, body: Data([unusedBits]) + value)
    }

    static func utf8String(_ value: String) -> Data {
        wrap(tag: 0x0c, body: Data(value.utf8))
    }

    static func utcTime(_ date: Date) -> Data {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyMMddHHmmss'Z'"
        return wrap(tag: 0x17, body: Data(formatter.string(from: date).utf8))
    }

    static func objectIdentifier(_ components: [UInt64]) -> Data {
        precondition(components.count >= 2)
        precondition(components[0] <= 2)
        precondition(components[0] == 2 || components[1] < 40)
        var output = base128(components[0] * 40 + components[1])
        for component in components.dropFirst(2) {
            output.append(contentsOf: base128(component))
        }
        return wrap(tag: 0x06, body: Data(output))
    }

    static func wrap(tag: UInt8, body: Data) -> Data {
        Data([tag]) + encodedLength(body.count) + body
    }

    private static func concatenate(_ values: [Data]) -> Data {
        values.reduce(into: Data()) { result, value in result.append(value) }
    }

    private static func encodedLength(_ count: Int) -> Data {
        precondition(count >= 0)
        if count < 0x80 { return Data([UInt8(count)]) }
        var value = count
        var bytes = [UInt8]()
        while value > 0 {
            bytes.insert(UInt8(value & 0xff), at: 0)
            value >>= 8
        }
        return Data([0x80 | UInt8(bytes.count)] + bytes)
    }

    private static func base128(_ value: UInt64) -> [UInt8] {
        var value = value
        var bytes = [UInt8(value & 0x7f)]
        value >>= 7
        while value > 0 {
            bytes.insert(UInt8(value & 0x7f) | 0x80, at: 0)
            value >>= 7
        }
        return bytes
    }
}

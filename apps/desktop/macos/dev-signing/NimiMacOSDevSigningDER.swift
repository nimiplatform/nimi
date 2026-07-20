import Foundation
import Security

// This narrow DER encoder is required because role private keys are generated
// non-exportable in the dedicated Keychain; removing it would require exporting
// those keys to an external certificate tool. Native tests parse every emitted
// certificate with Security.framework and verify its code-signing extensions.
private enum DER {
    static func sequence(_ values: [Data]) -> Data { wrap(0x30, values.reduce(into: Data()) { $0.append($1) }) }
    static func set(_ values: [Data]) -> Data { wrap(0x31, values.reduce(into: Data()) { $0.append($1) }) }
    static func explicit(_ number: UInt8, _ value: Data) -> Data { wrap(0xa0 | number, value) }
    static func integer(_ value: UInt64) -> Data { var current=value, bytes=[UInt8](); repeat { bytes.insert(UInt8(current & 0xff), at: 0); current >>= 8 } while current != 0; return integer(Data(bytes)) }
    static func integer(_ value: Data) -> Data { var bytes=Array(value.drop(while: {$0 == 0})); if bytes.isEmpty { bytes=[0] }; if bytes[0]&0x80 != 0 { bytes.insert(0,at:0) }; return wrap(0x02,Data(bytes)) }
    static func boolean(_ value: Bool) -> Data { wrap(0x01,Data([value ? 0xff:0])) }
    static func octet(_ value: Data) -> Data { wrap(0x04,value) }
    static func bitString(_ value: Data, unused: UInt8=0) -> Data { wrap(0x03,Data([unused])+value) }
    static func utf8(_ value: String) -> Data { wrap(0x0c,Data(value.utf8)) }
    static func time(_ value: Date) -> Data { let f=DateFormatter(); f.calendar=Calendar(identifier:.gregorian); f.locale=Locale(identifier:"en_US_POSIX"); f.timeZone=TimeZone(secondsFromGMT:0); f.dateFormat="yyMMddHHmmss'Z'"; return wrap(0x17,Data(f.string(from:value).utf8)) }
    static func oid(_ values: [UInt64]) -> Data { var bytes=base128(values[0]*40+values[1]); for value in values.dropFirst(2){bytes += base128(value)}; return wrap(0x06,Data(bytes)) }
    private static func wrap(_ tag: UInt8,_ body: Data)->Data { Data([tag])+length(body.count)+body }
    private static func length(_ count:Int)->Data { if count<0x80{return Data([UInt8(count)])}; var n=count,b=[UInt8]();while n>0{b.insert(UInt8(n&0xff),at:0);n>>=8};return Data([0x80|UInt8(b.count)]+b) }
    private static func base128(_ value:UInt64)->[UInt8]{var n=value,b=[UInt8(n&0x7f)];n>>=7;while n>0{b.insert(UInt8(n&0x7f)|0x80,at:0);n>>=7};return b}
}

func createCertificate(subjectCommonName: String, subjectPublicKey: SecKey, issuer: Issuer, notBefore: Date, notAfter: Date, isCA: Bool) throws -> Data {
    var serial=Data(count:16); let status=serial.withUnsafeMutableBytes{SecRandomCopyBytes(kSecRandomDefault,$0.count,$0.baseAddress!)}
    guard status==errSecSuccess else { throw securityFailure("generate certificate serial",status) }
    serial[0] &= 0x7f; if serial.allSatisfy({$0==0}){serial[0]=1}
    let algorithm=DER.sequence([DER.oid([1,2,840,10045,4,3,2])])
    let extensions = isCA ? [
        extensionValue([2,5,29,19],true,DER.sequence([DER.boolean(true)])),
        extensionValue([2,5,29,15],true,DER.bitString(Data([0x06]),unused:1)),
    ] : [
        extensionValue([2,5,29,19],true,DER.sequence([])),
        extensionValue([2,5,29,15],true,DER.bitString(Data([0x80]),unused:7)),
        extensionValue([2,5,29,37],false,DER.sequence([DER.oid([1,3,6,1,5,5,7,3,3])])),
    ]
    let tbs=DER.sequence([DER.explicit(0,DER.integer(2)),DER.integer(serial),algorithm,name(issuer.commonName),DER.sequence([DER.time(notBefore),DER.time(notAfter)]),name(subjectCommonName),try subjectPublicKeyInfo(subjectPublicKey),DER.explicit(3,DER.sequence(extensions))])
    var error:Unmanaged<CFError>?; guard let signature=SecKeyCreateSignature(issuer.privateKey,.ecdsaSignatureMessageX962SHA256,tbs as CFData,&error) as Data? else { throw securityError("sign development certificate",error) }
    return DER.sequence([tbs,algorithm,DER.bitString(signature)])
}

func subjectPublicKeyInfo(_ key:SecKey)throws->Data { var error:Unmanaged<CFError>?;guard let point=SecKeyCopyExternalRepresentation(key,&error) as Data?,point.count==65,point.first==0x04 else { throw securityError("export role public key",error) };return DER.sequence([DER.sequence([DER.oid([1,2,840,10045,2,1]),DER.oid([1,2,840,10045,3,1,7])]),DER.bitString(point)]) }
private func name(_ common:String)->Data { DER.sequence([DER.set([DER.sequence([DER.oid([2,5,4,3]),DER.utf8(common)])])]) }
private func extensionValue(_ oid:[UInt64],_ critical:Bool,_ value:Data)->Data { var fields=[DER.oid(oid)];if critical{fields.append(DER.boolean(true))};fields.append(DER.octet(value));return DER.sequence(fields) }

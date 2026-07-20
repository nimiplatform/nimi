import Foundation

struct PartialInstallRepairJournal: Codable, Equatable {
    let schemaVersion: String
    let transactionID: String
    let phase: String
    let accountName: String
    let identifier: UInt32
    let groupGeneratedUID: String
    let userGeneratedUID: String
    let sourceHelperSHA256: String
    let sourceHelperCDHash: String
    let sourcePrincipalCarrierContractVersion: Int
    let residueClass: String
    let authenticationEvidenceSHA256: String
    let planDigest: String
    let rootKeyId: String
    let policyDigest: String

    var plan: RuntimeAccountCreationPlan {
        RuntimeAccountCreationPlan(
            identifier: identifier,
            groupGeneratedUID: groupGeneratedUID,
            userGeneratedUID: userGeneratedUID
        )
    }
}

enum PartialInstallRepairJournalCodecFailure: String, Error, Equatable {
    case nonExactFieldSet = "non-exact-field-set"
    case decodeFailed = "decode-failed"
    case nonCanonicalTransactionID = "non-canonical-transaction-id"
    case nonCanonicalBytes = "non-canonical-bytes"

    var probe: String {
        switch self {
        case .nonExactFieldSet: "journal-field-set"
        case .decodeFailed: "journal-json"
        case .nonCanonicalTransactionID: "journal-transaction-id"
        case .nonCanonicalBytes: "journal-canonical-bytes"
        }
    }
}

private let partialInstallRepairJournalExactKeys: Set<String> = [
    "schemaVersion", "transactionID", "phase", "accountName", "identifier",
    "groupGeneratedUID", "userGeneratedUID", "sourceHelperSHA256", "sourceHelperCDHash",
    "sourcePrincipalCarrierContractVersion", "residueClass", "authenticationEvidenceSHA256",
    "planDigest", "rootKeyId", "policyDigest",
]

func canonicalPartialInstallRepairJournalData(
    _ journal: PartialInstallRepairJournal
) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .prettyPrinted, .withoutEscapingSlashes]
    var data = try encoder.encode(journal)
    data.append(0x0a)
    return data
}

func decodeCanonicalPartialInstallRepairJournalStructure(
    _ data: Data
) throws -> PartialInstallRepairJournal {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          Set(object.keys) == partialInstallRepairJournalExactKeys else {
        throw PartialInstallRepairJournalCodecFailure.nonExactFieldSet
    }
    let journal: PartialInstallRepairJournal
    do {
        journal = try JSONDecoder().decode(PartialInstallRepairJournal.self, from: data)
    } catch {
        throw PartialInstallRepairJournalCodecFailure.decodeFailed
    }
    guard UUID(uuidString: journal.transactionID)?.uuidString.lowercased()
            == journal.transactionID else {
        throw PartialInstallRepairJournalCodecFailure.nonCanonicalTransactionID
    }
    guard try canonicalPartialInstallRepairJournalData(journal) == data else {
        throw PartialInstallRepairJournalCodecFailure.nonCanonicalBytes
    }
    return journal
}

func partialInstallRepairOpenedWitnessMatches(
    opened: PartialInstallRepairJournal,
    expected: PartialInstallRepairJournal
) -> Bool {
    opened == expected
}

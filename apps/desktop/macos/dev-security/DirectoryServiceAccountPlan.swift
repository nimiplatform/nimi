import Foundation

let runtimeAccountFullName = "Nimi Runtime Development Service"

struct RuntimeAccountCreationPlan: Codable, Equatable {
    let identifier: UInt32
    let groupGeneratedUID: String
    let userGeneratedUID: String
}

func makeRuntimeAccountCreationPlan(
    identifier: UInt32,
    groupGeneratedUID: String,
    userGeneratedUID: String
) throws -> RuntimeAccountCreationPlan {
    guard (runtimeAccountUIDMinimum...runtimeAccountUIDMaximum).contains(identifier),
          canonicalUUID(groupGeneratedUID),
          canonicalUUID(userGeneratedUID),
          groupGeneratedUID != userGeneratedUID,
          runtimeGeneratedUIDPolicy == "distinct_valid_UUID_required_for_user_and_group",
          runtimeAuthenticationAuthorityPosture == "absent_required",
          runtimeForbiddenAuthenticationMaterialAttributes == [
              "dsAttrTypeStandard:AuthenticationAuthority",
              "dsAttrTypeNative:ShadowHashData",
              "dsAttrTypeStandard:PasswordPlus",
              "dsAttrTypeStandard:AltSecurityIdentities",
              "dsAttrTypeStandard:AuthCredential",
              "dsAttrTypeStandard:AuthMethod",
              "dsAttrTypeStandard:AuthenticationHint",
              "dsAttrTypeStandard:KDCAuthKey",
              "dsAttrTypeStandard:KerberosServices",
              "dsAttrTypeStandard:KerberosRealm",
              "dsAttrTypeNative:KerberosKeys",
              "dsAttrTypeNative:HeimdalSRPKey",
              "dsAttrTypeNative:SecureTokenVerifierHistory",
              "dsAttrTypeNative:AutoGrantSecureToken",
              "dsAttrTypeNative:LinkedIdentity",
          ],
          runtimeForbiddenDelegatedWriterAttributePrefix == "dsAttrTypeNative:_writers",
          runtimeForbiddenExplicitGroupMembershipAttributes == [
              "dsAttrTypeStandard:GroupMembership",
              "dsAttrTypeStandard:GroupMembers",
              "dsAttrTypeStandard:NestedGroups",
          ],
          runtimeNegativeAttributeValuePolicy == "raw_Any_value_count_nonzero_is_present_and_rejected;_binary_or_malformed_values_must_never_be_coerced_to_empty",
          runtimeDirectoryServiceAPI == "public_OpenDirectory_framework_ODNode_createRecord_only",
          runtimeDirectoryServiceCommitPolicy == "fsynced_root_owned_principal_journal_precedes_any_record_mutation_then_ODNode_createRecord_atomically_creates_group_then_user_with_complete_birth_attributes_including_distinct_GeneratedUID_password_star_hidden_state_false_shell_and_empty_home_but_no_AuthenticationAuthority_authentication_material_delegated-writer_or_explicit-group-membership_then_synchronizes_and_a_fresh_exact-signed_real-root_helper_process_reads_raw_OpenDirectory_and_POSIX_identity_and_returns_a_transaction-and-plan-bound_receipt" else {
        throw fail(
            "runtime-service-repair-required",
            "repair the spec-derived macOS Runtime account profile",
            "The admitted OpenDirectory account creation plan is invalid."
        )
    }
    return RuntimeAccountCreationPlan(
        identifier: identifier,
        groupGeneratedUID: groupGeneratedUID,
        userGeneratedUID: userGeneratedUID
    )
}

func canonicalUUID(_ value: String) -> Bool {
    guard let parsed = UUID(uuidString: value) else { return false }
    return parsed.uuidString == value
}

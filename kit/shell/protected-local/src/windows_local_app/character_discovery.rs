use super::{invalid_payload, untrusted};
use crate::generated::*;
use crate::grpc_status::local_app_error_from_status;
use crate::LocalAppOperationError;
use serde::Deserialize;
use serde_json::{json, Value};
use tonic::transport::Channel;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Query { query: Option<String>, cursor: Option<String>, page_size: Option<u32> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Connect { source_ref: Source, request_id: String }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source { kind: String, id: String, world_id: String, source_hash: String, world_entity_ref: Option<Entity>, owner_account_id: Option<String> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Entity { kind: String, world_id: String, entity_id: String }

// @nimi-authority: rule.nimi.sdks.feature-clients.character-discovery
pub(super) async fn list(channel: Channel, input: Value) -> Result<Value, LocalAppOperationError> {
    let input: Query = serde_json::from_value(input).map_err(|_| invalid_payload())?;
    let query = input.query.unwrap_or_default(); let cursor = input.cursor.unwrap_or_default(); let page_size = input.page_size.unwrap_or(20);
    if query.len() > 256 || cursor.len() > 4096 || !(1..=50).contains(&page_size) { return Err(invalid_payload()); }
    let page = crate::grpc_limits::runtime_agent_client(channel).list_local_app_character_sources(ListLocalAppCharacterSourcesRequest { query, cursor, page_size }).await.map_err(local_app_error_from_status)?.into_inner();
    let items = page.items.into_iter().map(|item| Ok(json!({
        "sourceRef": project_source(item.source_ref.ok_or_else(untrusted)?)?, "displayName": item.display_name,
        "summary": item.summary, "worldName": item.world_name, "avatarUrl": item.avatar_url,
        "disposition": item.disposition, "traits": item.traits, "topics": item.topics, "connectable": item.connectable,
        "existingPartner": item.existing_partner.map(project_partner)
    }))).collect::<Result<Vec<Value>, LocalAppOperationError>>()?;
    Ok(json!({"items": items, "nextCursor": page.next_cursor}))
}

pub(super) async fn connect(channel: Channel, input: Value) -> Result<Value, LocalAppOperationError> {
    let input: Connect = serde_json::from_value(input).map_err(|_| invalid_payload())?;
    if input.request_id.is_empty() || input.request_id.len() > 128 { return Err(invalid_payload()); }
    let source = input.source_ref;
    let source = match source.kind.as_str() {
        "worldCharacter" if source.owner_account_id.is_none() => {
            let entity = source.world_entity_ref.ok_or_else(invalid_payload)?;
            if entity.kind != "worldEntity" || entity.world_id != source.world_id { return Err(invalid_payload()); }
            character_source_ref_v3::Source::WorldCharacter(WorldCharacterSourceRefV3 { kind: CharacterSourceKindV3::WorldCharacter as i32, id: source.id, world_id: source.world_id, source_hash: source.source_hash, world_entity_ref: Some(WorldEntityRefV3 { kind: WorldEntityRefKindV3::WorldEntity as i32, world_id: entity.world_id, entity_id: entity.entity_id }) })
        },
        "personaCharacter" if source.world_entity_ref.is_none() => character_source_ref_v3::Source::PersonaCharacter(PersonaCharacterSourceRefV3 { kind: CharacterSourceKindV3::PersonaCharacter as i32, id: source.id, world_id: source.world_id, source_hash: source.source_hash, owner_account_id: source.owner_account_id.ok_or_else(invalid_payload)? }),
        _ => return Err(invalid_payload()),
    };
    let result = crate::grpc_limits::runtime_agent_client(channel).connect_local_app_character_source(ConnectLocalAppCharacterSourceRequest { source_ref: Some(CharacterSourceRefV3 { source: Some(source) }), request_id: input.request_id }).await.map_err(local_app_error_from_status)?.into_inner();
    Ok(json!({"partner": project_partner(result.partner.ok_or_else(untrusted)?), "created": result.created}))
}

fn project_partner(partner: LocalAppAgentReference) -> Value {
    json!({"agentHandle": partner.agent_handle, "agentBinding": partner.agent_binding, "activityAgentRef": partner.activity_agent_ref, "displayName": partner.display_name, "avatarUrl": partner.avatar_url})
}
fn project_source(source: CharacterSourceRefV3) -> Result<Value, LocalAppOperationError> {
    match source.source.ok_or_else(untrusted)? {
        character_source_ref_v3::Source::WorldCharacter(source) => {
            let entity = source.world_entity_ref.ok_or_else(untrusted)?;
            Ok(json!({"kind":"worldCharacter", "id":source.id, "worldId":source.world_id, "sourceHash":source.source_hash, "worldEntityRef":{"kind":"worldEntity", "worldId":entity.world_id, "entityId":entity.entity_id}}))
        },
        character_source_ref_v3::Source::PersonaCharacter(source) => Ok(json!({"kind":"personaCharacter", "id":source.id, "worldId":source.world_id, "sourceHash":source.source_hash, "ownerAccountId":source.owner_account_id})),
    }
}

# Pagination & Filtering Contract

> Owner Domain: `K-PAGE-*`

## K-PAGE-001 page_size

`ListConnectors` / `ListConnectorModels`：

- 默认 `50`
- 最大 `200`
- 超上限按最大值裁剪

## K-PAGE-002 page_token 语义

- 不透明游标
- 至少包含“排序断点 + 过滤摘要”
- 非法 token（格式错误/签名校验失败/过滤不匹配）返回 `INVALID_ARGUMENT` + `AI_CONNECTOR_INVALID`

## K-PAGE-003 排序稳定性

`ListConnectors` 固定排序：

1. kind：`LOCAL_MODEL` 在前，`REMOTE_MANAGED` 在后
2. local：`local_category` 升序，同 category 按 `connector_id ASC`
3. remote：`created_at DESC`，同值 `connector_id ASC`

`ListConnectorModels`：`model_id ASC`

## K-PAGE-004 过滤语义

- `kind_filter/status_filter` 中 `UNSPECIFIED` 条目静默忽略。
- `provider_filter` 继承 provider 小写约束；trim 后空值静默忽略。
- 过滤后无匹配返回空列表，不返回错误。

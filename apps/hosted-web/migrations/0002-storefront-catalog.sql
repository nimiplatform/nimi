-- Run node apps/hosted-web/publish.mjs migrate <registry-checkout> to add the
-- products columns and refresh existing rows from the reviewed Registry snapshot.
CREATE TABLE IF NOT EXISTS storefront_catalog (
  app_id TEXT PRIMARY KEY,
  primary_version TEXT NOT NULL,
  target_releases_json TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  has_storefront INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  default_locale TEXT,
  summary_en TEXT NOT NULL,
  summary_zh TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '{}',
  icon_asset TEXT,
  cover_assets_json TEXT,
  synced_commit TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

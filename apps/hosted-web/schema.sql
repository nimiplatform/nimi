CREATE TABLE IF NOT EXISTS registry_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  slug TEXT PRIMARY KEY,
  app_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  publisher TEXT NOT NULL,
  repository TEXT NOT NULL,
  license TEXT NOT NULL,
  summary_en TEXT NOT NULL,
  summary_zh TEXT NOT NULL,
  pc_targets TEXT NOT NULL,
  pc_target_versions_json TEXT NOT NULL DEFAULT '{}',
  capabilities TEXT NOT NULL,
  visible INTEGER NOT NULL,
  blocked INTEGER NOT NULL,
  origin TEXT,
  upstream_json TEXT,
  client_id TEXT,
  source_revision INTEGER,
  source_active INTEGER NOT NULL,
  policy_commit TEXT NOT NULL,
  active_version TEXT,
  active_digest TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  ready INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pending_web_publications ON products(app_id)
  WHERE pending=1 AND blocked=0 AND source_active=1;
CREATE TABLE IF NOT EXISTS releases (
  app_id TEXT NOT NULL,
  version TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  digest TEXT NOT NULL,
  PRIMARY KEY (app_id, version)
);
CREATE TRIGGER IF NOT EXISTS activate_release AFTER UPDATE OF active_version, active_digest ON products
WHEN NEW.active_version IS NOT NULL AND (OLD.active_version IS NOT NEW.active_version OR OLD.active_digest IS NOT NEW.active_digest) BEGIN
  SELECT RAISE(ABORT,'Conflicting immutable Web release') WHERE EXISTS (
    SELECT 1 FROM releases WHERE app_id=NEW.app_id AND version=NEW.active_version AND (digest<>NEW.active_digest OR source_revision<>NEW.source_revision));
  INSERT INTO releases(app_id,version,source_revision,digest)
    SELECT NEW.app_id,NEW.active_version,NEW.source_revision,NEW.active_digest
    WHERE NOT EXISTS (SELECT 1 FROM releases WHERE app_id=NEW.app_id AND version=NEW.active_version);
END;
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

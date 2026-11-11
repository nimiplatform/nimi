import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export type SiteAccount = { id: string; username: string; nimiAccountId: string | null };

/** The reference website's own identity store, separate from Nimi identity. */
export class Accounts {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    this.#db = new DatabaseSync(path);
    this.#db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS website_user(
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL,
        password_hash TEXT NOT NULL, nimi_account_id TEXT
      );`);
  }
  async register(username: string, password: string): Promise<SiteAccount> {
    validateCredentials(username, password);
    const salt = randomBytes(16).toString('hex');
    const hash = await derive(password, salt, 64) as Buffer;
    const id = randomUUID();
    try { this.#db.prepare('INSERT INTO website_user(id,username,salt,password_hash) VALUES(?,?,?,?)')
      .run(id, username, salt, hash.toString('hex')); }
    catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('此网站用户名已被使用。');
      throw error;
    }
    return this.get(id)!;
  }
  async login(username: string, password: string): Promise<SiteAccount> {
    validateCredentials(username, password);
    const row = this.#db.prepare('SELECT id,salt,password_hash FROM website_user WHERE username=?').get(username) as
      { id: string; salt: string; password_hash: string } | undefined;
    // Unknown users still perform the password derivation; no account enumeration result.
    const hash = await derive(password, row?.salt ?? 'reference-unknown-user', 64) as Buffer;
    if (!row || !timingSafeEqual(hash, Buffer.from(row.password_hash, 'hex'))) throw new Error('网站用户名或密码不正确。');
    return this.get(row.id)!;
  }
  get(id: string): SiteAccount | null {
    const row = this.#db.prepare('SELECT id,username,nimi_account_id FROM website_user WHERE id=?').get(id) as
      { id: string; username: string; nimi_account_id: string | null } | undefined;
    return row ? { id: row.id, username: row.username, nimiAccountId: row.nimi_account_id } : null;
  }
  associate(id: string, verifiedNimiAccountId: string): void {
    if (!verifiedNimiAccountId) throw new Error('缺少已验证的 Nimi 身份。');
    const result = this.#db.prepare(`UPDATE website_user SET nimi_account_id=?
      WHERE id=? AND (nimi_account_id IS NULL OR nimi_account_id=?)`).run(verifiedNimiAccountId, id, verifiedNimiAccountId);
    if (result.changes !== 1) throw new Error('此网站账号已关联其他 Nimi 账号，请先解除关联。');
  }
  unlink(id: string): void { this.#db.prepare('UPDATE website_user SET nimi_account_id=NULL WHERE id=?').run(id); }
  close(): void { this.#db.close(); }
}

function validateCredentials(username: string, password: string): void {
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(username) || password.length < 12 || password.length > 128) {
    throw new Error('用户名需为 3–40 位字母、数字、下划线或短横线；密码需为 12–128 个字符。');
  }
}

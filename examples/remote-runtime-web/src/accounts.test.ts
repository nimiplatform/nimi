import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Accounts } from './accounts.ts';

test('website credentials authenticate separate users; Nimi association never uses matching names', async () => {
  const accounts = new Accounts(':memory:');
  try {
    const a = await accounts.register('reader_a', 'a-secret-password');
    const b = await accounts.register('reader_b', 'b-secret-password');
    await assert.rejects(accounts.login('reader_a', 'b-secret-password'));
    assert.equal((await accounts.login('reader_b', 'b-secret-password')).id, b.id);
    accounts.associate(a.id, 'verified-nimi-b');
    accounts.associate(b.id, 'verified-nimi-a');
    assert.equal(accounts.get(a.id)?.nimiAccountId, 'verified-nimi-b');
    assert.equal(accounts.get(b.id)?.nimiAccountId, 'verified-nimi-a');
    assert.throws(() => accounts.associate(a.id, 'verified-nimi-a'));
    accounts.unlink(a.id);
    accounts.associate(a.id, 'verified-nimi-a');
    assert.equal(accounts.get(a.id)?.nimiAccountId, 'verified-nimi-a');
    assert.equal(accounts.get(b.id)?.nimiAccountId, 'verified-nimi-a');
  } finally { accounts.close(); }
});

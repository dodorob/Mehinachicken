'use strict';

const assert = require('assert');

let saveQueue = Promise.resolve();
let _dbCache = { invoices: [] };
const STORE_KEY = 'buchpro_v1';
const localStorage = { data: {}, fail: false, setItem(k, v) { if (this.fail) throw new Error('QuotaExceeded'); this.data[k] = v; }, getItem(k) { return this.data[k] || null; } };
function cloneForSave(d) { return JSON.parse(JSON.stringify(d)); }
function getDB() { return _dbCache; }
function enqueueDbWrite(operation) { const task = saveQueue.then(operation); saveQueue = task.catch(function() {}); return task; }
function saveDB(d) { _dbCache = d; const snapshot = cloneForSave(d); return enqueueDbWrite(() => { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot)); return { ok: true }; }); }
async function browserPersist(applyChange) { const previous = cloneForSave(getDB()); const next = cloneForSave(previous); try { applyChange(next); await saveDB(next); _dbCache = next; return next; } catch (e) { _dbCache = previous; throw e; } }
const create = inv => browserPersist(next => { next.invoices = next.invoices.filter(i => i.id !== inv.id); next.invoices.push(inv); });
const update = inv => browserPersist(next => { next.invoices = next.invoices.map(i => i.id === inv.id ? Object.assign({}, i, inv) : i); });
const del = id => browserPersist(next => { next.invoices = next.invoices.filter(i => i.id !== id); });
const status = (id, st) => browserPersist(next => { next.invoices = next.invoices.map(i => i.id === id ? Object.assign({}, i, { status: st }) : i); });
const load = () => JSON.parse(localStorage.getItem(STORE_KEY));

(async () => {
  await create({ id: 'A', status: 'offen', notizen: 'a', file_b64: 'pdf' });
  assert.ok(load().invoices.find(i => i.id === 'A'));
  await update({ id: 'A', notizen: 'changed' });
  assert.strictEqual(load().invoices[0].notizen, 'changed');
  await status('A', 'bezahlt');
  assert.deepStrictEqual(Object.assign({}, load().invoices[0], { status: 'offen' }), { id: 'A', status: 'offen', notizen: 'changed', file_b64: 'pdf' });
  const before = cloneForSave(getDB());
  localStorage.fail = true;
  let failed = false;
  try { await update({ id: 'A', notizen: 'lost' }); } catch (_) { failed = true; }
  assert.ok(failed);
  assert.deepStrictEqual(getDB(), before);
  localStorage.fail = false;
  await del('A');
  assert.strictEqual(load().invoices.length, 0);
  console.log('invoice browser localStorage tests passed');
})();

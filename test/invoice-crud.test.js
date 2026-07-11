'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BuchProDB = require('../database');

function baseInvoice(id, extra = {}) {
  return Object.assign({
    id,
    typ: 'ausgang',
    nummer: id,
    lfd_nr: id,
    zahlungsart: 'bank',
    partner_name: `Partner ${id}`,
    datum: '2026-01-01',
    faellig: '2026-01-15',
    status: 'offen',
    notizen: `note ${id}`,
    materialkosten: 12.34,
    file_b64: `pdf-${id}`,
    file_name: `${id}.pdf`,
    file_type: 'application/pdf',
    items: [{ titel: `Item ${id}`, desc: 'desc', menge: 1, preis: 100, ust: 20 }],
    er_items: [],
    erstellt: '2026-01-01T00:00:00.000Z',
  }, extra);
}

async function withDb(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoice-crud-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new BuchProDB();
  db.open(dbPath);
  try {
    return await fn(db);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function invoices(db) {
  return db.loadAll().invoices.sort((a, b) => a.id.localeCompare(b.id));
}

function byId(db, id) {
  return db.loadAll().invoices.find(inv => inv.id === id);
}

function assertUnchanged(actual, expected) {
  assert.deepStrictEqual(actual, expected);
}

async function crudTests() {
await withDb((db) => {
  const a = baseInvoice('A');
  const b = baseInvoice('B');
  db.createInvoice(a);
  db.createInvoice(b);
  const beforeA = byId(db, 'A');
  const beforeB = byId(db, 'B');

  db.createInvoice(baseInvoice('C'));
  assert.deepStrictEqual(invoices(db).map(i => i.id), ['A', 'B', 'C']);
  assertUnchanged(byId(db, 'A'), beforeA);
  assertUnchanged(byId(db, 'B'), beforeB);
});

await withDb((db) => {
  ['A', 'B', 'C'].forEach(id => db.createInvoice(baseInvoice(id)));
  const beforeA = byId(db, 'A');
  const beforeC = byId(db, 'C');
  db.updateInvoice(Object.assign({}, byId(db, 'B'), { notizen: 'changed', file_b64: 'still-present' }));
  assert.strictEqual(byId(db, 'B').notizen, 'changed');
  assert.strictEqual(byId(db, 'B').file_b64, 'still-present');
  assertUnchanged(byId(db, 'A'), beforeA);
  assertUnchanged(byId(db, 'C'), beforeC);
});

await withDb((db) => {
  ['A', 'B', 'C'].forEach(id => db.createInvoice(baseInvoice(id)));
  const beforeA = byId(db, 'A');
  const beforeC = byId(db, 'C');
  db.deleteInvoice('B');
  assert.deepStrictEqual(invoices(db).map(i => i.id), ['A', 'C']);
  assertUnchanged(byId(db, 'A'), beforeA);
  assertUnchanged(byId(db, 'C'), beforeC);
});

await withDb((db) => {
  ['A', 'B', 'C'].forEach(id => db.createInvoice(baseInvoice(id)));
  const before = invoices(db);
  assert.throws(() => db.updateInvoice(baseInvoice('missing')), /nicht gefunden/);
  assert.deepStrictEqual(invoices(db), before);
});

await withDb((db) => {
  db.createInvoice(baseInvoice('A'));
  const before = byId(db, 'A');
  assert.throws(() => db.createInvoice(baseInvoice('A', { notizen: 'overwrite attempt' })));
  assertUnchanged(byId(db, 'A'), before);
});

await withDb((db) => {
  db.createInvoice(baseInvoice('A'));
  db.createInvoice(baseInvoice('B'));
  const staleRendererSnapshot = [baseInvoice('A'), baseInvoice('B')];
  db.createInvoice(baseInvoice('C'));
  db.updateInvoice(Object.assign({}, staleRendererSnapshot[0], { notizen: 'edited from stale snapshot' }));
  assert.deepStrictEqual(invoices(db).map(i => i.id), ['A', 'B', 'C']);
  assert.strictEqual(byId(db, 'A').notizen, 'edited from stale snapshot');
  assert.strictEqual(byId(db, 'B').notizen, 'note B');
  assert.strictEqual(byId(db, 'C').notizen, 'note C');
});

}

async function queueTests() {
  await withDb(async (db) => {
    ['A', 'B', 'C'].forEach(id => db.createInvoice(baseInvoice(id)));
    const order = [];
    let queue = Promise.resolve();
    function enqueue(label, fn) {
      const task = queue.then(() => {
        order.push(label);
        return fn();
      });
      queue = task.catch(() => {});
      return task;
    }
    await Promise.all([
      enqueue('update A', () => db.updateInvoice(Object.assign({}, byId(db, 'A'), { notizen: 'A1' }))),
      enqueue('update B', () => db.updateInvoice(Object.assign({}, byId(db, 'B'), { notizen: 'B1' }))),
      enqueue('delete C', () => db.deleteInvoice('C')),
    ]);
    assert.deepStrictEqual(order, ['update A', 'update B', 'delete C']);
    assert.deepStrictEqual(invoices(db).map(i => i.id), ['A', 'B']);
  });

  await withDb(async (db) => {
    ['A', 'B'].forEach(id => db.createInvoice(baseInvoice(id)));
    let queue = Promise.resolve();
    function enqueue(fn) {
      const task = queue.then(fn);
      queue = task.catch(() => {});
      return task;
    }
    await enqueue(() => db.updateInvoice(Object.assign({}, byId(db, 'A'), { notizen: 'A1' })));
    await assert.rejects(enqueue(() => db.updateInvoice(baseInvoice('missing'))));
    await enqueue(() => db.updateInvoice(Object.assign({}, byId(db, 'B'), { notizen: 'B1' })));
    assert.strictEqual(byId(db, 'A').notizen, 'A1');
    assert.strictEqual(byId(db, 'B').notizen, 'B1');
  });
}

(async () => {
  await crudTests();
  await queueTests();
})().then(() => {
  console.log('invoice CRUD tests passed');
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

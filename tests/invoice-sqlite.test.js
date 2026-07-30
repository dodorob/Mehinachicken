'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BuchProDB = require('../database');

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mehina-invoice-'));
  const file = path.join(dir, 'test.sqlite');
  const db = new BuchProDB();
  db.open(file);
  return { db, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function inv(id, extra) {
  return Object.assign({
    id, typ: 'ausgang', nummer: id, lfd_nr: id, zahlungsart: 'bank', partner_name: 'Partner ' + id,
    datum: '2026-01-01', faellig: '2026-01-15', status: 'offen', notizen: 'note ' + id,
    materialkosten: 1, items: [{ titel: 'Pos ' + id, menge: 1, preis: 10, ust: 20 }], er_items: [],
    file_b64: id === 'B' ? 'data:application/pdf;base64,BBB' : null,
    file_name: id === 'B' ? 'b.pdf' : null,
    file_type: id === 'B' ? 'application/pdf' : null,
  }, extra || {});
}

function byId(list) { return Object.fromEntries(list.map(i => [i.id, i])); }
function stripOrder(db) { return byId(db.loadAll().invoices); }
async function assertRejects(fn) { let ok = false; try { await fn(); } catch (_) { ok = true; } assert.ok(ok, 'expected operation to fail'); }

async function testCrudAndSafety() {
  const { db, cleanup } = tempDb();
  try {
    db.createInvoice(inv('A'));
    db.createInvoice(inv('B'));
    const beforeAB = stripOrder(db);

    db.createInvoice(inv('C'));
    let all = stripOrder(db);
    assert.deepStrictEqual(Object.keys(all).sort(), ['A', 'B', 'C']);
    assert.deepStrictEqual(all.A, beforeAB.A);
    assert.deepStrictEqual(all.B, beforeAB.B);

    const beforeEdit = stripOrder(db);
    db.updateInvoice(Object.assign({}, beforeEdit.B, { notizen: 'changed', partner_name: 'Changed B' }));
    all = stripOrder(db);
    assert.strictEqual(all.B.notizen, 'changed');
    assert.deepStrictEqual(all.A, beforeEdit.A);
    assert.deepStrictEqual(all.C, beforeEdit.C);

    const beforeDelete = stripOrder(db);
    db.deleteInvoice('B');
    all = stripOrder(db);
    assert.deepStrictEqual(Object.keys(all).sort(), ['A', 'C']);
    assert.deepStrictEqual(all.A, beforeDelete.A);
    assert.deepStrictEqual(all.C, beforeDelete.C);

    db.createInvoice(inv('B'));
    const beforeStatus = stripOrder(db);
    db.updateInvoiceStatus('B', 'bezahlt');
    all = stripOrder(db);
    assert.strictEqual(all.B.status, 'bezahlt');
    const expectedB = Object.assign({}, beforeStatus.B, { status: 'bezahlt' });
    assert.deepStrictEqual(all.B, expectedB);
    assert.deepStrictEqual(all.A, beforeStatus.A);
    assert.deepStrictEqual(all.C, beforeStatus.C);

    const beforeUnknown = stripOrder(db);
    await assertRejects(() => db.updateInvoice(inv('UNKNOWN')));
    assert.deepStrictEqual(stripOrder(db), beforeUnknown);

    const beforeDuplicate = stripOrder(db);
    await assertRejects(() => db.createInvoice(inv('A', { partner_name: 'Overwrite attempt' })));
    assert.deepStrictEqual(stripOrder(db), beforeDuplicate);

    db.updateInvoice({ id: 'B', notizen: 'without pdf upload' });
    all = stripOrder(db);
    assert.strictEqual(all.B.file_b64, 'data:application/pdf;base64,BBB');
    assert.strictEqual(all.B.file_name, 'b.pdf');
    assert.strictEqual(all.B.file_type, 'application/pdf');

    const staleA = Object.assign({}, all.A, { notizen: 'stale renderer update' });
    db.updateInvoice(staleA);
    all = stripOrder(db);
    assert.deepStrictEqual(Object.keys(all).sort(), ['A', 'B', 'C']);
    assert.strictEqual(all.A.notizen, 'stale renderer update');
    assert.ok(all.C, 'C must survive stale renderer update');

    const beforeSaveAll = stripOrder(db);
    db.saveAll({ invoices: [inv('A', { notizen: 'stale full snapshot' })], kunden: [{ id: 'K1', name: 'Kunde' }] });
    assert.deepStrictEqual(stripOrder(db), beforeSaveAll);
    assert.strictEqual(db.loadAll().kunden[0].name, 'Kunde');
  } finally { cleanup(); }
}

function enqueueFactory(log) {
  let saveQueue = Promise.resolve();
  return function enqueueDbWrite(operation) {
    const task = saveQueue.then(operation);
    saveQueue = task.catch(function() {});
    return task;
  };
}
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }


function setCounters(db, values) { db.updateInvoiceCounters(values); }
function counters(db) { return db.loadAll().counters; }
function atomicInv(id, extra) { return Object.assign({ id, typ: 'ausgang', zahlungsart: 'bank', partner_name: 'P', datum: '2026-01-01', status: 'offen', items: [] }, extra || {}); }

async function testAtomicInvoiceCounters() {
  let t = tempDb();
  try {
    setCounters(t.db, { ausgang: 1, fortlaufend: 10, lfd_bank: 80, kassenbeleg: 50 });
    const ar = t.db.createInvoiceWithCounters(atomicInv('BANK-AR', { typ: 'ausgang', zahlungsart: 'bank' }), { numberMode: 'auto' }).invoice;
    const er = t.db.createInvoiceWithCounters(atomicInv('BANK-ER', { typ: 'eingang', nummer: '', zahlungsart: 'bank' }), { numberMode: 'auto' }).invoice;
    assert.strictEqual(ar.nummer, '001');
    assert.strictEqual(ar.lfd_nr, '');
    assert.strictEqual(er.nummer, null);
    assert.strictEqual(er.lfd_nr, '');
    assert.strictEqual(ar.zahlungs_lfd_nr, '080');
    assert.strictEqual(ar.kassenbeleg_nr, null);
    assert.strictEqual(er.zahlungs_lfd_nr, '081');
    assert.strictEqual(er.kassenbeleg_nr, null);
    assert.strictEqual(counters(t.db).ausgang, 2);
    assert.strictEqual(counters(t.db).fortlaufend, 10);
    assert.strictEqual(counters(t.db).lfd_bank, 82);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 1, fortlaufend: 20, lfd_bank: 80, kassenbeleg: 50 });
    const erBank = t.db.createInvoiceWithCounters(atomicInv('BANK-ER-2', { typ: 'eingang', nummer: '', zahlungsart: 'bank' }), { numberMode: 'auto' }).invoice;
    const arKassa = t.db.createInvoiceWithCounters(atomicInv('KASSA-AR', { typ: 'ausgang', zahlungsart: 'kassa' }), { numberMode: 'auto' }).invoice;
    const arBank = t.db.createInvoiceWithCounters(atomicInv('BANK-AR-2', { typ: 'ausgang', zahlungsart: 'bank' }), { numberMode: 'auto' }).invoice;
    assert.deepStrictEqual([erBank.lfd_nr, arKassa.lfd_nr, arBank.lfd_nr], ['', '020', '']);
    assert.strictEqual(erBank.zahlungs_lfd_nr, '080');
    assert.strictEqual(arKassa.zahlungs_lfd_nr, '050');
    assert.strictEqual(arKassa.kassenbeleg_nr, '050');
    assert.strictEqual(arBank.zahlungs_lfd_nr, '081');
    assert.strictEqual(arBank.kassenbeleg_nr, null);
    assert.strictEqual(counters(t.db).fortlaufend, 21);
    assert.strictEqual(counters(t.db).lfd_bank, 82);
    assert.strictEqual(counters(t.db).kassenbeleg, 51);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    t.db.saveAll({ counters: { lfd_kassa: 700 }, kunden: [] });
    setCounters(t.db, { ausgang: 1, fortlaufend: 30, lfd_bank: 500, kassenbeleg: 80 });
    const erKassa = t.db.createInvoiceWithCounters(atomicInv('KASSA-ER', { typ: 'eingang', nummer: '', zahlungsart: 'kassa' }), { numberMode: 'auto' }).invoice;
    const arBank = t.db.createInvoiceWithCounters(atomicInv('OLD-LFD-AR', { typ: 'ausgang', zahlungsart: 'bank' }), { numberMode: 'auto' }).invoice;
    const tl = t.db.createInvoiceWithCounters(atomicInv('TL', { typ: 'eingang', nummer: '', zahlungsart: 'bank', is_tageslosung: true }), { numberMode: 'auto' }).invoice;
    assert.deepStrictEqual([erKassa.lfd_nr, arBank.lfd_nr, tl.lfd_nr], ['030', '', '']);
    assert.strictEqual(erKassa.zahlungs_lfd_nr, null);
    assert.strictEqual(erKassa.kassenbeleg_nr, null);
    assert.strictEqual(arBank.zahlungs_lfd_nr, '500');
    assert.strictEqual(tl.zahlungs_lfd_nr, '501');
    const c = counters(t.db);
    assert.strictEqual(c.fortlaufend, 31);
    assert.strictEqual(c.kassenbeleg, 80);
    assert.strictEqual(c.lfd_bank, 502);
    assert.strictEqual(c.lfd_kassa, 700);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 1, fortlaufend: 1, kassenbeleg: 1 });
    t.db.createInvoice(atomicInv('EXISTING', { nummer: '001', lfd_nr: 'old' }));
    await assertRejects(() => t.db.createInvoiceWithCounters(atomicInv('DUPNR'), { numberMode: 'auto' }));
    assert.ok(!t.db.getInvoice('DUPNR'));
    assert.strictEqual(counters(t.db).ausgang, 1);
    assert.strictEqual(counters(t.db).fortlaufend, 1);
    assert.strictEqual(counters(t.db).kassenbeleg, 1);
  } finally { t.cleanup(); }



  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 1, fortlaufend: 5, lfd_bank: 70, kassenbeleg: 9 });
    t.db.db.prepare("DELETE FROM counters WHERE name = 'fortlaufend'").run();
    const bank = t.db.createInvoiceWithCounters(atomicInv('BANK-NO-FORTLAUFEND', { typ: 'ausgang', zahlungsart: 'bank' }), { numberMode: 'auto' }).invoice;
    assert.strictEqual(bank.nummer, '001');
    assert.strictEqual(bank.lfd_nr, '');
    assert.strictEqual(bank.zahlungs_lfd_nr, '070');
    assert.strictEqual(counters(t.db).lfd_bank, 71);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 3, fortlaufend: 7, kassenbeleg: 9 });
    const before = counters(t.db);
    await assertRejects(() => t.db.createInvoiceWithCounters(atomicInv('X'), { numberMode: 'manual', requestedNumber: '' }));
    assert.deepStrictEqual(counters(t.db), before);
    assert.ok(!t.db.getInvoice('X'));
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 1, fortlaufend: 10, kassenbeleg: 1 });
    const a = t.db.createInvoiceWithCounters(atomicInv('A'), { numberMode: 'auto' }).invoice;
    await assertRejects(() => t.db.createInvoiceWithCounters(atomicInv('B', { nummer: '' }), { numberMode: 'manual', requestedNumber: '' }));
    const c = t.db.createInvoiceWithCounters(atomicInv('C'), { numberMode: 'auto' }).invoice;
    assert.deepStrictEqual([a.nummer, c.nummer], ['001', '002']);
    assert.deepStrictEqual([a.lfd_nr, c.lfd_nr], ['', '']);
    assert.strictEqual(counters(t.db).ausgang, 3);
    assert.strictEqual(counters(t.db).fortlaufend, 10);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 1, fortlaufend: 1, kassenbeleg: 1 });
    const nums = ['Q1','Q2','Q3'].map(id => t.db.createInvoiceWithCounters(atomicInv(id), { numberMode: 'auto' }).invoice);
    assert.deepStrictEqual(nums.map(i => i.nummer), ['001','002','003']);
    assert.deepStrictEqual(nums.map(i => i.lfd_nr), ['', '', '']);
    assert.strictEqual(counters(t.db).ausgang, 4);
    assert.strictEqual(counters(t.db).fortlaufend, 1);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 1, fortlaufend: 1, kassenbeleg: 1 });
    t.db.createInvoiceWithCounters(atomicInv('OLDPREVIEW'), { numberMode: 'auto' });
    const r = t.db.createInvoiceWithCounters(atomicInv('NEW'), { numberMode: 'auto' });
    assert.strictEqual(r.invoice.nummer, '002');
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 5, fortlaufend: 6, kassenbeleg: 1 });
    const r = t.db.createInvoiceWithCounters(atomicInv('MAN'), { numberMode: 'manual', requestedNumber: 'MAN-77' });
    assert.strictEqual(r.invoice.nummer, 'MAN-77');
    assert.strictEqual(r.invoice.lfd_nr, '');
    assert.strictEqual(counters(t.db).ausgang, 6);
    assert.strictEqual(counters(t.db).fortlaufend, 6);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 10, fortlaufend: 20, kassenbeleg: 40 });
    const stale = { counters: { ausgang: 1, fortlaufend: 2, kassenbeleg: 4, lfd_bank: 99 }, kunden: [{ id: 'K2', name: 'Other' }] };
    t.db.createInvoiceWithCounters(atomicInv('SAFE'), { numberMode: 'auto' });
    t.db.saveAll(stale);
    assert.ok(t.db.getInvoice('SAFE'));
    assert.strictEqual(counters(t.db).ausgang, 11);
    assert.strictEqual(counters(t.db).fortlaufend, 20);
    assert.strictEqual(counters(t.db).kassenbeleg, 40);
    assert.strictEqual(counters(t.db).lfd_bank, 21);
    assert.strictEqual(t.db.loadAll().kunden[0].name, 'Other');
  } finally { t.cleanup(); }



  t = tempDb();
  try {
    t.db.createInvoice(atomicInv('LFD-EXISTS-BANK', { nummer: '900', lfd_nr: '025', zahlungsart: 'bank' }));
    setCounters(t.db, { ausgang: 50, fortlaufend: 25, lfd_bank: 80, kassenbeleg: 80 });
    const bankWithDuplicateLfd = t.db.createInvoiceWithCounters(atomicInv('LFD-DUP-BANK', { typ: 'eingang', zahlungsart: 'bank' }), { numberMode: 'auto' }).invoice;
    assert.strictEqual(bankWithDuplicateLfd.lfd_nr, '');
    assert.strictEqual(bankWithDuplicateLfd.zahlungs_lfd_nr, '080');
    t.db.createInvoice(atomicInv('LFD-EXISTS-KASSA', { nummer: '901', lfd_nr: '025', zahlungsart: 'kassa' }));
    const before = counters(t.db);
    await assertRejects(() => t.db.createInvoiceWithCounters(atomicInv('LFD-DUP-KASSA', { zahlungsart: 'kassa' }), { numberMode: 'auto' }));
    assert.ok(!t.db.getInvoice('LFD-DUP-KASSA'));
    assert.deepStrictEqual(counters(t.db), before);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 1, fortlaufend: 1, kassenbeleg: 25 });
    const autoKb = t.db.createInvoiceWithCounters(atomicInv('KB-AUTO', { zahlungsart: 'kassa' }), { numberMode: 'auto' }).invoice;
    assert.strictEqual(autoKb.zahlungs_lfd_nr, '025');
    assert.strictEqual(autoKb.kassenbeleg_nr, '025');
    assert.strictEqual(counters(t.db).kassenbeleg, 26);
    const manualKb = t.db.createInvoiceWithCounters(atomicInv('KB-MANUAL', { zahlungsart: 'kassa' }), { numberMode: 'auto', kassenbelegMode: 'manual', requestedKassenbeleg: '027' }).invoice;
    assert.strictEqual(manualKb.zahlungs_lfd_nr, '027');
    assert.strictEqual(manualKb.kassenbeleg_nr, '027');
    assert.strictEqual(counters(t.db).kassenbeleg, 28);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    setCounters(t.db, { ausgang: 1, fortlaufend: 1, kassenbeleg: 27 });
    t.db.createInvoice(atomicInv('KB-EXISTS', { nummer: '800', lfd_nr: '800', zahlungsart: 'kassa', kassenbeleg_nr: '027' }));
    const before = counters(t.db);
    await assertRejects(() => t.db.createInvoiceWithCounters(atomicInv('KB-DUP', { zahlungsart: 'kassa' }), { numberMode: 'auto', kassenbelegMode: 'manual', requestedKassenbeleg: '27' }));
    assert.ok(!t.db.getInvoice('KB-DUP'));
    assert.deepStrictEqual(counters(t.db), before);
  } finally { t.cleanup(); }

  t = tempDb();
  try {
    t.db.updateInvoiceCounters({ ausgang: 123, fortlaufend: 124, lfd_bank: 126, kassenbeleg: 125 });
    assert.strictEqual(counters(t.db).ausgang, 123);
    assert.strictEqual(counters(t.db).fortlaufend, 124);
    assert.strictEqual(counters(t.db).kassenbeleg, 125);
    assert.strictEqual(counters(t.db).lfd_bank, 126);
    await assertRejects(() => t.db.updateInvoiceCounters({ unknown: 1 }));
        await assertRejects(() => t.db.updateInvoiceCounters({ ausgang: 0 }));
  } finally { t.cleanup(); }
}

async function testQueue() {
  const log = [];
  const enqueue = enqueueFactory(log);
  const op = (name, fail) => enqueue(async () => { log.push('Start ' + name); await delay(5); if (fail) { log.push('Fehler ' + name); throw new Error(name); } log.push('Ende ' + name); return name; });
  await Promise.all([op('A'), op('B'), op('C')]);
  assert.deepStrictEqual(log, ['Start A', 'Ende A', 'Start B', 'Ende B', 'Start C', 'Ende C']);

  log.length = 0;
  const p1 = op('A');
  const p2 = op('UNKNOWN', true).catch(e => e.message);
  const p3 = op('B');
  assert.deepStrictEqual(await Promise.all([p1, p2, p3]), ['A', 'UNKNOWN', 'B']);
  assert.deepStrictEqual(log, ['Start A', 'Ende A', 'Start UNKNOWN', 'Fehler UNKNOWN', 'Start B', 'Ende B']);
}

(async () => {
  await testCrudAndSafety();
  await testAtomicInvoiceCounters();
  await testQueue();
  console.log('invoice sqlite tests passed');
})();

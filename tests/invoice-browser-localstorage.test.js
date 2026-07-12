'use strict';

const assert = require('assert');

let saveQueue = Promise.resolve();
let _dbCache = { invoices: [], counters: { ausgang: 1, fortlaufend: 1, kassenbeleg: 1, lfd_bank: 1, lfd_kassa: 1 } };
let saveCount = 0;
const STORE_KEY = 'buchpro_v1';
const localStorage = { data: {}, fail: false, setItem(k, v) { if (this.fail) throw new Error('QuotaExceeded'); this.data[k] = v; }, getItem(k) { return this.data[k] || null; } };
function cloneForSave(d) { return JSON.parse(JSON.stringify(d)); }
function getDB() { return _dbCache; }
function enqueueDbWrite(operation) { const task = saveQueue.then(operation); saveQueue = task.catch(function() {}); return task; }
function saveDB(d) { _dbCache = d; const snapshot = cloneForSave(d); return enqueueDbWrite(() => { saveCount++; localStorage.setItem(STORE_KEY, JSON.stringify(snapshot)); return { ok: true }; }); }
async function browserPersist(applyChange) { const previous = cloneForSave(getDB()); const next = cloneForSave(previous); try { applyChange(next); await saveDB(next); _dbCache = next; return next; } catch (e) { _dbCache = previous; throw e; } }
function applyNumbering(next, inv, opts) {
  next.counters = Object.assign({ ausgang: 1, fortlaufend: 1, kassenbeleg: 1, lfd_bank: 1, lfd_kassa: 1 }, next.counters || {});
  const za = inv.zahlungsart === 'kassa' ? 'kassa' : 'bank';
  const out = Object.assign({}, inv);
  if (out.typ === 'ausgang') {
    if (opts && opts.numberMode === 'manual') out.nummer = String(opts.requestedNumber || out.nummer).trim();
    else out.nummer = String(next.counters.ausgang).padStart(3, '0');
    if (!out.nummer) throw new Error('manual missing');
    next.counters.ausgang++;
  } else out.nummer = out.nummer || '';
  out.lfd_nr = String(next.counters.fortlaufend);
  next.counters.fortlaufend++;
  if (out.typ === 'ausgang' && za === 'kassa') { out.kassenbeleg_nr = String(next.counters.kassenbeleg); next.counters.kassenbeleg++; }
  return out;
}
const createWithCounters = (inv, opts) => { let saved; return browserPersist(next => { saved = applyNumbering(next, inv, opts); next.invoices = next.invoices.filter(i => i.id !== saved.id); next.invoices.push(saved); }).then(() => saved); };
const updateCounters = vals => browserPersist(next => { next.counters = Object.assign({}, next.counters, vals); });
const load = () => JSON.parse(localStorage.getItem(STORE_KEY));

function invoiceNumberingOptionsFromField(typ, rnrValue, manuallyEdited) {
  if (typ === 'ausgang' && manuallyEdited) return { numberMode: 'manual', requestedNumber: String(rnrValue || '').trim() };
  return { numberMode: 'auto' };
}

function makeRnrState(counterValue) {
  return { manuallyEdited: false, value: String(counterValue).padStart(3, '0') };
}
function refreshRnrState(state, counterValue) {
  if (!state.manuallyEdited) state.value = String(counterValue).padStart(3, '0');
}
function userEditRnrState(state, value) {
  state.manuallyEdited = true;
  state.value = value;
}
function resetRnrState(state, counterValue) {
  state.manuallyEdited = false;
  state.value = String(counterValue).padStart(3, '0');
}

function assertManualPreviewState() {
  let state = makeRnrState(7);
  assert.deepStrictEqual(invoiceNumberingOptionsFromField('ausgang', state.value, state.manuallyEdited), { numberMode: 'auto' });

  let next = { invoices: [], counters: { ausgang: 8, fortlaufend: 1, lfd_bank: 1, lfd_kassa: 1, kassenbeleg: 1 } };
  const stalePreviewInvoice = applyNumbering(next, { id: 'STALE', typ: 'ausgang', nummer: state.value, zahlungsart: 'bank' }, invoiceNumberingOptionsFromField('ausgang', state.value, state.manuallyEdited));
  assert.strictEqual(stalePreviewInvoice.nummer, '008');

  userEditRnrState(state, 'SONDER-15');
  assert.deepStrictEqual(invoiceNumberingOptionsFromField('ausgang', state.value, state.manuallyEdited), { numberMode: 'manual', requestedNumber: 'SONDER-15' });
  next = { invoices: [], counters: { ausgang: 7, fortlaufend: 1, lfd_bank: 1, lfd_kassa: 1, kassenbeleg: 1 } };
  const manualInvoice = applyNumbering(next, { id: 'MANUAL', typ: 'ausgang', nummer: state.value, zahlungsart: 'bank' }, invoiceNumberingOptionsFromField('ausgang', state.value, state.manuallyEdited));
  assert.strictEqual(manualInvoice.nummer, 'SONDER-15');

  refreshRnrState(state, 9);
  assert.strictEqual(state.value, 'SONDER-15');
  assert.strictEqual(state.manuallyEdited, true);

  resetRnrState(state, 10);
  assert.strictEqual(state.value, '010');
  assert.deepStrictEqual(invoiceNumberingOptionsFromField('ausgang', state.value, state.manuallyEdited), { numberMode: 'auto' });
}

(async () => {
  assertManualPreviewState();
  saveCount = 0;
  let inv = await createWithCounters({ id: 'A', typ: 'ausgang', zahlungsart: 'bank' }, { numberMode: 'auto' });
  assert.strictEqual(saveCount, 1);
  assert.strictEqual(inv.nummer, '001');
  assert.strictEqual(inv.lfd_nr, '1');
  assert.strictEqual(load().counters.ausgang, 2);
  assert.ok(load().invoices.find(i => i.id === 'A'));

  inv = await createWithCounters({ id: 'K', typ: 'ausgang', zahlungsart: 'kassa' }, { numberMode: 'auto' });
  assert.strictEqual(inv.kassenbeleg_nr, '1');
  assert.strictEqual(load().counters.fortlaufend, 3);
  assert.strictEqual(load().counters.lfd_kassa, 1);
  assert.strictEqual(load().counters.kassenbeleg, 2);

  const before = cloneForSave(getDB());
  localStorage.fail = true;
  let failed = false;
  try { await createWithCounters({ id: 'FAIL', typ: 'ausgang', zahlungsart: 'bank' }, { numberMode: 'auto' }); } catch (_) { failed = true; }
  assert.ok(failed);
  assert.deepStrictEqual(getDB(), before);
  localStorage.fail = false;

  inv = await createWithCounters({ id: 'M', typ: 'ausgang', zahlungsart: 'bank' }, { numberMode: 'manual', requestedNumber: 'MAN-1' });
  assert.strictEqual(inv.nummer, 'MAN-1');
  assert.strictEqual(load().counters.ausgang, 4);


  const shared = { invoices: [], counters: { ausgang: 1, fortlaufend: 10, lfd_bank: 500, lfd_kassa: 700, kassenbeleg: 1 } };
  const sharedAr = applyNumbering(shared, { id: 'SHARED-AR', typ: 'ausgang', zahlungsart: 'bank' }, { numberMode: 'auto' });
  const sharedEr = applyNumbering(shared, { id: 'SHARED-ER', typ: 'eingang', nummer: '', zahlungsart: 'bank' }, { numberMode: 'auto' });
  assert.strictEqual(sharedAr.nummer, '001');
  assert.strictEqual(sharedEr.nummer, '');
  assert.deepStrictEqual([sharedAr.lfd_nr, sharedEr.lfd_nr], ['10', '11']);
  assert.strictEqual(shared.counters.ausgang, 2);
  assert.strictEqual(shared.counters.fortlaufend, 12);
  assert.strictEqual(shared.counters.lfd_bank, 500);
  assert.strictEqual(shared.counters.lfd_kassa, 700);

  await updateCounters({ ausgang: 50, fortlaufend: 60, kassenbeleg: 70 });
  _dbCache = cloneForSave(load());
  assert.strictEqual(getDB().counters.ausgang, 50);
  assert.strictEqual(getDB().counters.fortlaufend, 60);
  assert.strictEqual(getDB().counters.kassenbeleg, 70);
  console.log('invoice browser localStorage tests passed');
})();

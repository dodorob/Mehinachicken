'use strict';
const assert = require('assert');

// The same storage contract runs against SQLite and the real localStorage functions.
async function testKassaReceipts(api) {
  await api.counters({ ausgang: 200, fortlaufend: 120, kassenbeleg: 120, lfd_bank: 80 });
  const receipt = (id, lfd, kb, file) => ({ id, typ: 'ausgang', zahlungsart: 'kassa', lfd_nr: lfd, kassenbeleg_nr: kb, ...file });
  const file = (name, type, data) => ({ file_name: name, file_type: type, file_b64: 'data:' + type + ';base64,' + data });
  const pdf = file('original.pdf', 'application/pdf', 'UEZERg==');
  const jpg = file('original.jpg', 'image/jpeg', 'SlBH');
  const png = file('replacement.png', 'image/png', 'UE5H');
  let saved = await api.create(receipt('LOW', '087', '087', { nummer: 'MUST-NOT-BE-USED', ...pdf }));
  assert.strictEqual(saved.nummer || '', '');
  assert.strictEqual(saved.lfd_nr, '087');
  assert.strictEqual(saved.kassenbeleg_nr, '087');
  assert.strictEqual(saved.zahlungs_lfd_nr, '087');
  assert.strictEqual(api.read().counters.fortlaufend, 120);
  assert.strictEqual(api.read().counters.kassenbeleg, 120);
  assert.strictEqual(api.read().counters.ausgang, 200);
  assert.strictEqual(api.read().invoices.find(i => i.id === 'LOW').file_b64, pdf.file_b64);

  saved = await api.create(receipt('HIGH', '125', '125', jpg));
  assert.strictEqual(saved.nummer || '', '');
  assert.strictEqual(saved.lfd_nr, '125');
  assert.strictEqual(saved.kassenbeleg_nr, '125');
  assert.strictEqual(api.read().counters.fortlaufend, 126);
  assert.strictEqual(api.read().counters.kassenbeleg, 126);
  assert.strictEqual(api.read().counters.ausgang, 200);
  const beforeDuplicate = JSON.stringify(api.read());
  await assert.rejects(async () => api.create(receipt('DUP-LFD', '87', '129')));
  await assert.rejects(async () => api.create(receipt('DUP-KB', '129', '87')));
  await assert.rejects(async () => api.create(receipt('INVALID', '0', '130')));
  assert.strictEqual(JSON.stringify(api.read()), beforeDuplicate, 'failed writes must roll back counters and receipts');

  saved = await api.update({ id: 'LOW', notizen: 'edit without new upload', file_b64: null, file_name: null, file_type: null });
  assert.strictEqual(saved.lfd_nr, '087');
  assert.strictEqual(saved.kassenbeleg_nr, '087');
  for (const key of Object.keys(pdf)) assert.strictEqual(saved[key], pdf[key]);
  assert.strictEqual(api.read().counters.fortlaufend, 126);
  saved = await api.update({ id: 'LOW', lfd_nr: '86', kassenbeleg_nr: '86' });
  assert.strictEqual(saved.lfd_nr, '86');
  assert.strictEqual(saved.zahlungs_lfd_nr, '86');
  assert.strictEqual(api.read().counters.fortlaufend, 126);
  assert.strictEqual(api.read().counters.kassenbeleg, 126);
  saved = await api.update({ id: 'LOW', lfd_nr: '130', kassenbeleg_nr: '140', ...png });
  assert.strictEqual(saved.lfd_nr, '130');
  assert.strictEqual(saved.zahlungs_lfd_nr, '140');
  assert.strictEqual(api.read().counters.fortlaufend, 131);
  assert.strictEqual(api.read().counters.kassenbeleg, 141);
  for (const key of Object.keys(png)) assert.strictEqual(saved[key], png[key]);
  const beforeEditDuplicate = JSON.stringify(api.read());
  await assert.rejects(async () => api.update({ id: 'LOW', lfd_nr: '125', kassenbeleg_nr: '150' }));
  await assert.rejects(async () => api.update({ id: 'LOW', lfd_nr: '150', kassenbeleg_nr: '125' }));
  assert.strictEqual(JSON.stringify(api.read()), beforeEditDuplicate);
  await api.update({ id: 'LOW', lfd_nr: '130', kassenbeleg_nr: '140' });

  // Legacy receipt numbers remain untouched, including previously unsupported formats.
  await api.legacy(receipt('LEGACY', 'ALT-1', undefined, { nummer: 'ALT-AR', zahlungs_lfd_nr: 'ALT-2' }));
  const legacyBefore = api.read().invoices.find(i => i.id === 'LEGACY');
  const countersBefore = JSON.stringify(api.read().counters);
  await api.update({ id: 'LEGACY', notizen: 'legacy note' });
  const legacyAfter = api.read().invoices.find(i => i.id === 'LEGACY');
  for (const key of ['nummer', 'lfd_nr', 'kassenbeleg_nr', 'zahlungs_lfd_nr']) assert.strictEqual(legacyAfter[key], legacyBefore[key]);
  assert.strictEqual(JSON.stringify(api.read().counters), countersBefore);

  const er = await api.create({ id: 'ER-UPLOAD', typ: 'eingang', zahlungsart: 'bank', ...pdf });
  assert.strictEqual(er.file_b64, pdf.file_b64);
  const erEdit = await api.update({ id: 'ER-UPLOAD', notizen: 'ER edit' });
  assert.strictEqual(erEdit.file_b64, pdf.file_b64);
  const bank = await api.create({ id: 'BANK-AUTO', typ: 'ausgang', zahlungsart: 'bank', lfd_nr: '999', kassenbeleg_nr: '999' });
  assert.strictEqual(bank.nummer, '200');
  assert.strictEqual(bank.zahlungs_lfd_nr, '081');
  assert.ok(!bank.lfd_nr);
  assert.ok(!bank.kassenbeleg_nr);
  assert.strictEqual(api.read().counters.fortlaufend, 131);
  assert.strictEqual(api.read().counters.kassenbeleg, 141);
  const next = await api.create({ id: 'NEXT-KASSA', typ: 'ausgang', zahlungsart: 'kassa' });
  assert.strictEqual(next.nummer || '', '');
  assert.strictEqual(next.lfd_nr, '131');
  assert.strictEqual(next.kassenbeleg_nr, '141');
  assert.strictEqual(api.read().counters.ausgang, 201);
  const erKassa = await api.create({ id: 'ER-KASSA', typ: 'eingang', zahlungsart: 'kassa', ...pdf });
  assert.strictEqual(erKassa.lfd_nr, '132');
  await assert.rejects(async () => api.create(receipt('DUP-ER-LFD', '132', '200')));
}
module.exports = { testKassaReceipts };

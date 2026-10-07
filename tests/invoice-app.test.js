'use strict';
const assert = require('assert');
const { appHarness } = require('./invoice-app-harness');
const file = (name, type, data) => ({ name, type, size: 12, data: 'data:' + type + ';base64,' + data });

async function testKassaFormAndFiles() {
  const { app, elements: el, storage, opened, alerts, pdfs } = appHarness();
  app.initForm();
  app._dbCache.counters.fortlaufend = 120;
  app._dbCache.counters.kassenbeleg = 120;
  app.setPay('kassa');
  assert.strictEqual(el['form-title'].textContent, 'Registrierkassenrechnung erfassen');
  assert.strictEqual(el['btn-save-inv'].textContent, 'Beleg speichern');
  assert.strictEqual(el['btn-save-inv-bottom'].textContent, 'Beleg speichern');
  assert.strictEqual(el['ar-kassa-upload-card'].style.display, '');
  assert.strictEqual(el.rnr.wrap.style.display, 'none');
  assert.strictEqual(el['lfd-nr'].value, '120');
  el['lfd-nr'].value = '087'; el['lfd-nr'].listeners.input();
  el['kassa-beleg-nr'].value = '089'; el['kassa-beleg-nr'].listeners.input();
  app.refreshNumbers();
  app.updateFT();
  assert.strictEqual(el['lfd-nr'].value, '087');
  assert.strictEqual(el['kassa-beleg-nr'].value, '089');
  const original = file('register.pdf', 'application/pdf', 'UEZERg==');
  await app.handleInvoiceFile(original, true);
  await app.saveInvoice();
  let inv = JSON.parse(storage.getItem('buchpro_v1')).invoices[0];
  assert.strictEqual(inv.nummer, '');
  assert.strictEqual(inv.lfd_nr, '087');
  assert.strictEqual(inv.kassenbeleg_nr, '089');
  assert.strictEqual(inv.zahlungs_lfd_nr, '089');
  assert.strictEqual(inv.file_b64, original.data);
  assert.strictEqual(pdfs.length, 0);
  assert.strictEqual(opened.length, 0, 'saving a receipt must not invoke the PDF action');
  assert.match(el['f-alerts'].innerHTML, /Registrierkassenbeleg gespeichert/);
  assert.strictEqual(app.getDB().counters.fortlaufend, 120);
  assert.strictEqual(app.getDB().counters.kassenbeleg, 120);
  assert.strictEqual(app.getDB().counters.ausgang, 1);

  // A fresh app instance reloads the actual saved localStorage state.
  const reloaded = appHarness();
  reloaded.storage.data = storage.data;
  reloaded.app._dbCache = null;
  reloaded.app.genPDF(inv.id);
  assert.match(reloaded.opened[0], /data:application\/pdf;base64,UEZERg==/);
  app.genPDFData(inv);
  assert.match(opened[0], /data:application\/pdf;base64,UEZERg==/);
  assert.strictEqual(pdfs.length, 0);

  app.SP = () => app.initForm();
  app.editInv(inv.id);
  assert.strictEqual(el['lfd-nr'].value, '087');
  assert.match(el['ar-kassa-upload-preview'].textContent, /register.pdf/);
  assert.strictEqual(el['ar-kassa-open-receipt'].style.display, '');
  el['ar-kassa-open-receipt'].onclick();
  assert.match(opened[1], /UEZERg==/);
  await app.saveInvoice();
  assert.strictEqual(app.getDB().invoices[0].file_b64, original.data);

  const replacement = file('register.png', 'image/png', 'UE5H');
  await app.handleInvoiceFile(replacement, true);
  await app.saveInvoice();
  inv = app.getDB().invoices[0];
  assert.strictEqual(inv.file_b64, replacement.data);
  assert.strictEqual(inv.file_name, replacement.name);
  assert.strictEqual(inv.file_type, replacement.type);
  app.genPDF(inv.id);
  assert.match(opened[2], /data:image\/png;base64,UE5H/);
  const jpeg = file('register.jpg', 'image/jpeg', 'SlBH');
  await app.handleInvoiceFile(jpeg, true);
  await app.saveInvoice();
  app.genPDF(inv.id);
  assert.match(opened[3], /data:image\/jpeg;base64,SlBH/);

  await app.handleInvoiceFile(file('invalid.txt', 'text/plain', 'VEVYVA=='), true);
  assert.strictEqual(app.window._arKassaFileB64, jpeg.data);
  assert.match(alerts.pop(), /PDF-, JPG- oder PNG/);
  app._dbCache.invoices.push({ id: 'NO-FILE', typ: 'ausgang', zahlungsart: 'kassa' });
  app.genPDF('NO-FILE');
  assert.match(alerts.pop(), /Kein Originalbeleg/);
  app.genPDFData({ id: 'NO-FILE', typ: 'ausgang', zahlungsart: 'kassa', is_sammel: true });
  assert.match(alerts.pop(), /Kein Originalbeleg/);
  assert.strictEqual(pdfs.length, 0);

  app._dbCache.invoices.push({ id: 'LEGACY-UI', typ: 'ausgang', zahlungsart: 'kassa', nummer: 'ALT-AR', lfd_nr: 'ALT-1', kassenbeleg_nr: null, zahlungs_lfd_nr: 'ALT-2', items: [] });
  app.editInv('LEGACY-UI');
  assert.strictEqual(el.rnr.value, '');
  assert.strictEqual(app._invoiceNumberForDisplay(app.getDB().invoices.find(i => i.id === 'LEGACY-UI'), '—'), '—');
  await app.saveInvoice();
  const legacy = app.getDB().invoices.find(i => i.id === 'LEGACY-UI');
  assert.strictEqual(legacy.nummer, 'ALT-AR');
  assert.strictEqual(legacy.lfd_nr, 'ALT-1');
  assert.strictEqual(legacy.kassenbeleg_nr, null);
  assert.strictEqual(legacy.zahlungs_lfd_nr, 'ALT-2');

  app.initForm();
  app.setPay('kassa');
  assert.strictEqual(app.window._arKassaFileB64, null);
  assert.strictEqual(el['ar-kassa-upload-preview'].textContent, '');
  assert.strictEqual(el['ar-kassa-open-receipt'].style.display, 'none');
}

async function testBankAndER() {
  const { app, elements: el, opened } = appHarness();
  app.initForm();
  app.setPay('bank');
  assert.strictEqual(el['btn-save-inv'].textContent, 'Speichern & PDF');
  assert.strictEqual(el['ar-kassa-upload-card'].style.display, 'none');
  app._dbCache.counters.ausgang = 15;
  app._dbCache.counters.lfd_bank = 20;
  // Stub PDF rendering only: verify save and later action still call the generator.
  const generated = [];
  app.genPDFData = inv => generated.push(inv.id);
  await app.saveInvoice();
  const bank = app.getDB().invoices[0];
  assert.strictEqual(bank.nummer, '015');
  assert.strictEqual(bank.zahlungs_lfd_nr, '020');
  assert.strictEqual(generated.length, 1);
  app.genPDF(bank.id);
  assert.strictEqual(generated.length, 2);
  assert.strictEqual(app.getDB().counters.ausgang, 16);

  app.initForm();
  app.setTyp('eingang');
  el['er-lief-name'].value = 'Supplier';
  app.window.erItemsData = [{ desc: 'ER', netto: 10, ust_pct: 20, ust_amt: 2 }];
  const original = file('supplier.pdf', 'application/pdf', 'RVJQREY=');
  await app.handleERFile(original);
  await app.saveER();
  const er = app.getDB().invoices.find(i => i.typ === 'eingang');
  assert.strictEqual(er.file_b64, original.data);
  app.SP = () => app.initForm();
  app.editInv(er.id);
  assert.match(el['er-upload-preview'].innerHTML, /supplier.pdf/);
  await app.saveER();
  assert.strictEqual(app.getDB().invoices.find(i => i.id === er.id).file_b64, original.data);
  app.genPDF(er.id);
  assert.match(opened[0], /RVJQREY=/);
  assert.strictEqual(generated.length, 2, 'ER must not generate an invoice PDF');
}

async function testPendingUploadAndElectronReceiptAction() {
  const { app, opened } = appHarness();
  app.initForm();
  app.setPay('kassa');
  let reader;
  app.FileReader = class { readAsDataURL() { reader = this; } };
  const original = file('pending.pdf', 'application/pdf', 'UEVORElORw==');
  app.handleInvoiceFile(original, true);
  const saving = app.saveInvoice();
  await Promise.resolve();
  assert.strictEqual(app.getDB().invoices.length, 0, 'save must await completion of the upload');
  reader.onload({ target: { result: original.data } });
  await saving;
  const saved = app.getDB().invoices[0];
  assert.strictEqual(saved.file_b64, original.data);
  const writes = [];
  app.getSetting = key => key === 'bp_path_ar_kassa' ? '/receipts' : null;
  app.window.electronAPI = {
    savePdfToPath: async (...args) => { writes.push(args); return { success: false }; }
  };
  app.genPDF(saved.id);
  assert.strictEqual(writes[0][0], '/receipts');
  assert.strictEqual(writes[0][1], 'pending.pdf');
  assert.strictEqual(writes[0][2], 'UEVORElORw==', 'Electron receives the original bytes');
  assert.match(opened[0], /UEVORElORw==/);
}

(async () => {
  await testKassaFormAndFiles();
  await testBankAndER();
  await testPendingUploadAndElectronReceiptAction();
  console.log('invoice app form and original receipt tests passed');
})();

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// Load the production functions without running the application's startup listeners.
function appHarness() {
  const elements = {};
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    const wrap = { style: {} };
    elements[match[1]] = {
      value: '', style: {}, textContent: '', innerHTML: '', checked: false, listeners: {},
      selectedIndex: 0, options: [{ text: '-- Bitte wählen --' }],
      closest: () => wrap, querySelectorAll: () => [],
      addEventListener(name, fn) { this.listeners[name] = fn; }, click() {},
    };
  }
  const storage = { data: {}, fail: false,
    setItem(k, v) { if (this.fail) throw new Error('QuotaExceeded'); this.data[k] = v; },
    getItem(k) { return this.data[k] || null; }
  };
  const opened = [], alerts = [], pdfs = [];
  const context = vm.createContext({
    console, localStorage: storage, window: {},
    document: { getElementById: id => elements[id] || null },
    alert: message => alerts.push(message), setTimeout() {},
    STORE_KEY: 'buchpro_v1', INVOICE_COUNTER_KEYS: ['ausgang', 'fortlaufend', 'lfd_bank', 'kassenbeleg'],
    BACKUP_KEYS: ['buchpro_v1'], ACCOUNTING_REPORT_TYPE: 'financial_accounting_monthly', ACCOUNTING_REPORT_LABEL: 'Finanzbuchhaltung',
    MONTHS: ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'],
    _dbCache: null, saveQueue: Promise.resolve(), editId: null,
    _settingsCache: {}, _beschHistCache: [], _fixkostenCache: [], _posBadgesCache: null,
    rnrManuallyEdited: false, kassenbelegManuallyEdited: false, lfdManuallyEdited: false,
    itemsData: [{ titel: '', menge: 1, preis: 10, ust: 20 }],
    getSetting: () => null, esc: text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'),
    uid: () => 'FORM-' + Math.random(), collectDateRows() {}, addToBeschHist() {},
    genArbeitsauftragPDF: inv => pdfs.push(inv.id), genSammelArbeitsauftraege: inv => pdfs.push(inv.id),
    genSammelPDF: inv => pdfs.push(inv.id),
    renderItems() {}, renderSammelItems() {}, renderERItems() {}, renderSum() {},
    fillPD() {}, SP() {},
    FileReader: class {
      readAsDataURL(file) { this.onload({ target: { result: file.data } }); }
    },
  });
  context.window.open = () => ({ document: { write: content => opened.push(content), close() {} } });
  function load(...names) {
    for (const name of names) {
      const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
      if (!match) throw new Error('Missing production function: ' + name);
      vm.runInContext(match[0], context);
    }
  }
  load('loadDB', 'dfV', 'getDB', 'cloneForSave', 'enqueueDbWrite', 'saveDB', '_hasElectronDbInvoiceApi', '_isElectronDbMode',
    '_replaceInvoiceInCache', '_mergeInvoiceForUpdate', '_persistInvoiceBrowser', '_mergeReturnedCounters',
    '_invoiceNumberingOptions', '_padInvoiceNumber', '_numericInvoiceValue', '_sameInvoiceNumber',
    '_assertNoInvoiceNumberDuplicate', '_requireStateCounter', '_isARKassa', '_applyARKassaNumbersToState',
    '_applyInvoiceNumberingToState', 'persistInvoiceCreateWithCounters', 'persistInvoiceUpdate',
    'persistInvoiceCounters', 'persistInvoiceAction', 'previewNum', 'refreshNumbers', 'updateARKassaForm',
    'findAccountingReport', 'validateAccountingReportPeriod', 'normaliseAccountingValue', 'normaliseAccountingReport',
    'preserveAccountingManualValues', 'buildAccountingImportDifferences', '_replaceAccountingReportInCache',
    'persistAccountingReportCreate', 'persistAccountingReportUpdate', 'createBackupObject',
    'wireFormButtons', 'handleERFile', 'handleInvoiceFile', 'saveInvoice', 'genPDF', 'genPDFData',
    'openInvoiceReceipt', 'editInv', 'setTyp', 'setPay', 'setKassaTyp', 'setSammelMode', 'updateFT',
    'setERTyp', 'setERMode', 'wireERForm', 'initForm', 'saveER', 'resetERForm');
  context._dbCache = { invoices: [], accounting_reports: [], counters: { ausgang: 1, fortlaufend: 1, kassenbeleg: 1, lfd_bank: 1, lfd_kassa: 1 }, kunden: [], lieferanten: [], fahrzeuge: [] };
  elements.typ.value = 'ausgang'; elements.zahlungsart.value = 'bank';
  context.window.erItemsData = [{ desc: 'ER', netto: 10, ust_pct: 20, ust_amt: 2 }];
  return { app: context, elements, storage, opened, alerts, pdfs, load };
}
module.exports = { appHarness };

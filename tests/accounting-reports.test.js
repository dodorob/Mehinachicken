'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BuchProDB = require('../database');
const SQLite = require('better-sqlite3');
const { appHarness } = require('./invoice-app-harness');

const PDF_JULY = 'data:application/pdf;base64,JVBERi0xLjQKSnVsaTIwMjY=';

function report(id, month, extra) {
  return Object.assign({
    id,
    report_type: 'financial_accounting_monthly',
    report_month: month,
    report_year: 2026,
    period_from_month: 1,
    period_to_month: month,
    imported_at: `2026-${String(month).padStart(2, '0')}-31T12:00:00.000Z`,
    original_file_b64: month === 7 ? PDF_JULY : `data:application/pdf;base64,MONTH${month}`,
    original_file_name: `fibu-${String(month).padStart(2, '0')}-2026.pdf`,
    original_file_type: 'application/pdf',
    parse_status: 'pending',
    parser_version: null,
    monthly_values: [],
    snapshot_values: [],
    cumulative_metrics: [],
    snapshot_metrics: [],
    tax_values: [],
    open_items: [],
    account_values: [],
    detected_values: [],
    manual_corrections: [],
    import_differences: [],
  }, extra || {});
}

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mehina-accounting-'));
  const file = path.join(dir, 'test.sqlite');
  const db = new BuchProDB();
  db.open(file);
  return { db, file, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

function testAdditiveSchemaMigration() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mehina-accounting-migration-'));
  const file = path.join(dir, 'legacy.sqlite');
  const raw = new SQLite(file);
  raw.exec("CREATE TABLE accounting_monthly_values (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, value_key TEXT NOT NULL, value_month INTEGER, value_year INTEGER, detected_value REAL, manual_value REAL, unit TEXT, source TEXT DEFAULT 'pdf', status TEXT DEFAULT 'detected', metadata_json TEXT DEFAULT '{}')");
  raw.close();
  const db = new BuchProDB();
  try {
    db.open(file);
    const columns = db.db.prepare('PRAGMA table_info(accounting_monthly_values)').all().map(column => column.name);
    ['account_number', 'account_name', 'source_section', 'source_label', 'confidence'].forEach(column => assert.ok(columns.includes(column), 'migration must add ' + column));
    assert.ok(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounting_cumulative_metrics'").get());
    assert.ok(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='accounting_import_differences'").get());
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testSqliteReports() {
  const temp = tempDb();
  try {
    temp.db.createInvoice({ id: 'EXISTING-INVOICE', typ: 'ausgang', nummer: '001', zahlungsart: 'bank', items: [] });
    const july = report('JULY', 7, {
      monthly_values: [{ id: 'MV1', value_key: 'revenue', value_month: 7, value_year: 2026, detected_value: 12345.67, manual_value: null, unit: 'EUR', source: 'pdf', status: 'detected' }],
      cumulative_metrics: [{ id: 'CM1', value_key: 'ebitda', detected_value: 28500, manual_value: null, unit: 'EUR', source_section: 'Erfolgsvergleich', source_label: 'EBITDA', confidence: 1 }],
      snapshot_metrics: [{ id: 'SM1', value_key: 'cash', snapshot_date: '2026-07-31', account_number: '2700', account_name: 'Kassenbestand', detected_value: 1234.56, manual_value: null, unit: 'EUR', source_section: 'Saldenliste', source_label: '2700 Kassenbestand', confidence: 1 }],
      snapshot_values: [{ id: 'SV1', value_key: 'cash', snapshot_date: '2026-07-31', detected_value: 1000, manual_value: 1100, unit: 'EUR', source: 'manual', status: 'manually_changed' }],
      tax_values: [{ id: 'TV1', tax_type: 'vat', value_key: 'payable', period_month: 7, period_year: 2026, detected_value: 200, manual_value: null, unit: 'EUR' }],
      open_items: [{ id: 'OI1', party_type: 'customer', party_name: 'Kunde', detected_value: 300, manual_value: null }],
      account_values: [{ id: 'AV1', account_number: '4000', account_name: 'Umsatz', detected_value: 400, manual_value: null }],
      detected_values: [{ id: 'DV1', value_scope: 'monthly', value_key: 'revenue', raw_value: '12.345,67', normalized_value: '12345.67', page_number: 2 }],
      manual_corrections: [{ id: 'MC1', value_scope: 'snapshot', value_id: 'SV1', value_key: 'cash', detected_value: '1000', previous_manual_value: null, manual_value: '1100', changed_at: '2026-08-01T10:00:00.000Z' }],
      import_differences: [{ id: 'DIFF1', previous_report_id: 'JUNE-OLD', value_scope: 'monthly_values', value_key: '5000:2026-06', account_number: '5000', value_month: 6, value_year: 2026, previous_detected_value: -1500, new_detected_value: -1550, previous_manual_value: null, resolution_status: 'pending', detected_at: '2026-08-01T10:00:00.000Z' }],
    });
    const saved = temp.db.createAccountingReport(july);
    assert.strictEqual(saved.original_file_b64, PDF_JULY);
    assert.strictEqual(saved.monthly_values[0].detected_value, 12345.67);
    assert.strictEqual(saved.monthly_values[0].manual_value, null);
    assert.strictEqual(saved.monthly_values[0].effective_value, 12345.67);
    assert.strictEqual(saved.snapshot_values[0].effective_value, 1100);
    assert.strictEqual(saved.cumulative_metrics[0].detected_value, 28500);
    assert.strictEqual(saved.snapshot_metrics[0].snapshot_date, '2026-07-31');
    assert.strictEqual(saved.detected_values[0].raw_value, '12.345,67');
    assert.strictEqual(saved.manual_corrections[0].detected_value, '1000');
    assert.strictEqual(saved.import_differences[0].new_detected_value, -1550);

    assert.throws(() => temp.db.createAccountingReport(report('JULY-DUP', 7)));
    temp.db.createAccountingReport(report('JAN', 1));
    temp.db.createAccountingReport(report('JUNE', 6));
    const august = temp.db.createAccountingReport(report('AUGUST', 8, {
      detected_values: [{ id: 'DV1', value_scope: 'monthly', value_key: '5000:2026-06', raw_value: '1.756,00', normalized_value: '1756.00', page_number: 2 }],
    }));
    assert.notStrictEqual(august.detected_values[0].id, saved.detected_values[0].id, 'parser-local IDs must not collide across historical reports');
    assert.deepStrictEqual(temp.db.listAccountingReports().map(item => item.report_month), [8, 7, 6, 1]);

    temp.db.close();
    temp.db.open(temp.file);
    const reloaded = temp.db.getAccountingReport('JULY');
    assert.strictEqual(reloaded.original_file_b64, PDF_JULY, 'Original-PDF must survive restart');
    assert.strictEqual(reloaded.original_file_name, 'fibu-07-2026.pdf');
    assert.strictEqual(reloaded.monthly_values[0].detected_value, 12345.67);
    assert.strictEqual(reloaded.monthly_values[0].manual_value, null);

    const electronRenderer = appHarness();
    electronRenderer.load('accountingReportPdfBlob', 'openAccountingReportPdf');
    let openedPdfUrl = null;
    electronRenderer.app.Blob = Blob;
    electronRenderer.app.atob = encoded => Buffer.from(encoded, 'base64').toString('binary');
    electronRenderer.app.URL = { createObjectURL() { return 'blob:sqlite-accounting-report'; }, revokeObjectURL() {} };
    electronRenderer.app.setTimeout = callback => callback();
    electronRenderer.app.window.open = url => { openedPdfUrl = url; return {}; };
    assert.strictEqual(electronRenderer.app.openAccountingReportPdf(reloaded), true, 'SQLite report PDF must open through the shared Electron renderer path');
    assert.strictEqual(openedPdfUrl, 'blob:sqlite-accounting-report');

    const manuallyChanged = temp.db.updateAccountingReport(Object.assign({}, reloaded, {
      monthly_values: [Object.assign({}, reloaded.monthly_values[0], { manual_value: 12400, source: 'manual', status: 'manually_changed' })],
    }));
    assert.strictEqual(manuallyChanged.monthly_values[0].detected_value, 12345.67);
    assert.strictEqual(manuallyChanged.monthly_values[0].effective_value, 12400);
    const pdfRestored = temp.db.updateAccountingReport(Object.assign({}, manuallyChanged, {
      monthly_values: [Object.assign({}, manuallyChanged.monthly_values[0], { manual_value: null, source: 'pdf', status: 'detected' })],
    }));
    assert.strictEqual(pdfRestored.monthly_values[0].detected_value, 12345.67);
    assert.strictEqual(pdfRestored.monthly_values[0].effective_value, 12345.67);

    const replacement = temp.db.updateAccountingReport({ id: 'JULY', original_file_b64: 'data:application/pdf;base64,REPLACED', original_file_name: 'july-replaced.pdf', original_file_type: 'application/pdf' });
    assert.strictEqual(replacement.original_file_name, 'july-replaced.pdf');
    assert.strictEqual(temp.db.loadAll().invoices.length, 1, 'report persistence must not affect invoices');
    assert.strictEqual(temp.db.loadAll().invoices[0].id, 'EXISTING-INVOICE');
  } finally {
    temp.cleanup();
  }
}

function testBrowserBackupMigrationToSqlite() {
  const temp = tempDb();
  try {
    const browserReport = report('BROWSER-JULY', 7, {
      monthly_values: [{ value_key: '5000:2026-06', account_number: '5000', value_month: 6, value_year: 2026, detected_value: -1706, manual_value: -1720 }],
      manual_corrections: [{ id: 'BROWSER-CORRECTION', value_scope: 'monthly_values', value_id: null, value_key: '5000:2026-06', detected_value: '-1706', previous_manual_value: null, manual_value: '-1720', changed_at: '2026-08-01T10:00:00.000Z' }],
    });
    temp.db.migrateFromLocalStorage({ buchpro_v1: JSON.stringify({ accounting_reports: [browserReport] }) });
    const restored = temp.db.getAccountingReport('BROWSER-JULY');
    assert.strictEqual(restored.original_file_b64, PDF_JULY);
    assert.strictEqual(restored.monthly_values[0].detected_value, -1706);
    assert.strictEqual(restored.monthly_values[0].manual_value, -1720);
    assert.strictEqual(restored.manual_corrections[0].value_id, '5000:2026-06', 'legacy browser corrections need a stable SQLite value reference');
  } finally {
    temp.cleanup();
  }
}

async function testLocalStorageAndBackup() {
  const { app, storage, load } = appHarness();
  load('accountingEffectiveNumber', 'parseAccountingManualInput', 'accountingValueWithManual', 'accountingPreviousValue',
    'canonicalAccountingMonthlyValues', 'saveAccountingManualValue', 'importBackupData');
  const saved = await app.persistAccountingReportCreate(report('LS-JULY', 7, {
    monthly_values: [
      { id: 'LS-MV', value_key: '4000:2026-07', account_number: '4000', value_month: 7, value_year: 2026, detected_value: 12345.67, manual_value: 12400 },
      { value_key: '5000:2026-06', account_number: '5000', value_month: 6, value_year: 2026, detected_value: -1706, manual_value: -1690 },
    ],
  }));
  assert.strictEqual(saved.original_file_b64, PDF_JULY);
  assert.strictEqual(saved.monthly_values[0].detected_value, 12345.67);
  assert.strictEqual(saved.monthly_values[0].manual_value, 12400);
  assert.strictEqual(saved.monthly_values[0].effective_value, 12400);
  assert.strictEqual(saved.monthly_values[0].source, 'manual');
  assert.strictEqual(saved.monthly_values[0].status, 'manually_changed');
  const restoredValue = app.normaliseAccountingValue({ detected_value: 12345.67, manual_value: null, source: 'manual', status: 'manually_changed' });
  assert.strictEqual(restoredValue.effective_value, 12345.67);
  assert.strictEqual(restoredValue.source, 'pdf');
  assert.strictEqual(restoredValue.status, 'detected');
  const august = await app.persistAccountingReportCreate(report('LS-AUGUST', 8, {
    monthly_values: [{ value_key: '5000:2026-06', account_number: '5000', value_month: 6, value_year: 2026, detected_value: -1756, manual_value: null }],
  }));
  assert.strictEqual(august.import_differences.length, 1);
  assert.strictEqual(august.import_differences[0].previous_detected_value, -1706);
  assert.strictEqual(august.import_differences[0].new_detected_value, -1756);
  assert.strictEqual(august.import_differences[0].previous_manual_value, -1690);
  assert.strictEqual(august.import_differences[0].resolution_status, 'manual_preserved');
  const manuallySaved = await app.saveAccountingManualValue('LS-JULY', 'monthly_values', 1, '-1.690,00');
  assert.strictEqual(manuallySaved.manual_corrections[0].value_id, '5000:2026-06', 'browser corrections without row IDs need a stable reference');
  const protectedJune = app.canonicalAccountingMonthlyValues(app.getDB().accounting_reports, 2026, 6)
    .find(value => value.account_number === '5000');
  assert.strictEqual(app.accountingEffectiveNumber(protectedJune), -1690, 'August must not silently replace the manually corrected June value from July');
  assert.strictEqual(JSON.parse(storage.getItem('buchpro_v1')).accounting_reports[0].original_file_b64, PDF_JULY);

  app._dbCache = null;
  assert.strictEqual(app.getDB().accounting_reports[0].original_file_name, 'fibu-07-2026.pdf', 'report must survive localStorage reload');
  await assert.rejects(() => app.persistAccountingReportCreate(report('LS-DUP', 7)), /DUPLICATE_ACCOUNTING_REPORT/);
  await app.persistAccountingReportCreate(report('LS-JAN', 1));
  await app.persistAccountingReportCreate(report('LS-JUNE', 6));
  assert.strictEqual(Array.from(app.getDB().accounting_reports, item => item.report_month).sort((a, b) => b - a).join(','), '8,7,6,1');

  const backup = app.createBackupObject();
  const backupData = JSON.parse(backup.buchpro_v1);
  assert.strictEqual(backup._meta.version, 3);
  assert.strictEqual(backupData.accounting_reports.length, 4);
  assert.strictEqual(backupData.accounting_reports.find(item => item.id === 'LS-JULY').original_file_b64, PDF_JULY);
  assert.strictEqual(backupData.accounting_reports.find(item => item.id === 'LS-JULY').manual_corrections[0].value_id, '5000:2026-06');
  assert.strictEqual(backupData.accounting_reports.find(item => item.id === 'LS-AUGUST').import_differences[0].new_detected_value, -1756);

  storage.data = {};
  app._dbCache = null;
  assert.strictEqual(app.importBackupData(backup), 1);
  app._dbCache = null;
  const backupRestored = app.getDB();
  assert.strictEqual(backupRestored.accounting_reports.find(item => item.id === 'LS-JULY').original_file_b64, PDF_JULY);
  assert.strictEqual(backupRestored.accounting_reports.find(item => item.id === 'LS-JULY').monthly_values[1].manual_value, -1690);
  assert.strictEqual(backupRestored.accounting_reports.find(item => item.id === 'LS-AUGUST').import_differences[0].resolution_status, 'manual_preserved');

  const updated = await app.persistAccountingReportUpdate({ id: 'LS-JULY', report_month: 7, report_year: 2026 });
  assert.strictEqual(updated.original_file_b64, PDF_JULY, 'metadata edit must retain original PDF');
  const reparsed = await app.persistAccountingReportUpdate({
    id: 'LS-JULY',
    monthly_values: [{ value_key: '4000:2026-07', account_number: '4000', value_month: 7, value_year: 2026, detected_value: 27000, manual_value: null }],
  });
  assert.strictEqual(reparsed.monthly_values[0].detected_value, 27000);
  assert.strictEqual(reparsed.monthly_values[0].manual_value, 12400, 're-import must retain manual correction');
  assert.strictEqual(reparsed.monthly_values[0].effective_value, 12400);

  const mismatch = app.validateAccountingReportPeriod(Object.assign({}, report('MISMATCH', 7), {
    detected_period_from_month: 1,
    detected_period_from_year: 2026,
    detected_period_to_month: 6,
    detected_period_to_year: 2026,
  }));
  assert.strictEqual(mismatch.status, 'mismatch');
  assert.match(mismatch.message, /Juli 2026/);

  [7, 8].forEach(month => {
    const matching = app.validateAccountingReportPeriod(Object.assign({}, report('MATCH-' + month, month), {
      detected_period_from_month: 1,
      detected_period_from_year: 2026,
      detected_period_to_month: month,
      detected_period_to_year: 2026,
    }));
    assert.strictEqual(matching.status, 'matched', 'January-to-selected-month reports must validate for month ' + month);
  });
}

(async () => {
  testAdditiveSchemaMigration();
  testSqliteReports();
  testBrowserBackupMigrationToSqlite();
  await testLocalStorageAndBackup();
  console.log('accounting report SQLite, localStorage and backup tests passed');
})();

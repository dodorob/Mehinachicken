'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { appHarness } = require('./invoice-app-harness');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function report(id, month, extra) {
  return Object.assign({
    id,
    report_type: 'financial_accounting_monthly',
    report_month: month,
    report_year: 2026,
    period_from_month: 1,
    period_to_month: month,
    imported_at: '2026-08-01T00:00:00.000Z',
    original_file_b64: 'data:application/pdf;base64,JVBERi0xLjQ=',
    original_file_name: 'report.pdf',
    original_file_type: 'application/pdf',
    monthly_values: [], snapshot_values: [], cumulative_metrics: [], snapshot_metrics: [],
    tax_values: [], open_items: [], account_values: [], detected_values: [], manual_corrections: [], import_differences: [],
  }, extra || {});
}

(async () => {
  const planningIndex = html.indexOf('<div class="sec">Planung</div>');
  const accountingNavIndex = html.indexOf('id="nav-buchhaltungsdaten"');
  const settingsIndex = html.indexOf('<div class="sec">Einstellungen</div>');
  assert.ok(planningIndex >= 0 && accountingNavIndex > planningIndex && accountingNavIndex < settingsIndex, 'Buchhaltungsdaten must be located in the Planung navigation group');
  assert.strictEqual((html.match(/id="nav-buchhaltungsdaten"/g) || []).length, 1, 'there must still be exactly one accounting tab');
  assert.match(html, /id="accounting-duplicate-replace"[^>]*>Bestehenden Bericht aktualisieren</);

  const { app, elements, alerts, load } = appHarness();
  app.ACCOUNTING_MONTHS = ['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  load('accountingReportPeriodLabel', 'updateAccountingExistingReportNotice', 'accountingReportPdfBlob', 'openAccountingReportPdf',
    'showAccountingDuplicate', 'closeAccountingReportForm', 'replaceDuplicateAccountingReport');

  const july = report('JULY', 7, {
    monthly_values: [{ id: 'VALUE', value_key: '4000:2026-07', account_number: '4000', value_month: 7, value_year: 2026, detected_value: 100, manual_value: 150 }],
  });
  app._dbCache.accounting_reports = [july];
  elements['accounting-report-month'].value = '7';
  elements['accounting-report-year'].value = '2026';
  elements['accounting-edit-id'].value = '';
  assert.strictEqual(app.updateAccountingExistingReportNotice().id, 'JULY');
  assert.strictEqual(elements['accounting-existing-report-notice'].style.display, 'flex');
  assert.strictEqual(elements['accounting-existing-report-notice'].textContent, 'Für Juli 2026 ist bereits ein Buchhaltungsbericht vorhanden.');

  elements['accounting-report-month'].value = '8';
  assert.strictEqual(app.updateAccountingExistingReportNotice(), null);
  assert.strictEqual(elements['accounting-existing-report-notice'].style.display, 'none');
  const august = await app.persistAccountingReportCreate(report('AUGUST', 8));
  assert.strictEqual(august.report_month, 8, 'a month without an existing report must remain uploadable');

  app.showAccountingDuplicate(july, report('NEW-JULY', 7, {
    original_file_b64: 'data:application/pdf;base64,JVBERi0xLjUK',
    original_file_name: 'report-neu.pdf',
    monthly_values: [{ id: 'VALUE-NEW', value_key: '4000:2026-07', account_number: '4000', value_month: 7, value_year: 2026, detected_value: 200, manual_value: null }],
  }));
  assert.match(elements['accounting-duplicate-message'].textContent, /bestehenden Bericht aktualisieren/);
  app.renderAccountingReports = () => {};
  app.renderAccountingDataView = () => {};
  app.renderAccountingKpis = () => {};
  await app.replaceDuplicateAccountingReport();
  const updated = app.getDB().accounting_reports.find(item => item.id === 'JULY');
  assert.strictEqual(app.getDB().accounting_reports.filter(item => item.report_month === 7 && item.report_year === 2026).length, 1, 'updating must not create a duplicate month');
  assert.strictEqual(updated.monthly_values[0].detected_value, 200);
  assert.strictEqual(updated.monthly_values[0].manual_value, 150, 'manual corrections must survive a repeated PDF import');
  assert.strictEqual(updated.monthly_values[0].effective_value, 150);
  assert.strictEqual(updated.original_file_name, 'report-neu.pdf');

  let createdBlob = null;
  let openedUrl = null;
  let revokedUrl = null;
  app.Blob = Blob;
  app.atob = encoded => Buffer.from(encoded, 'base64').toString('binary');
  app.URL = {
    createObjectURL(blob) { createdBlob = blob; return 'blob:accounting-report'; },
    revokeObjectURL(url) { revokedUrl = url; },
  };
  app.setTimeout = callback => callback();
  app.window.open = (url, target) => { openedUrl = { url, target }; return {}; };
  app._dbCache = null;
  const reloadedUpdate = app.getDB().accounting_reports.find(item => item.id === 'JULY');
  assert.strictEqual(app.openAccountingReportPdf(reloadedUpdate), true, 'the original PDF must open after a localStorage reload');
  assert.strictEqual(createdBlob.type, 'application/pdf');
  assert.ok(createdBlob.size > 0);
  assert.deepStrictEqual(openedUrl, { url: 'blob:accounting-report', target: '_blank' });
  assert.strictEqual(revokedUrl, 'blob:accounting-report');

  assert.strictEqual(app.openAccountingReportPdf({ id: 'OLD', original_file_b64: null }), false);
  assert.strictEqual(alerts.pop(), 'Für diesen Buchhaltungsbericht ist keine Original-PDF gespeichert.');
  app.window.open = () => null;
  assert.strictEqual(app.openAccountingReportPdf(reloadedUpdate), false);
  assert.strictEqual(alerts.pop(), 'Die PDF konnte nicht geöffnet werden.');

  console.log('accounting report navigation, repeat upload and PDF opening tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

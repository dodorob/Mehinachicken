'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const parser = require('../accounting-report-parser');
const browserAdapter = require('../assets/js/accounting-report-browser');
const { appHarness } = require('./invoice-app-harness');

async function testBrowserGlobalAndPdfAdapter() {
  const parserSource = fs.readFileSync(path.join(__dirname, '../accounting-report-parser.js'), 'utf8');
  const browserContext = vm.createContext({});
  vm.runInContext(parserSource, browserContext);
  assert.strictEqual(typeof browserContext.AccountingReportParser.parseFinancialAccountingReportText, 'function');
  assert.strictEqual(parser.parseFinancialAccountingReportText('Von: Jänner 2026  Bis: Jänner 2026').parser_version, 'bmd-fibu-v2');

  const layoutItems = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/financial-accounting-layout-items.json'), 'utf8'));
  let destroyed = false;
  const fakePdf = {
    disableWorker: false,
    getDocument(bytes) {
      assert.ok(bytes.data instanceof Uint8Array);
      return { promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items: layoutItems }) }),
        destroy() { destroyed = true; },
      }) };
    },
  };
  const runtime = { atob: encoded => Buffer.from(encoded, 'base64').toString('binary') };
  const adapter = browserAdapter.create(fakePdf, parser, runtime);
  const result = await adapter.extractAccountingReport('data:application/pdf;base64,JVBERi0xLjQ=');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.pages, 1);
  assert.strictEqual(result.parsed.monthly_values.length, 2);
  assert.strictEqual(fakePdf.disableWorker, true, 'file:// extraction must not require a worker');
  assert.strictEqual(destroyed, true);
  await assert.rejects(
    () => browserAdapter.create(null, parser, runtime).extractAccountingReport('data:application/pdf;base64,JVBERi0xLjQ='),
    /PDF-Bibliothek/
  );
}

async function testSharedExtractionAndLocalStorage() {
  const { app, storage, load } = appHarness();
  load('normaliseAccountingExtractionResult', 'extractAccountingReport');
  const parsed = {
    parser_version: 'bmd-fibu-v2', parse_status: 'parsed',
    detected_period_from_month: 1, detected_period_from_year: 2026,
    detected_period_to_month: 7, detected_period_to_year: 2026,
    monthly_values: [{ value_key: '4000:2026-07', account_number: '4000', value_month: 7, value_year: 2026, detected_value: 16000 }],
    cumulative_metrics: [], snapshot_metrics: [], tax_values: [], open_items: [], detected_values: [],
  };
  let browserCalls = 0;
  app.window.AccountingReportBrowser = {
    async extractAccountingReport() { browserCalls += 1; return { ok: true, parsed: parsed, pages: 3 }; },
  };
  const browserResult = await app.extractAccountingReport('data:application/pdf;base64,VEVTVA==');
  assert.strictEqual(browserCalls, 1);
  assert.strictEqual(browserResult.parsed.parse_status, 'parsed');
  assert.strictEqual(browserResult.parsed.monthly_values[0].detected_value, 16000);

  const saved = await app.persistAccountingReportCreate(Object.assign({
    id: 'BROWSER-JULY', report_type: 'financial_accounting_monthly', report_month: 7, report_year: 2026,
    period_from_month: 1, period_to_month: 7, imported_at: '2026-08-01T10:00:00.000Z',
    original_file_b64: 'data:application/pdf;base64,VEVTVA==', original_file_name: 'synthetic.pdf', original_file_type: 'application/pdf',
  }, browserResult.parsed));
  assert.strictEqual(saved.monthly_values[0].detected_value, 16000);
  app._dbCache = null;
  assert.strictEqual(app.getDB().accounting_reports[0].monthly_values[0].detected_value, 16000);
  assert.strictEqual(app.getDB().accounting_reports[0].original_file_b64, 'data:application/pdf;base64,VEVTVA==');
  assert.ok(storage.getItem('buchpro_v1'));

  app.window.AccountingReportBrowser.extractAccountingReport = async () => ({ ok: true, parsed: { parser_version: 'bmd-fibu-v2', monthly_values: [] } });
  const warning = await app.extractAccountingReport('data:application/pdf;base64,VEVTVA==');
  assert.strictEqual(warning.parsed.parse_status, 'warning');
  assert.match(warning.message, /keine Monatswerte erkannt/);

  app.window.AccountingReportBrowser.extractAccountingReport = async () => { throw new Error('synthetischer Lesefehler'); };
  const failed = await app.extractAccountingReport('data:application/pdf;base64,VEVTVA==');
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.parsed.parse_status, 'failed');
  assert.match(failed.message, /synthetischer Lesefehler/);

  let electronCalls = 0;
  app.window.electronAPI = {
    async extractAccountingReport() { electronCalls += 1; return { ok: true, parsed: parsed, pages: 3 }; },
  };
  await app.extractAccountingReport('data:application/pdf;base64,VEVTVA==');
  assert.strictEqual(electronCalls, 1, 'Electron extraction must remain the preferred backend');
  assert.strictEqual(browserCalls, 1, 'Electron extraction must not fall through to the browser backend');
}

(async () => {
  await testBrowserGlobalAndPdfAdapter();
  await testSharedExtractionAndLocalStorage();
  console.log('accounting report browser extraction tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

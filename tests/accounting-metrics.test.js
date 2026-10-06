'use strict';

const assert = require('assert');
const { appHarness } = require('./invoice-app-harness');

function monthly(account, month, value, name) {
  return {
    value_key: account + ':2026-' + String(month).padStart(2, '0'), account_number: account,
    account_name: name || account, value_month: month, value_year: 2026,
    detected_value: value, manual_value: null, effective_value: value, source: 'pdf', status: 'detected',
  };
}

function report(id, month, values, extra) {
  return Object.assign({
    id, report_type: 'financial_accounting_monthly', report_month: month, report_year: 2026,
    period_from_month: 1, period_to_month: month, imported_at: '2026-08-01T10:00:00.000Z',
    original_file_b64: 'data:application/pdf;base64,VEVTVA==', original_file_name: id + '.pdf', original_file_type: 'application/pdf',
    parse_status: 'parsed', parser_version: 'bmd-fibu-v2', monthly_values: values || [], cumulative_metrics: [],
    snapshot_values: [], snapshot_metrics: [], tax_values: [], open_items: [], account_values: [], detected_values: [],
    manual_corrections: [], import_differences: [],
  }, extra || {});
}

(async () => {
  const { app, load } = appHarness();
  app.ACCOUNTING_MONTHS = ['Jänner','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  load(
    'accountingEffectiveNumber', 'parseAccountingManualInput', 'accountingValueWithManual',
    'accountingPreviousValue', 'canonicalAccountingMonthlyValues', 'accountingAccountSum', 'accountingRatio',
    'accountingMonthlyMetrics', 'accountingMetricByKey', 'accountingYtdMetrics', 'accountingMovingAverage',
    'accountingEstimatedBreakEven', 'accountingMonthSequence', 'accountingComparisonRows',
    'resolveAccountingDifference'
  );

  assert.strictEqual(app.parseAccountingManualInput('12.345,67 €'), 12345.67);
  const detected = { detected_value: 100, manual_value: null };
  const overridden = app.accountingValueWithManual(detected, 125);
  assert.strictEqual(overridden.detected_value, 100);
  assert.strictEqual(overridden.effective_value, 125);
  assert.strictEqual(overridden.status, 'manually_changed');
  const restored = app.accountingValueWithManual(overridden, null);
  assert.strictEqual(restored.detected_value, 100);
  assert.strictEqual(restored.effective_value, 100);
  assert.strictEqual(restored.source, 'pdf');

  const julyValues = [];
  for (let month = 1; month <= 7; month += 1) {
    julyValues.push(monthly('4000', month, 10000 * month, 'Erlöse'));
    julyValues.push(monthly('5000', month, -1000 * month, 'Wareneinkauf'));
    julyValues.push(monthly('5300', month, -500 * month, 'Material'));
    julyValues.push(monthly('5700', month, -500 * month, 'Fremdleistungen'));
    julyValues.push(monthly('6000', month, -2000 * month, 'Personal'));
    julyValues.push(monthly('7000', month, -1000 * month, 'Sonstige Kosten'));
  }
  const juneOld = monthly('5000', 6, -1500, 'Wareneinkauf');
  juneOld.manual_value = -1400;
  juneOld.effective_value = -1400;
  const juneReport = report('JUNE', 6, [juneOld]);
  const julyReport = report('JULY', 7, julyValues, {
    cumulative_metrics: [
      { value_key: 'revenue', detected_value: 280000, manual_value: 300000, effective_value: 300000 },
      { value_key: 'material_consumption', detected_value: -14000, manual_value: null, effective_value: -14000 },
      { value_key: 'cost_of_goods', detected_value: -28000, manual_value: null, effective_value: -28000 },
      { value_key: 'external_services', detected_value: -14000, manual_value: null, effective_value: -14000 },
      { value_key: 'contribution_margin_1', detected_value: 224000, manual_value: 240000, effective_value: 240000 },
      { value_key: 'personnel_expenses', detected_value: -56000, manual_value: null, effective_value: -56000 },
      { value_key: 'annual_result', detected_value: 100000, manual_value: null, effective_value: 100000 },
    ],
    snapshot_metrics: [
      { value_key: 'bank_total', detected_value: 5000, manual_value: 6000, effective_value: 6000 },
      { value_key: 'cash', detected_value: 1000, manual_value: null, effective_value: 1000 },
      { value_key: 'receivables', detected_value: 30000, manual_value: null, effective_value: 30000 },
    ],
    tax_values: [{ value_key: 'payable', detected_value: 2000, manual_value: null, effective_value: 2000 }],
    import_differences: [{ previous_report_id: 'JUNE', value_key: '5000:2026-06', account_number: '5000', value_month: 6, value_year: 2026, previous_detected_value: -1500, new_detected_value: -6000, previous_manual_value: -1400, resolution_status: 'manual_preserved' }],
  });
  const reports = [juneReport, julyReport];

  const juneCanonical = app.canonicalAccountingMonthlyValues(reports, 2026, 6).find(value => value.account_number === '5000');
  assert.strictEqual(app.accountingEffectiveNumber(juneCanonical), -1400, 'historical manual value must stay protected');
  julyReport.import_differences[0].resolution_status = 'accepted_new';
  const accepted = app.canonicalAccountingMonthlyValues(reports, 2026, 6).find(value => value.account_number === '5000');
  assert.strictEqual(app.accountingEffectiveNumber(accepted), -6000, 'explicitly accepted new value must win');
  julyReport.import_differences[0].resolution_status = 'kept_previous';
  assert.strictEqual(app.accountingEffectiveNumber(app.canonicalAccountingMonthlyValues(reports, 2026, 6).find(value => value.account_number === '5000')), -1400);
  const currentJune = julyReport.monthly_values.find(value => value.value_key === '5000:2026-06');
  currentJune.manual_value = -1300;
  currentJune.effective_value = -1300;
  assert.strictEqual(app.accountingEffectiveNumber(app.canonicalAccountingMonthlyValues(reports, 2026, 6).find(value => value.account_number === '5000')), -1300, 'manual value in the newest report must win');
  currentJune.manual_value = null;
  currentJune.effective_value = currentJune.detected_value;

  const july = app.accountingMonthlyMetrics(reports, 2026, 7);
  assert.strictEqual(july.revenue, 70000);
  assert.strictEqual(july.contribution_margin_1, 56000);
  assert.strictEqual(july.contribution_margin_1_ratio, 80);
  assert.strictEqual(july.material_ratio, 20);
  assert.strictEqual(july.personnel_ratio, 20);
  assert.strictEqual(july.result, 35000);
  const breakEven = app.accountingEstimatedBreakEven(july);
  assert.strictEqual(breakEven.fixed_costs, 21000);
  assert.strictEqual(breakEven.value, 26250);

  const ytd = app.accountingYtdMetrics(julyReport);
  assert.strictEqual(ytd.revenue, 300000, 'YTD metric must use manual/effective value');
  assert.strictEqual(ytd.contribution_margin_1, 240000);
  assert.strictEqual(ytd.contribution_margin_1_ratio, 80);
  assert.strictEqual(ytd.material_ratio, 18.666666666666668);
  assert.strictEqual(ytd.personnel_ratio, 18.666666666666668);
  assert.strictEqual(ytd.liquidity, 7000);
  assert.strictEqual(ytd.receivables_ratio, 10);

  const revenueComparison = app.accountingComparisonRows(reports, 2026, 7, ytd)[0];
  assert.strictEqual(revenueComparison.current, 70000);
  assert.strictEqual(revenueComparison.previous, 60000);
  assert.strictEqual(revenueComparison.average3, 60000);
  assert.strictEqual(revenueComparison.average6, 45000);
  assert.strictEqual(revenueComparison.ytd, 300000);

  assert.strictEqual(app.accountingMovingAverage([10, 20, 30], 3), 20);
  assert.strictEqual(app.accountingMovingAverage([10, null, 30], 3), null, 'missing month must not be converted to zero');
  const incomplete = app.accountingMonthlyMetrics([report('ONLY-REVENUE', 7, [monthly('4000', 7, 10000)])], 2026, 7);
  assert.strictEqual(incomplete.variable_costs, null);
  assert.strictEqual(incomplete.contribution_margin_1, null);
  assert.strictEqual(incomplete.material_ratio, null);

  const persisted = await app.persistAccountingReportCreate(report('RESET', 7, [monthly('4000', 7, 100)]));
  const changedValues = [app.accountingValueWithManual(persisted.monthly_values[0], 125)];
  const changed = await app.persistAccountingReportUpdate(Object.assign({}, persisted, { monthly_values: changedValues }), { preserveManualValues: false, rebuildImportDifferences: false });
  assert.strictEqual(changed.monthly_values[0].effective_value, 125);
  const resetValues = [app.accountingValueWithManual(changed.monthly_values[0], null)];
  const reset = await app.persistAccountingReportUpdate(Object.assign({}, changed, { monthly_values: resetValues }), { preserveManualValues: false, rebuildImportDifferences: false });
  assert.strictEqual(reset.monthly_values[0].effective_value, 100);
  assert.strictEqual(reset.monthly_values[0].manual_value, null);
  await app.persistAccountingReportUpdate(Object.assign({}, reset, {
    import_differences: [{ value_key: '4000:2026-07', account_number: '4000', value_month: 7, value_year: 2026, previous_detected_value: 90, new_detected_value: 100, resolution_status: 'pending' }],
  }), { preserveManualValues: false, rebuildImportDifferences: false });
  const resolved = await app.resolveAccountingDifference('RESET', 0, 'kept_previous');
  assert.strictEqual(resolved.import_differences[0].resolution_status, 'kept_previous');

  console.log('accounting metrics and manual correction tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseGermanNumber, parseFinancialAccountingReportText } = require('../accounting-report-parser');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/financial-accounting-july-2026.txt'), 'utf8');
const parsed = parseFinancialAccountingReportText(fixture);

assert.strictEqual(parseGermanNumber('26.117,23'), 26117.23);
assert.strictEqual(parseGermanNumber('-1.706'), -1706);
assert.strictEqual(parseGermanNumber('keine Zahl'), null);

assert.deepStrictEqual([
  parsed.detected_period_from_month,
  parsed.detected_period_from_year,
  parsed.detected_period_to_month,
  parsed.detected_period_to_year,
], [1, 2026, 7, 2026]);

function monthly(account, month) {
  return parsed.monthly_values.find(value => value.account_number === account && value.value_month === month);
}
function cumulative(key) {
  return parsed.cumulative_metrics.find(value => value.value_key === key);
}
function snapshot(key) {
  return parsed.snapshot_metrics.find(value => value.value_key === key);
}
function tax(key) {
  return parsed.tax_values.find(value => value.value_key === key);
}

assert.strictEqual(monthly('4000', 1).detected_value, 11263);
assert.strictEqual(monthly('4000', 7).detected_value, 26114);
assert.strictEqual(monthly('5000', 6).detected_value, -1706);
assert.strictEqual(monthly('9999', 7).detected_value, -7, 'unknown accounts must be retained');
assert.strictEqual(monthly('9999', 7).account_name, 'Unbekanntes Testkonto');

assert.strictEqual(cumulative('revenue').detected_value, 136119.49);
assert.strictEqual(cumulative('contribution_margin_2').detected_value, 11512.61);
assert.strictEqual(cumulative('ebitda').detected_value, -13611.59);
assert.strictEqual(cumulative('annual_result').detected_value, -19400.6);
assert.ok(!parsed.monthly_values.some(value => value.value_key === 'revenue'), 'cumulative metrics must not become monthly values');

assert.strictEqual(snapshot('receivables').detected_value, 15909.99);
assert.strictEqual(snapshot('cash').detected_value, 1625.9);
assert.strictEqual(snapshot('bank_total').detected_value, 5586.67);
assert.strictEqual(snapshot('payables').detected_value, -1808.95);
assert.strictEqual(snapshot('cash').snapshot_date, '2026-07-31');

assert.strictEqual(tax('taxable_basis').detected_value, 26117.23);
assert.strictEqual(tax('vat').detected_value, 5223.45);
assert.strictEqual(tax('input_tax').detected_value, 1525.74);
assert.strictEqual(tax('payable').detected_value, 3697.71);

const customerTotal = parsed.open_items.find(value => value.value_key === 'customer_total');
const supplierTotal = parsed.open_items.find(value => value.value_key === 'supplier_total');
assert.strictEqual(customerTotal.detected_value, 15909.99);
assert.strictEqual(supplierTotal.detected_value, -1808.95);
assert.ok(parsed.open_items.some(value => value.document_number === '165' && value.detected_value === 3276));

const sparse = parseFinancialAccountingReportText('Von: Jänner 2026\tBis: Juli 2026\nErfolgsvergleich\nPeriodenübersicht mit EB');
assert.strictEqual(sparse.cumulative_metrics.find(value => value.value_key === 'revenue').detected_value, null);
assert.strictEqual(sparse.cumulative_metrics.find(value => value.value_key === 'revenue').status, 'missing');
assert.strictEqual(sparse.tax_values.find(value => value.value_key === 'payable').detected_value, null);

console.log('accounting report parser tests passed');

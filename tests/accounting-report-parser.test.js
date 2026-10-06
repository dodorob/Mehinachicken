'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseGermanNumber, reconstructLayoutPage, parseFinancialAccountingReportText } = require('../accounting-report-parser');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/financial-accounting-july-2026.txt'), 'utf8');
const layoutItems = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/financial-accounting-layout-items.json'), 'utf8'));
const parsed = parseFinancialAccountingReportText(fixture);

assert.ok(!fixture.includes('\t'), 'the parser fixture must model PDF layout without tab delimiters');
assert.strictEqual(parsed.parser_version, 'bmd-fibu-v2');

assert.strictEqual(parseGermanNumber('12.345,67'), 12345.67);
assert.strictEqual(parseGermanNumber('-1.500'), -1500);
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

assert.strictEqual(monthly('4000', 1).detected_value, 10000);
assert.strictEqual(monthly('4000', 7).detected_value, 16000);
assert.strictEqual(monthly('5000', 6).detected_value, -1500);
assert.strictEqual(monthly('9999', 7).detected_value, -7, 'unknown accounts must be retained');
assert.strictEqual(monthly('9999', 7).account_name, 'Unbekanntes Testkonto');

assert.strictEqual(cumulative('revenue').detected_value, 100000);
assert.strictEqual(cumulative('contribution_margin_2').detected_value, 42500);
assert.strictEqual(cumulative('ebitda').detected_value, 28500);
assert.strictEqual(cumulative('annual_result').detected_value, 20500);
assert.ok(!parsed.monthly_values.some(value => value.value_key === 'revenue'), 'cumulative metrics must not become monthly values');

assert.strictEqual(snapshot('receivables').detected_value, 12345.67);
assert.strictEqual(snapshot('cash').detected_value, 1234.56);
assert.strictEqual(snapshot('bank_total').detected_value, 4321.09);
assert.strictEqual(snapshot('payables').detected_value, -2222.22);
assert.strictEqual(snapshot('cash').snapshot_date, '2026-07-31');

assert.strictEqual(tax('taxable_basis').detected_value, 16000);
assert.strictEqual(tax('vat').detected_value, 3200);
assert.strictEqual(tax('input_tax').detected_value, 1200);
assert.strictEqual(tax('payable').detected_value, 2000);

const customerTotal = parsed.open_items.find(value => value.value_key === 'customer_total');
const supplierTotal = parsed.open_items.find(value => value.value_key === 'supplier_total');
assert.strictEqual(customerTotal.detected_value, 12345.67);
assert.strictEqual(supplierTotal.detected_value, -2222.22);
assert.ok(parsed.open_items.some(value => value.document_number === 'TEST-101' && value.detected_value === 1111.11));

const reconstructed = reconstructLayoutPage(layoutItems);
assert.ok(!reconstructed.includes('\t'), 'coordinate reconstruction must not invent tabs');
const layoutParsed = parseFinancialAccountingReportText([
  'Von: Jänner 2026  Bis: Februar 2026',
  'Periodenübersicht mit EB',
  reconstructed,
  'Seite: 1',
].join('\n'));
assert.strictEqual(layoutParsed.monthly_values.find(value => value.account_number === '4000' && value.value_month === 1).detected_value, 1000);
assert.strictEqual(layoutParsed.monthly_values.find(value => value.account_number === '4000' && value.value_month === 2).detected_value, 2000);

const sparse = parseFinancialAccountingReportText('Von: Jänner 2026  Bis: Juli 2026\nErfolgsvergleich\nPeriodenübersicht mit EB');
assert.strictEqual(sparse.cumulative_metrics.find(value => value.value_key === 'revenue').detected_value, null);
assert.strictEqual(sparse.cumulative_metrics.find(value => value.value_key === 'revenue').status, 'missing');
assert.strictEqual(sparse.tax_values.find(value => value.value_key === 'payable').detected_value, null);

console.log('accounting report parser tests passed');

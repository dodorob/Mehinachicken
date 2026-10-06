'use strict';

const assert = require('assert');
const { appHarness } = require('./invoice-app-harness');

function employee(id, name, extra) {
  return Object.assign({
    id, name, weekly_hours: 20, annual_employer_cost: 26000,
    productive_mode: 'manual', manual_productive_rate: 0.5,
    active: true, timesheet_link: null, note: '',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  }, extra || {});
}

function accountingReport() {
  const monthlyValues = [];
  for (let month = 1; month <= 7; month += 1) {
    monthlyValues.push({ value_key: `7000:2026-${String(month).padStart(2, '0')}`, account_number: '7000', value_month: month, value_year: 2026, detected_value: -1000, manual_value: null });
    monthlyValues.push({ value_key: `5000:2026-${String(month).padStart(2, '0')}`, account_number: '5000', value_month: month, value_year: 2026, detected_value: -5000, manual_value: null });
    monthlyValues.push({ value_key: `5700:2026-${String(month).padStart(2, '0')}`, account_number: '5700', value_month: month, value_year: 2026, detected_value: -3000, manual_value: null });
    monthlyValues.push({ value_key: `6000:2026-${String(month).padStart(2, '0')}`, account_number: '6000', value_month: month, value_year: 2026, detected_value: -4000, manual_value: null });
  }
  return {
    id: 'REPORT-JULY', report_type: 'financial_accounting_monthly', report_month: 7, report_year: 2026,
    period_from_month: 1, period_to_month: 7, imported_at: '2026-08-01T00:00:00.000Z', monthly_values: monthlyValues,
  };
}

(async () => {
  const { app, storage, load } = appHarness();
  load(
    'persistDB', 'accountingEffectiveNumber', 'accountingPreviousValue', 'canonicalAccountingMonthlyValues',
    'normaliseEmployee', 'validateEmployee', 'suggestEmployeeTimesheetLink', 'persistEmployee', 'deactivateEmployee',
    'employeePlanningPeriod', 'employeeAnnualContractHours', 'employeeContractHoursForPeriod', 'employeeDateInPeriod',
    'employeeTimesheetActuals', 'employeeProductiveRate', 'employeeAccountingOverhead', 'calculateEmployeePlans',
    'importBackupData'
  );

  assert.strictEqual(app.suggestEmployeeTimesheetLink('Dževad'), 'djevad');
  assert.strictEqual(app.suggestEmployeeTimesheetLink('Cevad'), 'djevad');
  assert.strictEqual(app.suggestEmployeeTimesheetLink('Helmut'), 'helmut');
  assert.strictEqual(app.suggestEmployeeTimesheetLink('Max Muster'), null);
  assert.strictEqual(app.employeeAnnualContractHours(employee('FULL', 'Vollzeit', { weekly_hours: 38.5 })), 2002);
  assert.strictEqual(app.normaliseEmployee(employee('UNLINKED-AUTO', 'Neu', { productive_mode: 'automatic' })).productive_mode, 'manual');

  app._dbCache.invoices = [{ id: 'ORIGINAL', typ: 'ausgang', items: [{ title: 'Bestehende Position', djevad_h: 0, helmut_h: 0 }] }];
  const invoicesBefore = JSON.stringify(app._dbCache.invoices);
  const max = await app.persistEmployee(employee('MAX', 'Max Muster'));
  assert.strictEqual(max.timesheet_link, null);
  assert.strictEqual(JSON.stringify(app.getDB().invoices), invoicesBefore, 'unlinked employees must not change invoice data');
  assert.ok(!Object.prototype.hasOwnProperty.call(app.getDB().invoices[0].items[0], 'employees'), 'no employee collection may be added to invoice items');

  const edited = await app.persistEmployee(Object.assign({}, max, { weekly_hours: 25, note: 'Bearbeitet' }));
  assert.strictEqual(edited.weekly_hours, 25);
  assert.strictEqual(app.getDB().employees.length, 1);
  const inactive = await app.deactivateEmployee('MAX');
  assert.strictEqual(inactive.active, false);

  await app.persistEmployee(employee('DZ', 'Dževad', { weekly_hours: 40, annual_employer_cost: 24000, productive_mode: 'automatic', manual_productive_rate: null, timesheet_link: 'djevad' }));
  await app.persistEmployee(employee('HEL', 'Helmut', { weekly_hours: 40, annual_employer_cost: 12000, productive_mode: 'automatic', manual_productive_rate: null, timesheet_link: 'helmut' }));
  await assert.rejects(
    () => app.persistEmployee(employee('DZ2', 'Zweiter Dževad', { productive_mode: 'automatic', manual_productive_rate: null, timesheet_link: 'djevad' })),
    /bereits/
  );

  app._dbCache.employees.find(item => item.id === 'MAX').active = true;
  app._dbCache.invoices = [{
    id: 'TIMES', typ: 'ausgang', datum: '2026-07-15', leistungsdatum: '2026-07-14', flag_djevad: false, flag_helmut: false,
    items: [{
      menge: 10,
      arbeitsdaten: [
        { datum: '2026-01-15', djevad_h: 100, helmut_h: 50 },
        { datum: '2026-07-15', djevad_h: 100, helmut_h: 50 },
      ],
      fahrzeitdaten: [
        { datum: '2026-01-15', djevad_h: 30, helmut_h: 10 },
        { datum: '2026-07-15', djevad_h: 20, helmut_h: 10 },
      ],
    }],
  }];
  app._dbCache.accounting_reports = [accountingReport()];

  const result = app.calculateEmployeePlans(app.getDB().employees, app.getDB().invoices, app.getDB().accounting_reports, 2026);
  assert.strictEqual(result.period.label, 'Jänner–Juli 2026');
  assert.strictEqual(result.overhead, 7000, 'material and personnel accounts must not be counted as overhead');
  const djevad = result.plans.find(plan => plan.employee.id === 'DZ');
  const helmut = result.plans.find(plan => plan.employee.id === 'HEL');
  const manual = result.plans.find(plan => plan.employee.id === 'MAX');
  assert.strictEqual(djevad.actuals.productive_hours, 200);
  assert.strictEqual(djevad.actuals.travel_hours, 50);
  assert.strictEqual(helmut.actuals.productive_hours, 100);
  assert.strictEqual(helmut.actuals.travel_hours, 20);
  assert.ok(Math.abs(djevad.contract_hours - (40 * 52 * 7 / 12)) < 1e-9);
  assert.ok(Math.abs(djevad.rate - (200 / (40 * 52 * 7 / 12))) < 1e-9, 'travel time must not increase the automatic productive rate');
  assert.strictEqual(manual.rate, 0.5);
  assert.strictEqual(manual.annual_contract_hours, 25 * 52);
  assert.strictEqual(manual.annual_productive_hours, 25 * 52 * 0.5);
  assert.strictEqual(manual.personnel_hourly, 40);
  assert.ok(Math.abs(result.total_productive_hours - (200 + 100 + 25 * 52 * 7 / 12 * 0.5)) < 1e-9);
  assert.ok(Math.abs(result.overhead_hourly - (7000 / result.total_productive_hours)) < 1e-9);
  assert.ok(Math.abs(djevad.break_even_hourly - (djevad.personnel_hourly + result.overhead_hourly)) < 1e-9);
  const actualPeriodOnly = app.calculateEmployeePlans([app.getDB().employees.find(item => item.id === 'DZ')], app.getDB().invoices, [], 2026);
  assert.strictEqual(actualPeriodOnly.period.label, 'Jänner–Juli 2026', 'without accounting data, available contract time must follow the actual data span');
  assert.ok(Math.abs(actualPeriodOnly.plans[0].rate - djevad.rate) < 1e-9);
  const insufficient = app.employeeProductiveRate(employee('EMPTY', 'Ohne Daten', { productive_mode: 'automatic', manual_productive_rate: null, timesheet_link: 'djevad' }), [], result.period);
  assert.strictEqual(insufficient.status, 'insufficient');
  assert.strictEqual(insufficient.rate, null);

  app._dbCache = null;
  assert.strictEqual(app.getDB().employees.length, 3, 'employees must survive localStorage reload');
  const backup = app.createBackupObject();
  assert.strictEqual(JSON.parse(backup.buchpro_v1).employees.length, 3);
  storage.data = {};
  app._dbCache = null;
  assert.strictEqual(app.importBackupData(backup), 1);
  app._dbCache = null;
  assert.strictEqual(app.getDB().employees.find(item => item.id === 'DZ').timesheet_link, 'djevad', 'employee links must survive browser backup restore');

  console.log('employee planning and browser persistence tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

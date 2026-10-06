'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BuchProDB = require('../database');

function employee(id, link) {
  return {
    id, name: id, weekly_hours: 38.5, annual_employer_cost: 55000,
    productive_mode: link ? 'automatic' : 'manual', manual_productive_rate: link ? null : 0.7,
    active: true, timesheet_link: link || null, note: '',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function openTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mehina-employees-'));
  const file = path.join(dir, 'test.sqlite');
  const db = new BuchProDB();
  db.open(file);
  return { dir, file, db };
}

const temp = openTemp();
try {
  temp.db.saveAll({ employees: [employee('DZ', 'djevad'), employee('MAX', null)] });
  assert.strictEqual(temp.db.loadAll().employees.length, 2);
  assert.strictEqual(temp.db.loadAll().employees.find(item => item.id === 'DZ').timesheet_link, 'djevad');
  temp.db.close();
  temp.db.open(temp.file);
  assert.strictEqual(temp.db.loadAll().employees.find(item => item.id === 'MAX').manual_productive_rate, 0.7, 'employees must survive SQLite restart');

  assert.throws(() => temp.db.saveAll({ employees: [employee('DZ', 'djevad'), employee('DZ2', 'djevad')] }), /UNIQUE/);
  assert.strictEqual(temp.db.loadAll().employees.length, 2, 'failed duplicate link transaction must retain existing employees');
} finally {
  temp.db.close();
  fs.rmSync(temp.dir, { recursive: true, force: true });
}

const migrated = openTemp();
try {
  migrated.db.migrateFromLocalStorage({ buchpro_v1: JSON.stringify({ employees: [employee('HEL', 'helmut')] }) });
  assert.strictEqual(migrated.db.loadAll().employees[0].timesheet_link, 'helmut', 'browser backup employees must migrate to SQLite');
} finally {
  migrated.db.close();
  fs.rmSync(migrated.dir, { recursive: true, force: true });
}

console.log('employee SQLite persistence tests passed');

'use strict';

const Database = require('better-sqlite3');

// Invoice counters are the counters consumed while creating new invoices.
// They must never be overwritten by stale renderer saveAll() snapshots.
const INVOICE_COUNTER_KEYS = Object.freeze(['ausgang', 'fortlaufend', 'lfd_bank', 'kassenbeleg']);
const INVOICE_COUNTER_KEY_SET = new Set(INVOICE_COUNTER_KEYS);

class BuchProDB {
  constructor() {
    this.db = null;
    this.dbPath = null;
  }

  open(dbPath) {
    if (this.db) {
      try { this.db.close(); } catch (_) {}
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.dbPath = dbPath;
    this._initSchema();
    return true;
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id             TEXT PRIMARY KEY,
        typ            TEXT NOT NULL,
        nummer         TEXT,
        lfd_nr         TEXT,
        zahlungsart    TEXT,
        privatkunde    INTEGER DEFAULT 0,
        flag_djevad    INTEGER DEFAULT 0,
        flag_helmut    INTEGER DEFAULT 0,
        partner_id     TEXT,
        partner_name   TEXT,
        partner_info   TEXT,
        datum          TEXT,
        leistungsdatum TEXT,
        fz_marke       TEXT,
        fz_kz          TEXT,
        faellig        TEXT,
        status         TEXT,
        notizen        TEXT,
        kassenbeleg_nr TEXT,
        zahlungs_lfd_nr TEXT,
        kassa_typ      TEXT,
        materialkosten REAL DEFAULT 0,
        mat_auto       INTEGER DEFAULT 0,
        erstellt       TEXT,
        er_liefnr      TEXT,
        is_gutschrift  INTEGER DEFAULT 0,
        is_tageslosung INTEGER DEFAULT 0,
        er_netto       REAL,
        er_ust         REAL,
        er_brutto      REAL,
        er_ust_pct     REAL,
        file_b64       TEXT,
        file_name      TEXT,
        file_type      TEXT,
        items          TEXT DEFAULT '[]',
        er_items       TEXT DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS kunden (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS lieferanten (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS zahlungen (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fahrzeuge (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS employees (
        id                     TEXT PRIMARY KEY,
        name                   TEXT NOT NULL,
        weekly_hours           REAL NOT NULL CHECK (weekly_hours > 0),
        annual_employer_cost   REAL NOT NULL CHECK (annual_employer_cost >= 0),
        productive_mode        TEXT NOT NULL CHECK (productive_mode IN ('automatic', 'manual')),
        manual_productive_rate REAL,
        active                 INTEGER NOT NULL DEFAULT 1,
        timesheet_link         TEXT UNIQUE CHECK (timesheet_link IN ('djevad', 'helmut') OR timesheet_link IS NULL),
        note                   TEXT,
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS todos (
        id         TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        archiviert INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS kostenvoranschlaege (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS beschreibung_hist (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT UNIQUE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS counters (
        name  TEXT PRIMARY KEY,
        value INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS vorlage (
        id   INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fixkosten (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        name   TEXT,
        betrag REAL,
        monat  INTEGER
      );

      CREATE TABLE IF NOT EXISTS pos_badges (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        label      TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS accounting_reports (
        id                         TEXT PRIMARY KEY,
        report_type                TEXT NOT NULL,
        report_month               INTEGER NOT NULL CHECK (report_month BETWEEN 1 AND 12),
        report_year                INTEGER NOT NULL CHECK (report_year BETWEEN 2000 AND 2100),
        period_from_month          INTEGER NOT NULL CHECK (period_from_month BETWEEN 1 AND 12),
        period_to_month            INTEGER NOT NULL CHECK (period_to_month BETWEEN 1 AND 12),
        imported_at                TEXT NOT NULL,
        original_file_b64          TEXT NOT NULL,
        original_file_name         TEXT NOT NULL,
        original_file_type         TEXT NOT NULL,
        parse_status               TEXT NOT NULL DEFAULT 'pending',
        parser_version             TEXT,
        detected_period_from_month INTEGER,
        detected_period_from_year  INTEGER,
        detected_period_to_month   INTEGER,
        detected_period_to_year    INTEGER,
        validation_status          TEXT NOT NULL DEFAULT 'not_checked',
        validation_message         TEXT,
        UNIQUE (report_type, report_month, report_year)
      );

      CREATE TABLE IF NOT EXISTS accounting_monthly_values (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, value_key TEXT NOT NULL,
        value_month INTEGER, value_year INTEGER, account_number TEXT, account_name TEXT,
        detected_value REAL, manual_value REAL, unit TEXT, source TEXT DEFAULT 'pdf',
        source_section TEXT, source_label TEXT, confidence REAL,
        status TEXT DEFAULT 'detected', metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS accounting_snapshot_values (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, value_key TEXT NOT NULL,
        snapshot_date TEXT, detected_value REAL, manual_value REAL, unit TEXT,
        source TEXT DEFAULT 'pdf', status TEXT DEFAULT 'detected', metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS accounting_cumulative_metrics (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, value_key TEXT NOT NULL,
        detected_value REAL, manual_value REAL, unit TEXT, source TEXT DEFAULT 'pdf',
        source_section TEXT, source_label TEXT, confidence REAL,
        status TEXT DEFAULT 'detected', metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS accounting_snapshot_metrics (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, value_key TEXT NOT NULL,
        snapshot_date TEXT, account_number TEXT, account_name TEXT,
        detected_value REAL, manual_value REAL, unit TEXT, source TEXT DEFAULT 'pdf',
        source_section TEXT, source_label TEXT, confidence REAL,
        status TEXT DEFAULT 'detected', metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS accounting_tax_values (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, tax_type TEXT, value_key TEXT NOT NULL,
        period_month INTEGER, period_year INTEGER, detected_value REAL, manual_value REAL, unit TEXT,
        source TEXT DEFAULT 'pdf', source_section TEXT, source_label TEXT, confidence REAL,
        status TEXT DEFAULT 'detected', metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS accounting_open_items (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, party_type TEXT, party_name TEXT,
        document_number TEXT, document_date TEXT, due_date TEXT, aging_class TEXT,
        detected_value REAL, manual_value REAL, currency TEXT DEFAULT 'EUR',
        source TEXT DEFAULT 'pdf', source_section TEXT, source_label TEXT, confidence REAL,
        status TEXT DEFAULT 'detected', metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS accounting_account_values (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, account_number TEXT, account_name TEXT,
        detected_value REAL, manual_value REAL, unit TEXT,
        source TEXT DEFAULT 'pdf', status TEXT DEFAULT 'detected', metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS accounting_detected_values (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, value_scope TEXT NOT NULL, value_key TEXT NOT NULL,
        raw_value TEXT, normalized_value TEXT, page_number INTEGER, confidence REAL, metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS accounting_manual_corrections (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, value_scope TEXT NOT NULL, value_id TEXT NOT NULL,
        value_key TEXT NOT NULL, detected_value TEXT, previous_manual_value TEXT, manual_value TEXT,
        changed_at TEXT NOT NULL, note TEXT,
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS accounting_import_differences (
        id TEXT PRIMARY KEY, report_id TEXT NOT NULL, previous_report_id TEXT,
        value_scope TEXT NOT NULL, value_key TEXT NOT NULL, account_number TEXT,
        value_month INTEGER, value_year INTEGER, previous_detected_value REAL,
        new_detected_value REAL, previous_manual_value REAL, resolution_status TEXT NOT NULL DEFAULT 'pending',
        detected_at TEXT NOT NULL, metadata_json TEXT DEFAULT '{}',
        FOREIGN KEY (report_id) REFERENCES accounting_reports(id) ON DELETE CASCADE
      );
    `);
    // Schema migrations (safe to run multiple times)
    try { this.db.exec('ALTER TABLE invoices ADD COLUMN is_sammel INTEGER DEFAULT 0'); } catch(_) {}
    try { this.db.exec('ALTER TABLE invoices ADD COLUMN zahlungs_lfd_nr TEXT'); } catch(_) {}
    try { this.db.exec('ALTER TABLE invoices ADD COLUMN sammel_beschreibung TEXT'); } catch(_) {}
    try { this.db.exec('ALTER TABLE fixkosten ADD COLUMN fk_id TEXT'); } catch(_) {}
    try { this.db.exec('ALTER TABLE fixkosten ADD COLUMN bezahlt_am TEXT'); } catch(_) {}
    try { this.db.exec("ALTER TABLE fixkosten ADD COLUMN reset_intervall TEXT DEFAULT 'monatlich'"); } catch(_) {}
    try { this.db.exec('ALTER TABLE fixkosten ADD COLUMN reset_datum TEXT'); } catch(_) {}
    [
      'ALTER TABLE accounting_monthly_values ADD COLUMN account_number TEXT',
      'ALTER TABLE accounting_monthly_values ADD COLUMN account_name TEXT',
      'ALTER TABLE accounting_monthly_values ADD COLUMN source_section TEXT',
      'ALTER TABLE accounting_monthly_values ADD COLUMN source_label TEXT',
      'ALTER TABLE accounting_monthly_values ADD COLUMN confidence REAL',
      'ALTER TABLE accounting_tax_values ADD COLUMN source_section TEXT',
      'ALTER TABLE accounting_tax_values ADD COLUMN source_label TEXT',
      'ALTER TABLE accounting_tax_values ADD COLUMN confidence REAL',
      'ALTER TABLE accounting_open_items ADD COLUMN document_date TEXT',
      'ALTER TABLE accounting_open_items ADD COLUMN aging_class TEXT',
      'ALTER TABLE accounting_open_items ADD COLUMN source_section TEXT',
      'ALTER TABLE accounting_open_items ADD COLUMN source_label TEXT',
      'ALTER TABLE accounting_open_items ADD COLUMN confidence REAL',
    ].forEach(sql => { try { this.db.exec(sql); } catch (_) {} });
  }

  // ----------------------------------------------------------------
  // Load all data for renderer
  // ----------------------------------------------------------------
  loadAll() {
    const invoicesRaw = this.db.prepare('SELECT * FROM invoices').all();
    const invoices = invoicesRaw.map(row => this._invoiceFromRow(row));

    const kunden      = this.db.prepare('SELECT data FROM kunden').all().map(r => JSON.parse(r.data));
    const lieferanten = this.db.prepare('SELECT data FROM lieferanten').all().map(r => JSON.parse(r.data));
    const zahlungen   = this.db.prepare('SELECT data FROM zahlungen').all().map(r => JSON.parse(r.data));
    const fahrzeuge   = this.db.prepare('SELECT data FROM fahrzeuge').all().map(r => JSON.parse(r.data));
    const employees   = this.db.prepare('SELECT * FROM employees ORDER BY active DESC, name COLLATE NOCASE').all().map(row => ({
      ...row,
      active: !!row.active,
    }));

    const todosAll    = this.db.prepare('SELECT * FROM todos').all();
    const todos       = todosAll.filter(r => !r.archiviert).map(r => JSON.parse(r.data));
    const todos_archiv = todosAll.filter(r =>  r.archiviert).map(r => JSON.parse(r.data));

    const kv = this.db.prepare('SELECT data FROM kostenvoranschlaege').all().map(r => JSON.parse(r.data));

    const countersRaw = this.db.prepare('SELECT name, value FROM counters').all();
    const counters = { ausgang: 1, eingang: 1, fortlaufend: 1, kassenbeleg: 1, lfd_bank: 1, lfd_kassa: 1 };
    countersRaw.forEach(row => { counters[row.name] = row.value; });

    const vorlageRow = this.db.prepare('SELECT data FROM vorlage WHERE id = 1').get();
    const vorlage    = vorlageRow ? JSON.parse(vorlageRow.data) : null;

    const accounting_reports = this.listAccountingReports();
    return { invoices, kunden, lieferanten, zahlungen, fahrzeuge, employees, todos, todos_archiv, kostenvoranschlaege: kv, counters, vorlage, accounting_reports };
  }

  isEmpty() {
    const invoices = this.db.prepare('SELECT COUNT(*) AS n FROM invoices').get().n;
    const reports = this.db.prepare('SELECT COUNT(*) AS n FROM accounting_reports').get().n;
    const employees = this.db.prepare('SELECT COUNT(*) AS n FROM employees').get().n;
    return invoices === 0 && reports === 0 && employees === 0;
  }

  // ----------------------------------------------------------------
  // Save entire data snapshot
  // ----------------------------------------------------------------
  saveAll(data) {
    const tx = this.db.transaction(() => {
      // In Electron/SQLite mode invoices and accounting reports are persisted
      // exclusively through targeted CRUD methods. The browser/localStorage
      // fallback does not use database.js, so stale snapshot copies of both
      // collections are intentionally ignored here.

      // Kunden
      this.db.prepare('DELETE FROM kunden').run();
      if (data.kunden && data.kunden.length) {
        const ins = this.db.prepare('INSERT INTO kunden (id, data) VALUES (@id, @data)');
        data.kunden.forEach(k => ins.run({ id: k.id, data: JSON.stringify(k) }));
      }

      // Lieferanten
      this.db.prepare('DELETE FROM lieferanten').run();
      if (data.lieferanten && data.lieferanten.length) {
        const ins = this.db.prepare('INSERT INTO lieferanten (id, data) VALUES (@id, @data)');
        data.lieferanten.forEach(l => ins.run({ id: l.id, data: JSON.stringify(l) }));
      }

      // Zahlungen
      this.db.prepare('DELETE FROM zahlungen').run();
      if (data.zahlungen && data.zahlungen.length) {
        const ins = this.db.prepare('INSERT INTO zahlungen (id, data) VALUES (@id, @data)');
        data.zahlungen.forEach(z => ins.run({ id: z.id, data: JSON.stringify(z) }));
      }

      // Fahrzeuge
      this.db.prepare('DELETE FROM fahrzeuge').run();
      if (data.fahrzeuge && data.fahrzeuge.length) {
        const ins = this.db.prepare('INSERT INTO fahrzeuge (id, data) VALUES (@id, @data)');
        data.fahrzeuge.forEach(f => ins.run({ id: f.id, data: JSON.stringify(f) }));
      }

      // Mitarbeiterstamm (Rechnungs-Zeiterfassung bleibt unverändert in invoices.items)
      this.db.prepare('DELETE FROM employees').run();
      if (data.employees && data.employees.length) {
        const ins = this.db.prepare(`INSERT INTO employees (
          id, name, weekly_hours, annual_employer_cost, productive_mode,
          manual_productive_rate, active, timesheet_link, note, created_at, updated_at
        ) VALUES (
          @id, @name, @weekly_hours, @annual_employer_cost, @productive_mode,
          @manual_productive_rate, @active, @timesheet_link, @note, @created_at, @updated_at
        )`);
        data.employees.forEach(employee => ins.run({
          id: employee.id,
          name: employee.name,
          weekly_hours: Number(employee.weekly_hours),
          annual_employer_cost: Number(employee.annual_employer_cost),
          productive_mode: employee.productive_mode === 'automatic' ? 'automatic' : 'manual',
          manual_productive_rate: employee.manual_productive_rate == null ? null : Number(employee.manual_productive_rate),
          active: employee.active === false ? 0 : 1,
          timesheet_link: employee.timesheet_link || null,
          note: employee.note || null,
          created_at: employee.created_at || new Date().toISOString(),
          updated_at: employee.updated_at || new Date().toISOString(),
        }));
      }

      // Todos
      this.db.prepare('DELETE FROM todos').run();
      const insT = this.db.prepare('INSERT INTO todos (id, data, archiviert) VALUES (@id, @data, @archiviert)');
      (data.todos || []).forEach(t => insT.run({ id: t.id, data: JSON.stringify(t), archiviert: 0 }));
      (data.todos_archiv || []).forEach(t => insT.run({ id: t.id, data: JSON.stringify(t), archiviert: 1 }));

      // Kostenvoranschlaege
      this.db.prepare('DELETE FROM kostenvoranschlaege').run();
      if (data.kostenvoranschlaege && data.kostenvoranschlaege.length) {
        const ins = this.db.prepare('INSERT INTO kostenvoranschlaege (id, data) VALUES (@id, @data)');
        data.kostenvoranschlaege.forEach(kv => ins.run({ id: kv.id, data: JSON.stringify(kv) }));
      }

      // Counters
      // Stale renderer saveAll() snapshots must not reset counters that are
      // consumed by atomic invoice creation. Persist only non-invoice counters.
      if (data.counters) {
        const del = this.db.prepare('DELETE FROM counters WHERE name = ?');
        const ins = this.db.prepare('INSERT OR REPLACE INTO counters (name, value) VALUES (@name, @value)');
        Object.entries(data.counters).forEach(([name, value]) => {
          if (INVOICE_COUNTER_KEY_SET.has(name)) return;
          del.run(name);
          ins.run({ name, value: value || 0 });
        });
      }

      // Vorlage
      if (data.vorlage) {
        this.db.prepare('INSERT OR REPLACE INTO vorlage (id, data) VALUES (1, @data)').run({ data: JSON.stringify(data.vorlage) });
      }
    });
    tx();
  }

  _invoiceColumns() {
    return [
      'id', 'typ', 'nummer', 'lfd_nr', 'zahlungsart', 'privatkunde', 'flag_djevad', 'flag_helmut',
      'partner_id', 'partner_name', 'partner_info', 'datum', 'leistungsdatum', 'fz_marke', 'fz_kz',
      'faellig', 'status', 'notizen', 'kassenbeleg_nr', 'zahlungs_lfd_nr', 'kassa_typ', 'materialkosten', 'mat_auto',
      'erstellt', 'er_liefnr', 'is_gutschrift', 'is_tageslosung', 'er_netto', 'er_ust', 'er_brutto',
      'er_ust_pct', 'file_b64', 'file_name', 'file_type', 'items', 'er_items',
      'is_sammel', 'sammel_beschreibung',
    ];
  }

  getInvoice(id) {
    const row = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    return row ? this._invoiceFromRow(row) : null;
  }

  // Insert an already completely numbered invoice (migration/import/tests).
  // Normal UI-created invoices must use createInvoiceWithCounters().
  createInvoice(invoice) {
    const row = this._invoiceToRow(invoice || {});
    const cols = this._invoiceColumns();
    const sql = `INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`;
    this.db.prepare(sql).run(row);
    return this.getInvoice(row.id);
  }


  _getCounterValue(name) {
    if (!INVOICE_COUNTER_KEY_SET.has(name)) throw new Error('Unbekannter Rechnungszähler: ' + name);
    const row = this.db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
    return row && Number.isInteger(row.value) && row.value > 0 ? row.value : 1;
  }

  _setCounterValue(name, value) {
    if (!INVOICE_COUNTER_KEY_SET.has(name)) throw new Error('Unbekannter Rechnungszähler: ' + name);
    if (!Number.isInteger(value) || value < 1) throw new Error('Ungültiger Rechnungszähler: ' + name);
    this.db.prepare('INSERT OR REPLACE INTO counters (name, value) VALUES (?, ?)').run(name, value);
  }


  _invoiceCount() {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM invoices').get();
    return row ? row.n : 0;
  }

  _requireActiveCounter(name) {
    if (!INVOICE_COUNTER_KEY_SET.has(name)) throw new Error('Unbekannter Rechnungszähler: ' + name);
    const row = this.db.prepare('SELECT value FROM counters WHERE name = ?').get(name);
    const value = row ? Number(row.value) : NaN;
    if (Number.isInteger(value) && value > 0) return value;
    if (this._invoiceCount() === 0) {
      this._setCounterValue(name, 1);
      return 1;
    }
    throw new Error('Der Rechnungszähler "' + name + '" fehlt oder ist ungültig. Bitte tragen Sie die nächste gültige Nummer in den Einstellungen ein.');
  }

  _padNumber(value) {
    return String(value).padStart(3, '0');
  }

  _numericValue(value) {
    const s = String(value == null ? '' : value).trim();
    return /^\d+$/.test(s) ? Number(s) : null;
  }

  _sameNumber(a, b) {
    const na = this._numericValue(a);
    const nb = this._numericValue(b);
    if (na != null && nb != null) return na === nb;
    return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim();
  }

  _assertNoDuplicateNumber(sql, value, message) {
    const rows = this.db.prepare(sql).all();
    if (rows.some(r => this._sameNumber(r.value, value))) throw new Error(message);
  }

  _invoiceCounterPlan(invoice) {
    const za = invoice && invoice.zahlungsart === 'kassa' ? 'kassa' : 'bank';
    const isAusgang = invoice && invoice.typ === 'ausgang';
    const isARKassa = isAusgang && za === 'kassa';
    return {
      isAusgang,
      isKassa: za === 'kassa',
      isARKassa,
      keys: za === 'kassa'
        ? ['fortlaufend'].concat(isARKassa ? ['kassenbeleg'] : [])
        : ['lfd_bank'].concat(isAusgang ? ['ausgang'] : [])
    };
  }

  _applyARKassaNumbers(invoice, existing) {
    const others = this.db.prepare('SELECT typ, zahlungsart, lfd_nr, kassenbeleg_nr, zahlungs_lfd_nr FROM invoices WHERE id != ?').all(invoice.id);
    const rules = [
      { field: 'lfd_nr', key: 'fortlaufend', label: 'Die laufende Nummer', list: others.filter(i => i.zahlungsart === 'kassa'), get: i => i.lfd_nr },
      { field: 'kassenbeleg_nr', key: 'kassenbeleg', label: 'Die Kassa-/Registrierkassennummer', list: others.filter(i => i.typ === 'ausgang' && i.zahlungsart === 'kassa'), get: i => i.kassenbeleg_nr || i.zahlungs_lfd_nr }
    ];
    rules.forEach(rule => {
      const raw = rule.get(invoice);
      // Existing legacy values must not be renumbered merely by editing a note.
      if (existing && raw === rule.get(existing)) {
        invoice[rule.field] = existing[rule.field];
        if (rule.field === 'kassenbeleg_nr') invoice.zahlungs_lfd_nr = existing.zahlungs_lfd_nr;
        return;
      }
      const counter = this._requireActiveCounter(rule.key);
      const value = String(raw == null ? this._padNumber(counter) : raw).trim();
      const number = this._numericValue(value);
      if (!Number.isSafeInteger(number) || number < 1) throw new Error(rule.label + ' muss eine positive ganze Zahl sein.');
      if (rule.list.some(i => this._sameNumber(rule.get(i), value))) throw new Error(rule.label + ' ' + value + ' ist bereits vorhanden.');
      invoice[rule.field] = value;
      this._setCounterValue(rule.key, Math.max(counter, number + 1));
    });
    if (!existing || invoice.kassenbeleg_nr !== existing.kassenbeleg_nr || invoice.zahlungs_lfd_nr !== existing.zahlungs_lfd_nr) {
      invoice.zahlungs_lfd_nr = invoice.kassenbeleg_nr || invoice.zahlungs_lfd_nr;
    }
  }

  // Normal new invoice creation with atomic number assignment. The transaction
  // reads the current counters, assigns final nummer/lfd_nr/zahlungs_lfd_nr/kassenbeleg_nr,
  // inserts the invoice, advances all consumed counters exactly once, and returns
  // the saved invoice plus current protected counter values.
  createInvoiceWithCounters(invoice, numberingOptions) {
    if (!invoice || !invoice.id) throw new Error('Rechnungs-ID fehlt');
    const opts = numberingOptions || {};
    const mode = opts.numberMode === 'manual' ? 'manual' : 'auto';
    const tx = this.db.transaction(() => {
      if (this.getInvoice(invoice.id)) throw new Error('Rechnungs-ID existiert bereits: ' + invoice.id);
      const plan = this._invoiceCounterPlan(invoice);
      const counters = {};
      plan.keys.forEach(key => { counters[key] = this._requireActiveCounter(key); });

      const finalInvoice = Object.assign({}, invoice);
      if (plan.isAusgang && !plan.isARKassa) {
        if (mode === 'manual') {
          const requested = String(opts.requestedNumber != null ? opts.requestedNumber : finalInvoice.nummer || '').trim();
          if (!requested) throw new Error('Manuelle Rechnungsnummer fehlt');
          finalInvoice.nummer = requested;
        } else {
          finalInvoice.nummer = this._padNumber(counters.ausgang);
        }
        this._assertNoDuplicateNumber("SELECT nummer AS value FROM invoices WHERE typ = 'ausgang' AND nummer IS NOT NULL AND nummer != ''", finalInvoice.nummer, 'Die Ausgangsrechnungsnummer ' + finalInvoice.nummer + ' ist bereits vorhanden. Bitte prüfen Sie die nächste Nummer in den Einstellungen.');
      } else if (plan.isARKassa) {
        // Registrierkassenbelege have their own number ranges and must neither
        // receive nor consume a normal outgoing-invoice number.
        finalInvoice.nummer = '';
      } else {
        finalInvoice.nummer = finalInvoice.nummer || '';
      }
      if (plan.isKassa && plan.isAusgang) {
        if (opts.requestedLfd != null) finalInvoice.lfd_nr = opts.requestedLfd;
        if (opts.requestedKassenbeleg != null) finalInvoice.kassenbeleg_nr = opts.requestedKassenbeleg;
        this._applyARKassaNumbers(finalInvoice);
      } else if (plan.isKassa) {
        finalInvoice.lfd_nr = this._padNumber(counters.fortlaufend);
        this._assertNoDuplicateNumber("SELECT lfd_nr AS value FROM invoices WHERE zahlungsart = 'kassa' AND lfd_nr IS NOT NULL AND lfd_nr != ''", finalInvoice.lfd_nr, 'Die laufende Nummer ' + finalInvoice.lfd_nr + ' ist bereits vorhanden. Bitte prüfen Sie die nächste Nummer in den Einstellungen.');
        finalInvoice.zahlungs_lfd_nr = '';
        finalInvoice.kassenbeleg_nr = '';
      } else {
        finalInvoice.lfd_nr = '';
        finalInvoice.zahlungs_lfd_nr = this._padNumber(counters.lfd_bank);
        finalInvoice.kassenbeleg_nr = '';
        this._assertNoDuplicateNumber("SELECT zahlungs_lfd_nr AS value FROM invoices WHERE (zahlungsart IS NULL OR zahlungsart != 'kassa') AND zahlungs_lfd_nr IS NOT NULL AND zahlungs_lfd_nr != ''", finalInvoice.zahlungs_lfd_nr, 'Die Bank-Fortlaufnummer ' + finalInvoice.zahlungs_lfd_nr + ' ist bereits vorhanden. Bitte prüfen Sie die nächste Nummer in den Einstellungen.');
      }

      const row = this._invoiceToRow(finalInvoice);
      const cols = this._invoiceColumns();
      const sql = `INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`;
      this.db.prepare(sql).run(row);

      if (plan.isAusgang && !plan.isARKassa) this._setCounterValue('ausgang', counters.ausgang + 1);
      if (plan.isKassa) {
        if (!plan.isAusgang) this._setCounterValue('fortlaufend', counters.fortlaufend + 1);
      } else {
        this._setCounterValue('lfd_bank', counters.lfd_bank + 1);
      }

      const currentCounters = {};
      INVOICE_COUNTER_KEYS.forEach(key => { currentCounters[key] = this._getCounterValue(key); });
      return { invoice: this.getInvoice(row.id), counters: currentCounters };
    });
    return tx();
  }

  updateInvoiceCounters(counterValues) {
    if (!counterValues || typeof counterValues !== 'object' || Array.isArray(counterValues)) throw new Error('Ungültige Rechnungszähler');
    const tx = this.db.transaction(() => {
      Object.entries(counterValues).forEach(([name, raw]) => {
        if (!INVOICE_COUNTER_KEY_SET.has(name)) throw new Error('Unbekannter Rechnungszähler: ' + name);
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1) throw new Error('Ungültiger Rechnungszähler: ' + name);
        this._setCounterValue(name, value);
      });
      const current = {};
      INVOICE_COUNTER_KEYS.forEach(key => { current[key] = this._getCounterValue(key); });
      return current;
    });
    return tx();
  }

  updateInvoice(invoice) {
    if (!invoice || !invoice.id) throw new Error('Rechnungs-ID fehlt');
    return this.db.transaction(() => {
      const existing = this.getInvoice(invoice.id);
      if (!existing) throw new Error('Rechnung nicht gefunden: ' + invoice.id);
      const merged = Object.assign({}, existing, invoice);
      if (invoice.file_b64 == null && invoice.file_name == null && invoice.file_type == null) {
        merged.file_b64 = existing.file_b64;
        merged.file_name = existing.file_name;
        merged.file_type = existing.file_type;
      }
      if (merged.typ === 'ausgang' && merged.zahlungsart === 'kassa') this._applyARKassaNumbers(merged, existing);
      const row = this._invoiceToRow(merged);
      const cols = this._invoiceColumns().filter(c => c !== 'id');
      const info = this.db.prepare(`UPDATE invoices SET ${cols.map(c => c + ' = @' + c).join(', ')} WHERE id = @id`).run(row);
      if (info.changes !== 1) throw new Error('Rechnung konnte nicht aktualisiert werden: ' + invoice.id);
      return this.getInvoice(invoice.id);
    })();
  }

  deleteInvoice(invoiceId) {
    const info = this.db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
    if (info.changes !== 1) throw new Error('Rechnung nicht gefunden: ' + invoiceId);
    return { id: invoiceId };
  }

  updateInvoiceStatus(invoiceId, status) {
    const info = this.db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
    if (info.changes !== 1) throw new Error('Rechnung nicht gefunden: ' + invoiceId);
    return this.getInvoice(invoiceId);
  }

  importInvoicesForMigration(invoices) {
    const tx = this.db.transaction((list) => {
      const cols = this._invoiceColumns();
      const ins = this.db.prepare(`INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`);
      (list || []).forEach(inv => ins.run(this._invoiceToRow(inv)));
    });
    tx(invoices || []);
  }

  // ----------------------------------------------------------------
  // Settings
  // ----------------------------------------------------------------
  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setSetting(key, value) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  getAllSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    const result = {};
    rows.forEach(r => { result[r.key] = r.value; });
    return result;
  }

  // ----------------------------------------------------------------
  // Beschreibung history
  // ----------------------------------------------------------------
  getBeschHist() {
    return this.db.prepare('SELECT text FROM beschreibung_hist ORDER BY id DESC').all().map(r => r.text);
  }

  saveBeschHist(terms) {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM beschreibung_hist').run();
      const ins = this.db.prepare('INSERT OR IGNORE INTO beschreibung_hist (text) VALUES (?)');
      // Insert in reverse order so that ORDER BY id DESC gives newest-first
      for (let i = terms.length - 1; i >= 0; i--) {
        ins.run(terms[i]);
      }
    });
    tx();
  }

  // ----------------------------------------------------------------
  // Fixkosten
  // ----------------------------------------------------------------
  getFixkosten() {
    return this.db.prepare('SELECT fk_id, name, betrag, monat, bezahlt_am, reset_intervall, reset_datum FROM fixkosten').all();
  }

  saveFixkosten(list) {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM fixkosten').run();
      const ins = this.db.prepare('INSERT INTO fixkosten (fk_id, name, betrag, monat, bezahlt_am, reset_intervall, reset_datum) VALUES (@fk_id, @name, @betrag, @monat, @bezahlt_am, @reset_intervall, @reset_datum)');
      list.forEach(item => ins.run({
        fk_id:           item.fk_id          || null,
        name:            item.name           || '',
        betrag:          item.betrag         || 0,
        monat:           item.monat          || null,
        bezahlt_am:      item.bezahlt_am     || null,
        reset_intervall: item.reset_intervall || 'monatlich',
        reset_datum:     item.reset_datum     || null,
      }));
    });
    tx();
  }

  // ----------------------------------------------------------------
  // Position badges
  // ----------------------------------------------------------------
  getPosBadges() {
    const rows = this.db.prepare('SELECT label FROM pos_badges ORDER BY sort_order, id').all();
    return rows.length > 0 ? rows.map(r => r.label) : null;
  }

  savePosBadges(labels) {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM pos_badges').run();
      const ins = this.db.prepare('INSERT INTO pos_badges (label, sort_order) VALUES (?, ?)');
      labels.forEach((label, i) => ins.run(label, i));
    });
    tx();
  }

  // ----------------------------------------------------------------
  // Accounting reports
  // ----------------------------------------------------------------
  _accountingReportColumns() {
    return [
      'id', 'report_type', 'report_month', 'report_year', 'period_from_month', 'period_to_month',
      'imported_at', 'original_file_b64', 'original_file_name', 'original_file_type', 'parse_status',
      'parser_version', 'detected_period_from_month', 'detected_period_from_year',
      'detected_period_to_month', 'detected_period_to_year', 'validation_status', 'validation_message',
    ];
  }

  _accountingValueConfigs() {
    return {
      monthly_values: {
        table: 'accounting_monthly_values',
        columns: ['id', 'report_id', 'value_key', 'value_month', 'value_year', 'account_number', 'account_name', 'detected_value', 'manual_value', 'unit', 'source', 'source_section', 'source_label', 'confidence', 'status', 'metadata_json'],
      },
      snapshot_values: {
        table: 'accounting_snapshot_values',
        columns: ['id', 'report_id', 'value_key', 'snapshot_date', 'detected_value', 'manual_value', 'unit', 'source', 'status', 'metadata_json'],
      },
      cumulative_metrics: {
        table: 'accounting_cumulative_metrics',
        columns: ['id', 'report_id', 'value_key', 'detected_value', 'manual_value', 'unit', 'source', 'source_section', 'source_label', 'confidence', 'status', 'metadata_json'],
      },
      snapshot_metrics: {
        table: 'accounting_snapshot_metrics',
        columns: ['id', 'report_id', 'value_key', 'snapshot_date', 'account_number', 'account_name', 'detected_value', 'manual_value', 'unit', 'source', 'source_section', 'source_label', 'confidence', 'status', 'metadata_json'],
      },
      tax_values: {
        table: 'accounting_tax_values',
        columns: ['id', 'report_id', 'tax_type', 'value_key', 'period_month', 'period_year', 'detected_value', 'manual_value', 'unit', 'source', 'source_section', 'source_label', 'confidence', 'status', 'metadata_json'],
      },
      open_items: {
        table: 'accounting_open_items',
        columns: ['id', 'report_id', 'party_type', 'party_name', 'document_number', 'document_date', 'due_date', 'aging_class', 'detected_value', 'manual_value', 'currency', 'source', 'source_section', 'source_label', 'confidence', 'status', 'metadata_json'],
      },
      account_values: {
        table: 'accounting_account_values',
        columns: ['id', 'report_id', 'account_number', 'account_name', 'detected_value', 'manual_value', 'unit', 'source', 'status', 'metadata_json'],
      },
      detected_values: {
        table: 'accounting_detected_values',
        columns: ['id', 'report_id', 'value_scope', 'value_key', 'raw_value', 'normalized_value', 'page_number', 'confidence', 'metadata_json'],
      },
      manual_corrections: {
        table: 'accounting_manual_corrections',
        columns: ['id', 'report_id', 'value_scope', 'value_id', 'value_key', 'detected_value', 'previous_manual_value', 'manual_value', 'changed_at', 'note'],
      },
      import_differences: {
        table: 'accounting_import_differences',
        columns: ['id', 'report_id', 'previous_report_id', 'value_scope', 'value_key', 'account_number', 'value_month', 'value_year', 'previous_detected_value', 'new_detected_value', 'previous_manual_value', 'resolution_status', 'detected_at', 'metadata_json'],
      },
    };
  }

  _validateAccountingReport(report) {
    if (!report || !report.id) throw new Error('Report-ID fehlt.');
    if (report.report_type !== 'financial_accounting_monthly') throw new Error('Unbekannte Berichtsart.');
    const month = Number(report.report_month);
    const year = Number(report.report_year);
    if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Ungültiger Berichtsmonat.');
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Ungültiges Berichtsjahr.');
    if (!report.original_file_b64 || !report.original_file_name) throw new Error('Original-PDF fehlt.');
    if (report.original_file_type !== 'application/pdf') throw new Error('Als Monatsreport ist nur eine PDF-Datei erlaubt.');
  }

  _accountingReportToRow(report) {
    return {
      id: report.id,
      report_type: report.report_type,
      report_month: Number(report.report_month),
      report_year: Number(report.report_year),
      period_from_month: Number(report.period_from_month || 1),
      period_to_month: Number(report.period_to_month || report.report_month),
      imported_at: report.imported_at || new Date().toISOString(),
      original_file_b64: report.original_file_b64,
      original_file_name: report.original_file_name,
      original_file_type: report.original_file_type,
      parse_status: report.parse_status || 'pending',
      parser_version: report.parser_version || null,
      detected_period_from_month: report.detected_period_from_month == null ? null : Number(report.detected_period_from_month),
      detected_period_from_year: report.detected_period_from_year == null ? null : Number(report.detected_period_from_year),
      detected_period_to_month: report.detected_period_to_month == null ? null : Number(report.detected_period_to_month),
      detected_period_to_year: report.detected_period_to_year == null ? null : Number(report.detected_period_to_year),
      validation_status: report.validation_status || 'not_checked',
      validation_message: report.validation_message || null,
    };
  }

  _saveAccountingValues(report) {
    const configs = this._accountingValueConfigs();
    Object.entries(configs).forEach(([key, config]) => {
      this.db.prepare(`DELETE FROM ${config.table} WHERE report_id = ?`).run(report.id);
      const sql = `INSERT INTO ${config.table} (${config.columns.join(', ')}) VALUES (${config.columns.map(c => '@' + c).join(', ')})`;
      const insert = this.db.prepare(sql);
      (report[key] || []).forEach((value, index) => {
        const row = {};
        config.columns.forEach(column => {
          if (column === 'id') {
            const candidate = value.id || `${report.id}-${key}-${index + 1}`;
            const owner = this.db.prepare(`SELECT report_id FROM ${config.table} WHERE id = ?`).get(candidate);
            row.id = owner && owner.report_id !== report.id ? `${report.id}-${candidate}` : candidate;
          }
          else if (column === 'report_id') row.report_id = report.id;
          else if (column === 'metadata_json') row.metadata_json = JSON.stringify(value.metadata || {});
          else if (column === 'value_id' && value[column] == null) row.value_id = value.value_key || `${report.id}-${value.value_scope || 'value'}-${index + 1}`;
          else row[column] = value[column] == null ? null : value[column];
        });
        if (Object.prototype.hasOwnProperty.call(row, 'source') && row.source == null) row.source = value.manual_value == null ? 'pdf' : 'manual';
        if (Object.prototype.hasOwnProperty.call(row, 'status') && row.status == null) row.status = value.manual_value == null ? 'detected' : 'manually_changed';
        if (Object.prototype.hasOwnProperty.call(row, 'changed_at') && row.changed_at == null) row.changed_at = new Date().toISOString();
        if (Object.prototype.hasOwnProperty.call(row, 'detected_at') && row.detected_at == null) row.detected_at = new Date().toISOString();
        if (Object.prototype.hasOwnProperty.call(row, 'resolution_status') && row.resolution_status == null) row.resolution_status = 'pending';
        insert.run(row);
      });
    });
  }

  _accountingReportFromRow(row) {
    if (!row) return null;
    const report = { ...row };
    const configs = this._accountingValueConfigs();
    Object.entries(configs).forEach(([key, config]) => {
      report[key] = this.db.prepare(`SELECT * FROM ${config.table} WHERE report_id = ? ORDER BY rowid`).all(row.id).map(value => {
        delete value.report_id;
        if (value.metadata_json !== undefined) {
          try { value.metadata = JSON.parse(value.metadata_json || '{}'); } catch (_) { value.metadata = {}; }
          delete value.metadata_json;
        }
        if (Object.prototype.hasOwnProperty.call(value, 'detected_value') && key !== 'manual_corrections') {
          value.effective_value = value.manual_value == null ? value.detected_value : value.manual_value;
        }
        return value;
      });
    });
    return report;
  }

  listAccountingReports() {
    return this.db.prepare('SELECT * FROM accounting_reports ORDER BY report_year DESC, report_month DESC, imported_at DESC').all()
      .map(row => this._accountingReportFromRow(row));
  }

  getAccountingReport(id) {
    return this._accountingReportFromRow(this.db.prepare('SELECT * FROM accounting_reports WHERE id = ?').get(id));
  }

  getAccountingReportByPeriod(reportType, reportMonth, reportYear) {
    const row = this.db.prepare('SELECT * FROM accounting_reports WHERE report_type = ? AND report_month = ? AND report_year = ?')
      .get(reportType, Number(reportMonth), Number(reportYear));
    return this._accountingReportFromRow(row);
  }

  createAccountingReport(report) {
    this._validateAccountingReport(report);
    const tx = this.db.transaction(() => {
      const row = this._accountingReportToRow(report);
      const columns = this._accountingReportColumns();
      this.db.prepare(`INSERT INTO accounting_reports (${columns.join(', ')}) VALUES (${columns.map(c => '@' + c).join(', ')})`).run(row);
      this._saveAccountingValues({ ...report, ...row });
      return this.getAccountingReport(row.id);
    });
    return tx();
  }

  updateAccountingReport(report) {
    if (!report || !report.id) throw new Error('Report-ID fehlt.');
    const existing = this.getAccountingReport(report.id);
    if (!existing) throw new Error('Buchhaltungsreport nicht gefunden: ' + report.id);
    const merged = { ...existing, ...report };
    if (report.original_file_b64 == null && report.original_file_name == null && report.original_file_type == null) {
      merged.original_file_b64 = existing.original_file_b64;
      merged.original_file_name = existing.original_file_name;
      merged.original_file_type = existing.original_file_type;
    }
    this._validateAccountingReport(merged);
    const tx = this.db.transaction(() => {
      const row = this._accountingReportToRow(merged);
      const columns = this._accountingReportColumns().filter(column => column !== 'id');
      this.db.prepare(`UPDATE accounting_reports SET ${columns.map(c => c + ' = @' + c).join(', ')} WHERE id = @id`).run(row);
      this._saveAccountingValues({ ...merged, ...row });
      return this.getAccountingReport(row.id);
    });
    return tx();
  }

  importAccountingReportsForMigration(reports) {
    (reports || []).forEach(report => {
      const existing = this.getAccountingReportByPeriod(report.report_type, report.report_month, report.report_year);
      if (existing) this.updateAccountingReport({ ...report, id: existing.id });
      else this.createAccountingReport(report);
    });
  }

  // ----------------------------------------------------------------
  // Migration from localStorage backup data
  // ----------------------------------------------------------------
  migrateFromLocalStorage(lsData) {
    const raw = lsData['buchpro_v1'];
    if (raw) {
      let buchproData;
      try { buchproData = JSON.parse(raw); } catch (_) { buchproData = null; }
      if (buchproData) {
        // Ensure KV entries have IDs
        (buchproData.kostenvoranschlaege || []).forEach(kv => {
          if (!kv.id) {
            kv.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
          }
        });
        this.saveAll({
          invoices:           [],
          kunden:             buchproData.kunden             || [],
          lieferanten:        buchproData.lieferanten        || [],
          zahlungen:          buchproData.zahlungen          || [],
          fahrzeuge:          buchproData.fahrzeuge          || [],
          employees:          buchproData.employees          || [],
          todos:              buchproData.todos              || [],
          todos_archiv:       buchproData.todos_archiv       || [],
          kostenvoranschlaege: buchproData.kostenvoranschlaege || [],
          counters:           buchproData.counters           || {},
          vorlage:            buchproData.vorlage            || null,
        });
        this.importInvoicesForMigration(buchproData.invoices || []);
        this.importAccountingReportsForMigration(buchproData.accounting_reports || []);
        const importedCounters = {};
        INVOICE_COUNTER_KEYS.forEach(key => {
          const value = Number((buchproData.counters || {})[key]);
          if (Number.isInteger(value) && value > 0) importedCounters[key] = value;
        });
        if (Object.keys(importedCounters).length) this.updateInvoiceCounters(importedCounters);
      }
    }

    // Settings
    const settingsKeys = [
      'bp_todo_vorlauf', 'bp_rech_vorlauf', 'bp_zahlungsziel',
      'bp_path_ar_bank', 'bp_path_ar_kassa', 'bp_path_ar', 'bp_path_er', 'bp_path_kv',
      'bp_apikey', 'bp_proxy', 'darkMode',
    ];
    settingsKeys.forEach(key => {
      if (lsData[key] != null) this.setSetting(key, lsData[key]);
    });

    // Beschreibung history
    if (lsData['buchpro_beschreibung_hist']) {
      try {
        const hist = JSON.parse(lsData['buchpro_beschreibung_hist']);
        if (Array.isArray(hist)) this.saveBeschHist(hist);
      } catch (_) {}
    }

    // Fixkosten
    if (lsData['bp_fixkosten']) {
      try {
        const fk = JSON.parse(lsData['bp_fixkosten']);
        if (Array.isArray(fk)) this.saveFixkosten(fk);
      } catch (_) {}
    }

    // Position badges
    if (lsData['bp_pos_badges']) {
      try {
        const pb = JSON.parse(lsData['bp_pos_badges']);
        if (Array.isArray(pb)) this.savePosBadges(pb);
      } catch (_) {}
    }
  }

  // ----------------------------------------------------------------
  // Internal helpers
  // ----------------------------------------------------------------
  _invoiceToRow(inv) {
    return {
      id:             inv.id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5)),
      typ:            inv.typ            || 'ausgang',
      nummer:         inv.nummer         || null,
      lfd_nr:         inv.lfd_nr         || null,
      zahlungsart:    inv.zahlungsart    || null,
      privatkunde:    inv.privatkunde    ? 1 : 0,
      flag_djevad:    inv.flag_djevad    ? 1 : 0,
      flag_helmut:    inv.flag_helmut    ? 1 : 0,
      partner_id:     inv.partner_id     || null,
      partner_name:   inv.partner_name   || null,
      partner_info:   inv.partner_info   || null,
      datum:          inv.datum          || null,
      leistungsdatum: inv.leistungsdatum || null,
      fz_marke:       inv.fz_marke       || null,
      fz_kz:          inv.fz_kz          || null,
      faellig:        inv.faellig        || null,
      status:         inv.status         || null,
      notizen:        inv.notizen        || null,
      kassenbeleg_nr: inv.kassenbeleg_nr || null,
      zahlungs_lfd_nr: inv.zahlungs_lfd_nr || null,
      kassa_typ:      inv.kassa_typ      || null,
      materialkosten: inv.materialkosten || 0,
      mat_auto:       inv.mat_auto       ? 1 : 0,
      erstellt:       inv.erstellt       || null,
      er_liefnr:      inv.er_liefnr      || null,
      is_gutschrift:  inv.is_gutschrift  ? 1 : 0,
      is_tageslosung: inv.is_tageslosung ? 1 : 0,
      er_netto:       inv.er_netto   != null ? inv.er_netto   : null,
      er_ust:         inv.er_ust     != null ? inv.er_ust     : null,
      er_brutto:      inv.er_brutto  != null ? inv.er_brutto  : null,
      er_ust_pct:     inv.er_ust_pct != null ? inv.er_ust_pct : null,
      file_b64:       inv.file_b64   || null,
      file_name:      inv.file_name  || null,
      file_type:      inv.file_type  || null,
      items:    JSON.stringify(inv.items    || []),
      er_items: JSON.stringify(inv.er_items || []),
      is_sammel:            inv.is_sammel            ? 1 : 0,
      sammel_beschreibung:  inv.sammel_beschreibung  || null,
    };
  }

  _invoiceFromRow(row) {
    const inv = Object.assign({}, row);
    inv.privatkunde    = !!inv.privatkunde;
    inv.flag_djevad    = !!inv.flag_djevad;
    inv.flag_helmut    = !!inv.flag_helmut;
    inv.mat_auto       = !!inv.mat_auto;
    inv.is_gutschrift  = !!inv.is_gutschrift;
    inv.is_tageslosung = !!inv.is_tageslosung;
    inv.is_sammel      = !!inv.is_sammel;
    inv.items    = JSON.parse(inv.items    || '[]');
    inv.er_items = JSON.parse(inv.er_items || '[]');
    return inv;
  }

  close() {
    if (this.db) {
      try { this.db.close(); } catch (_) {}
      this.db = null;
    }
  }
}

module.exports = BuchProDB;
module.exports.INVOICE_COUNTER_KEYS = INVOICE_COUNTER_KEYS;

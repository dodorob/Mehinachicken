'use strict';

const Database = require('better-sqlite3');

// Invoice counters are the counters consumed while creating new invoices.
// They must never be overwritten by stale renderer saveAll() snapshots.
const INVOICE_COUNTER_KEYS = Object.freeze(['ausgang', 'fortlaufend', 'kassenbeleg']);
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
    `);
    // Schema migrations (safe to run multiple times)
    try { this.db.exec('ALTER TABLE invoices ADD COLUMN is_sammel INTEGER DEFAULT 0'); } catch(_) {}
    try { this.db.exec('ALTER TABLE invoices ADD COLUMN sammel_beschreibung TEXT'); } catch(_) {}
    try { this.db.exec('ALTER TABLE fixkosten ADD COLUMN fk_id TEXT'); } catch(_) {}
    try { this.db.exec('ALTER TABLE fixkosten ADD COLUMN bezahlt_am TEXT'); } catch(_) {}
    try { this.db.exec("ALTER TABLE fixkosten ADD COLUMN reset_intervall TEXT DEFAULT 'monatlich'"); } catch(_) {}
    try { this.db.exec('ALTER TABLE fixkosten ADD COLUMN reset_datum TEXT'); } catch(_) {}
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

    const todosAll    = this.db.prepare('SELECT * FROM todos').all();
    const todos       = todosAll.filter(r => !r.archiviert).map(r => JSON.parse(r.data));
    const todos_archiv = todosAll.filter(r =>  r.archiviert).map(r => JSON.parse(r.data));

    const kv = this.db.prepare('SELECT data FROM kostenvoranschlaege').all().map(r => JSON.parse(r.data));

    const countersRaw = this.db.prepare('SELECT name, value FROM counters').all();
    const counters = { ausgang: 1, eingang: 1, fortlaufend: 1, kassenbeleg: 1, lfd_bank: 1, lfd_kassa: 1 };
    countersRaw.forEach(row => { counters[row.name] = row.value; });

    const vorlageRow = this.db.prepare('SELECT data FROM vorlage WHERE id = 1').get();
    const vorlage    = vorlageRow ? JSON.parse(vorlageRow.data) : null;

    return { invoices, kunden, lieferanten, zahlungen, fahrzeuge, todos, todos_archiv, kostenvoranschlaege: kv, counters, vorlage };
  }

  isEmpty() {
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM invoices').get();
    return count.n === 0;
  }

  // ----------------------------------------------------------------
  // Save entire data snapshot
  // ----------------------------------------------------------------
  saveAll(data) {
    const tx = this.db.transaction(() => {
      // In Electron/SQLite mode invoices are persisted exclusively through
      // targeted CRUD methods. The browser/localStorage fallback does not use
      // database.js, so data.invoices is intentionally ignored here.

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
      'faellig', 'status', 'notizen', 'kassenbeleg_nr', 'kassa_typ', 'materialkosten', 'mat_auto',
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
    return {
      isAusgang,
      isKassa: za === 'kassa',
      keys: ['fortlaufend'].concat(isAusgang ? ['ausgang'] : [], (za === 'kassa' && isAusgang) ? ['kassenbeleg'] : [])
    };
  }

  // Normal new invoice creation with atomic number assignment. The transaction
  // reads the current counters, assigns final nummer/lfd_nr/kassenbeleg_nr,
  // inserts the invoice, advances all consumed counters exactly once, and returns
  // the saved invoice plus current protected counter values.
  createInvoiceWithCounters(invoice, numberingOptions) {
    if (!invoice || !invoice.id) throw new Error('Rechnungs-ID fehlt');
    const opts = numberingOptions || {};
    const mode = opts.numberMode === 'manual' ? 'manual' : 'auto';
    const tx = this.db.transaction(() => {
      if (this.getInvoice(invoice.id)) throw new Error('Rechnungs-ID existiert bereits: ' + invoice.id);
      INVOICE_COUNTER_KEYS.forEach(key => { this._requireActiveCounter(key); });
      const plan = this._invoiceCounterPlan(invoice);
      const counters = {};
      plan.keys.forEach(key => { counters[key] = this._requireActiveCounter(key); });

      const finalInvoice = Object.assign({}, invoice);
      if (plan.isAusgang) {
        if (mode === 'manual') {
          const requested = String(opts.requestedNumber != null ? opts.requestedNumber : finalInvoice.nummer || '').trim();
          if (!requested) throw new Error('Manuelle Rechnungsnummer fehlt');
          finalInvoice.nummer = requested;
        } else {
          finalInvoice.nummer = this._padNumber(counters.ausgang);
        }
        this._assertNoDuplicateNumber("SELECT nummer AS value FROM invoices WHERE typ = 'ausgang' AND nummer IS NOT NULL AND nummer != ''", finalInvoice.nummer, 'Die Ausgangsrechnungsnummer ' + finalInvoice.nummer + ' ist bereits vorhanden. Bitte prüfen Sie die nächste Nummer in den Einstellungen.');
      } else {
        finalInvoice.nummer = finalInvoice.nummer || '';
      }
      finalInvoice.lfd_nr = this._padNumber(counters.fortlaufend);
      this._assertNoDuplicateNumber("SELECT lfd_nr AS value FROM invoices WHERE lfd_nr IS NOT NULL AND lfd_nr != ''", finalInvoice.lfd_nr, 'Die laufende Nummer ' + finalInvoice.lfd_nr + ' ist bereits vorhanden. Bitte prüfen Sie die nächste Nummer in den Einstellungen.');
      let nextKassenbeleg = null;
      if (plan.isKassa && plan.isAusgang) {
        if (opts.kassenbelegMode === 'manual') {
          const kbValue = this._numericValue(opts.requestedKassenbeleg);
          if (!Number.isInteger(kbValue) || kbValue < 1) throw new Error('Die Kassenbelegnummer muss eine positive ganze Zahl sein.');
          finalInvoice.kassenbeleg_nr = this._padNumber(kbValue);
          nextKassenbeleg = Math.max(counters.kassenbeleg, kbValue + 1);
        } else {
          finalInvoice.kassenbeleg_nr = this._padNumber(counters.kassenbeleg);
          nextKassenbeleg = counters.kassenbeleg + 1;
        }
        this._assertNoDuplicateNumber("SELECT kassenbeleg_nr AS value FROM invoices WHERE typ = 'ausgang' AND zahlungsart = 'kassa' AND kassenbeleg_nr IS NOT NULL AND kassenbeleg_nr != ''", finalInvoice.kassenbeleg_nr, 'Die Kassenbelegnummer ' + finalInvoice.kassenbeleg_nr + ' ist bereits vorhanden. Bitte prüfen Sie die nächste Nummer in den Einstellungen.');
      } else finalInvoice.kassenbeleg_nr = '';

      const row = this._invoiceToRow(finalInvoice);
      const cols = this._invoiceColumns();
      const sql = `INSERT INTO invoices (${cols.join(', ')}) VALUES (${cols.map(c => '@' + c).join(', ')})`;
      this.db.prepare(sql).run(row);

      if (plan.isAusgang) this._setCounterValue('ausgang', counters.ausgang + 1);
      this._setCounterValue('fortlaufend', counters.fortlaufend + 1);
      if (plan.isKassa && plan.isAusgang) this._setCounterValue('kassenbeleg', nextKassenbeleg);

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
    const existing = this.getInvoice(invoice.id);
    if (!existing) throw new Error('Rechnung nicht gefunden: ' + invoice.id);
    const merged = Object.assign({}, existing, invoice);
    if (invoice.file_b64 == null && invoice.file_name == null && invoice.file_type == null) {
      merged.file_b64 = existing.file_b64;
      merged.file_name = existing.file_name;
      merged.file_type = existing.file_type;
    }
    const row = this._invoiceToRow(merged);
    const cols = this._invoiceColumns().filter(c => c !== 'id');
    const info = this.db.prepare(`UPDATE invoices SET ${cols.map(c => c + ' = @' + c).join(', ')} WHERE id = @id`).run(row);
    if (info.changes !== 1) throw new Error('Rechnung konnte nicht aktualisiert werden: ' + invoice.id);
    return this.getInvoice(invoice.id);
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
          todos:              buchproData.todos              || [],
          todos_archiv:       buchproData.todos_archiv       || [],
          kostenvoranschlaege: buchproData.kostenvoranschlaege || [],
          counters:           buchproData.counters           || {},
          vorlage:            buchproData.vorlage            || null,
        });
        this.importInvoicesForMigration(buchproData.invoices || []);
        const importedCounters = {};
        ['ausgang', 'fortlaufend', 'kassenbeleg'].forEach(key => {
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


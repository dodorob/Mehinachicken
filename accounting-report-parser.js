'use strict';

const MONTH_NAMES = {
  'jänner': 1, 'januar': 1, 'februar': 2, 'märz': 3, 'maerz': 3, 'april': 4,
  'mai': 5, 'juni': 6, 'juli': 7, 'august': 8, 'september': 9, 'oktober': 10,
  'november': 11, 'dezember': 12,
};
const MONTH_ABBREVIATIONS = {
  'jän': 1, 'jan': 1, 'feb': 2, 'mrz': 3, 'mär': 3, 'apr': 4, 'mai': 5, 'jun': 6,
  'jul': 7, 'aug': 8, 'sep': 9, 'okt': 10, 'nov': 11, 'dez': 12,
};
const GERMAN_NUMBER = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;

function parseGermanNumber(value) {
  const normalized = String(value == null ? '' : value).replace(/\s/g, '').trim();
  if (!GERMAN_NUMBER.test(normalized)) return null;
  const number = Number(normalized.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function normalizeLine(line) {
  return String(line || '').replace(/\u00a0/g, ' ').trim();
}

function splitColumns(line) {
  return normalizeLine(line).split(/\t+| {2,}/).map(cell => cell.trim()).filter(Boolean);
}

function parseAccountRow(line) {
  const match = normalizeLine(line).match(/^(\d{3,6})\s+(.+)$/);
  if (!match) return null;
  const parts = match[2].split(/\s+/);
  const numbers = [];
  while (parts.length) {
    const value = parseGermanNumber(parts[parts.length - 1]);
    if (value === null) break;
    numbers.unshift(value);
    parts.pop();
  }
  if (!parts.length || !numbers.length) return null;
  return { account_number: match[1], account_name: parts.join(' '), numbers };
}

function reconstructLayoutPage(items) {
  const rows = [];
  (items || []).filter(item => item && String(item.str || '').trim()).forEach(item => {
    const x = Number(item.transform && item.transform[4]);
    const y = Number(item.transform && item.transform[5]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    let row = rows.find(candidate => Math.abs(candidate.y - y) <= 0.8);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ str: String(item.str), x, width: Number(item.width) || 0 });
  });
  return rows.sort((a, b) => b.y - a.y).map(row => {
    const sorted = row.items.sort((a, b) => a.x - b.x);
    let line = '';
    let previousEnd = null;
    sorted.forEach(item => {
      if (previousEnd !== null) {
        const gap = item.x - previousEnd;
        line += ' '.repeat(Math.max(1, Math.min(80, Math.round(gap / 3.5))));
      }
      line += item.str;
      previousEnd = Math.max(previousEnd == null ? item.x : previousEnd, item.x + item.width);
    });
    return normalizeLine(line);
  }).filter(Boolean).join('\n');
}

function numericCells(line) {
  return splitColumns(line).map(parseGermanNumber).filter(value => value !== null);
}

function firstReportedValue(line) {
  const cells = splitColumns(line);
  for (let index = 1; index < cells.length; index += 1) {
    const value = parseGermanNumber(cells[index]);
    if (value !== null) return value;
  }
  return null;
}

function findLine(lines, matcher, start, end) {
  const from = start || 0;
  const to = end == null ? lines.length : end;
  for (let index = from; index < to; index += 1) {
    if (matcher.test(lines[index])) return index;
  }
  return -1;
}

function findValueAtOrAfter(lines, matcher, start, end) {
  const index = findLine(lines, matcher, start, end);
  if (index < 0) return null;
  const sameLine = firstReportedValue(lines[index]);
  if (sameLine !== null) return sameLine;
  for (let offset = 1; offset <= 2 && index + offset < (end == null ? lines.length : end); offset += 1) {
    const values = numericCells(lines[index + offset]);
    if (values.length) return values[0];
  }
  return null;
}

function findSectionTotal(lines, startMatcher, endMatcher, start, end) {
  const sectionStart = findLine(lines, startMatcher, start, end);
  if (sectionStart < 0) return null;
  const sectionEnd = findLine(lines, endMatcher, sectionStart + 1, end);
  const stop = sectionEnd < 0 ? end : sectionEnd;
  let value = null;
  for (let index = sectionStart + 1; index < stop; index += 1) {
    const line = normalizeLine(lines[index]);
    if (/^\d{3,6}\s/.test(line)) continue;
    const cells = splitColumns(line);
    if (cells.length >= 2 && parseGermanNumber(cells[0]) !== null) value = parseGermanNumber(cells[0]);
  }
  return value;
}

function detectPeriod(text) {
  const match = text.match(/Von:\s*(Jänner|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*(\d{4})\s*Bis:\s*(Jänner|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*(\d{4})/i);
  if (!match) return { from_month: null, from_year: null, to_month: null, to_year: null, status: 'missing' };
  return {
    from_month: MONTH_NAMES[match[1].toLocaleLowerCase('de-AT')] || null,
    from_year: Number(match[2]),
    to_month: MONTH_NAMES[match[3].toLocaleLowerCase('de-AT')] || null,
    to_year: Number(match[4]),
    status: 'detected',
  };
}

function detectedMetric(key, label, value, section, extra) {
  return Object.assign({
    value_key: key,
    source_section: section,
    source_label: label,
    detected_value: value,
    manual_value: null,
    effective_value: value,
    source: 'pdf',
    confidence: value === null ? 0 : 1,
    status: value === null ? 'missing' : 'detected',
    unit: 'EUR',
  }, extra || {});
}

function parseMonthlyValues(lines, period) {
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = normalizeLine(lines[index]);
    if (!/^EB\b/i.test(header) || !/Jän|Jan/i.test(header)) continue;
    const monthColumns = [];
    Array.from(header.matchAll(/\b(Jän|Jan|Feb|Mrz|Mär|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez)\s+(\d{2})\b/gi)).forEach(monthMatch => {
      monthColumns.push({ month: MONTH_ABBREVIATIONS[monthMatch[1].toLocaleLowerCase('de-AT')], year: 2000 + Number(monthMatch[2]) });
    });
    for (let rowIndex = index + 1; rowIndex < lines.length; rowIndex += 1) {
      const line = normalizeLine(lines[rowIndex]);
      if (/^Seite:/.test(line) || /^510 Periodenübersicht/.test(line)) { index = rowIndex; break; }
      const row = parseAccountRow(line);
      if (!row || row.numbers.length < monthColumns.length + 1) continue;
      monthColumns.forEach((column, monthIndex) => {
        // EB is the first numeric column, followed by the available months.
        const detectedValue = row.numbers[monthIndex + 1];
        values.push(detectedMetric(
          row.account_number + ':' + column.year + '-' + String(column.month).padStart(2, '0'),
          row.account_number + ' ' + row.account_name,
          detectedValue,
          'Periodenübersicht mit EB',
          {
            account_number: row.account_number,
            account_name: row.account_name,
            value_month: column.month,
            value_year: column.year,
            confidence: detectedValue === null ? 0 : 1,
          }
        ));
      });
    }
  }
  return values.filter(value => !period.to_year || value.value_year === period.to_year)
    .filter(value => !period.to_month || value.value_month <= period.to_month);
}

function parseCumulativeMetrics(lines) {
  const start = findLine(lines, /^Erfolgsvergleich$/i);
  const end = findLine(lines, /^Periodenübersicht mit EB$/i, start + 1);
  const specs = [
    ['revenue', 'Umsatzerlöse', () => findSectionTotal(lines, /^1\.\s+Umsatzerlöse/i, /^2\.\s+Betriebsleistung/i, start, end)],
    ['operating_output', 'Betriebsleistung', () => findValueAtOrAfter(lines, /^2\.\s+Betriebsleistung/i, start, end)],
    ['material_consumption', 'Materialverbrauch', () => findSectionTotal(lines, /^a\)\s+Materialverbrauch/i, /^b\)\s+Wareneinsatz/i, start, end)],
    ['cost_of_goods', 'Wareneinsatz', () => findSectionTotal(lines, /^b\)\s+Wareneinsatz/i, /^c\)\s+Fremdleistungen/i, start, end)],
    ['external_services', 'Fremdleistungen', () => findSectionTotal(lines, /^c\)\s+Fremdleistungen/i, /^d\)\s+Skonto/i, start, end)],
    ['contribution_margin_1', 'Deckungsbeitrag I', () => findValueAtOrAfter(lines, /^4\.\s+Deckungsbeitrag I/i, start, end)],
    ['personnel_expenses', 'Personalaufwand', () => findSectionTotal(lines, /^5\.\s+Personalaufwand/i, /^6\.\s+Deckungsbeitrag II/i, start, end)],
    ['contribution_margin_2', 'Deckungsbeitrag II', () => findValueAtOrAfter(lines, /^6\.\s+Deckungsbeitrag II/i, start, end)],
    ['other_operating_income', 'sonstige betriebliche Erträge', () => findSectionTotal(lines, /^7\.\s+sonstige betriebliche Erträge/i, /^8\.\s+sonstige betriebliche/i, start, end)],
    ['other_operating_expenses', 'sonstige betriebliche Aufwendungen', () => findSectionTotal(lines, /^8\.\s+sonstige betriebliche/i, /^9\.\s+Finanzerträge/i, start, end)],
    ['ebitda', 'EBITDA', () => findValueAtOrAfter(lines, /\(EBITDA\)/i, start, end)],
    ['depreciation', 'Abschreibungen', () => findSectionTotal(lines, /^11\.\s+Abschreibungen/i, /^12\.\s*Ergebnis vor Zinsen/i, start, end)],
    ['ebit', 'EBIT', () => findValueAtOrAfter(lines, /Steuern \(EBIT\)/i, start, end)],
    ['ebt', 'EBT', () => findValueAtOrAfter(lines, /Steuern \(EBT\)/i, start, end)],
    ['income_taxes', 'Steuern vom Einkommen/Ertrag', () => findSectionTotal(lines, /^14\.\s+Steuern vom Einkommen\/Ertrag/i, /^15\./i, start, end)],
    ['annual_result', 'Jahresgewinn/Jahresverlust', () => findValueAtOrAfter(lines, /^15\.\s*Jahres(?:gewinn|verlust)/i, start, end)],
  ];
  return specs.map(spec => detectedMetric(spec[0], spec[1], start < 0 ? null : spec[2](), 'Erfolgsvergleich'));
}

function parseBalanceAccounts(lines) {
  const end = findLine(lines, /^Erfolgsvergleich$/i);
  const accounts = [];
  for (let index = 0; index < (end < 0 ? lines.length : end); index += 1) {
    const cells = splitColumns(lines[index]);
    if (/^\d{3,6}$/.test(cells[0] || '') && cells.length >= 3) {
      const value = parseGermanNumber(cells[2]);
      if (value !== null) accounts.push({ account_number: cells[0], account_name: cells[1], value });
      continue;
    }
    const row = parseAccountRow(lines[index]);
    if (row) accounts.push({ account_number: row.account_number, account_name: row.account_name, value: row.numbers[0] });
  }
  return accounts;
}

function parseSnapshotMetrics(lines, period) {
  const accounts = parseBalanceAccounts(lines);
  const byNumber = number => accounts.find(account => account.account_number === number);
  const lastDay = period.to_year && period.to_month
    ? new Date(Date.UTC(period.to_year, period.to_month, 0)).toISOString().slice(0, 10) : null;
  const definitions = [
    ['receivables', 'Forderungen aus Lieferungen und Leistungen', '2000'],
    ['cash', 'Kassenbestand', '2700'],
    ['payables', 'Verbindlichkeiten aus Lieferungen und Leistungen', '3300'],
    ['vat_payable_balance', 'Umsatzsteuer-Zahllast', '3520'],
  ];
  const metrics = definitions.map(definition => {
    const account = byNumber(definition[2]);
    return detectedMetric(definition[0], account ? account.account_number + ' ' + account.account_name : definition[1], account ? account.value : null, 'Saldenliste', {
      account_number: definition[2], account_name: account ? account.account_name : definition[1], snapshot_date: lastDay,
    });
  });
  const bankAccounts = accounts.filter(account => /^28\d{2}$/.test(account.account_number) && /(bank|sparkasse|raiffeisen|volksbank|bawag|oberbank|hypo|konto)/i.test(account.account_name));
  const bankTotal = bankAccounts.length ? bankAccounts.reduce((sum, account) => sum + account.value, 0) : null;
  metrics.push(detectedMetric('bank_total', 'Bankkonten gesamt', bankTotal, 'Saldenliste', {
    snapshot_date: lastDay,
    metadata: { accounts: bankAccounts },
  }));
  return metrics;
}

function parseOpenItems(lines) {
  const start = findLine(lines, /^Offene Posten$/i);
  const end = findLine(lines, /^An das$/i, start + 1);
  if (start < 0) return [];
  const items = [];
  let partyType = null;
  let party = null;
  let pending = null;
  const addDetail = (parts, base) => {
    const numbers = parts.map(parseGermanNumber).filter(value => value !== null);
    if (numbers.length < 2 || !party) return;
    items.push(detectedMetric([partyType, party.account, base.document_number || '', base.document_date || ''].join(':'), party.name, numbers[numbers.length - 1], 'OP-Liste', {
      party_type: partyType,
      party_name: party.name,
      document_number: base.document_number || null,
      document_date: base.document_date || null,
      due_date: null,
      aging_class: null,
      currency: 'EUR',
      confidence: 0.7,
      status: 'uncertain',
      metadata: { party_account: party.account, gross_amount: numbers[numbers.length - 2] },
    }));
  };
  for (let index = start; index < (end < 0 ? lines.length : end); index += 1) {
    const line = normalizeLine(lines[index]);
    if (line === 'Kunden') { partyType = 'customer'; party = null; continue; }
    if (line === 'Lieferanten') { partyType = 'supplier'; party = null; continue; }
    const partyMatch = line.match(/^([23]\d{5})\s+(.+)$/);
    if (partyMatch) { party = { account: partyMatch[1], name: partyMatch[2] }; pending = null; continue; }
    const totalCells = splitColumns(line);
    if (line.includes('Kontogruppe Kunden') || line.includes('Kontogruppe Lieferanten')) {
      const total = parseGermanNumber(totalCells[totalCells.length - 1]);
      items.push(detectedMetric(partyType === 'supplier' ? 'supplier_total' : 'customer_total', partyType === 'supplier' ? 'Offene Lieferantenverbindlichkeiten gesamt' : 'Offene Kundenforderungen gesamt', total, 'OP-Liste', {
        party_type: partyType,
        party_name: null,
        currency: 'EUR',
        metadata: { is_total: true },
      }));
      continue;
    }
    const transaction = line.match(/^(UE|AR|ER|BK)\s+(\S+)\s+(\d{2}\.\d{2}\.\d{4})(.*)$/);
    if (transaction) {
      pending = { document_number: transaction[2], document_date: transaction[3] };
      if (/\bEUR\b/.test(transaction[4]) && numericCells(line).length >= 2) { addDetail(totalCells, pending); pending = null; }
      continue;
    }
    if (pending && /^EUR\b/.test(line)) { addDetail(totalCells, pending); pending = null; }
  }
  ['customer', 'supplier'].forEach(type => {
    if (!items.some(item => item.party_type === type && item.metadata && item.metadata.is_total)) {
      items.push(detectedMetric(type === 'customer' ? 'customer_total' : 'supplier_total', type === 'customer' ? 'Offene Kundenforderungen gesamt' : 'Offene Lieferantenverbindlichkeiten gesamt', null, 'OP-Liste', {
        party_type: type, party_name: null, currency: 'EUR', metadata: { is_total: true },
      }));
    }
  });
  return items;
}

function parseTaxValues(lines, period) {
  const start = findLine(lines, /^SUMMENBLATT\b.*\bBemessung\b.*\bSteuer$/i);
  const end = findLine(lines, /^STEUERKONTROLLE/i, start + 1);
  const taxDetectedPeriod = start < 0 ? null : detectPeriod(lines.slice(Math.max(0, start - 20), start + 1).join('\n'));
  const line022 = findLine(lines, /^022\s+20\s*%\s+Normalsteuersatz/i, start, end);
  const line060 = findLine(lines, /^060\s+Gesamtbetrag der abziehbaren Vorsteuer/i, start, end);
  const linePayable = findLine(lines, /^Zahllast\b/i, start, end);
  const values022 = line022 < 0 ? [] : numericCells(lines[line022]);
  const taxPeriod = {
    period_month: taxDetectedPeriod && taxDetectedPeriod.to_month ? taxDetectedPeriod.to_month : period.to_month,
    period_year: taxDetectedPeriod && taxDetectedPeriod.to_year ? taxDetectedPeriod.to_year : period.to_year,
  };
  return [
    detectedMetric('taxable_basis', '022 Normalsteuersatz – Bemessungsgrundlage', values022.length > 0 ? values022[0] : null, 'Steuernachweis', taxPeriod),
    detectedMetric('vat', '022 Normalsteuersatz – Umsatzsteuer', values022.length > 1 ? values022[1] : null, 'Steuernachweis', taxPeriod),
    detectedMetric('input_tax', '060 Gesamtbetrag der abziehbaren Vorsteuer', line060 < 0 ? null : firstReportedValue(lines[line060]), 'Steuernachweis', taxPeriod),
    detectedMetric('payable', 'Zahllast', linePayable < 0 ? null : firstReportedValue(lines[linePayable]), 'Steuernachweis', taxPeriod),
  ];
}

function parseFinancialAccountingReportText(text) {
  const normalizedText = String(text || '').replace(/\r/g, '');
  const lines = normalizedText.split('\n').map(normalizeLine);
  const period = detectPeriod(normalizedText);
  const monthlyValues = parseMonthlyValues(lines, period);
  const cumulativeMetrics = parseCumulativeMetrics(lines);
  const snapshotMetrics = parseSnapshotMetrics(lines, period);
  const openItems = parseOpenItems(lines);
  const taxValues = parseTaxValues(lines, period);
  return {
    parser_version: 'bmd-fibu-v2',
    parse_status: monthlyValues.length ? 'parsed' : 'partial',
    detected_period_from_month: period.from_month,
    detected_period_from_year: period.from_year,
    detected_period_to_month: period.to_month,
    detected_period_to_year: period.to_year,
    monthly_values: monthlyValues,
    cumulative_metrics: cumulativeMetrics,
    snapshot_metrics: snapshotMetrics,
    tax_values: taxValues,
    open_items: openItems,
    detected_values: monthlyValues.concat(cumulativeMetrics, snapshotMetrics, taxValues).map((value, index) => ({
      id: 'detected-' + (index + 1),
      value_scope: value.source_section,
      value_key: value.value_key,
      raw_value: value.detected_value == null ? null : String(value.detected_value),
      normalized_value: value.detected_value == null ? null : String(value.detected_value),
      page_number: null,
      confidence: value.confidence,
      metadata: { source_label: value.source_label, account_number: value.account_number || null },
    })),
  };
}

const accountingReportParser = {
  parseGermanNumber,
  detectPeriod,
  reconstructLayoutPage,
  parseFinancialAccountingReportText,
};

if (typeof module !== 'undefined' && module.exports) module.exports = accountingReportParser;
else if (typeof globalThis !== 'undefined') globalThis.AccountingReportParser = accountingReportParser;

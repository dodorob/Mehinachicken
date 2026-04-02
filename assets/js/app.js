// ================================================================
// DATA
// ================================================================
var STORE_KEY = 'buchpro_v1';
var POS_BADGES_KEY = 'bp_pos_badges';
var POS_BADGES_DEFAULT = ['Links','Rechts','Vorne','Hinten'];
var updateStatusUnsubscribe = null;
var updateUiWired = false;

function getPosBadges() {
  try {
    var v = localStorage.getItem(POS_BADGES_KEY);
    if (v) { var a = JSON.parse(v); if (Array.isArray(a) && a.length) return a; }
  } catch(e) {}
  return POS_BADGES_DEFAULT.slice();
}
function savePosBadges(arr) {
  localStorage.setItem(POS_BADGES_KEY, JSON.stringify(arr));
}

function loadDB() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch(e) { return {}; }
}

function getDB() {
  var d = loadDB();
  if (!d.invoices)   d.invoices   = [];
  if (!d.kunden)     d.kunden     = [];
  if (!d.lieferanten)d.lieferanten= [];
  if (!d.zahlungen)  d.zahlungen  = [];
  if (!d.fahrzeuge)  d.fahrzeuge  = [];
  if (!d.counters)   d.counters   = {ausgang:1, eingang:1, fortlaufend:1};
  // Migration: ensure fortlaufend exists
  if (!d.counters.fortlaufend) d.counters.fortlaufend = d.invoices.length + 1;
  if (!d.counters.kassenbeleg) d.counters.kassenbeleg = 1;
  // Migration: ensure ausgang counter is at least invoice count + 1
  if (!d.counters.ausgang) {
    var arCount = d.invoices.filter(function(i){ return i.typ==='ausgang'; }).length;
    d.counters.ausgang = arCount + 1;
  }
  if (!d.vorlage)    d.vorlage    = dfV();
  if (!d.todos)         d.todos         = [];
  if (!d.todos_archiv)  d.todos_archiv  = [];
  return d;
}

function saveDB(d) {
  localStorage.setItem(STORE_KEY, JSON.stringify(d));
}

// Beschreibung autocomplete history
var HIST_KEY = 'buchpro_beschreibung_hist';
function loadBeschHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch(e) { return []; }
}
function saveBeschHist(terms) {
  localStorage.setItem(HIST_KEY, JSON.stringify(terms));
}
function addToBeschHist(text) {
  if (!text || text.trim().length < 2) return;
  var terms = loadBeschHist();
  var t = text.trim();
  // Remove duplicates, add to front
  terms = terms.filter(function(x){ return x.toLowerCase() !== t.toLowerCase(); });
  terms.unshift(t);
  // Keep max 200 entries
  if (terms.length > 200) terms = terms.slice(0, 200);
  saveBeschHist(terms);
}
function updateBeschDatalist() {
  var dl = document.getElementById('besch-suggestions');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'besch-suggestions';
    document.body.appendChild(dl);
  }
  var terms = loadBeschHist();
  dl.innerHTML = terms.map(function(t){ return '<option value="' + t.replace(/"/g,'&quot;') + '">'; }).join('');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2,5);
}

function savePDFToFolder(doc, filename, folderPath, fallback) {
  if (folderPath && window.electronAPI && window.electronAPI.savePdfToPath) {
    var b64 = doc.output('datauristring').split(',')[1];
    window.electronAPI.savePdfToPath(folderPath, filename, b64).then(function(result) {
      if (result && result.success) {
        var n = document.createElement('div');
        n.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:#0f6e56;color:#fff;padding:12px 20px;border-radius:8px;font-family:sans-serif;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.2)';
        n.textContent = '\u2713 PDF gespeichert: ' + result.path;
        document.body.appendChild(n);
        setTimeout(function(){ n.remove(); }, 3500);
      } else {
        fallback();
      }
    });
  } else {
    fallback();
  }
}

function nextNum(typ) {
  var raw = localStorage.getItem('buchpro_v1');
  var d = raw ? JSON.parse(raw) : {};
  if (!d.counters) d.counters = {};
  if (!d.counters.ausgang)        d.counters.ausgang        = 1;
  if (!d.counters.lfd_bank)       d.counters.lfd_bank       = 1;
  if (!d.counters.lfd_kassa)      d.counters.lfd_kassa      = 1;

  var za = (document.getElementById('zahlungsart')||{value:'bank'}).value;
  var lfdKey = za === 'kassa' ? 'lfd_kassa' : 'lfd_bank';

  if (typ === 'ausgang') {
    var num = d.counters.ausgang;
    var lfd = d.counters[lfdKey];
    d.counters.ausgang = num + 1;
    d.counters[lfdKey] = lfd + 1;
    if (za === 'kassa') d.counters.kassenbeleg = (d.counters.kassenbeleg || 1) + 1;
    localStorage.setItem('buchpro_v1', JSON.stringify(d));
    return String(num).padStart(2, '0');
  } else {
    // ER: no AR number, but lfd still increments
    var lfd2 = d.counters[lfdKey];
    d.counters[lfdKey] = lfd2 + 1;
    localStorage.setItem('buchpro_v1', JSON.stringify(d));
    return '';
  }
}


function previewNum(typ) {
  var d = getDB();
  if (typ === 'ausgang') {
    var num = (d.counters && d.counters.ausgang) || 1;
    return String(num).padStart(2, '0');
  }
  return '';
}

// ================================================================
// HELPERS
// ================================================================
var MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

function fmt(n) {
  return new Intl.NumberFormat('de-AT', {style:'currency', currency:'EUR'}).format(n || 0);
}

function fmtD(s) {
  if (!s) return '';
  try {
    var d = new Date(s);
    var dd = String(d.getDate()).padStart(2,'0');
    var mm = String(d.getMonth()+1).padStart(2,'0');
    return dd + '.' + mm + '.' + d.getFullYear();
  } catch(e) { return s; }
}

function brutto(inv) {
  if (inv.typ === 'eingang' && inv.er_brutto != null && inv.er_brutto > 0) return inv.er_brutto;
  var b = (inv.items || []).reduce(function(s,it){
    var base = it.menge * it.preis * (1 + it.ust/100);
    var extra = it.extraBetrag ? it.extraBetrag * (1 + (it.extraUst!=null?it.extraUst:20)/100) : 0;
    return s + base + extra;
  }, 0);
  return b + (inv.materialkosten || 0) * 1.2;
}

function netto(inv) {
  if (inv.typ === 'eingang' && inv.er_netto != null && inv.er_netto > 0) return inv.er_netto;
  return (inv.items || []).reduce(function(s,it){
    return s + it.menge * it.preis + (it.extraBetrag || 0);
  }, 0);
}

function vatAmt(inv) {
  if (inv.typ === 'eingang' && inv.er_ust != null && inv.er_ust > 0) return inv.er_ust;
  var items_vat = (inv.items || []).reduce(function(s,it){
    var base = it.menge * it.preis * it.ust/100;
    var extra = it.extraBetrag ? it.extraBetrag * (it.extraUst!=null?it.extraUst:20)/100 : 0;
    return s + base + extra;
  }, 0);
  return items_vat + (inv.materialkosten || 0) * 0.2;
}

function sBadge(s) {
  var map = {bezahlt:'green', offen:'amber', 'überfällig':'red'};
  return '<span class="badge ' + (map[s]||'gray') + '">' + s + '</span>';
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function openModal() { document.getElementById('modal-bg').classList.add('open'); }
function closeModal() { document.getElementById('modal-bg').classList.remove('open'); }

// ================================================================
// NAVIGATION — all via addEventListener, no onclick attributes
// ================================================================
var AF = {ausgang:'all', eingang:'all'};

function SP(id) {
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('active'); });
  document.querySelectorAll('nav a').forEach(function(a){ a.classList.remove('active'); });
  var pg  = document.getElementById('page-' + id);
  var nav = document.getElementById('nav-' + id);
  if (pg)  pg.classList.add('active');
  if (nav) nav.classList.add('active');
  if (id === 'dashboard')  { renderDash(); updateBeschDatalist(); }
  if (id === 'ausgang') {
    renderTable('ausgang');
    var bfa=document.getElementById('btn-filter-ausgang'); if(bfa) bfa.onclick=function(){ openFilterModal('ausgang','ar'); };
    var sa=document.getElementById('s-ausgang'); if(sa) sa.oninput=function(){ renderTable('ausgang'); };
  }
  if (id === 'eingang') {
    renderTable('eingang');
    var bfe=document.getElementById('btn-filter-eingang'); if(bfe) bfe.onclick=function(){ openFilterModal('eingang','er'); };
    var se=document.getElementById('s-eingang'); if(se) se.oninput=function(){ renderTable('eingang'); };
  }
  if (id === 'kunden')     { renderKunden(); var el=document.getElementById('s-kunden'); if(el) el.oninput=function(){ renderKunden(); }; }
  if (id === 'fahrzeuge')  { renderFahrzeuge(); var el=document.getElementById('s-fahrzeuge'); if(el) el.oninput=function(){ renderFahrzeuge(); }; }
  if (id === 'mitarbeiter') renderMitarbeiter();
  if (id === 'lieferanten') { renderLief(); var el=document.getElementById('s-lieferanten'); if(el) el.oninput=function(){ renderLief(); }; }
  if (id === 'zahlungen')  renderZ();
  if (id === 'statistik')  renderStatistik();
  if (id === 'finanzen')   renderFin();
  if (id === 'bankbuch') {
    initBuchMonat('bank');
    var bb=document.getElementById('btn-bankbuch-pdf'); if(bb) bb.onclick=function(){ exportBuchKassaPDF('bank'); };
    var bx=document.getElementById('btn-bankbuch-excel'); if(bx) bx.onclick=function(){ exportBuchKassaExcel('bank'); };
    var bfb=document.getElementById('btn-filter-bankbuch'); if(bfb) bfb.onclick=function(){ openFilterModal('bankbuch','buch'); };
    var sb=document.getElementById('s-bankbuch'); if(sb) sb.oninput=function(){ renderBuchKassa('bank'); };
  }
  if (id === 'kassabuch') {
    initBuchMonat('kassa');
    var kb=document.getElementById('btn-kassabuch-pdf'); if(kb) kb.onclick=function(){ exportBuchKassaPDF('kassa'); };
    var kx=document.getElementById('btn-kassabuch-excel'); if(kx) kx.onclick=function(){ exportBuchKassaExcel('kassa'); };
    var bfk=document.getElementById('btn-filter-kassabuch'); if(bfk) bfk.onclick=function(){ openFilterModal('kassabuch','buch'); };
    var sk=document.getElementById('s-kassabuch'); if(sk) sk.oninput=function(){ renderBuchKassa('kassa'); };
  }
  if (id === 'export')     { initEx(); initPathSettings(); }
  if (id === 'neu')        initForm();
  if (id === 'kostenvoranschlag') initKVForm();
  if (id === 'kv-liste') {
    renderKVListe();
    var skv = document.getElementById('s-kv-liste');
    if (skv) skv.oninput = function(){ renderKVListe(); };
  }

  if (id === 'todos')         renderTodos();
  if (id === 'einstellungen') initEinstellungen();
}

// Wire sidebar nav
document.getElementById('nav-dashboard').addEventListener('click',   function(){ SP('dashboard'); });
document.getElementById('nav-ausgang').addEventListener('click',      function(){ SP('ausgang'); });
document.getElementById('nav-eingang').addEventListener('click',      function(){ SP('eingang'); });
document.getElementById('nav-neu').addEventListener('click',          function(){ SP('neu'); });
document.getElementById('nav-kunden').addEventListener('click',       function(){ SP('kunden'); });
document.getElementById('nav-fahrzeuge').addEventListener('click',    function(){ SP('fahrzeuge'); });
document.getElementById('nav-mitarbeiter').addEventListener('click',  function(){ SP('mitarbeiter'); });
document.getElementById('nav-lieferanten').addEventListener('click',  function(){ SP('lieferanten'); });
document.getElementById('nav-zahlungen').addEventListener('click',    function(){ SP('zahlungen'); });
document.getElementById('nav-statistik').addEventListener('click',    function(){ SP('statistik'); });
document.getElementById('nav-finanzen').addEventListener('click',     function(){ SP('finanzen'); });
document.getElementById('nav-bankbuch').addEventListener('click',     function(){ SP('bankbuch'); });
document.getElementById('nav-kassabuch').addEventListener('click',    function(){ SP('kassabuch'); });
document.getElementById('nav-export').addEventListener('click',       function(){ SP('export'); });
document.getElementById('nav-todos').addEventListener('click',         function(){ SP('todos'); });
document.getElementById('nav-kostenvoranschlag').addEventListener('click', function(){ SP('kostenvoranschlag'); });
document.getElementById('nav-kv-liste').addEventListener('click', function(){ SP('kv-liste'); });

// Wire topbar buttons
(document.getElementById('btn-neue-rechnung')||{addEventListener:function(){}}).addEventListener('click', function(){ SP('neu'); });
(document.getElementById('btn-neue-ar')||{addEventListener:function(){}}).addEventListener('click',       function(){ SP('neu'); });
(document.getElementById('btn-neue-er')||{addEventListener:function(){}}).addEventListener('click',       function(){ SP('neu'); });
document.getElementById('btn-reset-form').addEventListener('click',    function(){ resetForm(); });
document.getElementById('btn-save-inv').addEventListener('click',      function(){ saveInvoice(); });
document.getElementById('btn-add-item').addEventListener('click',      function(){ addItem(); });
document.getElementById('btn-scan-k').addEventListener('click',        function(){ openScanner(); });
document.getElementById('btn-scan-f').addEventListener('click',        function(){ openScanner(); });
document.getElementById('btn-new-kunde').addEventListener('click',     function(){ openKundeModal(); });
document.getElementById('btn-new-fz').addEventListener('click',        function(){ openFzModal(null); });
document.getElementById('btn-new-lief').addEventListener('click',      function(){ openLiefModal(); });
document.getElementById('btn-new-z').addEventListener('click',         function(){ openZModal(); });
(document.getElementById('btn-csv')||{addEventListener:function(){}}).addEventListener('click',function(){ exportCSV(); });
(document.getElementById('btn-json')||{addEventListener:function(){}}).addEventListener('click',function(){ exportJSON(); });
(document.getElementById('btn-expdf')||{addEventListener:function(){}}).addEventListener('click',function(){ exportPDF(); });
document.getElementById('btn-save-v').addEventListener('click',        function(){ saveV(); });
document.getElementById('btn-reset-v').addEventListener('click',       function(){ resetV(); });

// Modal close
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-bg').addEventListener('click', function(e){
  if (e.target === document.getElementById('modal-bg')) closeModal();
});

// Vorlage tabs
document.getElementById('vt-layout').addEventListener('click',  function(){ switchVT('layout'); });
document.getElementById('vt-inhalt').addEventListener('click',  function(){ switchVT('inhalt'); });
document.getElementById('vt-firma').addEventListener('click',   function(){ switchVT('firma'); });

// Vorlage template cards
document.getElementById('tc-klassisch').addEventListener('click', function(){ selTpl('klassisch'); });
document.getElementById('tc-modern').addEventListener('click',    function(){ selTpl('modern'); });
document.getElementById('tc-minimal').addEventListener('click',   function(){ selTpl('minimal'); });

// Vorlage color swatches
var swColors = {sw1:'#1D9E75', sw2:'#185FA5', sw3:'#534AB7', sw4:'#D85A30', sw5:'#BA7517', sw6:'#333333'};
Object.keys(swColors).forEach(function(id){
  document.getElementById(id).addEventListener('click', function(){ setVC(swColors[id]); });
});
document.getElementById('vc-custom').addEventListener('input', function(){ setVC(this.value); });

// Vorlage font buttons
document.getElementById('f-helvetica').addEventListener('click', function(){ setVF('helvetica','Arial,sans-serif'); });
document.getElementById('f-georgia').addEventListener('click',   function(){ setVF('georgia','Georgia,serif'); });
document.getElementById('f-courier').addEventListener('click',   function(){ setVF('courier','Courier New,monospace'); });

// Vorlage checkboxes
['v-logo','v-bank','v-footer'].forEach(function(id){
  document.getElementById(id).addEventListener('change', function(){ updateVP(); });
});

// Vorlage text inputs
['v-ta','v-te','v-zb','v-f1','v-firma','v-adr','v-uid','v-tel','v-email','v-web','v-bname','v-iban','v-bic'].forEach(function(id){
  document.getElementById(id).addEventListener('input', function(){ updateVP(); });
});

// Filter inputs — ausgang & eingang
['ausgang','eingang'].forEach(function(typ){
  ['s-'+typ,'f-'+typ+'-von','f-'+typ+'-bis','f-'+typ+'-min','f-'+typ+'-max','f-'+typ+'-status','btn-'+typ+'-reset'].forEach(function(id){
    var el = document.getElementById(id);
    if (!el) return;
    if (id.startsWith('btn-')) {
      el.addEventListener('click', function(){
        ['s-'+typ,'f-'+typ+'-von','f-'+typ+'-bis','f-'+typ+'-min','f-'+typ+'-max'].forEach(function(fid){ var fe=document.getElementById(fid); if(fe) fe.value=''; });
        var st=document.getElementById('f-'+typ+'-status'); if(st) st.value='';
        renderTable(typ);
      });
    } else {
      el.addEventListener(el.tagName==='SELECT'?'change':'input', function(){ renderTable(typ); });
    }
  });
});

// Rechnung form
document.getElementById('typ').addEventListener('change', function(){ updateFT(); });
// partner change handled in wireFormButtons()

// Export selects
document.getElementById('ex-m').addEventListener('change', function(){ updateExDays(); updateExP(); });
document.getElementById('ex-y').addEventListener('change', function(){ updateExDays(); updateExP(); });

function setActiveChip(typ, activeId) {
  var prefix = 'chip-' + typ + '-';
  document.querySelectorAll('[id^="' + prefix + '"]').forEach(function(el){
    el.classList.toggle('active', el.id === activeId);
  });
}

// ================================================================
// DASHBOARD
// ================================================================
function renderPosBadgesList() {
  var el = document.getElementById('pos-badges-list');
  if (!el) return;
  var badges = getPosBadges();
  if (!badges.length) {
    el.innerHTML = '<div style="font-family:sans-serif;font-size:13px;color:var(--t3);padding:6px 0">Keine Vorschläge eingetragen.</div>';
    return;
  }
  var dragFrom = null;
  el.innerHTML = badges.map(function(b, i){
    return '<div class="pb-row" draggable="true" data-i="'+i+'" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;border-radius:8px;transition:background .15s">' +
      '<span style="cursor:grab;font-size:18px;color:#bbb;padding:0 2px;user-select:none;flex-shrink:0">&#8942;</span>' +
      '<input class="pb-val" value="'+esc(b)+'" style="flex:1;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:sans-serif">' +
      '<button class="btn" style="padding:4px 10px;font-size:12px" onclick="savePosBadgeEdit('+i+')">&#10003;</button>' +
      '<button class="btn danger pb-del" data-i="'+i+'" style="padding:4px 10px;font-size:12px">✕</button>' +
    '</div>';
  }).join('');

  el.querySelectorAll('.pb-row').forEach(function(row){
    row.addEventListener('dragstart', function(e){
      dragFrom = parseInt(this.dataset.i);
      e.dataTransfer.effectAllowed = 'move';
      var self = this; setTimeout(function(){ self.style.opacity='0.4'; }, 0);
    });
    row.addEventListener('dragend', function(){
      this.style.opacity='';
      el.querySelectorAll('.pb-row').forEach(function(r){ r.style.background=''; });
    });
    row.addEventListener('dragover', function(e){
      e.preventDefault();
      el.querySelectorAll('.pb-row').forEach(function(r){ r.style.background=''; });
      this.style.background='#f0f9f5';
    });
    row.addEventListener('drop', function(e){
      e.preventDefault();
      var toIdx = parseInt(this.dataset.i);
      if (dragFrom === null || dragFrom === toIdx) return;
      var arr = getPosBadges();
      var item = arr.splice(dragFrom, 1)[0];
      arr.splice(toIdx, 0, item);
      savePosBadges(arr);
      renderPosBadgesList();
    });
  });

  el.querySelectorAll('.pb-del').forEach(function(btn){
    btn.onclick = function(){
      var arr = getPosBadges();
      arr.splice(parseInt(this.dataset.i), 1);
      savePosBadges(arr);
      renderPosBadgesList();
      showPosBadgesInfo('Gelöscht');
    };
  });
}

function savePosBadgeEdit(i) {
  var rows = document.querySelectorAll('#pos-badges-list .pb-row');
  var arr = getPosBadges();
  var newVal = rows[i] ? rows[i].querySelector('.pb-val').value.trim() : '';
  if (!newVal) return;
  arr[i] = newVal;
  savePosBadges(arr);
  renderPosBadgesList();
  showPosBadgesInfo('Gespeichert');
}

function showPosBadgesInfo(msg) {
  var el = document.getElementById('pos-badges-info');
  if (!el) return;
  el.textContent = '✓ ' + msg;
  setTimeout(function(){ el.textContent = ''; }, 2000);
}

function setUpdateInfo(msg, isError) {
  var infoEl = document.getElementById('update-info');
  if (!infoEl) return;
  infoEl.style.color = isError ? 'var(--danger)' : 'var(--accent)';
  infoEl.textContent = msg || '';
}

function handleUpdateStatus(payload) {
  var dlBtn = document.getElementById('btn-download-update');
  if (!payload) return;

  if (payload.event === 'checking') {
    if (dlBtn) dlBtn.style.display = 'none';
    setUpdateInfo('Suche nach Updates...');
  } else if (payload.event === 'available') {
    if (dlBtn) dlBtn.style.display = 'inline-block';
    var nextVersion = payload.version ? (' v' + payload.version) : '';
    setUpdateInfo('Update verfügbar' + nextVersion + '. Bitte Download starten.');
  } else if (payload.event === 'not-available') {
    if (dlBtn) dlBtn.style.display = 'none';
    setUpdateInfo('Keine Updates verfügbar.');
  } else if (payload.event === 'download-deferred') {
    if (dlBtn) dlBtn.style.display = 'inline-block';
    setUpdateInfo('Download wurde verschoben.');
  } else if (payload.event === 'download-progress') {
    if (dlBtn) dlBtn.style.display = 'none';
    setUpdateInfo('Download läuft: ' + Math.round(payload.percent || 0) + '%');
  } else if (payload.event === 'downloaded') {
    if (dlBtn) dlBtn.style.display = 'none';
    setUpdateInfo('Update geladen. Bitte App neu starten, wenn Sie dazu aufgefordert werden.');
  } else if (payload.event === 'error') {
    if (dlBtn) dlBtn.style.display = 'inline-block';
    setUpdateInfo('Update-Fehler: ' + (payload.message || 'Unbekannter Fehler'), true);
  }
}

function initUpdateSettings() {
  var api = window.electronAPI;
  var versionEl = document.getElementById('current-version');
  var checkBtn = document.getElementById('btn-check-updates');
  var dlBtn = document.getElementById('btn-download-update');

  if (!api || !api.getAppVersion) {
    if (versionEl) versionEl.textContent = 'Browser-Version';
    if (checkBtn) checkBtn.disabled = true;
    if (dlBtn) dlBtn.style.display = 'none';
    setUpdateInfo('Update-Funktion nur in der Desktop-App verfügbar.');
    return;
  }

  api.getAppVersion().then(function(version){
    if (versionEl) versionEl.textContent = version;
  }).catch(function(){
    if (versionEl) versionEl.textContent = 'unbekannt';
  });

  if (!updateUiWired) {
    if (checkBtn) {
      checkBtn.onclick = function() {
        setUpdateInfo('Suche nach Updates...');
        api.checkForUpdates().then(function(result){
          if (!result || !result.ok) {
            setUpdateInfo((result && result.message) ? result.message : 'Update-Prüfung fehlgeschlagen.', true);
          }
        }).catch(function(err){
          setUpdateInfo('Update-Prüfung fehlgeschlagen: ' + err.message, true);
        });
      };
    }

    if (dlBtn) {
      dlBtn.onclick = function() {
        setUpdateInfo('Update-Download wird gestartet...');
        api.downloadUpdate().then(function(result){
          if (!result || !result.ok) {
            setUpdateInfo((result && result.message) ? result.message : 'Download fehlgeschlagen.', true);
          }
        }).catch(function(err){
          setUpdateInfo('Download fehlgeschlagen: ' + err.message, true);
        });
      };
    }

    updateUiWired = true;
  }

  if (updateStatusUnsubscribe) {
    updateStatusUnsubscribe();
  }
  updateStatusUnsubscribe = api.onUpdateStatus(handleUpdateStatus);
}

function initEinstellungen() {
  initUpdateSettings();

  // Speicherpfade laden und Buttons verdrahten
  initPathSettings();

  // Zähler & Startnummern laden
  (function() {
    var db = getDB();
    var c = db.counters || {};
    var elAusgang   = document.getElementById('counter-ausgang');
    var elLfdBank   = document.getElementById('counter-lfd-bank');
    var elLfdKassa  = document.getElementById('counter-lfd-kassa');
    var elKb        = document.getElementById('counter-kassenbeleg');
    if (elAusgang)  elAusgang.value  = c.ausgang       || 1;
    if (elLfdBank)  elLfdBank.value  = c.lfd_bank      || 1;
    if (elLfdKassa) elLfdKassa.value = c.lfd_kassa     || 1;
    if (elKb)       elKb.value       = c.kassenbeleg   || 1;

    var btnSaveCounters = document.getElementById('btn-save-counters');
    if (btnSaveCounters) btnSaveCounters.onclick = function() {
      var d2 = getDB();
      var newAusgang  = parseInt((document.getElementById('counter-ausgang')||{value:'1'}).value) || 1;
      var newLfdBank  = parseInt((document.getElementById('counter-lfd-bank')||{value:'1'}).value) || 1;
      var newLfdKassa = parseInt((document.getElementById('counter-lfd-kassa')||{value:'1'}).value) || 1;
      var newKb       = parseInt((document.getElementById('counter-kassenbeleg')||{value:'1'}).value) || 1;
      d2.counters.ausgang     = newAusgang;
      d2.counters.lfd_bank    = newLfdBank;
      d2.counters.lfd_kassa   = newLfdKassa;
      d2.counters.kassenbeleg = newKb;
      saveDB(d2);
      var info = document.getElementById('counter-info');
      if (info) { info.textContent = '\u2713 Zähler gespeichert'; setTimeout(function(){ info.textContent = ''; }, 2500); }
    };
  })();

  // Positions-Vorschläge
  renderPosBadgesList();
  var btnAdd = document.getElementById('btn-pos-badge-add');
  if (btnAdd) btnAdd.onclick = function(){
    var inp = document.getElementById('pos-badge-new');
    var val = inp ? inp.value.trim() : '';
    if (!val) return;
    var arr = getPosBadges();
    arr.push(val);
    savePosBadges(arr);
    if (inp) inp.value = '';
    renderPosBadgesList();
    showPosBadgesInfo('Hinzugefügt: ' + val);
  };
  var inp = document.getElementById('pos-badge-new');
  if (inp) inp.onkeydown = function(e){ if (e.key === 'Enter') document.getElementById('btn-pos-badge-add').click(); };

  // Fixkosten laden und rendern
  renderFixkostenList();

  var btnAdd = document.getElementById('btn-add-fixkosten');
  if(btnAdd) btnAdd.onclick = function(){
    // Read current values from DOM (not from storage) so nothing gets lost
    var fk = [];
    document.querySelectorAll('.fk-row').forEach(function(row){
      var name = row.querySelector('.fk-name').value.trim();
      var betrag = parseFloat(row.querySelector('.fk-betrag').value) || 0;
      var monatEl = row.querySelector('.fk-monat');
      var monat = monatEl ? (parseInt(monatEl.value)||null) : null;
      fk.push({name:name, betrag:betrag, monat:monat});
    });
    fk.push({name:'', betrag:0});
    saveFixkosten(fk);
    renderFixkostenList();
  };

  var vlEl = document.getElementById('todo-vorlauf');
  if (vlEl) vlEl.value = localStorage.getItem('bp_todo_vorlauf') || '7';
  var vlBtn = document.getElementById('btn-todo-vorlauf-save');
  if (vlBtn) vlBtn.onclick = function(){
    var v = parseInt((document.getElementById('todo-vorlauf')||{value:'7'}).value) || 7;
    localStorage.setItem('bp_todo_vorlauf', String(v));
    var info = document.getElementById('todo-vorlauf-info');
    if (info) { info.textContent = '✓ Gespeichert: ' + v + ' Tage'; setTimeout(function(){ info.textContent = ''; }, 2000); }
  };

  var btnSave = document.getElementById('btn-save-fixkosten');
  if(btnSave) btnSave.onclick = function(){
    var rows = document.querySelectorAll('.fk-row');
    var fk = [];
    rows.forEach(function(row){
      var name   = row.querySelector('.fk-name').value.trim();
      var betrag = parseFloat(row.querySelector('.fk-betrag').value) || 0;
      var monatEl = row.querySelector('.fk-monat');
      var monat = monatEl ? (parseInt(monatEl.value)||null) : null;
      if(name || betrag > 0) fk.push({name:name, betrag:betrag, monat:monat});
    });
    saveFixkosten(fk);
    var info = document.getElementById('fixkosten-info');
    if(info){ info.textContent='✓ Gespeichert'; setTimeout(function(){ info.textContent=''; }, 2000); }
  };
}

function loadFixkosten() {
  try { return JSON.parse(localStorage.getItem('bp_fixkosten') || '[]'); } catch(e){ return []; }
}

function saveFixkosten(list) {
  localStorage.setItem('bp_fixkosten', JSON.stringify(list));
}

function getFixkostenTotal(monat) {
  // monat: 1-12, or undefined = current month
  var m = monat || (new Date().getMonth() + 1);
  return loadFixkosten().filter(function(f){
    return !f.monat || f.monat === m;
  }).reduce(function(s,f){ return s + (parseFloat(f.betrag)||0); }, 0);
}

function renderFixkostenList() {
  var el = document.getElementById('fixkosten-list');
  if (!el) return;
  var fk = loadFixkosten();
  if (!fk.length) {
    el.innerHTML = '<div style="font-family:sans-serif;font-size:13px;color:var(--t3);padding:8px 0">Noch keine Fixkosten eingetragen.</div>';
    return;
  }
  var MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  var monthOpts = '<option value="">Jeden Monat</option>' +
    MONTHS.map(function(m,i){ return '<option value="'+(i+1)+'">'+m+'</option>'; }).join('');

  el.innerHTML = fk.map(function(item, i){
    var selVal = item.monat ? String(item.monat) : '';
    var opts = '<option value="">Jeden Monat</option>' +
      MONTHS.map(function(m,mi){ return '<option value="'+(mi+1)+'"'+(String(mi+1)===selVal?' selected':'')+'>'+m+'</option>'; }).join('');
    return '<div class="fk-row" draggable="true" data-i="'+i+'" style="display:flex;gap:8px;margin-bottom:6px;align-items:center;flex-wrap:wrap;border-radius:8px;transition:background .15s">' +
      '<span class="drag-handle" style="cursor:grab;font-size:20px;color:#bbb;padding:0 2px;user-select:none;flex-shrink:0" title="Verschieben">&#8942;</span>' +
      '<input class="fk-name" placeholder="Bezeichnung (z.B. 13. Gehalt)" value="'+esc(item.name||'')+'" style="flex:2;min-width:140px;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:sans-serif">' +
      '<input class="fk-betrag" type="number" placeholder="0.00" value="'+(item.betrag||'')+'" min="0" step="0.01" style="flex:1;min-width:90px;padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;font-family:sans-serif">' +
      '<span style="font-family:sans-serif;font-size:13px;color:#666;white-space:nowrap">€</span>' +
      '<select class="fk-monat" style="padding:7px 10px;border:1px solid #ddd;border-radius:8px;font-size:12px;font-family:sans-serif;color:var(--t2)">'+opts+'</select>' +
      '<button class="btn danger fk-del" data-i="'+i+'" style="padding:4px 10px;font-size:12px">✕</button>' +
    '</div>';
  }).join('');

  function readFkFromDOM() {
    var rows = [];
    document.querySelectorAll('#fixkosten-list .fk-row').forEach(function(row){
      var name = row.querySelector('.fk-name').value.trim();
      var betrag = parseFloat(row.querySelector('.fk-betrag').value)||0;
      var monatEl = row.querySelector('.fk-monat');
      var monat = monatEl ? (parseInt(monatEl.value)||null) : null;
      rows.push({name:name, betrag:betrag, monat:monat});
    });
    return rows;
  }

  var fkDragFrom = null;
  el.querySelectorAll('.fk-row').forEach(function(row){
    row.addEventListener('dragstart', function(e){
      fkDragFrom = parseInt(this.dataset.i);
      e.dataTransfer.effectAllowed = 'move';
      var self = this;
      setTimeout(function(){ self.style.opacity = '0.4'; }, 0);
    });
    row.addEventListener('dragend', function(){
      this.style.opacity = '';
      el.querySelectorAll('.fk-row').forEach(function(r){ r.style.background=''; });
    });
    row.addEventListener('dragover', function(e){
      e.preventDefault();
      el.querySelectorAll('.fk-row').forEach(function(r){ r.style.background=''; });
      this.style.background = '#f0f9f5';
    });
    row.addEventListener('drop', function(e){
      e.preventDefault();
      var toIdx = parseInt(this.dataset.i);
      if (fkDragFrom === null || fkDragFrom === toIdx) return;
      var fk2 = readFkFromDOM();
      var item = fk2.splice(fkDragFrom, 1)[0];
      fk2.splice(toIdx, 0, item);
      saveFixkosten(fk2);
      renderFixkostenList();
    });
  });

  el.querySelectorAll('.fk-del').forEach(function(btn){
    btn.onclick = function(){
      var fk2 = readFkFromDOM();
      fk2.splice(parseInt(this.dataset.i), 1);
      saveFixkosten(fk2);
      renderFixkostenList();
    };
  });
}



// ================================================================
// STATISTIK
// ================================================================
function renderStatistik() {
  var d = getDB();
  var now = new Date();
  var curM = now.getMonth(), curY = now.getFullYear();

  function invForMonth(m, y) {
    return d.invoices.filter(function(i){ var dt=new Date(i.datum); return dt.getMonth()===m && dt.getFullYear()===y; });
  }

  var curInvs = invForMonth(curM, curY);
  var arInvs  = curInvs.filter(function(i){ return i.typ==='ausgang'; });
  var erInvs  = curInvs.filter(function(i){ return i.typ==='eingang'; });

  var umsatz   = arInvs.reduce(function(s,i){ return s+brutto(i); }, 0);
  var ausgaben = erInvs.reduce(function(s,i){ return s+brutto(i); }, 0);
  var fixkostenMonat = getFixkostenTotal(curM + 1);
  // Gewinn WITHOUT Fixkosten as requested
  var gewinnVerlust  = umsatz - ausgaben;
  var isGewinn       = gewinnVerlust >= 0;
  var marge = umsatz > 0 ? Math.round(gewinnVerlust / umsatz * 1000) / 10 : 0;

  var MONTHS = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

  // ── Metrics ──────────────────────────────────────────────────
  document.getElementById('stat-metrics').innerHTML =
    '<div class="metric green"><div class="lbl">Umsatz (dieser Monat)</div><div class="val">'+fmt(umsatz)+'</div></div>' +
    '<div class="metric red"><div class="lbl">Ausgaben</div><div class="val">'+fmt(ausgaben)+'</div></div>' +
    '<div class="metric '+(isGewinn?'green':'red')+'"><div class="lbl">'+(isGewinn?'Gewinn':'Verlust')+'</div><div class="val">'+fmt(Math.abs(gewinnVerlust))+'</div></div>' +
    '<div class="metric '+(marge>=0?'green':'red')+'"><div class="lbl">Gewinnmarge</div><div class="val">'+marge.toFixed(1)+'%</div></div>' +
    '<div class="metric"><div class="lbl">Fixkosten / Monat</div><div class="val">'+fmt(fixkostenMonat)+'</div></div>';

  // ── 6-month trend (also without Fixkosten) ───────────────────
  var labels=[], dataGV=[], dataUM=[], dataAUS=[];
  for (var offset=5; offset>=0; offset--) {
    var mm = new Date(curY, curM - offset, 1);
    var mo = mm.getMonth(), yo = mm.getFullYear();
    var mi = invForMonth(mo, yo);
    var um = mi.filter(function(i){return i.typ==='ausgang';}).reduce(function(s,i){return s+brutto(i);},0);
    var au = mi.filter(function(i){return i.typ==='eingang';}).reduce(function(s,i){return s+brutto(i);},0);
    labels.push(MONTHS[mo]+' '+yo);
    dataUM.push(Math.round(um*100)/100);
    dataAUS.push(Math.round(au*100)/100);
    dataGV.push(Math.round((um-au)*100)/100);
  }

  // Chart: Gewinn/Verlust
  var c1 = document.getElementById('stat-chart-gv');
  if (c1._sc) c1._sc.destroy();
  c1._sc = new Chart(c1, {
    type: 'bar',
    data: { labels: labels, datasets: [{
      label: 'Gewinn / Verlust (€)',
      data: dataGV,
      backgroundColor: dataGV.map(function(v){ return v>=0?'rgba(29,158,117,0.7)':'rgba(226,75,74,0.7)'; }),
      borderRadius: 6
    }]},
    options: { responsive:true, plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:function(v){return v+'€';}}}} }
  });

  // Chart: Umsatz vs Ausgaben
  var c2 = document.getElementById('stat-chart-ua');
  if (c2._sc) c2._sc.destroy();
  c2._sc = new Chart(c2, {
    type: 'bar',
    data: { labels: labels, datasets: [
      { label:'Umsatz', data:dataUM, backgroundColor:'rgba(29,158,117,0.7)', borderRadius:4 },
      { label:'Ausgaben', data:dataAUS, backgroundColor:'rgba(226,75,74,0.6)', borderRadius:4 }
    ]},
    options: { responsive:true, scales:{y:{ticks:{callback:function(v){return v+'€';}}}},
      plugins:{legend:{position:'bottom'}} }
  });

  // ── Fixkosten Übersicht ──────────────────────────────────────
  var fk = loadFixkosten();
  var fkEl = document.getElementById('stat-fixkosten');
  var fkFutureEl = document.getElementById('stat-fixkosten-future');
  var MONTHS_STAT = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

  if (!fk.length) {
    fkEl.innerHTML = '<div class="empty">Keine Fixkosten eingetragen.<br><small>Unter Einstellungen → Fixkosten hinzufügen.</small></div>';
    if (fkFutureEl) fkFutureEl.innerHTML = '<div class="empty">Keine Fixkosten eingetragen.</div>';
  } else {
    // Split: this month = every month OR matching current month
    var fkThis   = fk.filter(function(f){ return !f.monat || f.monat === (curM+1); });
    var fkFuture = fk.filter(function(f){ return f.monat && f.monat !== (curM+1); });

    // ── This month: with progress bars vs umsatz ──────────────
    var umsatzLeft = umsatz;
    var thisRows = fkThis.map(function(f){
      var betrag = parseFloat(f.betrag)||0;
      var wann = f.monat ? MONTHS_STAT[f.monat-1] : 'Jeden Monat';
      var covered = Math.min(umsatzLeft, betrag);
      umsatzLeft = Math.max(0, umsatzLeft - betrag);
      var pct = betrag > 0 ? Math.min(100, Math.round(covered/betrag*100)) : 0;
      var col = pct>=100?'#1D9E75':pct>=50?'#f59e0b':'#E24B4A';
      return '<tr>'+
        '<td>'+esc(f.name||'—')+'</td>'+
        '<td style="font-size:11px;color:var(--t3)">'+wann+'</td>'+
        '<td style="text-align:right">'+fmt(betrag)+'</td>'+
        '<td style="padding:0 8px;min-width:70px">'+
          '<div style="background:#f0f0ec;border-radius:4px;height:8px;margin:2px 0">'+
            '<div style="background:'+col+';height:8px;border-radius:4px;width:'+pct+'%"></div>'+
          '</div>'+
        '</td>'+
        '<td style="font-size:11px;font-weight:600;color:'+col+';white-space:nowrap">'+pct+'%</td>'+
      '</tr>';
    }).join('');

    var totalThis = fkThis.reduce(function(s,f){return s+(parseFloat(f.betrag)||0);},0);
    var totalPct = totalThis>0 ? Math.min(100,Math.round(umsatz/totalThis*100)) : 0;
    var totalCol = totalPct>=100?'#1D9E75':totalPct>=50?'#f59e0b':'#E24B4A';

    if (!fkThis.length) {
      fkEl.innerHTML = '<div class="empty">Keine Fixkosten für diesen Monat.</div>';
    } else {
      fkEl.innerHTML =
        '<table><thead><tr><th>Bezeichnung</th><th>Gültig</th><th style="text-align:right">€</th><th colspan="2">Eingenommen</th></tr></thead>'+
        '<tbody>'+thisRows+'</tbody>'+
        '<tfoot><tr>'+
          '<td style="font-weight:600;padding:8px 10px">Gesamt</td><td></td>'+
          '<td style="text-align:right;font-weight:600;padding:8px 10px">'+fmt(totalThis)+'</td>'+
          '<td style="padding:0 8px;min-width:70px">'+
            '<div style="background:#f0f0ec;border-radius:4px;height:8px;margin:2px 0">'+
              '<div style="background:'+totalCol+';height:8px;border-radius:4px;width:'+totalPct+'%"></div>'+
            '</div>'+
          '</td>'+
          '<td style="font-size:12px;font-weight:600;color:'+totalCol+'">'+totalPct+'%</td>'+
        '</tr></tfoot></table>';
    }

    // ── Future: sorted by month ───────────────────────────────
    if (fkFutureEl) {
      if (!fkFuture.length) {
        fkFutureEl.innerHTML = '<div class="empty">Keine weiteren geplanten Fixkosten.</div>';
      } else {
        // Sort by month, wrap around year if needed
        fkFuture.sort(function(a,b){
          var am = a.monat > curM+1 ? a.monat : a.monat+12;
          var bm = b.monat > curM+1 ? b.monat : b.monat+12;
          return am - bm;
        });
        var futureRows = fkFuture.map(function(f){
          var betrag = parseFloat(f.betrag)||0;
          var monthName = MONTHS_STAT[f.monat-1];
          var monthsAway = f.monat > curM+1 ? f.monat-(curM+1) : (12-curM-1)+f.monat;
          var badge = monthsAway===1 ? '<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 6px;border-radius:10px;margin-left:4px">nächsten Monat</span>' :
            monthsAway<=3 ? '<span style="background:#fef3c7;color:#92400e;font-size:10px;padding:1px 6px;border-radius:10px;margin-left:4px">in '+monthsAway+' Monaten</span>' : '';
          return '<tr>'+
            '<td>'+esc(f.name||'—')+badge+'</td>'+
            '<td style="font-family:sans-serif;font-size:12px;font-weight:500;color:var(--accent)">'+monthName+'</td>'+
            '<td style="text-align:right;font-weight:500">'+fmt(betrag)+'</td>'+
          '</tr>';
        }).join('');
        var totalFuture = fkFuture.reduce(function(s,f){return s+(parseFloat(f.betrag)||0);},0);
        fkFutureEl.innerHTML =
          '<table><thead><tr><th>Bezeichnung</th><th>Monat</th><th style="text-align:right">€</th></tr></thead>'+
          '<tbody>'+futureRows+'</tbody>'+
          '<tfoot><tr>'+
            '<td style="font-weight:600;padding:8px 10px">Gesamt</td><td></td>'+
            '<td style="text-align:right;font-weight:600;padding:8px 10px">'+fmt(totalFuture)+'</td>'+
          '</tr></tfoot></table>';
      }
    }
  }

  // ── Top Kunden ────────────────────────────────────────────────
  var kundenMap = {};
  d.invoices.filter(function(i){ return i.typ==='ausgang' && i.partner_name; }).forEach(function(inv){
    var n = inv.partner_name;
    kundenMap[n] = (kundenMap[n]||0) + brutto(inv);
  });
  var topK = Object.keys(kundenMap).map(function(n){ return {name:n, val:kundenMap[n]}; })
    .sort(function(a,b){ return b.val-a.val; }).slice(0,8);
  var tkEl = document.getElementById('stat-topkunden');
  if (!topK.length) {
    tkEl.innerHTML = '<div class="empty">Noch keine Rechnungen vorhanden.</div>';
  } else {
    var maxV = topK[0].val;
    tkEl.innerHTML = topK.map(function(k){
      var pct = Math.round(k.val/maxV*100);
      return '<div style="margin-bottom:10px">'+
        '<div style="display:flex;justify-content:space-between;font-family:sans-serif;font-size:12px;margin-bottom:3px">'+
          '<span>'+esc(k.name)+'</span><span style="font-weight:500">'+fmt(k.val)+'</span>'+
        '</div>'+
        '<div style="background:#f0f0ec;border-radius:4px;height:8px">'+
          '<div style="background:var(--accent);height:8px;border-radius:4px;width:'+pct+'%"></div>'+
        '</div>'+
      '</div>';
    }).join('');
  }
}

function renderDash() {
  var d = getDB(), now = new Date(), m = now.getMonth(), y = now.getFullYear();
  var tI=0, tE=0, vC=0, vP=0, mI=0, mE=0;
  d.invoices.forEach(function(inv){
    var b = brutto(inv), v = vatAmt(inv);
    if (inv.typ === 'ausgang') { tI+=b; vC+=v; } else { tE+=b; vP+=v; }
    var id = new Date(inv.datum);
    if (id.getMonth()===m && id.getFullYear()===y) {
      if (inv.typ==='ausgang') mI+=b; else mE+=b;
    }
  });
  document.getElementById('d-metrics').innerHTML =
    '<div class="metric green"><div class="lbl">Umsatz</div><div class="val">' + fmt(tI-tE) + '</div></div>' +
    '<div class="metric green"><div class="lbl">Einnahmen</div><div class="val">' + fmt(tI) + '</div><div class="sub">Monat: ' + fmt(mI) + '</div></div>' +
    '<div class="metric red"><div class="lbl">Ausgaben</div><div class="val">' + fmt(tE) + '</div><div class="sub">Monat: ' + fmt(mE) + '</div></div>' +
    '<div class="metric amber"><div class="lbl">USt.-Schuld</div><div class="val">' + fmt(vC-vP) + '</div></div>';

  var alerts = '';
  var od = d.invoices.filter(function(i){ return i.typ==='ausgang' && i.status==='offen' && i.faellig && new Date(i.faellig) < now; });
  if (od.length) alerts += '<div class="alert warning">&#9888; ' + od.length + ' überfällige Ausgangsrechnung(en)</div>';
  document.getElementById('d-alerts').innerHTML = alerts;

  var m6=[],iD=[],eD=[];
  for (var i=5; i>=0; i--) {
    var dm = new Date(y, m-i, 1);
    m6.push(MONTHS[dm.getMonth()].substr(0,3));
    var ii=0, ee=0;
    d.invoices.forEach(function(inv){
      var id = new Date(inv.datum);
      if (id.getMonth()===dm.getMonth() && id.getFullYear()===dm.getFullYear()) {
        if (inv.typ==='ausgang') ii+=brutto(inv); else ee+=brutto(inv);
      }
    });
    iD.push(ii); eD.push(ee);
  }
  var c1 = document.getElementById('cEA');
  if (c1._c) c1._c.destroy();
  c1._c = new Chart(c1, {type:'bar', data:{labels:m6, datasets:[{label:'Einnahmen',data:iD,backgroundColor:'#5DCAA5'},{label:'Ausgaben',data:eD,backgroundColor:'#F09595'}]}, options:{plugins:{legend:{labels:{font:{size:11}}},datalabels:{display:false}}, scales:{y:{ticks:{callback:function(v){ return fmt(v); }}}}, animation:{onComplete:function(){var ctx=this.ctx;ctx.save();ctx.font='bold 10px sans-serif';ctx.fillStyle='#333';ctx.textAlign='center';ctx.textBaseline='bottom';this.data.datasets.forEach(function(ds,di){var meta=this.getDatasetMeta(di);meta.data.forEach(function(bar,i){var val=ds.data[i];if(val>0){var v=val>=1000?(val/1000).toFixed(1)+'k':''+Math.round(val);ctx.fillText(v,bar.x,bar.y-2);}});}.bind(this));ctx.restore();}}}});

  var c2 = document.getElementById('cUST');
  if (c2._c) c2._c.destroy();
  c2._c = new Chart(c2, {type:'doughnut', data:{labels:['USt. eingenommen','USt. bezahlt'], datasets:[{data:[vC,vP], backgroundColor:['#1D9E75','#F09595']}]}, options:{plugins:{legend:{labels:{font:{size:11}}}}}});

  var rec = document.getElementById('d-recent');
  var in3 = new Date(now.getTime() + 3*86400000);
  var due3 = d.invoices.filter(function(i){
    return i.status === 'offen' && i.faellig && new Date(i.faellig) <= in3;
  }).sort(function(a,b){ return new Date(a.faellig)-new Date(b.faellig); });
  if (!due3.length) { rec.innerHTML = '<div class="empty">Keine Rechnungen in den nächsten 3 Tagen fällig ✓</div>'; }
  else {
    var rows = due3.map(function(inv){
      var fd = new Date(inv.faellig);
      var tage = Math.round((fd - now) / 86400000);
      var tageStr = tage < 0
        ? '<span style="color:#E24B4A;font-weight:600">'+Math.abs(tage)+' Tage überfällig</span>'
        : tage === 0 ? '<span style="color:#BA7517;font-weight:600">Heute fällig</span>'
        : '<span style="color:#f59e0b;font-weight:600">in '+tage+' Tag(en)</span>';
      return '<tr>'+
        '<td class="mono" style="font-size:11px">'+esc(inv.nummer)+'</td>'+
        '<td>'+(inv.partner_name||'—')+'</td>'+
        '<td><span class="badge '+(inv.typ==='ausgang'?'green':'red')+'">'+(inv.typ==='ausgang'?'AR':'ER')+'</span></td>'+
        '<td style="text-align:right">'+fmt(brutto(inv))+'</td>'+
        '<td>'+tageStr+'</td>'+
      '</tr>';
    }).join('');
    rec.innerHTML = '<table><thead><tr><th>Nr.</th><th>Partner</th><th>Typ</th><th style="text-align:right">Betrag</th><th>Fälligkeit</th></tr></thead><tbody>'+rows+'</tbody></table>';
  }

  // Fällige Todos
  var todosEl = document.getElementById('d-todos');
  if (todosEl) {
    var vorlauf = parseInt(localStorage.getItem('bp_todo_vorlauf') || '7');
    var inV = new Date(now.getTime() + vorlauf*86400000);
    var dueTodos = (d.todos || []).filter(function(t){
      return !t.erledigt && t.faellig && new Date(t.faellig) <= inV;
    }).sort(function(a,b){ return new Date(a.faellig)-new Date(b.faellig); });
    if (!dueTodos.length) {
      todosEl.innerHTML = '<div class="empty">Keine fälligen To-Dos in den nächsten ' + vorlauf + ' Tagen ✓</div>';
    } else {
      var trows = dueTodos.map(function(t){
        var fd = new Date(t.faellig);
        var tage = Math.round((fd - now) / 86400000);
        var tageStr = tage < 0
          ? '<span style="color:#E24B4A;font-weight:600">'+Math.abs(tage)+' Tage überfällig</span>'
          : tage === 0 ? '<span style="color:#BA7517;font-weight:600">Heute fällig</span>'
          : '<span style="color:#f59e0b;font-weight:600">in '+tage+' Tag(en)</span>';
        var wdh = {keine:'–',taeglich:'Täglich',woechentlich:'Wöchentlich',monatlich:'Monatlich',jaehrlich:'Jährlich'};
        return '<tr>'+
          '<td>'+esc(t.titel)+'</td>'+
          '<td>'+fmtD(t.faellig)+'</td>'+
          '<td>'+tageStr+'</td>'+
          '<td style="font-size:11px;color:var(--t3)">'+(wdh[t.wiederholung]||'–')+'</td>'+
          '<td><button class="btn primary" style="font-size:11px;padding:3px 10px" onclick="erledigeTodo(\''+t.id+'\')">Erledigt</button></td>'+
        '</tr>';
      }).join('');
      todosEl.innerHTML = '<table><thead><tr><th>Titel</th><th>Fällig</th><th>Fälligkeit</th><th>Wiederholung</th><th></th></tr></thead><tbody>'+trows+'</tbody></table>';
    }
  }
}

// ================================================================
// INVOICE TABLE
// ================================================================
function renderTable(typ) {
  var d = getDB();
  var s      = (document.getElementById('s-'+typ)||{value:''}).value.toLowerCase();
  var von    = (document.getElementById('f-'+typ+'-von')||{value:''}).value;
  var bis    = (document.getElementById('f-'+typ+'-bis')||{value:''}).value;
  var minB   = parseFloat((document.getElementById('f-'+typ+'-min')||{value:''}).value)||0;
  var maxB   = parseFloat((document.getElementById('f-'+typ+'-max')||{value:''}).value)||Infinity;
  var status = (document.getElementById('f-'+typ+'-status')||{value:''}).value;
  var invs = d.invoices.filter(function(i){ return i.typ === typ; });
  if (s)      invs = invs.filter(function(i){ return (i.nummer+(i.partner_name||'')).toLowerCase().indexOf(s)!==-1; });
  if (von)    invs = invs.filter(function(i){ return i.datum >= von; });
  if (bis)    invs = invs.filter(function(i){ return i.datum <= bis; });
  if (status) invs = invs.filter(function(i){ return i.status === status; });
  invs = invs.filter(function(i){ var b=brutto(i); return b>=minB && b<=maxB; });
  invs = invs.slice().sort(function(a,b){ return b.datum > a.datum ? 1 : -1; });
  var el = document.getElementById('tbl-'+typ);
  if (!invs.length) { el.innerHTML = '<div class="empty">Keine Rechnungen</div>'; return; }
  var rows = invs.map(function(inv){
    return '<tr>' +
      '<td class="mono" style="color:var(--t3);font-size:11px">'+(inv.lfd_nr||'')+'</td>' +
      (typ==='ausgang'?'<td class="mono">' + (inv.nummer||'—') + '</td>':'') +
      '<td>' + (inv.partner_name||'-') + '</td>' +
      '<td>' + fmtD(inv.datum) + '</td>' +
      '<td>' + fmtD(inv.faellig) + '</td>' +
      '<td>' + fmt(netto(inv)) + '</td>' +
      '<td>' + fmt(brutto(inv)) + '</td>' +
      '<td>' + sBadge(inv.status) + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn" style="padding:4px 8px;font-size:11px" data-action="pdf" data-id="' + inv.id + '">PDF</button> ' +
        '<button class="btn" style="padding:4px 8px;font-size:11px" data-action="edit" data-id="' + inv.id + '">&#9998;</button> ' +
        '<button class="btn" style="padding:4px 8px;font-size:11px" data-action="status" data-id="' + inv.id + '">Status</button> ' +
        '<button class="btn danger" style="padding:4px 8px;font-size:11px" data-action="del" data-id="' + inv.id + '">Löschen</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  el.innerHTML = (typ==='ausgang'?'<table><thead><tr><th>Lfd.</th><th>Nr.</th><th>Partner</th><th>Datum</th><th>Fällig</th><th>Netto</th><th>Brutto</th><th>Status</th><th>Aktion</th></tr></thead><tbody>':'<table><thead><tr><th>Lfd.</th><th>Partner</th><th>Datum</th><th>Fällig</th><th>Netto</th><th>Brutto</th><th>Status</th><th>Aktion</th></tr></thead><tbody>') + rows + '</tbody></table>';
  el.querySelectorAll('button[data-action]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = this.dataset.id, action = this.dataset.action;
      if (action === 'pdf')    genPDF(id);
      if (action === 'edit')   editInv(id);
      if (action === 'status') togStatus(id);
      if (action === 'del')    delInv(id);
    });
  });
}

function togStatus(id) {
  var d = getDB(), inv = d.invoices.find(function(i){ return i.id===id; });
  if (!inv) return;
  var s = ['offen','bezahlt','überfällig'];
  inv.status = s[(s.indexOf(inv.status)+1) % s.length];
  saveDB(d);
  renderTable(inv.typ);
}

function delInv(id) {
  if (!confirm('Rechnung löschen?')) return;
  var d = getDB(), inv = d.invoices.find(function(i){ return i.id===id; }), typ = inv ? inv.typ : 'ausgang';
  d.invoices = d.invoices.filter(function(i){ return i.id!==id; });
  saveDB(d);
  renderTable(typ);
}

// ================================================================
// INVOICE FORM
// ================================================================
var editId = null;
var itemsData = [{titel:'',desc:'',menge:1,preis:0,ust:20,djevad_h:0,helmut_h:0}];

function initForm() {
  editId = null;
  document.getElementById('form-title').textContent = 'Neue Rechnung';
  var now = new Date().toISOString().split('T')[0];
  var due = new Date(Date.now() + 14*86400000).toISOString().split('T')[0];
  document.getElementById('datum').value = now;
  document.getElementById('leistungsdatum').value = now;
  if (document.getElementById('fz-marke-inv')) document.getElementById('fz-marke-inv').value = '';
  if (document.getElementById('fz-kz-inv')) document.getElementById('fz-kz-inv').value = '';
  document.getElementById('faellig').value = due;
  document.getElementById('status').value = 'offen';
  document.getElementById('notizen').value = '';
  document.getElementById('pinfo').value = '';
  document.getElementById('f-alerts').innerHTML = '';
  document.getElementById('f-alerts2').innerHTML = '';

  setPay('bank');
  document.getElementById('mat-auto').checked = false;
  if (document.getElementById('inv-privat')) document.getElementById('inv-privat').checked = false;
  if (document.getElementById('inv-djevad')) document.getElementById('inv-djevad').checked = false;
  if (document.getElementById('inv-helmut')) document.getElementById('inv-helmut').checked = false;
  var mm = document.getElementById('mat-manuell'); if (mm) mm.value = '';
  document.getElementById('mat-info').textContent = '';
  document.getElementById('partner').value = '';
  document.getElementById('partner-detail').style.display = 'none';
  // Set AR as default
  setTyp('ausgang');
  // Init ER dates
  var erNow = new Date().toISOString().split('T')[0];
  var erDue = new Date(Date.now()+14*86400000).toISOString().split('T')[0];
  var erD = document.getElementById('er-datum'); if(erD) erD.value = erNow;
  var erF = document.getElementById('er-faellig'); if(erF) erF.value = erDue;
  var erPct = document.getElementById('er-ust-pct'); if(erPct) erPct.value = '20';
  updateFT();
  itemsData = [{titel:'Sprenglerarb.: ',desc:'',menge:1,preis:0,ust:20,djevad_h:0,helmut_h:0}];
  renderItems();
  // Wire up toggle buttons (re-wire after SP)
  wireFormButtons();
  // Always refresh displayed numbers from DB
  refreshNumbers();
}

function wireFormButtons() {
  var arBtn = document.getElementById('toggle-ar');
  var erBtn = document.getElementById('toggle-er');
  var bankBtn = document.getElementById('toggle-bank');
  var kassaBtn = document.getElementById('toggle-kassa');
  var matAuto = document.getElementById('mat-auto');
  var partnerSel = document.getElementById('partner');

  if (arBtn) {
    arBtn.onclick = function(){ setTyp('ausgang'); };
    erBtn.onclick = function(){ setTyp('eingang'); };
    bankBtn.onclick = function(){ setPay('bank'); };
    kassaBtn.onclick = function(){ setPay('kassa'); };
    var barBtn2 = document.getElementById('toggle-bar');
    var bankomatBtn2 = document.getElementById('toggle-bankomat');
    if (barBtn2) barBtn2.onclick = function(){ setKassaTyp('bar'); };
    if (bankomatBtn2) bankomatBtn2.onclick = function(){ setKassaTyp('bankomat'); };
    matAuto.onchange = function(){
      if (this.checked) { var m=document.getElementById('mat-manuell'); if(m) m.value=''; }
      renderSum();
    };
    var matMan = document.getElementById('mat-manuell');
    if (matMan) matMan.oninput = function(){
      if (this.value) { var a=document.getElementById('mat-auto'); if(a) a.checked=false; }
      renderSum();
    };
    partnerSel.onchange = function(){ fillPD(); };
  }
  var btnNewP = document.getElementById('btn-new-partner-inline');
  if (btnNewP) btnNewP.onclick = function(){ openInlineKundeModal(); };
  var btnBottom = document.getElementById('btn-save-inv-bottom');
  if (btnBottom) btnBottom.onclick = function(){ saveInvoice(); };
  var btnResetBottom = document.getElementById('btn-reset-form-bottom');
  if (btnResetBottom) btnResetBottom.onclick = function(){ resetForm(); };
  var btnFixC = document.getElementById('btn-fix-counters');
  if (btnFixC) btnFixC.addEventListener('click', function(){
    var d = getDB();
    var arInvs = d.invoices.filter(function(i){ return i.typ === 'ausgang'; });
    var allInvs = d.invoices;
    d.counters.ausgang = arInvs.length + 1;
    d.counters.fortlaufend = allInvs.length + 1;
    if (!d.counters.eingang) d.counters.eingang = 1;
    saveDB(d);
    refreshNumbers();
    this.textContent = '✓ Repariert!';
    this.style.color = 'var(--accent)';
    this.style.borderColor = 'var(--accent)';
    setTimeout(function(){ 
      var b = document.getElementById('btn-fix-counters');
      if (b) { b.textContent = '↺ Zähler reparieren'; b.style.color = 'var(--warn)'; b.style.borderColor = 'var(--warn)'; }
    }, 2000);
  });
  var privatCheck = document.getElementById('inv-privat');
  if (privatCheck) {
    privatCheck.onchange = function(){
      if (this.checked) setPay('kassa'); else setPay('bank');
    };
  }
}

function setTyp(typ) {
  document.getElementById('typ').value = typ;
  var arBtn = document.getElementById('toggle-ar');
  var erBtn = document.getElementById('toggle-er');
  if (!arBtn) return;
  if (typ === 'ausgang') {
    arBtn.style.background = 'var(--accent)'; arBtn.style.color = '#fff';
    erBtn.style.background = '#f0f0ec'; erBtn.style.color = 'var(--t2)';
    document.getElementById('typ-label').textContent = 'Ausgangsrechnung';
    document.getElementById('partner-card-title').textContent = 'Kunde';
    document.getElementById('plbl').textContent = 'Bestehenden Kunden wählen';
    document.getElementById('btn-new-partner-inline').textContent = '+ Neuen Kunden anlegen';
  } else {
    erBtn.style.background = 'var(--accent)'; erBtn.style.color = '#fff';
    arBtn.style.background = '#f0f0ec'; arBtn.style.color = 'var(--t2)';
    document.getElementById('typ-label').textContent = 'Eingangsrechnung';
    document.getElementById('partner-card-title').textContent = 'Lieferant';
    document.getElementById('plbl').textContent = 'Bestehenden Lieferanten wählen';
    document.getElementById('btn-new-partner-inline').textContent = '+ Neuen Lieferanten anlegen';
  }
  updateFT();
  // Show/hide AR vs ER form
  var arForm = document.getElementById('ar-form');
  var erForm = document.getElementById('er-form');
  var saveBtn = document.getElementById('btn-save-inv');
  var rnrLabel = document.getElementById('rnr-label');
  if (arForm && erForm) {
    if (typ === 'ausgang') {
      arForm.style.display = 'block';
      erForm.style.display = 'none';
      if (saveBtn) saveBtn.style.display = '';
      if (rnrLabel) rnrLabel.textContent = 'Rechnungsnummer (AR)';
    } else {
      arForm.style.display = 'none';
      erForm.style.display = 'block';
      if (saveBtn) saveBtn.style.display = 'none';
      if (rnrLabel) rnrLabel.textContent = 'Rechnungsnummer (ER)';
      wireERForm();
    }
  }
}

function wireERForm() {
  // Upload
  var drop = document.getElementById('er-upload-drop');
  var fileIn = document.getElementById('er-upload-file');
  if (drop && !drop._wired) {
    drop._wired = true;
    drop.addEventListener('click', function(){ fileIn.click(); });
    drop.addEventListener('dragover', function(e){ e.preventDefault(); drop.style.borderColor='var(--accent)'; });
    drop.addEventListener('dragleave', function(){ drop.style.borderColor=''; });
    drop.addEventListener('drop', function(e){ e.preventDefault(); drop.style.borderColor=''; handleERFile(e.dataTransfer.files[0]); });
    fileIn.addEventListener('change', function(){ handleERFile(this.files[0]); });
  }
  // Auto-calculate amounts
  // All fields trigger info update
  var erNetto  = document.getElementById('er-netto');
  var erPct    = document.getElementById('er-ust-pct');
  var erUstAmt = document.getElementById('er-ust-amt');
  var erBrutto = document.getElementById('er-brutto');
  if (erNetto)  erNetto.oninput  = calcERAmounts;
  if (erPct)    erPct.oninput    = calcERAmounts;
  if (erUstAmt) erUstAmt.oninput = updateERInfo;
  if (erBrutto) erBrutto.oninput = updateERInfo;
  // Save button
  var saveBtn = document.getElementById('btn-er-save');
  if (saveBtn) saveBtn.onclick = function(){ saveER(); };
  var resetBtn = document.getElementById('btn-er-reset');
  if (resetBtn) resetBtn.onclick = function(){ resetERForm(); };
  // Lieferant dropdown
  var erPartner = document.getElementById('er-partner');
  if (erPartner) erPartner.onchange = function(){
      var d = getDB(), p = d.lieferanten.find(function(l){ return l.id===this.value; }.bind(this));
      if (p) document.getElementById('er-lief-name').value = p.name;
    };
  // Populate lieferanten dropdown
  if (erPartner) {
    var d = getDB();
    erPartner.innerHTML = '<option value="">-- Bitte wählen --</option>' +
      d.lieferanten.map(function(l){ return '<option value="'+l.id+'">'+esc(l.name)+'</option>'; }).join('');
  }
  // New Lieferant inline
  var btnNewL = document.getElementById('btn-new-lief-inline');
  if (btnNewL) btnNewL.onclick = function(){ openLiefModal(); };
}

function handleERFile(file) {
  if (!file) return;
  var prev = document.getElementById('er-upload-preview');
  if (prev) prev.innerHTML = '&#128196; ' + esc(file.name) + ' (' + (file.size/1024).toFixed(0) + ' KB) <span style="color:var(--t3);font-size:11px">— wird beim Speichern angehängt</span>';
  window._erFile = file;
  // Read as base64 to store in invoice
  var reader = new FileReader();
  reader.onload = function(e) {
    window._erFileB64 = e.target.result;  // full data URL
    window._erFileName = file.name;
    window._erFileType = file.type;
  };
  reader.readAsDataURL(file);
}

function calcERAmounts() {
  var pct  = parseFloat(document.getElementById('er-ust-pct').value) || 20;
  var nt   = parseFloat(document.getElementById('er-netto').value)   || 0;
  var info = document.getElementById('er-betrag-info');
  var r    = pct / 100;

  if (nt > 0) {
    // Always calculate USt and Brutto from Netto
    var calcUa = Math.round(nt * r * 100) / 100;
    var calcBr = Math.round((nt + calcUa) * 100) / 100;
    // Set calculated values — user can then override them
    document.getElementById('er-ust-amt').value = calcUa.toFixed(2);
    document.getElementById('er-brutto').value  = calcBr.toFixed(2);
    if (info) {
      info.style.display = 'block';
      info.textContent = 'Netto: ' + fmt(nt) + '  |  USt. (' + pct + '%): ' + fmt(calcUa) + '  |  Brutto: ' + fmt(calcBr);
    }
  } else {
    document.getElementById('er-ust-amt').value = '';
    document.getElementById('er-brutto').value  = '';
    if (info) info.style.display = 'none';
  }
}

function updateERInfo() {
  // Called when USt or Brutto is manually edited - just update the info display
  var nt  = parseFloat(document.getElementById('er-netto').value)   || 0;
  var ua  = parseFloat(document.getElementById('er-ust-amt').value) || 0;
  var br  = parseFloat(document.getElementById('er-brutto').value)  || 0;
  var pct = parseFloat(document.getElementById('er-ust-pct').value) || 20;
  var info = document.getElementById('er-betrag-info');
  if (info && (nt || ua || br)) {
    info.style.display = 'block';
    info.textContent = 'Netto: ' + fmt(nt) + '  |  USt. (' + pct + '%): ' + fmt(ua) + '  |  Brutto: ' + fmt(br);
  }
}

function saveER() {
  var nr = '';  // ER haben keine Rechnungsnummer
  var lief = document.getElementById('er-lief-name').value.trim() ||
    (function(){ var s=document.getElementById('er-partner'); return s&&s.selectedIndex>0?s.options[s.selectedIndex].text:''; })();
  var netto  = parseFloat(document.getElementById('er-netto').value)   || 0;
  var ust    = parseFloat(document.getElementById('er-ust-amt').value) || 0;
  var brutto = parseFloat(document.getElementById('er-brutto').value)  || 0;
  var pct    = parseFloat(document.getElementById('er-ust-pct').value) || 20;
  var datum  = document.getElementById('er-datum').value;
  var faellig= document.getElementById('er-faellig').value;
  var status = document.getElementById('er-status').value;
  var notizen= document.getElementById('er-notizen').value;

  if (!netto) { alert('Bitte Nettobetrag eingeben'); return; }
  // If USt or Brutto not filled, calculate from Netto
  if (!ust)    ust    = Math.round(netto * pct/100 * 100) / 100;
  if (!brutto) brutto = Math.round((netto + ust) * 100) / 100;

  // ER: fortlaufend still increments for internal tracking
  var raw2 = localStorage.getItem('buchpro_v1');
  var dd = raw2 ? JSON.parse(raw2) : {};
  if (!dd.counters) dd.counters = {};
  var zaER = (document.getElementById('zahlungsart')||{value:'bank'}).value;
  var lfdKeyER = zaER==='kassa'?'lfd_kassa':'lfd_bank';
  dd.counters[lfdKeyER] = (dd.counters[lfdKeyER]||1) + 1;
  localStorage.setItem('buchpro_v1', JSON.stringify(dd));

  // Read FRESH from localStorage AFTER nextNum incremented the counter
  var d = getDB();
  var inv = {
    id: uid(), typ: 'eingang', nummer: nr,
    lfd_nr: (document.getElementById('lfd-nr')||{value:''}).value.replace('lfd. ','').trim(),
    zahlungsart: document.getElementById('zahlungsart').value,
    partner_name: lief, partner_info: lief,
    datum: datum, faellig: faellig, status: status, notizen: notizen,
    er_liefnr: (document.getElementById('er-liefnr')||{}).value || '',
    items: [{titel:'Eingangsrechnung', desc:'', menge:1, preis:netto, ust:pct}],
    er_netto: netto, er_ust: ust, er_brutto: brutto, er_ust_pct: pct,
    materialkosten: 0, mat_auto: false,
    file_b64: window._erFileB64 || null,
    file_name: window._erFileName || null,
    file_type: window._erFileType || null,
    erstellt: new Date().toISOString()
  };

  d.invoices.push(inv);
  saveDB(d);
  refreshNumbers();

  document.getElementById('f-alerts').innerHTML = '<div class="alert success">&#10003; Eingangsrechnung gespeichert!</div>';
  resetERForm();
  refreshNumbers();
  setTimeout(function(){ SP('eingang'); }, 1200);
}

function resetERForm() {
  var now = new Date().toISOString().split('T')[0];
  var due = new Date(Date.now()+14*86400000).toISOString().split('T')[0];
  ['er-datum','er-faellig'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=id==='er-datum'?now:due; });
  ['er-netto','er-ust-amt','er-brutto','er-notizen','er-lief-name','er-liefnr'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
  var ep = document.getElementById('er-ust-pct'); if(ep) ep.value='20';
  var es = document.getElementById('er-status'); if(es) es.value='offen';
  var ep2 = document.getElementById('er-partner'); if(ep2) ep2.value='';
  var info = document.getElementById('er-betrag-info'); if(info) info.style.display='none';
  var prev = document.getElementById('er-upload-preview'); if(prev) prev.textContent='';
  window._erFile = null; window._erFileB64 = null; window._erFileName = null;
}

function setKassaTyp(typ) {
  var ktEl = document.getElementById('kassa-typ');
  var barBtn = document.getElementById('toggle-bar');
  var bankomatBtn = document.getElementById('toggle-bankomat');
  if (!ktEl) return;
  ktEl.value = typ;
  if (typ === 'bankomat') {
    if (bankomatBtn) { bankomatBtn.style.background = 'var(--accent)'; bankomatBtn.style.color = '#fff'; }
    if (barBtn) { barBtn.style.background = '#f0f0ec'; barBtn.style.color = 'var(--t2)'; }
  } else {
    if (barBtn) { barBtn.style.background = 'var(--accent)'; barBtn.style.color = '#fff'; }
    if (bankomatBtn) { bankomatBtn.style.background = '#f0f0ec'; bankomatBtn.style.color = 'var(--t2)'; }
  }
}

function setPay(pay) {
  document.getElementById('zahlungsart').value = pay;
  var bankBtn = document.getElementById('toggle-bank');
  var kassaBtn = document.getElementById('toggle-kassa');
  var bankomatRow = document.getElementById('bankomat-row');
  if (!bankBtn) return;
  if (pay === 'bank') {
    bankBtn.style.background = 'var(--accent)'; bankBtn.style.color = '#fff';
    kassaBtn.style.background = '#f0f0ec'; kassaBtn.style.color = 'var(--t2)';
    document.getElementById('pay-label').textContent = 'Banküberweisung';
    if (bankomatRow) bankomatRow.style.display = 'none';
    setKassaTyp('bar');
  } else {
    kassaBtn.style.background = 'var(--accent)'; kassaBtn.style.color = '#fff';
    bankBtn.style.background = '#f0f0ec'; bankBtn.style.color = 'var(--t2)';
    document.getElementById('pay-label').textContent = 'Barzahlung / Kassa';
    if (bankomatRow) bankomatRow.style.display = '';
  }
  refreshNumbers();
}

function refreshNumbers() {
  var typ = document.getElementById('typ') ? document.getElementById('typ').value : 'ausgang';
  var za = (document.getElementById('zahlungsart')||{value:'bank'}).value;
  var raw = localStorage.getItem('buchpro_v1');
  var db = raw ? JSON.parse(raw) : {};
  if (!db.counters) db.counters = {};
  var rnrEl  = document.getElementById('rnr');
  var rnrWrap = rnrEl ? rnrEl.closest('.fg') : null;
  var lfdEl  = document.getElementById('lfd-nr');
  var lfdKey = za === 'kassa' ? 'lfd_kassa' : 'lfd_bank';
  var lfdNum = db.counters[lfdKey] || 1;
  var kbEl  = document.getElementById('kassa-beleg-nr');
  var kbRow = document.getElementById('kassa-beleg-row');
  var kbNum = db.counters.kassenbeleg || 1;

  if (typ === 'eingang') {
    if (rnrWrap) rnrWrap.style.display = 'none';
    if (lfdEl) lfdEl.value = 'lfd. ' + String(lfdNum).padStart(3,'0');
    if (kbRow) kbRow.style.display = 'none';
  } else {
    if (rnrWrap) rnrWrap.style.display = '';
    if (rnrEl) rnrEl.value = previewNum(typ);
    if (lfdEl) lfdEl.value = 'lfd. ' + String(lfdNum).padStart(3,'0');
    if (kbRow) kbRow.style.display = (za === 'kassa') ? '' : 'none';
    if (kbEl && za === 'kassa' && !editId) kbEl.value = String(kbNum).padStart(4, '0');
  }
}

function updateFT() {
  var typ = document.getElementById('typ').value, d = getDB();
  var partners = typ === 'ausgang' ? d.kunden : d.lieferanten;
  var sel = document.getElementById('partner');
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="">-- Bitte wählen --</option>' +
    partners.map(function(p){ return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
  if (cur) sel.value = cur;
  if (!editId) refreshNumbers();
}

function fillPD() {
  var typEl = document.getElementById('typ');
  var partnerEl = document.getElementById('partner');
  var detail = document.getElementById('partner-detail');
  var infoEl = document.getElementById('partner-info-display');
  if (!typEl || !partnerEl || !detail || !infoEl) return;
  var typ = typEl.value;
  var id  = partnerEl.value;
  if (!id) { detail.style.display = 'none'; return; }
  var d = getDB();
  var list = typ === 'ausgang' ? d.kunden : d.lieferanten;
  var p = list.find(function(x){ return x.id === id; });
  if (!p) { detail.style.display = 'none'; return; }
  var pinfo = document.getElementById('pinfo');
  if (pinfo) pinfo.value = p.name + (p.adresse ? '\n' + p.adresse : '');
  var privatBadge = p.privat
    ? '<span style="display:inline-block;margin-left:8px;background:#FAEEDA;color:#633806;font-size:11px;padding:2px 10px;border-radius:20px;font-family:sans-serif;border:1px solid #FAC775;font-weight:500">Privatkunde/Barzahler</span>'
    : '';
  infoEl.innerHTML =
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">' +
      '<strong style="font-size:14px">' + esc(p.name) + '</strong>' + privatBadge +
    '</div>' +
    (p.adresse ? '<div style="color:#666;margin-top:3px">' + esc(p.adresse.replace(/\n/g, ', ')) + '</div>' : '') +
    (p.uid   ? '<div style="color:#999;font-size:12px">UID: ' + esc(p.uid) + '</div>' : '') +
    (p.email  ? '<div style="color:#999;font-size:12px">' + esc(p.email) + '</div>' : '');
  detail.style.display = 'block';
  var invPrivat = document.getElementById('inv-privat');
  if (invPrivat) invPrivat.checked = !!p.privat;
  if (p.privat) { setPay('kassa'); }
}

function openInlineKundeModal() {
  var typ = document.getElementById('typ').value;
  var label = typ === 'ausgang' ? 'Kunden' : 'Lieferanten';
  var col   = typ === 'ausgang' ? 'kunden' : 'lieferanten';
  document.getElementById('modal-body').innerHTML =
    '<h3>Neuer ' + label + '</h3>' +
    '<div class="fg"><label>Name *</label><input type="text" id="ik-name"></div>' +
    '<div class="fg"><label>Adresse</label><textarea id="ik-adr"></textarea></div>' +
    '<div class="fr c2"><div class="fg"><label>UID</label><input id="ik-uid" type="text"></div><div class="fg"><label>E-Mail</label><input id="ik-email" type="email"></div></div>' +

    '<div style="text-align:right;margin-top:1rem"><button class="btn primary" id="btn-ik-save">Speichern</button></div>';
  openModal();
  document.getElementById('btn-ik-save').addEventListener('click', function(){
    var name = document.getElementById('ik-name').value.trim();
    if (!name) { alert('Name eingeben'); return; }
    var d = getDB();
    var newP = {id:uid(), name:name, adresse:document.getElementById('ik-adr').value, uid:document.getElementById('ik-uid').value, email:document.getElementById('ik-email').value};
    d[col].push(newP); saveDB(d);
    closeModal();
    updateFT();
    document.getElementById('partner').value = newP.id;
    fillPD();
  });
}

function calcMat() { renderSum(); }

function addItem(type) {
  var defaultTitel = (document.getElementById('typ') && document.getElementById('typ').value === 'ausgang') ? 'Sprenglerarb.: ' : '';
  itemsData.push({titel:defaultTitel,desc:'',menge:1,preis:0,ust:20,type:type||'stunden',djevad_h:0,helmut_h:0,fz_marke:'',fz_kz:''});
  renderItems();
}

function removeItem(i) {
  if (itemsData.length === 1) return;
  itemsData.splice(i, 1);
  renderItems();
}

function updateItem(i, f, v) {
  if (f === 'titel' || f === 'desc' || f === 'fz_marke' || f === 'fz_kz') {
    itemsData[i][f] = v;
  } else {
    itemsData[i][f] = parseFloat(v) || 0;
  }
  renderSum();
}

function renderItems() {
  var rows = itemsData.map(function(it, i){
    var lineTotal = it.menge * it.preis * (1 + it.ust/100);
    var bg = i % 2 === 1 ? 'background:#fafafa' : 'background:#fff';
    return (
      // Fahrzeug row
      '<tr style="' + bg + '">' +
        '<td colspan="7" style="padding:4px 8px 0;border-bottom:none">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-family:sans-serif;font-size:10px;color:#aaa;white-space:nowrap">Fahrzeug:</span>' +
            '<input type="text" class="item-fz-marke" data-i="' + i + '" value="' + esc(it.fz_marke||'') + '" placeholder="Modell (optional)" style="flex:1;padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif">' +
            '<span style="font-family:sans-serif;font-size:10px;color:#aaa;white-space:nowrap">KZ:</span>' +
            '<input type="text" class="item-fz-kz" data-i="' + i + '" value="' + esc(it.fz_kz||'') + '" placeholder="Kennzeichen" style="width:120px;padding:4px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif">' +
          '</div>' +
        '</td>' +
      '</tr>' +
      // Label row: gray "Beschreibung" + position badges
      '<tr style="' + bg + '">' +
        '<td colspan="7" style="padding:6px 8px 0;border-bottom:none">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">' +
            '<div style="font-size:10px;font-weight:500;color:#888;font-family:sans-serif;text-transform:uppercase;letter-spacing:.5px;background:#f0f0ec;padding:3px 8px;border-radius:4px;display:inline-block">Beschreibung</div>' +
            getPosBadges().map(function(b){ return '<button type="button" class="pos-badge" data-i="' + i + '" data-val="'+esc(b)+'" style="font-size:11px;padding:2px 10px;border-radius:20px;border:1px solid #ddd;background:#fff;cursor:pointer;font-family:sans-serif;color:#555">'+esc(b)+'</button>'; }).join('') +
          '</div>' +
        '</td>' +
      '</tr>' +
      // Input row: full-width Beschreibung field
      '<tr style="' + bg + '">' +
        '<td colspan="6" style="padding:0 8px 4px">' +
          '<textarea class="item-titel" list="besch-suggestions" autocomplete="off" data-i="' + i + '" placeholder="z.B. Ölwechsel, Bremsbeläge tauschen ..." style="width:100%;border-top-left-radius:0;height:36px;resize:none;padding:6px 8px;font-family:inherit;font-size:13px">' + esc(it.titel||'') + '</textarea>' +
        '</td>' +
        '<td rowspan="2" style="vertical-align:middle;' + bg + ';padding:4px">' +
          '<button class="btn item-del" data-i="' + i + '" style="padding:2px 6px;font-size:11px">&#x2715;</button>' +
        '</td>' +
      '</tr>' +
      // Detail row: depends on type
      (it.type === 'sonstig' ?
        '<tr style="' + bg + ';border-bottom:2px solid #e0e0d8">' +
          '<td colspan="2" style="padding:0 8px 8px">' +
            '<div style="font-family:sans-serif;font-size:11px;color:#888;margin-bottom:3px">Betrag (€)</div>' +
            '<input type="number" class="item-preis" data-i="' + i + '" value="' + (it.preis||'') + '" min="0" step="0.01" placeholder="0.00" style="width:100%">' +
          '</td>' +
          '<td colspan="2" style="padding:0 8px 8px">' +
            '<div style="font-family:sans-serif;font-size:11px;color:#888;margin-bottom:3px">USt. %</div>' +
            '<div style="position:relative;display:flex;align-items:center">' +
            '<input type="number" class="item-ust" data-i="' + i + '" value="' + it.ust + '" min="0" max="100" style="width:100%;padding-right:20px">' +
            '<span style="position:absolute;right:7px;font-family:sans-serif;font-size:12px;color:#999;pointer-events:none">%</span>' +
            '</div>' +
          '</td>' +
          '<td></td>' +
          '<td style="text-align:right;font-family:sans-serif;font-size:12px;color:#333;white-space:nowrap;padding:0 8px 8px;vertical-align:bottom">' + fmt(it.preis*(1+it.ust/100)) + '</td>' +
        '</tr>'
      :
        '<tr style="' + bg + ';border-bottom:2px solid #e0e0d8">' +
          '<td style="padding:0 8px 8px">' +
            '<span style="font-family:sans-serif;font-size:12px;font-weight:500;color:#555;background:#f0f0ec;padding:5px 10px;border-radius:6px;border:1px solid #ddd;display:inline-block">Stunden</span>'+
          '</td>' +
          '<td style="padding:0 8px 8px">' +
            '<input type="number" class="item-menge" data-i="' + i + '" value="' + it.menge + '" min="0" step="0.01" style="width:100%">' +
          '</td>' +
          '<td style="padding:0 8px 8px">' +
            '<input type="number" class="item-preis" list="preis-suggestions" data-i="' + i + '" value="' + (it.preis||'') + '" min="0" step="0.01" placeholder="€" style="width:100%">' +
          '</td>' +
          '<td style="padding:0 8px 8px">' +
            '<div style="position:relative;display:flex;align-items:center">' +
            '<input type="number" class="item-ust" data-i="' + i + '" value="' + it.ust + '" min="0" max="100" style="width:100%;padding-right:20px">' +
            '<span style="position:absolute;right:7px;font-family:sans-serif;font-size:12px;color:#999;pointer-events:none">%</span>' +
            '</div>' +
          '</td>' +
          '<td></td>' +
          '<td style="text-align:right;font-family:sans-serif;font-size:12px;color:#333;white-space:nowrap;padding:0 8px 8px;vertical-align:bottom">' + fmt(lineTotal) + '</td>' +
      '</tr>' +
      '<tr style="' + bg + '">' +
        '<td colspan="2" style="padding:0 8px 4px">' +
          '<input type="text" class="item-extra-label" data-i="' + i + '" value="' + esc(it.extraLabel||'') + '" placeholder="Sonstige Bezeichnung..." style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif">' +
        '</td>' +
        '<td style="padding:0 8px 4px">' +
          '<input type="number" class="item-extra-betrag" data-i="' + i + '" value="' + (it.extraBetrag||'') + '" placeholder="€" min="0" step="0.01" style="width:100%">' +
        '</td>' +
        '<td style="padding:0 8px 4px">' +
          '<div style="position:relative;display:flex;align-items:center">' +
          '<input type="number" class="item-extra-ust" data-i="' + i + '" value="' + (it.extraUst!=null?it.extraUst:20) + '" min="0" max="100" style="width:100%;padding-right:20px">' +
          '<span style="position:absolute;right:7px;font-family:sans-serif;font-size:12px;color:#999;pointer-events:none">%</span>' +
          '</div>' +
        '</td>' +
        '<td></td>' +
        '<td style="text-align:right;font-family:sans-serif;font-size:12px;color:#333;white-space:nowrap;padding:0 8px 4px;vertical-align:bottom">' + (it.extraBetrag ? fmt(it.extraBetrag*(1+(it.extraUst!=null?it.extraUst:20)/100)) : '') + '</td>' +
      '</tr>' +
      '<tr style="' + bg + ';border-bottom:2px solid #e0e0d8">' +
        '<td colspan="7" style="padding:0 8px 8px">' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#f5f5f2;border-radius:6px;padding:5px 10px;border:1px solid #e5e5e0">' +
            '<span style="font-family:sans-serif;font-size:10px;font-weight:600;color:#999;text-transform:uppercase;letter-spacing:.5px">Intern – Mitarbeiter:</span>' +
            '<label style="display:flex;align-items:center;gap:5px;font-family:sans-serif;font-size:12px;color:#555">' +
              '<span style="font-weight:500">Dž</span>' +
              '<input type="number" class="item-djevad-h" data-i="' + i + '" value="' + (it.djevad_h||0) + '" min="0" step="0.5" style="width:60px;padding:3px 6px;border:1px solid #ddd;border-radius:5px;font-size:12px">' +
              '<span style="color:#888">h</span>' +
            '</label>' +
            '<label style="display:flex;align-items:center;gap:5px;font-family:sans-serif;font-size:12px;color:#555">' +
              '<span style="font-weight:500">Helmut</span>' +
              '<input type="number" class="item-helmut-h" data-i="' + i + '" value="' + (it.helmut_h||0) + '" min="0" step="0.5" style="width:60px;padding:3px 6px;border:1px solid #ddd;border-radius:5px;font-size:12px">' +
              '<span style="color:#888">h</span>' +
            '</label>' +
          '</div>' +
        '</td>' +
      '</tr>'
      )
    );
  }).join('');
  if (!document.getElementById('preis-suggestions')) {
    var dl = document.createElement('datalist');
    dl.id = 'preis-suggestions';
    dl.innerHTML = '<option value="80"><option value="90"><option value="100">';
    document.body.appendChild(dl);
  }
  document.getElementById('items-body').innerHTML = rows;
  document.querySelectorAll('.item-titel').forEach(function(el){
    el.addEventListener('input', function(){ updateItem(parseInt(this.dataset.i), 'titel', this.value); });
  });
  document.querySelectorAll('.pos-badge').forEach(function(btn){
    btn.addEventListener('click', function(){
      var i = parseInt(this.dataset.i);
      var val = this.dataset.val;
      // Always read directly from the input field — not from itemsData
      var input = document.querySelector('.item-titel[data-i="' + i + '"]');
      var cur = input ? input.value : (itemsData[i].titel || '');
      var sep = (cur && !cur.endsWith(' ')) ? ' ' : '';
      var newVal = cur + sep + val;
      // Update both the input and itemsData
      if (input) input.value = newVal;
      itemsData[i].titel = newVal;
      renderSum();
    });
  });
  document.querySelectorAll('.item-desc').forEach(function(el){
    el.addEventListener('input', function(){ updateItem(parseInt(this.dataset.i), 'desc', this.value); });
  });

  document.querySelectorAll('.item-menge').forEach(function(el){
    el.addEventListener('input', function(){ updateItem(parseInt(this.dataset.i), 'menge', this.value); });
  });
  document.querySelectorAll('.item-preis').forEach(function(el){
    el.addEventListener('input', function(){ updateItem(parseInt(this.dataset.i), 'preis', this.value); });
  });
  document.querySelectorAll('.item-ust').forEach(function(el){
    el.addEventListener('input', function(){ updateItem(parseInt(this.dataset.i), 'ust', this.value); });
  });
  document.querySelectorAll('.item-del').forEach(function(el){
    el.addEventListener('click', function(){ removeItem(parseInt(this.dataset.i)); });
  });
  document.querySelectorAll('.item-extra-label').forEach(function(el){
    el.addEventListener('input', function(){ updateItemExtra(parseInt(this.dataset.i), 'extraLabel', this.value); });
  });
  document.querySelectorAll('.item-extra-betrag').forEach(function(el){
    el.addEventListener('input', function(){ updateItemExtra(parseInt(this.dataset.i), 'extraBetrag', this.value); });
  });
  document.querySelectorAll('.item-extra-ust').forEach(function(el){
    el.addEventListener('input', function(){ updateItemExtra(parseInt(this.dataset.i), 'extraUst', this.value); });
  });
  document.querySelectorAll('.item-djevad-h').forEach(function(el){
    el.addEventListener('input', function(){ updateItem(parseInt(this.dataset.i), 'djevad_h', this.value); });
  });
  document.querySelectorAll('.item-helmut-h').forEach(function(el){
    el.addEventListener('input', function(){ updateItem(parseInt(this.dataset.i), 'helmut_h', this.value); });
  });
  document.querySelectorAll('.item-fz-marke').forEach(function(el){
    el.addEventListener('input', function(){ updateItem(parseInt(this.dataset.i), 'fz_marke', this.value); });
  });
  document.querySelectorAll('.item-fz-kz').forEach(function(el){
    el.addEventListener('input', function(){ updateItem(parseInt(this.dataset.i), 'fz_kz', this.value); });
  });
  if (document.getElementById('mat-auto') && document.getElementById('mat-auto').checked) calcMat();
  else renderSum();
  updateBeschDatalist();
}

function renderSum() {
  var nStunden = itemsData.reduce(function(s,it){ return s + it.menge*it.preis; }, 0);
  var nExtra   = itemsData.reduce(function(s,it){ return s + (it.extraBetrag||0); }, 0);
  var n = nStunden + nExtra;
  var v = itemsData.reduce(function(s,it){
    return s + it.menge*it.preis*it.ust/100 + (it.extraBetrag||0)*(it.extraUst!=null?it.extraUst:20)/100;
  }, 0);

  // Materialkosten: 6% vom NETTO
  var matAuto = document.getElementById('mat-auto');
  var matManEl = document.getElementById('mat-manuell');
  var matVal = 0;
  var matInfoEl = document.getElementById('mat-info');
  if (matAuto && matAuto.checked) {
    matVal = Math.round(n * 0.06 * 100) / 100;
    if (matInfoEl) matInfoEl.textContent = '6% von Netto ' + fmt(n) + ' = ' + fmt(matVal) + ' — wird als Position hinzugefügt';
  } else if (matManEl && parseFloat(matManEl.value) > 0) {
    matVal = parseFloat(matManEl.value);
    if (matInfoEl) matInfoEl.textContent = 'Materialkosten ' + fmt(matVal) + ' — wird als Position hinzugefügt';
  } else {
    if (matInfoEl) matInfoEl.textContent = '';
  }

  v += matVal * 0.2;
  var nettoGesamt = n + matVal;
  var gesamt = nettoGesamt + v;

  function M(n){
    var s = fmt(n); // "€ 90,00"
    var parts = s.split(' '); // split on non-breaking space (between € and number)
    if (parts.length < 2) parts = s.split(' ');
    var sym = parts[0]; var num = parts.slice(1).join(' ');
    return '<span style="display:inline-flex;gap:0;min-width:110px;justify-content:flex-end">' +
           '<span style="font-family:Courier New,monospace;font-size:15px;font-weight:500;min-width:20px;text-align:left">' + sym + '</span>' +
           '<span style="font-family:Courier New,monospace;font-size:15px;font-weight:500;min-width:90px;text-align:right">' + num + '</span>' +
           '</span>';
  }
  var matLabel = (document.getElementById('mat-auto') && document.getElementById('mat-auto').checked) ? 'Materialkosten (6%)' : 'Materialkosten';
  var html = '<div class="row"><span>Netto:</span>' + M(n) + '</div>';
  if (matVal > 0) {
    html += '<div class="row"><span>' + matLabel + ':</span>' + M(matVal) + '</div>';
    html += '<div class="row"><span>Netto gesamt:</span>' + M(nettoGesamt) + '</div>';
  }
  var ustRates = [];
  itemsData.forEach(function(it){
    if (it.ust > 0 && ustRates.indexOf(it.ust) === -1) ustRates.push(it.ust);
    var eu = it.extraBetrag ? (it.extraUst != null ? it.extraUst : 20) : 0;
    if (eu > 0 && ustRates.indexOf(eu) === -1) ustRates.push(eu);
  });
  ustRates.sort(function(a,b){return a-b;});
  var ustLabel = ustRates.length > 0 ? 'USt. (' + ustRates.join('/') + '%)' : 'USt.';
  html += '<div class="row"><span>' + ustLabel + ':</span>' + M(v) + '</div>';
  html += '<div class="row total"><span>Gesamtbetrag:</span>' + M(gesamt) + '</div>';
  document.getElementById('items-sum').innerHTML = html;

  var pflicht = document.getElementById('partner-pflicht');
  if (pflicht) pflicht.style.display = gesamt > 400 ? 'inline-block' : 'none';

  var pi = document.getElementById('pinfo').value;
  var partnerVal = (document.getElementById('partner')||{}).value;
  var hasPartner = partnerVal || (pi && pi.trim().length >= 5);
  document.getElementById('f-alerts2').innerHTML = (gesamt > 400 && !hasPartner)
    ? '<div class="alert warning">&#9888; Gesamtbetrag über €400: Kunde/Adresse ist Pflichtfeld!</div>' : '';
}

function saveInvoice() {
  var typ  = document.getElementById('typ').value;
  var pi   = document.getElementById('pinfo').value;
  var sel  = document.getElementById('partner');
  var partnerVal = sel ? sel.value : '';
  var matAuto2 = document.getElementById('mat-auto');
  var matManEl2 = document.getElementById('mat-manuell');
  var itemNetto = itemsData.reduce(function(s,it){ return s + it.menge*it.preis; }, 0);
  var matVal = 0;
  if (matAuto2 && matAuto2.checked) matVal = Math.round(itemNetto * 0.06 * 100) / 100;
  else if (matManEl2 && parseFloat(matManEl2.value) > 0) matVal = parseFloat(matManEl2.value);
  var base = itemsData.reduce(function(s,it){ return s + it.menge*it.preis*(1+it.ust/100); }, 0);
  var gesamt = base + matVal;

  // Validation: partner required if > 400
  var hasPartner = partnerVal || (pi && pi.trim().length >= 5);
  if (gesamt > 400 && !hasPartner) {
    document.getElementById('f-alerts').innerHTML = '<div class="alert danger">&#9888; Gesamtbetrag über €400: Bitte Kunde auswählen oder Adresse eintragen!</div>';
    return;
  }

  var pname = '';
  if (sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) {
    pname = sel.options[sel.selectedIndex].text;
    if (pname === '-- Bitte wählen --') pname = '';
  }
  if (!pname && pi) pname = pi.split('\n')[0];
  // If Privatkunde/Barzahler checked, add to partner_info
  var isPrivat = document.getElementById('inv-privat') && document.getElementById('inv-privat').checked;
  if (isPrivat && pi && pi.indexOf('Privatkunde/Barzahler') === -1) {
    pi = pi + (pi.trim() ? '\n' : '') + 'Privatkunde/Barzahler';
  }

  var nummer;
  if (editId) {
    var dPre = getDB();
    nummer = dPre.invoices.find(function(i){ return i.id===editId; }).nummer;
  } else {
    nextNum(typ);  // increments correct counter based on zahlungsart
    // Use manually entered value from rnr field if present, else use auto-generated
    var rnrFieldVal = (document.getElementById('rnr')||{value:''}).value.trim();
    nummer = rnrFieldVal || String(getDB().counters.ausgang - 1).padStart(2,'0');
  }
  // Read FRESH from localStorage AFTER nextNum incremented the counters
  var d = getDB();
  var inv = {
    id: editId || uid(),
    typ: typ,
    nummer: nummer,
    lfd_nr: (document.getElementById('lfd-nr')||{value:''}).value.replace('lfd. ','').trim(),
    zahlungsart: document.getElementById('zahlungsart').value,
    privatkunde: document.getElementById('inv-privat') ? document.getElementById('inv-privat').checked : false,
    flag_djevad: document.getElementById('inv-djevad') ? document.getElementById('inv-djevad').checked : false,
    flag_helmut: document.getElementById('inv-helmut') ? document.getElementById('inv-helmut').checked : false,
    partner_id: partnerVal,
    partner_name: pname,
    partner_info: pi,
    datum: document.getElementById('datum').value,
    leistungsdatum: document.getElementById('leistungsdatum').value,
    fz_marke: (document.getElementById('fz-marke-inv')||{}).value || '',
    fz_kz: (document.getElementById('fz-kz-inv')||{}).value || '',
    faellig: document.getElementById('faellig').value,
    status: document.getElementById('status').value,
    notizen: document.getElementById('notizen').value,
    kassenbeleg_nr: (document.getElementById('zahlungsart').value === 'kassa')
      ? ((document.getElementById('kassa-beleg-nr')||{value:''}).value || '')
      : '',
    kassa_typ: (document.getElementById('zahlungsart').value === 'kassa')
      ? ((document.getElementById('kassa-typ')||{value:'bar'}).value || 'bar')
      : '',
    items: itemsData.map(function(it){ return Object.assign({}, it); }),
    materialkosten: matVal,
    mat_auto: !!(document.getElementById('mat-auto') && document.getElementById('mat-auto').checked),
    erstellt: new Date().toISOString()
  };
  if (editId) d.invoices = d.invoices.map(function(i){ return i.id===editId ? inv : i; });
  else d.invoices.push(inv);
  // Auto-create Fahrzeug if KZ given and not already exists
  if (inv.fz_kz && inv.fz_kz.trim()) {
    var kzN = inv.fz_kz.trim().toUpperCase().replace(/\s+/g,'');
    if (!d.fahrzeuge.some(function(f){ return (f.kennzeichen||'').toUpperCase().replace(/\s+/g,'')==kzN; })) {
      d.fahrzeuge.push({id:uid(),kundeId:inv.partner_id||'',kundeName:inv.partner_name||'',marke:inv.fz_marke||'',kennzeichen:inv.fz_kz.trim(),vin:'',erstzulassung:'',erstellt:new Date().toISOString()});
    }
  }
  saveDB(d);
  // Save beschreibung history
  itemsData.forEach(function(it){
    if (it.titel && it.titel.trim()) addToBeschHist(it.titel);
  });
  genPDFData(inv);
  document.getElementById('f-alerts').innerHTML = '<div class="alert success">&#10003; Gespeichert & PDF erstellt!</div>';
  refreshNumbers();
  setTimeout(function(){ SP(typ==='ausgang' ? 'ausgang' : 'eingang'); }, 1500);
}

function resetForm() { initForm(); }

// ================================================================
// PDF
// ================================================================
function genPDF(id) {
  var d = getDB(), inv = d.invoices.find(function(i){ return i.id===id; });
  if (!inv) return;
  if (inv.typ === 'eingang' && inv.file_b64) {
    var erPath = localStorage.getItem('bp_path_er');
    if (erPath && window.electronAPI && window.electronAPI.savePdfToPath) {
      var erFilename = (inv.file_name || ('ER_' + (inv.partner_name || 'Rechnung').replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_') + '_' + (inv.datum || '') + '.pdf'));
      var erB64 = inv.file_b64.indexOf(',') !== -1 ? inv.file_b64.split(',')[1] : inv.file_b64;
      window.electronAPI.savePdfToPath(erPath, erFilename, erB64).then(function(result) {
        if (result && result.success) {
          var n = document.createElement('div');
          n.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;background:#0f6e56;color:#fff;padding:12px 20px;border-radius:8px;font-family:sans-serif;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,0.2)';
          n.textContent = '\u2713 Datei gespeichert: ' + result.path;
          document.body.appendChild(n);
          setTimeout(function(){ n.remove(); }, 3500);
        }
      });
    }
    // Open the stored file
    var win = window.open();
    if (win) {
      win.document.write('<iframe src="' + inv.file_b64 + '" width="100%" height="100%" style="border:none;margin:0;padding:0"></iframe>');
      win.document.close();
    }
  } else if (inv.typ === 'ausgang') {
    genPDFData(inv);
  } else {
    alert('Kein PDF für diese Eingangsrechnung gespeichert.');
  }
}

function genPDFData(inv) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({unit:'mm', format:'a4'});

  function numFmt(n) {
    return new Intl.NumberFormat('de-AT', {minimumFractionDigits:2, maximumFractionDigits:2}).format(n);
  }

  var xL = 25;
  var xR = 190;

  // ── Georgia Font laden (Fallback: times) ──────────────────────────
  var georgiaFont = 'times';
  if (_georgiaFontB64) {
    try {
      doc.addFileToVFS('georgia.ttf', _georgiaFontB64);
      doc.addFont('georgia.ttf', 'Georgia', 'normal');
      georgiaFont = 'Georgia';
    } catch(e) {}
  }
  if (_georgiaBoldFontB64) {
    try {
      doc.addFileToVFS('georgiab.ttf', _georgiaBoldFontB64);
      doc.addFont('georgiab.ttf', 'Georgia', 'bold');
    } catch(e) {}
  }

  // ── KOPFZEILE (Georgia, zentriert) ───────────────────────────────
  doc.setTextColor(30, 30, 30);
  doc.setFont(georgiaFont, 'bold');
  doc.setFontSize(24);
  doc.text('KAROSSERIEFACHWERKSTÄTTE', 105, 25, {align:'center'});
  doc.setFontSize(22);
  doc.text('KURT LINDITSCH GMBH', 105, 34, {align:'center'});
  doc.setFont(georgiaFont, 'normal');
  doc.setFontSize(9);
  doc.text('Jägerweg 42, A-8041 GRAZ', 105, 41, {align:'center'});
  doc.text('E-Mail: linditsch@a1.net     Tel.: 0676/343 134 2', 105, 46, {align:'center'});

  // ── Ab jetzt: Times New Roman, Größe 10 ─────────────────────────
  doc.setFont('times', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);

  // ── KUNDENADRESSE ab 5,7cm ───────────────────────────────────────
  var partnerLines = [];
  if (inv.partner_info) {
    inv.partner_info.split('\n').forEach(function(l){ if(l.trim()) partnerLines.push(l.trim()); });
  }
  if (inv.privatkunde && partnerLines.every(function(l){ return l.indexOf('Privatkunde')===-1; })) {
    partnerLines.unshift('Privatkunde/Barzahler');
  }
  if (partnerLines.length === 0 && inv.privatkunde) partnerLines = ['Privatkunde/Barzahler'];
  var yAddr = 64;
  partnerLines.forEach(function(l) {
    doc.text(l, xL, yAddr);
    yAddr += 5;
  });

  // ── DATUM 5,7cm rechtsbündig ─────────────────────────────────────
  doc.text('Graz, ' + fmtD(inv.datum), xR, 57, {align:'right'});

  // ── LEISTUNGSDATUM 9,5cm rechtsbündig ────────────────────────────
  if (inv.leistungsdatum) {
    doc.text('Leistungsdatum: ' + fmtD(inv.leistungsdatum), xR, 95, {align:'right'});
  }

  // ── RECHNUNG NR.: fett, Größe 12, linksbündig ───────────────────
  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  var rNr = inv.nummer || '';
  var nrMatch = rNr.match(/(\d+)$/);
  var nrDisplay = nrMatch ? (parseInt(nrMatch[1]) < 10 ? String(parseInt(nrMatch[1])).padStart(2,'0') : String(parseInt(nrMatch[1]))) : rNr;
  doc.text('Rechnung Nr.: ' + nrDisplay, xL, 100);
  doc.setFont('times', 'normal');
  doc.setFontSize(10);

  // ── TABELLEN-SETUP ───────────────────────────────────────────────
  var matAmt = (inv.materialkosten && inv.materialkosten > 0) ? inv.materialkosten : 0;
  var hasMat = matAmt > 0;
  var mklbl = inv.mat_auto ? '6% Kleinmaterial' : 'Materialkosten';
  var nt = netto(inv), va = vatAmt(inv), totalH = nt + matAmt + va;
  var ustRates = [];
  (inv.items||[]).forEach(function(it){ if(it.ust>0&&ustRates.indexOf(it.ust)===-1) ustRates.push(it.ust); });
  var ustPct = ustRates.length > 0 ? ustRates.join('/') : '20';

  // ── Spalten-Layout (4 Spalten) ───────────────────────────────────
  var colFzEnd = xL + 50;  // 75mm – Ende Fahrzeug-Spalte
  var colAnz   = 155;       // Anzahl-Spalte (zentriert)
  var rowH = 6, hdrH = 8;

  function blackLine() { doc.setDrawColor(30,30,30); doc.setLineWidth(0.225); }

  function getEffCar(it) {
    var m = (it.fz_marke||'').trim(), k = (it.fz_kz||'').trim();
    if (!m && !k) { m = (inv.fz_marke||'').trim(); k = (inv.fz_kz||'').trim(); }
    return {marke:m, kz:k, key:m+'|||'+k};
  }

  // Fahrzeug-Gruppen aufbauen
  var carGroups = [];
  var seenCarKeys = [];
  (inv.items||[]).forEach(function(it) {
    var car = getEffCar(it);
    var idx = seenCarKeys.indexOf(car.key);
    if (idx === -1) {
      seenCarKeys.push(car.key);
      carGroups.push({car:car, items:[]});
      idx = carGroups.length - 1;
    }
    carGroups[idx].items.push(it);
  });

  function buildSubRows(group) {
    var rows = [];
    group.items.forEach(function(it) {
      if (it.titel && it.titel.trim()) rows.push({type:'titel', it:it});
      rows.push({type:'stunden', it:it});
      if (it.extraLabel && it.extraLabel.trim() && it.extraBetrag) rows.push({type:'extra', it:it});
    });
    // KZ liegt immer auf Zeile 2 (Index 1) – Arbeitsstunden darf dort nicht stehen
    if (group.car.kz && rows.length > 0 && rows[0].type === 'titel') {
      rows.splice(1, 0, {type:'pad'});
    }
    // Mindest-Höhe: 2 Zeilen wenn Marke + KZ vorhanden (kein Titel-Fall)
    if (group.car.marke && group.car.kz && rows.length < 2) rows.push({type:'pad'});
    return rows;
  }

  // ── € Ausrichtung: breiteste Zahl vorausberechnen ────────────────
  doc.setFont('times','normal'); doc.setFontSize(10);
  var allAmounts = [];
  carGroups.forEach(function(g) {
    buildSubRows(g).forEach(function(row) {
      if (row.type === 'stunden') allAmounts.push(row.it.menge * row.it.preis * (1 + row.it.ust/100));
      else if (row.type === 'extra') allAmounts.push(row.it.extraBetrag * (1 + (row.it.extraUst!=null?row.it.extraUst:20)/100));
    });
  });
  if (hasMat) allAmounts.push(matAmt);
  allAmounts.push(nt, va, totalH);
  var maxNumW = 0;
  allAmounts.forEach(function(n) { var w = doc.getTextWidth(numFmt(n)); if (w > maxNumW) maxNumW = w; });
  var xEuro = xR - maxNumW - 6;  // € immer an dieser Position

  var tY = 113;

  // ── Grauer Hintergrund nur für Header-Zeile ───────────────────────
  doc.setFillColor(245, 245, 242);
  doc.rect(xL, tY, xR - xL, hdrH, 'F');

  // ── Schwarze Linie unter Header ──────────────────────────────────
  blackLine();
  doc.line(xL, tY + hdrH, xR, tY + hdrH);

  // ── Header-Text (vertikal zentriert) ────────────────────────────
  var hdrTextY = tY + hdrH / 2 + 1.5;  // Baseline für visuell zentrierten 10pt-Text
  doc.setFont('times','normal'); doc.setFontSize(10);
  doc.text('Fahrzeug',     xL + 2,      hdrTextY);
  doc.text('Beschreibung', colFzEnd + 2, hdrTextY);
  doc.text('Anzahl',       colAnz,       hdrTextY, {align:'center'});
  doc.text('Betrag (€)',   xR - 2,       hdrTextY, {align:'right'});

  // ── Content-Zeilen ───────────────────────────────────────────────
  var yCur = tY + hdrH;

  carGroups.forEach(function(group) {
    var car = group.car;
    var subRows = buildSubRows(group);

    doc.setFont('times','normal'); doc.setFontSize(10);
    if (car.marke) doc.text(car.marke, xL + 2, yCur + rowH - 2);
    if (car.kz)    doc.text(car.kz,    xL + 2, yCur + 2*rowH - 2);

    for (var ri = 0; ri < subRows.length; ri++) {
      var row = subRows[ri];
      var rowY = yCur + ri * rowH + rowH - 2;
      doc.setFont('times','normal'); doc.setFontSize(10);
      if (row.type === 'titel') {
        doc.text((row.it.titel||'').trim(), colFzEnd + 2, rowY);
      } else if (row.type === 'stunden') {
        var menge = parseFloat(row.it.menge)||1;
        doc.text(menge===1?'Arbeitsstunde':'Arbeitsstunden', colFzEnd + 2, rowY);
        doc.text(String(row.it.menge), colAnz, rowY, {align:'center'});
        var lt = row.it.menge * row.it.preis * (1 + row.it.ust/100);
        doc.text('€', xEuro, rowY);
        doc.text(numFmt(lt), xR - 2, rowY, {align:'right'});
      } else if (row.type === 'extra') {
        var et = row.it.extraBetrag * (1 + (row.it.extraUst!=null?row.it.extraUst:20)/100);
        doc.text((row.it.extraLabel||'').trim(), colFzEnd + 2, rowY);
        doc.text('€', xEuro, rowY);
        doc.text(numFmt(et), xR - 2, rowY, {align:'right'});
      }
    }
    yCur += subRows.length * rowH;
  });

  // ── Materialkosten-Zeile ─────────────────────────────────────────
  if (hasMat) {
    doc.setFont('times','normal'); doc.setFontSize(10);
    doc.text(mklbl, colFzEnd + 2, yCur + rowH - 2);
    doc.text('€', xEuro, yCur + rowH - 2);
    doc.text(numFmt(matAmt), xR - 2, yCur + rowH - 2, {align:'right'});
    yCur += rowH;
  }

  // ── Summenzeilen (kein Rahmen, nur Linien bei Netto + Gesamt) ────
  var ySumStart = yCur + 4;
  var yNettoY   = ySumStart + rowH - 2;
  var yMwstY    = ySumStart + 2*rowH - 2;
  var yGesamtY  = ySumStart + 3*rowH - 2;
  var yGesamtBottom = ySumStart + 3*rowH;

  doc.setFont('times','normal'); doc.setFontSize(10);
  doc.text('Netto',              xL + 2, yNettoY);
  doc.text('€', xEuro, yNettoY);
  doc.text(numFmt(nt),    xR - 2, yNettoY, {align:'right'});
  // Linie unter Netto: volle Breite (Netto bis Betrag)
  blackLine();
  doc.line(xL, yNettoY + 1, xR, yNettoY + 1);

  doc.text('MwSt. '+ustPct+'%', xL + 2, yMwstY);
  doc.text('€', xEuro, yMwstY);
  doc.text(numFmt(va),    xR - 2, yMwstY, {align:'right'});
  // Linie unter MwSt-Betrag
  blackLine();
  doc.line(xEuro - 1, yMwstY + 1, xR, yMwstY + 1);

  doc.setFont('times','bold');
  doc.text('Gesamtbetrag',  xL + 2, yGesamtY);
  doc.text('€', xEuro, yGesamtY);
  doc.text(numFmt(totalH), xR - 2, yGesamtY, {align:'right'});
  doc.setFont('times','normal');
  // Doppelte Linie unter Gesamtbetrag
  blackLine();
  doc.line(xEuro - 1, yGesamtY + 1, xR, yGesamtY + 1);
  doc.line(xEuro - 1, yGesamtY + 2, xR, yGesamtY + 2);

  // ── BEZAHLT IN BAR / BANKOMAT (alle Kassa-Zahlungen) ────────────
  if (inv.zahlungsart === 'kassa') {
    doc.setFont('times','normal'); doc.setFontSize(10); doc.setTextColor(30,30,30);
    var kbNr = inv.kassenbeleg_nr || '';
    var bezahltText = (inv.kassa_typ === 'bankomat')
      ? 'Bezahlt am ' + fmtD(inv.datum) + ' mit Bankomat  -  Kassenbeleg Nr.: ' + kbNr
      : 'Bezahlt in Bar am ' + fmtD(inv.datum) + '  -  Kassenbeleg Nr.: ' + kbNr;
    doc.text(bezahltText, xL, yGesamtBottom + 1 + 20);
  }

  // ── FUßZEILE ab 26,4cm ───────────────────────────────────────────
  doc.setFont(georgiaFont,'normal'); doc.setFontSize(10); doc.setTextColor(30,30,30);
  doc.text('Zahlbar sofort nach Erhalt der Rechnung netto Kassa!', 105, 264, {align:'center'});
  doc.text('Bankverbindung: Steierm. Sparkasse Graz, IBAN: AT072081500000073536, BIC: STSPAT2GXXX', 105, 269, {align:'center'});
  doc.text('UID-Nr. ATU 58185458, LG f. ZRS GRAZ, FN 251792h', 105, 274, {align:'center'});

  // ── Dateiname ─────────────────────────────────────────────────────
  var fnNr = inv.nummer || '';
  var fnKunde = '';
  if (!inv.privatkunde && inv.partner_name) {
    fnKunde = inv.partner_name.trim().replace(/\s+/g,'_').replace(/[^a-zA-Z0-9äöüÄÖÜß_\-]/g,'');
  }
  var firstKz = ((inv.items&&inv.items[0]&&(inv.items[0].fz_kz||'').trim()) || (inv.fz_kz||''));
  var fnKz = firstKz.replace(/[^a-zA-Z0-9]/g,'');
  var filename = 'RechnungNR.' + fnNr;
  if (fnKunde) filename += '_' + fnKunde;
  if (fnKz) filename += '_' + fnKz;
  filename += '.pdf';
  var arPath = inv.zahlungsart === 'kassa'
    ? (localStorage.getItem('bp_path_ar_kassa') || localStorage.getItem('bp_path_ar'))
    : (localStorage.getItem('bp_path_ar_bank')  || localStorage.getItem('bp_path_ar'));
  savePDFToFolder(doc, filename, arPath, function(){ doc.save(filename); });
}

// ================================================================
// MITARBEITER
// ================================================================
function renderMitarbeiter(offset) {
  offset = offset || 0;
  var d = getDB();
  var base = new Date();
  var targetDate = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  var curM = targetDate.getMonth(), curY = targetDate.getFullYear();

  var MONTHS_MA = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  var label = document.getElementById('ma-month-label');
  if (label) label.textContent = MONTHS_MA[curM] + ' ' + curY;

  // Store offset for nav buttons
  window._maOffset = offset;

  // Collect hours per employee from AR invoices this month
  var stats = { djevad: {stunden:0, jobs:[]}, helmut: {stunden:0, jobs:[]} };

  d.invoices.forEach(function(inv) {
    if (inv.typ !== 'ausgang') return;
    var dt = new Date(inv.datum);
    if (dt.getMonth() !== curM || dt.getFullYear() !== curY) return;

    var kz = inv.fz_kz || inv.fz_marke || '—';
    var datum = fmtD(inv.datum);

    // Per-item employee hours (new system)
    var djevadH = (inv.items||[]).reduce(function(s,it){ return s + (parseFloat(it.djevad_h)||0); }, 0);
    var helmutH = (inv.items||[]).reduce(function(s,it){ return s + (parseFloat(it.helmut_h)||0); }, 0);

    // Fallback for old invoices without per-item hours: use total hours via invoice flags
    var totalH = (inv.items||[]).reduce(function(s,it){ return s + (parseFloat(it.menge)||0); }, 0);

    var effDjevad = djevadH > 0 ? djevadH : (inv.flag_djevad ? totalH : 0);
    var effHelmut = helmutH > 0 ? helmutH : (inv.flag_helmut ? totalH : 0);

    if (effDjevad > 0) {
      stats.djevad.stunden += effDjevad;
      stats.djevad.jobs.push({datum:datum, kz:kz, stunden:effDjevad, nr:inv.nummer});
    }
    if (effHelmut > 0) {
      stats.helmut.stunden += effHelmut;
      stats.helmut.jobs.push({datum:datum, kz:kz, stunden:effHelmut, nr:inv.nummer});
    }
  });

  // Metrics
  document.getElementById('ma-metrics').innerHTML =
    '<div class="metric"><div class="lbl">Monat</div><div class="val" style="font-size:15px">' + MONTHS_MA[curM] + ' ' + curY + '</div></div>' +
    '<div class="metric green"><div class="lbl">Dževad — Stunden</div><div class="val">' + stats.djevad.stunden.toFixed(1) + ' h</div></div>' +
    '<div class="metric green"><div class="lbl">Helmut — Stunden</div><div class="val">' + stats.helmut.stunden.toFixed(1) + ' h</div></div>' +
    '<div class="metric"><div class="lbl">Gesamt Stunden</div><div class="val">' + (stats.djevad.stunden + stats.helmut.stunden).toFixed(1) + ' h</div></div>';

  // Detail tables
  function buildDetail(jobs) {
    if (!jobs.length) return '<div class="empty">Keine Einträge</div>';
    var rows = jobs.map(function(j) {
      return '<tr><td>' + j.datum + '</td><td class="mono">' + esc(j.kz) + '</td>' +
             '<td style="text-align:right">' + j.stunden.toFixed(1) + ' h</td>' +
             '<td class="mono" style="font-size:11px;color:var(--t3)">' + esc(j.nr) + '</td></tr>';
    }).join('');
    var total = jobs.reduce(function(s,j){ return s+j.stunden; }, 0);
    return '<table><thead><tr><th>Datum</th><th>Kennzeichen</th><th style="text-align:right">Stunden</th><th>Rech.Nr.</th></tr></thead>' +
           '<tbody>' + rows + '</tbody>' +
           '<tfoot><tr><td colspan="2" style="font-weight:500;padding:8px 10px">Gesamt</td><td style="text-align:right;font-weight:500;padding:8px 10px">' + total.toFixed(1) + ' h</td><td></td></tr></tfoot></table>';
  }

  document.getElementById('ma-djevad-detail').innerHTML = buildDetail(stats.djevad.jobs);
  document.getElementById('ma-helmut-detail').innerHTML = buildDetail(stats.helmut.jobs);

  // Wire nav buttons
  var btnPrev = document.getElementById('ma-prev');
  var btnNext = document.getElementById('ma-next');
  if (btnPrev) btnPrev.onclick = function(){ renderMitarbeiter((window._maOffset||0) - 1); };
  if (btnNext) btnNext.onclick = function(){
    var next = (window._maOffset||0) + 1;
    if (next <= 0) renderMitarbeiter(next);
  };
  // Disable next if at current month
  if (btnNext) btnNext.disabled = offset >= 0;
}


function renderKunden() {
  var d = getDB(), el = document.getElementById('tbl-kunden');
  var s = (document.getElementById('s-kunden')||{value:''}).value.toLowerCase();
  var kunden = s ? d.kunden.filter(function(k){ return (k.name+' '+(k.adresse||'')+(k.email||'')).toLowerCase().indexOf(s)!==-1; }) : d.kunden;
  if (!kunden.length) { el.innerHTML = '<div class="empty">Keine Kunden gefunden</div>'; return; }
  var rows = kunden.map(function(k){
    var autos = d.fahrzeuge.filter(function(f){ return f.kundeId===k.id; });
    var badges = autos.map(function(a){ return '<span class="badge blue" style="margin:1px">&#128663; ' + esc(a.kennzeichen||a.marke||'Auto') + '</span>'; }).join(' ');
    var privatBadge = k.privat ? '<span class="badge gray" style="margin-left:4px">&#128181; Privat/Bar</span>' : '';
    return '<tr>' +
      '<td>' + esc(k.name) + privatBadge + '</td>' +
      '<td>' + esc((k.adresse||'').replace(/\n/g,', ')) + '</td>' +
      '<td>' + (badges||'—') + '</td>' +
      '<td>' + esc(k.email||'—') + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn" style="padding:4px 8px;font-size:11px" data-action="edit" data-id="' + k.id + '">&#9998;</button> ' +
        '<button class="btn" style="padding:4px 8px;font-size:11px" data-action="addfz" data-id="' + k.id + '">+ Auto</button> ' +
        '<button class="btn danger" style="padding:4px 8px;font-size:11px" data-action="del" data-id="' + k.id + '">Löschen</button>' +
      '</td></tr>';
  }).join('');
  el.innerHTML = '<table><thead><tr><th>Name</th><th>Adresse</th><th>Fahrzeuge</th><th>E-Mail</th><th>Aktion</th></tr></thead><tbody>' + rows + '</tbody></table>';
  el.querySelectorAll('button[data-action]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if (this.dataset.action === 'edit')  editKunde(this.dataset.id);
      if (this.dataset.action === 'addfz') openFzModal(this.dataset.id);
      if (this.dataset.action === 'del')   delKunde(this.dataset.id);
    });
  });
}

function openKundeModal() {
  var kFzList = [{marke:'',kz:''}];
  function renderKFz() {
    document.getElementById('k-fz-list').innerHTML = kFzList.map(function(fz,i){
      return '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">' +
        '<input placeholder="Marke/Modell" value="'+esc(fz.marke)+'" class="kfz-m" data-i="'+i+'" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif">' +
        '<input placeholder="Kennzeichen" value="'+esc(fz.kz)+'" class="kfz-k" data-i="'+i+'" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif">' +
        (kFzList.length>1?'<button class="btn kfz-x" data-i="'+i+'" style="padding:4px 8px;font-size:11px">&#x2715;</button>':'')+'</div>';
    }).join('');
    document.querySelectorAll('.kfz-m').forEach(function(el){ el.oninput=function(){ kFzList[this.dataset.i].marke=this.value; }; });
    document.querySelectorAll('.kfz-k').forEach(function(el){ el.oninput=function(){ kFzList[this.dataset.i].kz=this.value; }; });
    document.querySelectorAll('.kfz-x').forEach(function(el){ el.onclick=function(){ kFzList.splice(parseInt(this.dataset.i),1); renderKFz(); }; });
  }
  document.getElementById('modal-body').innerHTML =
    '<h3>Neuer Kunde</h3>'+
    '<div class="fg"><label>Name *</label><input type="text" id="k-name"></div>'+
    '<div class="fg"><label>Adresse</label><textarea id="k-adr"></textarea></div>'+
    '<div class="fr c2"><div class="fg"><label>UID</label><input id="k-uid" type="text"></div><div class="fg"><label>E-Mail</label><input id="k-email" type="email"></div></div>'+
    '<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #eee">'+
      '<div style="font-family:sans-serif;font-size:12px;font-weight:500;color:#666;margin-bottom:8px">Fahrzeuge (optional — mehrere möglich)</div>'+
      '<div id="k-fz-list"></div>'+
      '<button class="btn" id="k-add-fz" style="font-size:12px;margin-top:4px">+ Fahrzeug hinzufügen</button>'+
    '</div>'+
    '<div style="text-align:right;margin-top:1rem"><button class="btn primary" id="btn-save-kunde">Speichern</button></div>';
  openModal(); renderKFz();
  document.getElementById('k-add-fz').onclick = function(){ kFzList.push({marke:'',kz:''}); renderKFz(); };
  document.getElementById('btn-save-kunde').addEventListener('click', function(){
    var name = document.getElementById('k-name').value.trim();
    if (!name) { alert('Name eingeben'); return; }
    var d = getDB(), kid = uid();
    d.kunden.push({id:kid,name:name,adresse:document.getElementById('k-adr').value,uid:document.getElementById('k-uid').value,email:document.getElementById('k-email').value});
    kFzList.forEach(function(fz){ if(fz.marke||fz.kz){ d.fahrzeuge.push({id:uid(),kundeId:kid,kundeName:name,marke:fz.marke,kennzeichen:fz.kz,vin:'',erstzulassung:'',erstellt:new Date().toISOString()}); }});
    saveDB(d); closeModal(); renderKunden();
  });
}


function delKunde(id) {
  if (!confirm('Kunden löschen?')) return;
  var d = getDB();
  d.kunden = d.kunden.filter(function(k){ return k.id!==id; });
  saveDB(d); renderKunden();
}

// ================================================================
// FAHRZEUGE
// ================================================================
function renderFahrzeuge() {
  var d = getDB(), el = document.getElementById('tbl-fahrzeuge');
  var s = (document.getElementById('s-fahrzeuge')||{value:''}).value.toLowerCase();
  var fzList = s ? d.fahrzeuge.filter(function(f){ return ((f.kennzeichen||'')+(f.marke||'')+(f.kundeName||'')).toLowerCase().indexOf(s)!==-1; }) : d.fahrzeuge;
  if (!fzList.length) { el.innerHTML = '<div class="empty">Keine Fahrzeuge gefunden</div>'; return; }
  var rows = fzList.map(function(f){
    var kzCount = d.invoices.filter(function(i){ return i.typ==='ausgang' && i.fz_kz && i.fz_kz.trim().toUpperCase() === (f.kennzeichen||'').trim().toUpperCase(); }).length;
    var kzBadge = kzCount > 0 ? ' <span class="badge blue" style="font-size:10px">'+kzCount+' Rechnungen</span>' : '';
    return '<tr>' +
      '<td><strong class="fz-link" data-kz="' + esc(f.kennzeichen||'') + '" style="cursor:pointer;color:var(--ad);text-decoration:underline">' + esc(f.kennzeichen||'—') + '</strong>' + kzBadge + '</td>' +
      '<td>' + esc(f.marke||'—') + '</td>' +
      '<td class="mono" style="font-size:11px">' + esc(f.vin||'—') + '</td>' +
      '<td>' + esc(f.erstzulassung||'—') + '</td>' +
      '<td>' + esc(f.kundeName||'—') + '</td>' +
      '<td style="white-space:nowrap"><button class="btn" style="padding:4px 8px;font-size:11px" data-action="edit" data-id="' + f.id + '">&#9998;</button> <button class="btn danger" style="padding:4px 8px;font-size:11px" data-action="del" data-id="' + f.id + '">Löschen</button></td>' +
    '</tr>';
  }).join('');
  el.innerHTML = '<table><thead><tr><th>Kennzeichen</th><th>Marke / Modell</th><th>VIN</th><th>Erstzulassung</th><th>Kunde</th><th>Aktion</th></tr></thead><tbody>' + rows + '</tbody></table>';
  el.querySelectorAll('button[data-action]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(this.dataset.action==='edit') editFz(this.dataset.id);
      if(this.dataset.action==='del')  delFz(this.dataset.id);
    });
  });
  el.querySelectorAll('.fz-link').forEach(function(link){
    link.addEventListener('click', function(){ openFzHistory(this.dataset.kz); });
  });
}

function openFzHistory(kz) {
  var d = getDB();
  var invs = d.invoices.filter(function(i){
    return i.typ === 'ausgang' && i.fz_kz && i.fz_kz.trim().toUpperCase() === kz.trim().toUpperCase();
  }).sort(function(a,b){ return a.datum > b.datum ? -1 : 1; });

  var fz = d.fahrzeuge.find(function(f){ return (f.kennzeichen||'').trim().toUpperCase() === kz.trim().toUpperCase(); });
  var marke = fz ? (fz.marke || '') : '';

  var rows = invs.map(function(inv){
    var beschr = (inv.items||[]).map(function(it){ return it.titel||''; }).filter(Boolean).join(', ');
    var stunden = (inv.items||[]).reduce(function(s,it){ return s+(parseFloat(it.menge)||0); }, 0);
    return '<div style="padding:12px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:flex-start;gap:1rem">' +
      '<div>' +
        '<div style="font-family:sans-serif;font-size:13px;font-weight:500;margin-bottom:3px">' + esc(beschr||'—') + '</div>' +
        '<div style="font-family:sans-serif;font-size:11px;color:#999">' + fmtD(inv.datum) + '  |  ' + stunden.toFixed(1) + ' Std.  |  ' + esc(inv.nummer) + '</div>' +
      '</div>' +
      '<button class="btn" style="padding:4px 10px;font-size:11px;flex-shrink:0" data-inv-id="' + inv.id + '">PDF öffnen</button>' +
    '</div>';
  }).join('');

  document.getElementById('modal-body').innerHTML =
    '<h3>&#128663; ' + esc(kz) + (marke ? '  <span style="font-size:13px;color:#999;font-weight:400">'+esc(marke)+'</span>' : '') + '</h3>' +
    '<p style="font-family:sans-serif;font-size:12px;color:#999;margin-bottom:1rem">' + invs.length + ' Rechnung(en)</p>' +
    (invs.length ? rows : '<div class="empty">Keine Rechnungen für dieses Kennzeichen</div>');

  openModal();

  document.querySelectorAll('[data-inv-id]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = this.dataset.invId;
      closeModal();
      genPDF(id);
    });
  });
}

function openFzModal(kundeId) {
  var d = getDB();
  var opts = d.kunden.map(function(k){
    return '<option value="' + k.id + '"' + (k.id===kundeId?' selected':'') + '>' + esc(k.name) + '</option>';
  }).join('');
  document.getElementById('modal-body').innerHTML =
    '<h3>&#128663; Fahrzeug hinzufügen</h3>' +
    '<div class="fg"><label>Kunde</label><select id="fz-kid"><option value="">— kein Kunde —</option>' + opts + '</select></div>' +
    '<div class="fr c2"><div class="fg"><label>Marke / Modell *</label><input id="fz-marke" type="text" placeholder="z.B. VW Golf"></div><div class="fg"><label>Kennzeichen</label><input id="fz-kz" type="text" placeholder="z.B. W-123AB"></div></div>' +
    '<div class="fg"><label>Fahrgestellnummer (VIN)</label><input id="fz-vin" type="text"></div>' +
    '<div class="fg"><label>Erstzulassung</label><input id="fz-ez" type="text" placeholder="TT.MM.JJJJ"></div>' +
    '<div style="text-align:right;margin-top:1rem"><button class="btn primary" id="btn-save-fz">Speichern</button></div>';
  openModal();
  document.getElementById('btn-save-fz').addEventListener('click', saveFz);
}

function saveFz() {
  var d = getDB();
  var kid = document.getElementById('fz-kid').value;
  var k   = d.kunden.find(function(x){ return x.id===kid; });
  var fz  = {
    id: uid(), kundeId: kid, kundeName: k ? k.name : '',
    marke: document.getElementById('fz-marke').value.trim(),
    kennzeichen: document.getElementById('fz-kz').value.trim(),
    vin: document.getElementById('fz-vin').value.trim(),
    erstzulassung: document.getElementById('fz-ez').value.trim(),
    erstellt: new Date().toISOString()
  };
  if (!fz.marke && !fz.kennzeichen) { alert('Bitte Marke oder Kennzeichen eingeben'); return; }
  d.fahrzeuge.push(fz); saveDB(d); closeModal();
  if (document.getElementById('page-fahrzeuge').classList.contains('active')) renderFahrzeuge();
  if (document.getElementById('page-kunden').classList.contains('active'))    renderKunden();
}

function delFz(id) {
  if (!confirm('Fahrzeug löschen?')) return;
  var d = getDB();
  d.fahrzeuge = d.fahrzeuge.filter(function(f){ return f.id!==id; });
  saveDB(d); renderFahrzeuge();
}

// ================================================================
// LIEFERANTEN
// ================================================================
function renderLief() {
  var d = getDB(), el = document.getElementById('tbl-lieferanten');
  var s = (document.getElementById('s-lieferanten')||{value:''}).value.toLowerCase();
  var lief = s ? d.lieferanten.filter(function(l){ return (l.name+' '+(l.adresse||'')).toLowerCase().indexOf(s)!==-1; }) : d.lieferanten;
  if (!lief.length) { el.innerHTML = '<div class="empty">Keine Lieferanten gefunden</div>'; return; }
  var rows = lief.map(function(l){
    return '<tr><td>' + esc(l.name) + '</td><td>' + esc((l.adresse||'').replace(/\n/g,', ')) + '</td><td>' + esc(l.uid||'—') + '</td><td>' + esc(l.email||'—') + '</td>' +
      '<td style="white-space:nowrap"><button class="btn" style="padding:4px 8px;font-size:11px" data-action="edit" data-id="' + l.id + '">&#9998;</button> <button class="btn danger" style="padding:4px 8px;font-size:11px" data-action="del" data-id="' + l.id + '">Löschen</button></td></tr>';
  }).join('');
  el.innerHTML = '<table><thead><tr><th>Name</th><th>Adresse</th><th>UID</th><th>E-Mail</th><th>Aktion</th></tr></thead><tbody>' + rows + '</tbody></table>';
  el.querySelectorAll('button[data-action]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if(this.dataset.action==='edit') editLief(this.dataset.id);
      if(this.dataset.action==='del')  delLief(this.dataset.id);
    });
  });
}

function openLiefModal() {
  document.getElementById('modal-body').innerHTML =
    '<h3>Neuer Lieferant</h3>' +
    '<div class="fg"><label>Name *</label><input type="text" id="l-name"></div>' +
    '<div class="fg"><label>Adresse</label><textarea id="l-adr"></textarea></div>' +
    '<div class="fr c2"><div class="fg"><label>UID</label><input id="l-uid"></div><div class="fg"><label>E-Mail</label><input id="l-email" type="email"></div></div>' +
    '<div style="text-align:right;margin-top:1rem"><button class="btn primary" id="btn-save-lief">Speichern</button></div>';
  openModal();
  document.getElementById('btn-save-lief').addEventListener('click', saveLief);
}

function saveLief() {
  var name = document.getElementById('l-name').value.trim();
  if (!name) { alert('Name eingeben'); return; }
  var d = getDB();
  d.lieferanten.push({id:uid(), name:name, adresse:document.getElementById('l-adr').value, uid:document.getElementById('l-uid').value, email:document.getElementById('l-email').value});
  saveDB(d); closeModal(); renderLief();
}

function delLief(id) {
  if (!confirm('Lieferant löschen?')) return;
  var d = getDB();
  d.lieferanten = d.lieferanten.filter(function(l){ return l.id!==id; });
  saveDB(d); renderLief();
}

// ================================================================
// ZAHLUNGEN
// ================================================================
function renderZ() {
  var d = getDB(), el = document.getElementById('tbl-zahlungen');
  var now = new Date();
  var open = d.invoices.filter(function(i){ return i.status === 'offen'; })
    .sort(function(a,b){
      var da = a.faellig ? new Date(a.faellig) : new Date('9999-12-31');
      var db = b.faellig ? new Date(b.faellig) : new Date('9999-12-31');
      return da - db;
    });
  if (!open.length) { el.innerHTML = '<div class="empty">Keine offenen Rechnungen &#10003;</div>'; return; }
  var rows = open.map(function(inv){
    var fd = inv.faellig ? new Date(inv.faellig) : null;
    var tage = fd ? Math.round((fd - now) / 86400000) : null;
    var tageStr = tage === null ? '&mdash;'
      : tage < 0  ? '<span style="color:#E24B4A;font-weight:600">'+Math.abs(tage)+' Tage überfällig</span>'
      : tage === 0 ? '<span style="color:#BA7517;font-weight:600">Heute fällig</span>'
      : '<span style="color:#555">in '+tage+' Tag(en)</span>';
    var bg = tage!==null&&tage<0 ? 'background:#fff5f5' : tage===0 ? 'background:#fffbf0' : '';
    return '<tr style="'+bg+'">'+
      '<td class="mono" style="font-size:11px">'+esc(inv.nummer)+'</td>'+
      '<td>'+(inv.partner_name||'&mdash;')+'</td>'+
      '<td><span class="badge '+(inv.typ==='ausgang'?'green':'red')+'">'+(inv.typ==='ausgang'?'AR':'ER')+'</span></td>'+
      '<td>'+(inv.faellig?fmtD(inv.faellig):'&mdash;')+'</td>'+
      '<td>'+tageStr+'</td>'+
      '<td style="text-align:right;font-weight:500">'+fmt(brutto(inv))+'</td>'+
      '<td style="white-space:nowrap">'+
        '<button class="btn" style="padding:4px 8px;font-size:11px" data-act="status" data-id="'+inv.id+'">&#10003; Bezahlt</button> '+
        '<button class="btn" style="padding:4px 8px;font-size:11px" data-act="pdf" data-id="'+inv.id+'">PDF</button>'+
      '</td>'+
    '</tr>';
  }).join('');
  el.innerHTML = '<table><thead><tr><th>Nr.</th><th>Partner</th><th>Typ</th><th>Fällig</th><th>Status</th><th style="text-align:right">Betrag</th><th>Aktion</th></tr></thead><tbody>'+rows+'</tbody></table>';
  el.querySelectorAll('button[data-act]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if (this.dataset.act==='status'){ togStatus(this.dataset.id); renderZ(); }
      if (this.dataset.act==='pdf')   genPDF(this.dataset.id);
    });
  });
}

function openZModal() {
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('modal-body').innerHTML =
    '<h3>Zahlung erfassen</h3>' +
    '<div class="fr c2"><div class="fg"><label>Datum</label><input id="z-d" type="date" value="' + today + '"></div>' +
    '<div class="fg"><label>Betrag € (+ Einnahme, - Ausgabe)</label><input id="z-b" type="number" step="0.01"></div></div>' +
    '<div class="fg"><label>Beschreibung</label><input id="z-desc" type="text"></div>' +
    '<div style="text-align:right;margin-top:1rem"><button class="btn primary" id="btn-save-z">Speichern</button></div>';
  openModal();
  document.getElementById('btn-save-z').addEventListener('click', saveZ);
}

function saveZ() {
  var b = parseFloat(document.getElementById('z-b').value);
  var desc = document.getElementById('z-desc').value.trim();
  if (!desc || isNaN(b)) { alert('Alle Felder ausfüllen'); return; }
  var d = getDB();
  d.zahlungen.push({id:uid(), datum:document.getElementById('z-d').value, betrag:b, beschreibung:desc});
  saveDB(d); closeModal(); renderZ();
}


// ================================================================
// FILTER MODAL
// ================================================================
function openFilterModal(typ, isStatusAR) {
  var von    = document.getElementById('f-'+typ+'-von')   ? document.getElementById('f-'+typ+'-von').value   : '';
  var bis    = document.getElementById('f-'+typ+'-bis')   ? document.getElementById('f-'+typ+'-bis').value   : '';
  var minV   = document.getElementById('f-'+typ+'-min')   ? document.getElementById('f-'+typ+'-min').value   : '';
  var maxV   = document.getElementById('f-'+typ+'-max')   ? document.getElementById('f-'+typ+'-max').value   : '';
  var status = document.getElementById('f-'+typ+'-status')? document.getElementById('f-'+typ+'-status').value: '';

  var statusOpts = '';
  if (isStatusAR === 'ar') {
    statusOpts = '<option value="">Alle</option><option value="offen">Offen</option><option value="bezahlt">Bezahlt</option><option value="überfällig">Überfällig</option>';
  } else if (isStatusAR === 'er') {
    statusOpts = '<option value="">Alle</option><option value="offen">Offen</option><option value="bezahlt">Bezahlt</option>';
  } else {
    statusOpts = '<option value="">Alle</option><option value="offen">Offen</option><option value="bezahlt">Bezahlt</option>';
  }

  var hasMin = !!document.getElementById('f-'+typ+'-min');

  document.getElementById('modal-body').innerHTML =
    '<h3>&#9776; Filter</h3>' +
    '<div class="fr c2">' +
      '<div class="fg"><label>Datum von</label><input type="date" id="fm-von" value="'+von+'"></div>' +
      '<div class="fg"><label>Datum bis</label><input type="date" id="fm-bis" value="'+bis+'"></div>' +
    '</div>' +
    (hasMin ? '<div class="fr c2">' +
      '<div class="fg"><label>Betrag min (€)</label><input type="number" id="fm-min" value="'+minV+'" min="0" step="0.01" placeholder="0"></div>' +
      '<div class="fg"><label>Betrag max (€)</label><input type="number" id="fm-max" value="'+maxV+'" min="0" step="0.01" placeholder="∞"></div>' +
    '</div>' : '') +
    '<div class="fg"><label>Status</label><select id="fm-status">'+statusOpts+'</select></div>' +
    '<div style="display:flex;justify-content:space-between;margin-top:1rem">' +
      '<button class="btn" id="fm-reset">↺ Zurücksetzen</button>' +
      '<div style="display:flex;gap:8px"><button class="btn" onclick="closeModal()">Abbrechen</button><button class="btn primary" id="fm-apply">Filter anwenden</button></div>' +
    '</div>';

  // Set current status value
  setTimeout(function(){
    var sel = document.getElementById('fm-status');
    if (sel) sel.value = status;
  }, 0);

  document.getElementById('fm-apply').addEventListener('click', function(){
    var fVon = document.getElementById('fm-von').value;
    var fBis = document.getElementById('fm-bis').value;
    var fMin = hasMin && document.getElementById('fm-min') ? document.getElementById('fm-min').value : '';
    var fMax = hasMin && document.getElementById('fm-max') ? document.getElementById('fm-max').value : '';
    var fSt  = document.getElementById('fm-status').value;

    function setHidden(id, val){ var e=document.getElementById(id); if(e) e.value=val; }
    setHidden('f-'+typ+'-von', fVon);
    setHidden('f-'+typ+'-bis', fBis);
    setHidden('f-'+typ+'-min', fMin);
    setHidden('f-'+typ+'-max', fMax);
    setHidden('f-'+typ+'-status', fSt);

    // Update badge
    var active = [fVon,fBis,fMin,fMax,fSt].filter(Boolean).length;
    var badge = document.getElementById('f-'+typ+'-badge');
    if (badge) { badge.style.display = active ? 'inline' : 'none'; badge.textContent = active; }

    closeModal();
    if (typ==='ausgang' || typ==='eingang') renderTable(typ);
    else renderBuchKassa(typ==='bankbuch'?'bank':'kassa');
  });

  document.getElementById('fm-reset').addEventListener('click', function(){
    ['fm-von','fm-bis','fm-min','fm-max'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
    var se=document.getElementById('fm-status'); if(se) se.value='';
  });

  openModal();
}

// ================================================================
// BANKBUCH / KASSABUCH
// ================================================================
function renderBuchKassa(art) {
  var d = getDB();
  var pageId = art === 'bank' ? 'bankbuch' : 'kassabuch';
  var s   = (document.getElementById('s-'+pageId)||{value:''}).value.toLowerCase();
  var von = (document.getElementById('f-'+pageId+'-von')||{value:''}).value;
  var bis = (document.getElementById('f-'+pageId+'-bis')||{value:''}).value;
  var st  = (document.getElementById('f-'+pageId+'-status')||{value:''}).value;
  var invs = d.invoices.filter(function(i){ return i.zahlungsart === art; });
  if (s)   invs = invs.filter(function(i){ return ((i.nummer||'')+(i.partner_name||'')).toLowerCase().indexOf(s)!==-1; });
  if (von) invs = invs.filter(function(i){ return i.datum >= von; });
  if (bis) invs = invs.filter(function(i){ return i.datum <= bis; });
  if (st)  invs = invs.filter(function(i){ return i.status === st; });
  invs.sort(function(a,b){ return a.datum > b.datum ? -1 : 1; });

  var ein = invs.filter(function(i){ return i.typ==='ausgang'; }).reduce(function(s,i){ return s+brutto(i); }, 0);
  var aus = invs.filter(function(i){ return i.typ==='eingang'; }).reduce(function(s,i){ return s+brutto(i); }, 0);

  document.getElementById(pageId+'-metrics').innerHTML =
    '<div class="metric green"><div class="lbl">Einnahmen</div><div class="val">'+fmt(ein)+'</div></div>'+
    '<div class="metric red"><div class="lbl">Ausgaben</div><div class="val">'+fmt(aus)+'</div></div>'+
    '<div class="metric"><div class="lbl">Saldo</div><div class="val">'+fmt(ein-aus)+'</div></div>'+
    '<div class="metric"><div class="lbl">Buchungen</div><div class="val">'+invs.length+'</div></div>';

  var el = document.getElementById('tbl-'+pageId);
  if (!invs.length) { el.innerHTML='<div class="empty">Keine Buchungen</div>'; return; }
  var rows = invs.map(function(inv){
    var isAR = inv.typ==='ausgang';
    return '<tr>'+
      '<td>'+fmtD(inv.datum)+'</td>'+
      '<td class="mono">'+inv.nummer+'</td>'+
      '<td>'+(inv.partner_name||'—')+'</td>'+
      '<td><span class="badge '+(isAR?'green':'red')+'">'+(isAR?'Einnahme':'Ausgabe')+'</span></td>'+
      '<td style="text-align:right;font-family:sans-serif">'+fmt(brutto(inv))+'</td>'+
      '<td>'+sBadge(inv.status)+'</td>'+
    '</tr>';
  }).join('');
  el.innerHTML = '<table><thead><tr><th>Datum</th><th>Nr.</th><th>Partner</th><th>Typ</th><th style="text-align:right">Betrag</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

// ================================================================
// EDIT INVOICE
// ================================================================
function editInv(id) {
  var d = getDB(), inv = d.invoices.find(function(i){ return i.id===id; });
  if (!inv) return;
  editId = id;
  SP('neu');
  // Populate form after SP('neu') which calls initForm and resets editId
  // So we set editId again after:
  editId = id;
  document.getElementById('form-title').textContent = 'Rechnung bearbeiten';

  if (inv.typ === 'ausgang') {
    setTyp('ausgang');
  } else {
    setTyp('eingang');
  }
  document.getElementById('rnr').value = inv.nummer;
  document.getElementById('zahlungsart').value = inv.zahlungsart || 'bank';
  setPay(inv.zahlungsart || 'bank');
  if (inv.zahlungsart === 'kassa' && inv.kassa_typ) {
    setKassaTyp(inv.kassa_typ);
  }
  if (inv.datum)     document.getElementById('datum').value = inv.datum;
  if (inv.leistungsdatum) document.getElementById('leistungsdatum').value = inv.leistungsdatum;
  if (inv.faellig)   document.getElementById('faellig').value = inv.faellig;
  if (inv.status)    document.getElementById('status').value = inv.status;
  if (inv.notizen)   document.getElementById('notizen').value = inv.notizen;
  if (inv.pinfo)     document.getElementById('pinfo').value = inv.partner_info || '';
  if (inv.fz_marke)  document.getElementById('fz-marke-inv').value = inv.fz_marke;
  if (inv.fz_kz)     document.getElementById('fz-kz-inv').value = inv.fz_kz;
  document.getElementById('pinfo').value = inv.partner_info || '';
  if (inv.partner_id) {
    document.getElementById('partner').value = inv.partner_id;
    fillPD();
  }
  if (inv.privatkunde) { var pc=document.getElementById('inv-privat'); if(pc) pc.checked=true; }
  if (inv.flag_djevad) { var pd=document.getElementById('inv-djevad'); if(pd) pd.checked=true; }
  if (inv.flag_helmut) { var ph=document.getElementById('inv-helmut'); if(ph) ph.checked=true; }
  if (inv.kassenbeleg_nr) {
    var kbEl2 = document.getElementById('kassa-beleg-nr');
    var kbRow2 = document.getElementById('kassa-beleg-row');
    if (kbEl2) kbEl2.value = inv.kassenbeleg_nr;
    if (kbRow2) kbRow2.style.display = '';
  }
  itemsData = (inv.items||[]).map(function(it){ return Object.assign({},it); });
  if (!itemsData.length) itemsData = [{titel:'',desc:'',menge:1,preis:0,ust:20}];
  renderItems();
  if (inv.materialkosten > 0) {
    if (inv.mat_auto) {
      document.getElementById('mat-auto').checked = true;
    } else {
      document.getElementById('mat-manuell').value = inv.materialkosten;
    }
  }
  refreshNumbers();
}

// ================================================================
// FINANZEN
// ================================================================
function renderFin() {
  var d = getDB(), now = new Date(), m = now.getMonth(), y = now.getFullYear();
  var tI=0,tE=0,vC=0,vP=0,mVC=0,mVP=0;
  d.invoices.forEach(function(inv){
    var b=brutto(inv), v=vatAmt(inv);
    if(inv.typ==='ausgang'){tI+=b;vC+=v;}else{tE+=b;vP+=v;}
    var id=new Date(inv.datum);
    if(id.getMonth()===m&&id.getFullYear()===y){if(inv.typ==='ausgang')mVC+=v;else mVP+=v;}
  });
  document.getElementById('fin-metrics').innerHTML =
    '<div class="metric green"><div class="lbl">Einnahmen</div><div class="val">' + fmt(tI) + '</div></div>' +
    '<div class="metric red"><div class="lbl">Ausgaben</div><div class="val">' + fmt(tE) + '</div></div>' +
    '<div class="metric green"><div class="lbl">USt. eingenommen</div><div class="val">' + fmt(vC) + '</div></div>' +
    '<div class="metric amber"><div class="lbl">USt.-Schuld</div><div class="val">' + fmt(vC-vP) + '</div></div>';
  document.getElementById('ust-vm').innerHTML =
    '<div style="font-family:sans-serif;font-size:13px">' +
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee"><span style="color:#666">USt. eingenommen (KZ 022)</span><span>' + fmt(mVC) + '</span></div>' +
    '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee"><span style="color:#666">Vorsteuer (KZ 060)</span><span>' + fmt(mVP) + '</span></div>' +
    '<div style="display:flex;justify-content:space-between;padding:10px 0;font-weight:500"><span>Zahllast (KZ 095)</span><span style="color:' + (mVC-mVP>0?'#E24B4A':'#0F6E56') + '">' + fmt(mVC-mVP) + '</span></div>' +
    '<p style="font-size:11px;color:#aaa;margin-top:8px">' + MONTHS[m] + ' ' + y + ' — Nur zur Orientierung.</p></div>';
  var m6=[],iD=[],eD=[];
  for (var i=5;i>=0;i--) {
    var dm=new Date(y,m-i,1); m6.push(MONTHS[dm.getMonth()].substr(0,3));
    var ii=0,ee=0;
    d.invoices.forEach(function(inv){ var id=new Date(inv.datum); if(id.getMonth()===dm.getMonth()&&id.getFullYear()===dm.getFullYear()){if(inv.typ==='ausgang')ii+=brutto(inv);else ee+=brutto(inv);}});
    iD.push(ii); eD.push(ee);
  }
  var cm = document.getElementById('cMonat');
  if (cm._c) cm._c.destroy();
  cm._c = new Chart(cm, {type:'bar', data:{labels:m6, datasets:[{label:'Einnahmen',data:iD,backgroundColor:'#5DCAA5'},{label:'Ausgaben',data:eD,backgroundColor:'#F09595'}]}, options:{plugins:{legend:{labels:{font:{size:11}}}}, scales:{y:{ticks:{callback:function(v){ return fmt(v); }}}}}});
  var offene = d.invoices.filter(function(i){ return i.status==='offen'; });
  var op = document.getElementById('offene-posten');
  if (!offene.length) { op.innerHTML='<div class="empty">Keine offenen Posten</div>'; return; }
  var rows = offene.map(function(inv){
    var od = inv.faellig && new Date(inv.faellig) < new Date();
    return '<tr><td class="mono">' + inv.nummer + '</td><td>' + sBadge(inv.typ==='ausgang'?'Ausgang':'Eingang') + '</td><td>' + (inv.partner_name||'—') + '</td><td style="color:' + (od?'#E24B4A':'') + '">' + fmtD(inv.faellig) + '</td><td>' + fmt(brutto(inv)) + '</td><td>' + sBadge(inv.status) + '</td></tr>';
  }).join('');
  op.innerHTML = '<table><thead><tr><th>Nr.</th><th>Typ</th><th>Partner</th><th>Fällig</th><th>Betrag</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

// ================================================================
// TODOS
// ================================================================
var TODO_WDH = [
  {val:'keine',       lbl:'Keine'},
  {val:'taeglich',    lbl:'Täglich'},
  {val:'woechentlich',lbl:'Wöchentlich'},
  {val:'monatlich',   lbl:'Monatlich'},
  {val:'jaehrlich',   lbl:'Jährlich'}
];

function renderTodos() {
  var d = getDB();
  var el = document.getElementById('todos-list');
  if (!el) return;
  var todos = d.todos || [];
  if (!todos.length) {
    el.innerHTML = '<div class="empty" style="padding:2rem">Keine To-Dos vorhanden. Klicken Sie auf „+ Neues To-Do".</div>';
    return;
  }
  var wdhMap = {keine:'–',taeglich:'Täglich',woechentlich:'Wöchentlich',monatlich:'Monatlich',jaehrlich:'Jährlich'};
  var now = new Date();
  var today = now.toISOString().split('T')[0];
  // Auto-clear erledigt_am when repeat is due again
  var changed = false;
  todos.forEach(function(t){
    if (t.erledigt_am && t.faellig && t.faellig <= today) {
      t.erledigt_am = null;
      changed = true;
    }
  });
  if (changed) saveDB(d);

  var rows = todos.map(function(t, i){
    var fd = t.faellig ? new Date(t.faellig) : null;
    var tage = fd ? Math.round((fd - now) / 86400000) : null;
    var wiederholung = t.wiederholung && t.wiederholung !== 'keine';
    var recentlyDone = !!t.erledigt_am;

    var statusStr = '';
    if (recentlyDone && fd) {
      var wdhNote = tage <= 0
        ? '<span style="color:var(--accent);font-weight:600">Heute wieder fällig</span>'
        : '<span style="color:var(--t2)">Wird wiederholt in <strong>'+tage+'</strong> Tag'+(tage===1?'':'en')+'</span>';
      statusStr = '<span style="color:var(--accent);font-size:11px">&#10003; Erledigt</span> &nbsp;·&nbsp; ' + wdhNote;
    } else if (fd) {
      statusStr = tage < 0
        ? '<span style="color:#E24B4A;font-weight:600">'+Math.abs(tage)+' T. überfällig</span>'
        : tage === 0 ? '<span style="color:#BA7517;font-weight:600">Heute fällig</span>'
        : '<span style="color:#f59e0b">in '+tage+' T.</span>';
    }

    var rowStyle = recentlyDone ? 'opacity:0.6;' : '';
    return '<tr class="todo-row" draggable="true" data-i="'+i+'" data-id="'+t.id+'" style="'+rowStyle+'">' +
      '<td style="padding:10px 6px;width:20px;cursor:grab;color:#bbb;font-size:18px;user-select:none">&#8942;</td>' +
      '<td style="padding:10px 8px;font-family:sans-serif;font-size:13px">' +
        (recentlyDone ? '<s>' : '') + esc(t.titel) + (recentlyDone ? '</s>' : '') +
      '</td>' +
      '<td style="padding:10px 8px;font-size:13px;font-family:sans-serif">'+fmtD(t.faellig)+'</td>' +
      '<td style="padding:10px 8px;font-size:12px">'+statusStr+'</td>' +
      '<td style="padding:10px 8px;font-size:11px;color:var(--t3);font-family:sans-serif">'+(wdhMap[t.wiederholung]||'–')+'</td>' +
      '<td style="padding:10px 8px;white-space:nowrap">' +
        (!recentlyDone ? '<button class="btn" style="font-size:11px;padding:3px 8px;margin-right:4px" onclick="openTodoForm(\''+t.id+'\')">&#9998;</button>' : '') +
        (!recentlyDone ? '<button class="btn primary" style="font-size:11px;padding:3px 8px;margin-right:4px" onclick="erledigeTodo(\''+t.id+'\')">&#10003; Erledigt</button>' : '') +
        '<button class="btn danger" style="font-size:11px;padding:3px 8px" onclick="deleteTodo(\''+t.id+'\')">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  el.innerHTML = '<table style="width:100%"><thead><tr>' +
    '<th style="padding:10px 6px;width:20px"></th>' +
    '<th style="padding:10px 8px;text-align:left">Titel</th>' +
    '<th style="padding:10px 8px;text-align:left">Fällig am</th>' +
    '<th style="padding:10px 8px;text-align:left">Fälligkeit</th>' +
    '<th style="padding:10px 8px;text-align:left">Wiederholung</th>' +
    '<th style="padding:10px 8px"></th>' +
  '</tr></thead><tbody id="todos-tbody">'+rows+'</tbody></table>';

  var tdDragFrom = null;
  el.querySelectorAll('.todo-row').forEach(function(row){
    row.addEventListener('dragstart', function(e){
      tdDragFrom = parseInt(this.dataset.i);
      e.dataTransfer.effectAllowed = 'move';
      var self = this;
      setTimeout(function(){ self.style.opacity = '0.4'; }, 0);
    });
    row.addEventListener('dragend', function(){
      this.style.opacity = '';
      el.querySelectorAll('.todo-row').forEach(function(r){ r.style.background=''; });
    });
    row.addEventListener('dragover', function(e){
      e.preventDefault();
      el.querySelectorAll('.todo-row').forEach(function(r){ r.style.background=''; });
      this.style.background = '#f0f9f5';
    });
    row.addEventListener('drop', function(e){
      e.preventDefault();
      var toIdx = parseInt(this.dataset.i);
      if (tdDragFrom === null || tdDragFrom === toIdx) return;
      var db = getDB();
      var item = db.todos.splice(tdDragFrom, 1)[0];
      db.todos.splice(toIdx, 0, item);
      saveDB(db);
      renderTodos();
    });
  });
}

function openTodoForm(id) {
  var d = getDB();
  var t = id ? (d.todos||[]).find(function(x){ return x.id===id; }) : null;
  var wdhOpts = TODO_WDH.map(function(w){
    return '<option value="'+w.val+'"'+(t&&t.wiederholung===w.val?' selected':(!t&&w.val==='keine'?' selected':''))+'>'+w.lbl+'</option>';
  }).join('');
  var body = '<h3 style="margin:0 0 1rem;font-family:sans-serif">'+(id?'To-Do bearbeiten':'Neues To-Do')+'</h3>' +
    '<div style="display:flex;flex-direction:column;gap:12px;font-family:sans-serif">' +
      '<div><label style="font-size:12px;color:var(--t2);display:block;margin-bottom:4px">Titel</label>' +
        '<input id="td-titel" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box" value="'+esc(t?t.titel:'')+'"></div>' +
      '<div><label style="font-size:12px;color:var(--t2);display:block;margin-bottom:4px">Fällig am</label>' +
        '<input id="td-faellig" type="date" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px;box-sizing:border-box" value="'+(t?t.faellig:'')+'"></div>' +
      '<div><label style="font-size:12px;color:var(--t2);display:block;margin-bottom:4px">Wiederholung</label>' +
        '<select id="td-wdh" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:13px">'+wdhOpts+'</select></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">' +
        '<button class="btn" onclick="closeModal()">Abbrechen</button>' +
        '<button class="btn primary" onclick="saveTodo(\''+( id||'')+'\')">Speichern</button>' +
      '</div>' +
    '</div>';
  document.getElementById('modal-body').innerHTML = body;
  openModal();
}

function saveTodo(id) {
  var titel   = (document.getElementById('td-titel')||{value:''}).value.trim();
  var faellig = (document.getElementById('td-faellig')||{value:''}).value;
  var wdh     = (document.getElementById('td-wdh')||{value:'keine'}).value;
  if (!titel) { alert('Bitte Titel eingeben'); return; }
  var d = getDB();
  if (!d.todos) d.todos = [];
  if (id) {
    var idx = d.todos.findIndex(function(t){ return t.id===id; });
    if (idx !== -1) {
      d.todos[idx].titel = titel;
      d.todos[idx].faellig = faellig;
      d.todos[idx].wiederholung = wdh;
      d.todos[idx].erledigt = false;
    }
  } else {
    d.todos.push({id:uid(), titel:titel, faellig:faellig, wiederholung:wdh, erledigt:false, erstellt:new Date().toISOString()});
  }
  saveDB(d);
  closeModal();
  renderTodos();
}

function erledigeTodo(id) {
  var d = getDB();
  if (!d.todos) return;
  if (!d.todos_archiv) d.todos_archiv = [];
  var idx = d.todos.findIndex(function(t){ return t.id===id; });
  if (idx === -1) return;
  var t = d.todos[idx];
  var today = new Date().toISOString().split('T')[0];

  if (t.wiederholung && t.wiederholung !== 'keine' && t.faellig) {
    // Repeating: advance date, keep in list, show "wird wiederholt" note
    var nd = new Date(t.faellig);
    if (t.wiederholung === 'taeglich')     nd.setDate(nd.getDate()+1);
    if (t.wiederholung === 'woechentlich') nd.setDate(nd.getDate()+7);
    if (t.wiederholung === 'monatlich')    nd.setMonth(nd.getMonth()+1);
    if (t.wiederholung === 'jaehrlich')    nd.setFullYear(nd.getFullYear()+1);
    t.faellig = nd.toISOString().split('T')[0];
    t.erledigt_am = today;
  } else {
    // Non-repeating: archive it
    t.erledigt_am = today;
    d.todos_archiv.push(t);
    d.todos.splice(idx, 1);
  }
  saveDB(d);
  renderTodos();
  renderDash();
}

function openTodoArchiv() {
  var d = getDB();
  var archiv = (d.todos_archiv || []).slice().reverse();
  var wdhMap = {keine:'–',taeglich:'Täglich',woechentlich:'Wöchentlich',monatlich:'Monatlich',jaehrlich:'Jährlich'};
  var rows = archiv.length
    ? archiv.map(function(t){
        return '<tr>' +
          '<td style="padding:9px 10px;font-family:sans-serif;font-size:13px"><s>'+esc(t.titel)+'</s></td>' +
          '<td style="padding:9px 10px;font-size:12px;font-family:sans-serif;color:var(--t3)">'+fmtD(t.erledigt_am)+'</td>' +
          '<td style="padding:9px 10px;font-size:11px;color:var(--t3);font-family:sans-serif">'+(wdhMap[t.wiederholung]||'–')+'</td>' +
          '<td style="padding:9px 10px;white-space:nowrap">' +
            '<button class="btn" style="font-size:11px;padding:3px 8px;margin-right:4px" onclick="restoreTodo(\''+t.id+'\')">&#8629; Wiederherstellen</button>' +
            '<button class="btn danger" style="font-size:11px;padding:3px 8px" onclick="deleteArchivTodo(\''+t.id+'\')">✕</button>' +
          '</td>' +
        '</tr>';
      }).join('')
    : '<tr><td colspan="4" style="padding:2rem;text-align:center;font-family:sans-serif;color:var(--t3)">Keine archivierten To-Dos vorhanden.</td></tr>';

  document.getElementById('modal-body').innerHTML =
    '<h3 style="margin:0 0 1rem;font-family:sans-serif">&#128193; Archivierte Todos</h3>' +
    '<table style="width:100%"><thead><tr>' +
      '<th>Titel</th><th>Erledigt am</th><th>Wiederholung</th><th></th>' +
    '</tr></thead><tbody>'+rows+'</tbody></table>';
  openModal();
}

function restoreTodo(id) {
  var d = getDB();
  if (!d.todos_archiv) return;
  var idx = d.todos_archiv.findIndex(function(t){ return t.id===id; });
  if (idx === -1) return;
  var t = d.todos_archiv[idx];
  t.erledigt_am = null;
  d.todos.push(t);
  d.todos_archiv.splice(idx, 1);
  saveDB(d);
  openTodoArchiv();
  renderTodos();
}

function deleteArchivTodo(id) {
  if (!confirm('Dauerhaft löschen?')) return;
  var d = getDB();
  d.todos_archiv = (d.todos_archiv||[]).filter(function(t){ return t.id!==id; });
  saveDB(d);
  openTodoArchiv();
}

function deleteTodo(id) {
  if (!confirm('To-Do wirklich löschen?')) return;
  var d = getDB();
  d.todos = (d.todos||[]).filter(function(t){ return t.id!==id; });
  saveDB(d);
  renderTodos();
}

// ================================================================
// EXPORT
// ================================================================
function initPathSettings() {
  var arBankEl  = document.getElementById('path-ar-bank');
  var arKassaEl = document.getElementById('path-ar-kassa');
  var erEl      = document.getElementById('path-er');
  var kvEl      = document.getElementById('path-kv');
  if (arBankEl)  arBankEl.value  = localStorage.getItem('bp_path_ar_bank')  || localStorage.getItem('bp_path_ar') || '';
  if (arKassaEl) arKassaEl.value = localStorage.getItem('bp_path_ar_kassa') || localStorage.getItem('bp_path_ar') || '';
  if (erEl) erEl.value = localStorage.getItem('bp_path_er') || '';
  if (kvEl) kvEl.value = localStorage.getItem('bp_path_kv') || '';

  function savePath(inputId, key, infoId) {
    var el = document.getElementById(inputId);
    if (!el) return;
    var v = el.value.trim();
    localStorage.setItem(key, v);
    var info = document.getElementById(infoId);
    if (info) { info.textContent = '✓ Gespeichert: ' + v; setTimeout(function(){ info.textContent = ''; }, 2500); }
  }

  var btnARBankSave  = document.getElementById('btn-path-ar-bank-save');
  var btnARKassaSave = document.getElementById('btn-path-ar-kassa-save');
  var btnERSave      = document.getElementById('btn-path-er-save');
  var btnKVSave      = document.getElementById('btn-path-kv-save');
  if (btnARBankSave)  btnARBankSave.onclick  = function(){ savePath('path-ar-bank',  'bp_path_ar_bank',  'path-ar-bank-info'); };
  if (btnARKassaSave) btnARKassaSave.onclick = function(){ savePath('path-ar-kassa', 'bp_path_ar_kassa', 'path-ar-kassa-info'); };
  if (btnERSave) btnERSave.onclick = function(){ savePath('path-er', 'bp_path_er', 'path-er-info'); };
  if (btnKVSave) btnKVSave.onclick = function(){ savePath('path-kv', 'bp_path_kv', 'path-kv-info'); };
}

function initEx() {
  var sm=document.getElementById('ex-m'), sy=document.getElementById('ex-y');
  sm.innerHTML = MONTHS.map(function(m,i){ return '<option value="'+i+'">'+m+'</option>'; }).join('');
  var now = new Date(); sm.value = now.getMonth(); sy.innerHTML = '';
  for (var y=now.getFullYear()-2; y<=now.getFullYear(); y++) sy.innerHTML += '<option value="'+y+'">'+y+'</option>';
  sy.value = now.getFullYear();
  updateExDays();
  updateExP();
  var dVon=document.getElementById('ex-d-von'), dBis=document.getElementById('ex-d-bis');
  if(dVon) dVon.addEventListener('change', function(){ updateExP(); });
  if(dBis) dBis.addEventListener('change', function(){ updateExP(); });
}

function updateExDays() {
  var m=parseInt(document.getElementById('ex-m').value), y=parseInt(document.getElementById('ex-y').value);
  var lastDay=new Date(y,m+1,0).getDate();
  var dVon=document.getElementById('ex-d-von'), dBis=document.getElementById('ex-d-bis');
  if(!dVon||!dBis) return;
  var prevVon=parseInt(dVon.value)||1, prevBis=parseInt(dBis.value)||lastDay;
  var opts=''; for(var d=1;d<=lastDay;d++) opts+='<option value="'+d+'">'+d+'.</option>';
  dVon.innerHTML=opts; dBis.innerHTML=opts;
  dVon.value=prevVon<=lastDay?String(prevVon):'1';
  dBis.value=prevBis<=lastDay?String(prevBis):String(lastDay);
}

function getExD() {
  var m=parseInt(document.getElementById('ex-m').value), y=parseInt(document.getElementById('ex-y').value);
  return getDB().invoices.filter(function(inv){ var dt=new Date(inv.datum); return dt.getMonth()===m && dt.getFullYear()===y; });
}

function updateExP() {
  var m=parseInt(document.getElementById('ex-m').value), y=parseInt(document.getElementById('ex-y').value);
  var lastDay=new Date(y,m+1,0).getDate();
  var dVon=document.getElementById('ex-d-von'), dBis=document.getElementById('ex-d-bis');
  var dVonV=dVon?parseInt(dVon.value):1, dBisV=dBis?parseInt(dBis.value):lastDay;
  var vonStr=y+'-'+String(m+1).padStart(2,'0')+'-'+String(dVonV).padStart(2,'0');
  var bisStr=y+'-'+String(m+1).padStart(2,'0')+'-'+String(dBisV).padStart(2,'0');
  var invs=getDB().invoices.filter(function(inv){if(!inv.datum)return false;return inv.datum>=vonStr&&inv.datum<=bisStr;});
  var inc=invs.filter(function(i){return i.typ==='ausgang';}).reduce(function(s,i){return s+brutto(i);},0);
  var exp=invs.filter(function(i){return i.typ==='eingang';}).reduce(function(s,i){return s+brutto(i);},0);
  var label=MONTHS[m]+' '+y;
  if(dVonV!==1||dBisV!==lastDay) label+=', '+dVonV+'. – '+dBisV+'.';
  document.getElementById('ex-prev').innerHTML = '<div class="alert info"><strong>' + label + '</strong> — ' + invs.length + ' Rechnung(en), Einnahmen: ' + fmt(inc) + ', Ausgaben: ' + fmt(exp) + '</div>';
}

function exportCSV() {
  var invs = getExD(); if (!invs.length) { alert('Keine Daten'); return; }
  var rows = [['Nr.','Typ','Partner','Datum','Netto','USt','Brutto','Status']];
  invs.forEach(function(inv){ rows.push([inv.nummer,inv.typ,inv.partner_name,inv.datum,netto(inv).toFixed(2),vatAmt(inv).toFixed(2),brutto(inv).toFixed(2),inv.status]); });
  var csv = rows.map(function(r){ return r.map(function(c){ return '"'+String(c||'').replace(/"/g,'""')+'"'; }).join(';'); }).join('\n');
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'})); a.download='export.csv'; a.click();
}

function exportJSON() {
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(getExD(),null,2)],{type:'application/json'})); a.download='export.json'; a.click();
}

function exportPDF() {
  var invs=getExD(), m=parseInt(document.getElementById('ex-m').value), y=parseInt(document.getElementById('ex-y').value);
  var jsPDF=window.jspdf.jsPDF, doc=new jsPDF();
  doc.setFontSize(16); doc.setTextColor(15,110,86); doc.text('Auswertung '+MONTHS[m]+' '+y,20,25);
  doc.setFontSize(9); doc.setTextColor(80,80,80); doc.text('Erstellt: '+new Date().toLocaleDateString('de-AT'),20,32); doc.line(20,36,190,36);
  var row=46;
  invs.forEach(function(inv){ doc.setFontSize(9); doc.setTextColor(30,30,30); doc.text(inv.nummer,20,row); doc.text(inv.typ,55,row); doc.text((inv.partner_name||'').substr(0,20),80,row); doc.text(fmtD(inv.datum),135,row); doc.text(fmt(brutto(inv)),158,row); doc.text(inv.status,180,row); row+=7; });
  var inc=invs.filter(function(i){return i.typ==='ausgang';}).reduce(function(s,i){return s+brutto(i);},0);
  var exp=invs.filter(function(i){return i.typ==='eingang';}).reduce(function(s,i){return s+brutto(i);},0);
  row+=8; doc.setFontSize(11); doc.setTextColor(15,110,86); doc.text('Zusammenfassung',20,row); row+=7;
  doc.setFontSize(10); doc.setTextColor(30,30,30); doc.text('Einnahmen: '+fmt(inc),20,row); row+=7; doc.text('Ausgaben: '+fmt(exp),20,row); row+=7; doc.text('Ergebnis: '+fmt(inc-exp),20,row);
  doc.save('Auswertung_'+MONTHS[m]+'_'+y+'.pdf');
}

// ================================================================
// VORLAGE
// ================================================================
var VS = {};

function dfV() {
  return {tpl:'klassisch',color:'#1D9E75',font:'helvetica',ff:'Arial,sans-serif',showLogo:true,showBank:true,showFooter:true,ta:'RECHNUNG',te:'EINGANGSRECHNUNG',zb:'Zahlbar innerhalb von 14 Tagen.',f1:'Vielen Dank für Ihren Auftrag!',firma:'',adr:'',uid:'',tel:'',email:'',web:'',bname:'',iban:'',bic:''};
}

function loadVF() {
  var v = getDB().vorlage || dfV(); VS = Object.assign({}, v);
  selTpl(v.tpl, true);
  document.getElementById('vc-custom').value = v.color;
  setVF(v.font, v.ff, true);
  document.getElementById('v-logo').checked   = v.showLogo;
  document.getElementById('v-bank').checked   = v.showBank;
  document.getElementById('v-footer').checked = v.showFooter;
  ['ta','te','zb','f1','firma','adr','uid','tel','email','web','bname','iban','bic'].forEach(function(k){
    var el = document.getElementById('v-'+k); if (el) el.value = v[k] || '';
  });
  updateVP();
}

function readVF() {
  function g(id){ var el=document.getElementById(id); return el ? el.value : ''; }
  return {
    tpl:VS.tpl||'klassisch', color:VS.color||'#1D9E75', font:VS.font||'helvetica', ff:VS.ff||'Arial,sans-serif',
    showLogo:document.getElementById('v-logo').checked, showBank:document.getElementById('v-bank').checked, showFooter:document.getElementById('v-footer').checked,
    ta:g('v-ta')||'RECHNUNG', te:g('v-te')||'EINGANGSRECHNUNG', zb:g('v-zb'), f1:g('v-f1'),
    firma:g('v-firma'), adr:g('v-adr'), uid:g('v-uid'), tel:g('v-tel'), email:g('v-email'), web:g('v-web'), bname:g('v-bname'), iban:g('v-iban'), bic:g('v-bic')
  };
}

function selTpl(name, silent) {
  VS.tpl = name;
  ['klassisch','modern','minimal'].forEach(function(t){
    document.getElementById('tc-'+t).classList.toggle('active', t===name);
  });
  renderThumbs();
  if (!silent) updateVP();
}

function renderThumbs() {
  var c = VS.color || '#1D9E75';
  var th = {
    klassisch: '<div class="tbar" style="width:70%;background:'+c+'"></div><div class="tbar" style="width:30%;background:#ddd"></div><div style="height:1px;background:#eee;margin:3px 0"></div><div class="tbar" style="width:45%;background:#ccc"></div><div class="tbar" style="width:45%;background:#ccc"></div><div style="height:1px;background:#eee;margin:3px 0"></div><div class="tbar" style="width:20%;background:'+c+';margin-left:auto"></div>',
    modern:    '<div style="height:8px;background:'+c+';border-radius:2px;margin-bottom:4px"></div><div class="tbar" style="width:30%;background:#ddd;margin-left:auto"></div><div style="height:1px;background:#eee;margin:3px 0"></div><div class="tbar" style="width:45%;background:#ccc"></div><div class="tbar" style="width:45%;background:#ccc"></div>',
    minimal:   '<div class="tbar" style="width:70%;background:#222"></div><div style="height:1px;background:'+c+';margin:3px 0"></div><div class="tbar" style="width:45%;background:#ccc"></div><div class="tbar" style="width:45%;background:#ccc"></div>'
  };
  ['klassisch','modern','minimal'].forEach(function(t){ var el=document.getElementById('tt-'+t); if(el) el.innerHTML=th[t]; });
}

function setVC(c, silent) { VS.color=c; document.getElementById('vc-custom').value=c; renderThumbs(); if(!silent) updateVP(); }

function setVF(key, family, silent) {
  VS.font=key; VS.ff=family;
  ['helvetica','georgia','courier'].forEach(function(f){ document.getElementById('f-'+f).classList.toggle('active', f===key); });
  if (!silent) updateVP();
}

function updateVP() {
  var v = readVF(); VS = Object.assign(VS, v);
  ['vp1','vp2','vp3'].forEach(function(id){ var el=document.getElementById(id); if(el) el.innerHTML=buildPrevHTML(v); });
}

function buildPrevHTML(v) {
  var c=v.color||'#1D9E75', ff=v.ff||'Arial,sans-serif', t=v.tpl||'klassisch';
  var firma=v.firma||'Musterunternehmen GmbH', adr=v.adr||'Musterstraße 1, 1010 Wien';
  var hdr='',bdy='',ftr='';
  if (t==='modern') {
    hdr='<div style="background:'+c+';padding:14px 20px;display:flex;justify-content:space-between"><div style="color:#fff;font-size:13px;font-weight:700">'+firma+'</div><div style="color:#fff;text-align:right;font-size:9px">Nr.: AR-2026-0001<br>16.03.2026</div></div><div style="padding:12px 20px 6px"><div style="font-size:14px;font-weight:700;color:'+c+'">'+v.ta+'</div></div><div style="height:1px;background:#eee;margin:0 20px"></div>';
  } else if (t==='minimal') {
    hdr='<div style="padding:18px 20px 10px"><div style="display:flex;justify-content:space-between"><div style="font-size:13px;font-weight:700">'+firma+'</div><div style="font-size:16px;letter-spacing:2px">'+v.ta+'</div></div><div style="height:1px;background:'+c+';margin:8px 0 4px"></div><div style="font-size:9px;color:#888;display:flex;justify-content:space-between"><span>'+adr+'</span><span>Nr.: AR-2026-0001</span></div></div>';
  } else {
    hdr='<div style="padding:18px 20px 10px;display:flex;justify-content:space-between"><div><div style="font-size:14px;font-weight:700;color:'+c+'">'+firma+'</div><div style="font-size:9px;color:#666;margin-top:2px">'+adr+'</div></div><div style="text-align:right"><div style="font-size:16px;font-weight:700;color:'+c+'">'+v.ta+'</div><div style="font-size:9px;color:#666;margin-top:3px">Nr.: AR-2026-0001<br>16.03.2026</div></div></div><div style="height:2px;background:'+c+';margin:0 20px"></div>';
  }
  bdy='<div style="padding:8px 20px"><div style="font-size:9px;color:#666;margin-bottom:8px"><strong>Rechnungsempfänger:</strong><br>Beispiel GmbH, Wien</div><table style="width:100%;border-collapse:collapse;font-size:9px"><thead><tr style="background:'+(t==='minimal'?'#f5f5f5':c)+';color:'+(t==='minimal'?'#333':'#fff')+'"><th style="padding:5px 6px;text-align:left">Beschreibung</th><th style="padding:5px 6px">Menge</th><th style="padding:5px 6px;text-align:right">Preis</th><th style="padding:5px 6px;text-align:right">Betrag</th></tr></thead><tbody><tr><td style="padding:4px 6px">Beratung</td><td style="padding:4px 6px;text-align:center">8</td><td style="padding:4px 6px;text-align:right">95,00 €</td><td style="padding:4px 6px;text-align:right">760,00 €</td></tr></tbody></table><div style="text-align:right;font-size:9px;margin-top:6px;padding-top:6px;border-top:1px solid #eee"><div style="font-weight:700;color:'+c+'">Gesamt: 912,00 €</div></div><div style="font-size:8px;color:#888;margin-top:8px">'+(v.zb||'')+'</div></div>';
  ftr=v.showFooter ? '<div style="margin:6px 20px 10px;padding-top:6px;border-top:1px solid #eee;font-size:8px;color:#aaa;text-align:center">'+(v.f1||'')+'</div>' : '';
  return '<div style="font-family:'+ff+';color:#222">'+hdr+bdy+ftr+'</div>';
}

function switchVT(tab) {
  ['layout','inhalt','firma'].forEach(function(t){
    document.getElementById('vt-'+t).classList.toggle('active', t===tab);
    document.getElementById('vtc-'+t).style.display = t===tab ? 'block' : 'none';
  });
  updateVP();
}

function saveV() {
  var v = readVF(); var d = getDB(); d.vorlage=v; saveDB(d);
  var el = document.getElementById('v-alert');
  el.innerHTML = '<div class="alert success">&#10003; Vorlage gespeichert!</div>';
  setTimeout(function(){ el.innerHTML=''; }, 3000);
}

function resetV() { var d=getDB(); d.vorlage=dfV(); saveDB(d); loadVF(); }

// ================================================================
// ZULASSUNG SCANNER
// ================================================================
function openScanner() {
  document.getElementById('modal-body').innerHTML =
    '<h3>&#128247; Zulassungsbescheinigung scannen</h3>' +
    '<p style="font-family:sans-serif;font-size:12px;color:#666;margin-bottom:1rem">Foto oder PDF hochladen — Daten werden von Claude automatisch erkannt.</p>' +
    '<div class="scan-drop" id="scan-drop">' +
      '<input type="file" id="scan-file" accept="image/*,application/pdf" style="display:none">' +
      '<div style="font-size:2.5rem">&#128247;</div>' +
      '<div style="font-family:sans-serif;font-size:14px;color:#666;margin-top:8px">Bild oder PDF ablegen oder klicken</div>' +
      '<div style="font-family:sans-serif;font-size:11px;color:#aaa;margin-top:4px">JPG, PNG, HEIC, PDF</div>' +
    '</div>' +
    '<div id="scan-status"></div>';
  openModal();

  var drop = document.getElementById('scan-drop');
  var fileInput = document.getElementById('scan-file');

  drop.addEventListener('click', function(){ fileInput.click(); });
  drop.addEventListener('dragover', function(e){ e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', function(){ drop.classList.remove('drag'); });
  drop.addEventListener('drop', function(e){ e.preventDefault(); drop.classList.remove('drag'); handleScan(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', function(){ handleScan(this.files[0]); });
}

function pdfToImage(file) {
  return new Promise(function(resolve, reject){
    function run(){
      var lib = window['pdfjs-dist/build/pdf'];
      if (!lib) { reject(new Error('PDF.js nicht verfügbar')); return; }
      lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      var r = new FileReader();
      r.onload = function(e){
        lib.getDocument({data: new Uint8Array(e.target.result)}).promise.then(function(pdf){
          return pdf.getPage(1);
        }).then(function(page){
          var vp = page.getViewport({scale:2});
          var canvas = document.createElement('canvas');
          canvas.width = vp.width; canvas.height = vp.height;
          return page.render({canvasContext:canvas.getContext('2d'), viewport:vp}).promise.then(function(){
            resolve(canvas.toDataURL('image/jpeg', 0.92));
          });
        }).catch(reject);
      };
      r.readAsArrayBuffer(file);
    }
    if (window['pdfjs-dist/build/pdf']) { run(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = run;
    s.onerror = function(){ reject(new Error('PDF.js konnte nicht geladen werden')); };
    document.head.appendChild(s);
  });
}

async function handleScan(file) {
  if (!file) return;
  var status = document.getElementById('scan-status');
  status.innerHTML = '<div style="text-align:center;padding:1.5rem"><span class="spinner"></span><span style="font-family:sans-serif;font-size:13px;color:#666">Lade Datei...</span></div>';
  try {
    var dataUrl;
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      status.innerHTML = '<div style="text-align:center;padding:1.5rem"><span class="spinner"></span><span style="font-family:sans-serif;font-size:13px;color:#666">Konvertiere PDF...</span></div>';
      dataUrl = await pdfToImage(file);
    } else {
      dataUrl = await new Promise(function(res, rej){ var r=new FileReader(); r.onload=function(e){res(e.target.result);}; r.onerror=rej; r.readAsDataURL(file); });
    }
    status.innerHTML = '<img src="' + dataUrl + '" class="scan-preview"><div style="text-align:center;margin-top:1rem"><span class="spinner"></span><span style="font-family:sans-serif;font-size:13px;color:#666">Claude analysiert die Zulassungsbescheinigung...</span></div>';

    var base64 = dataUrl.split(',')[1];
    var apiKey = localStorage.getItem('bp_apikey') || '';
    var useProxy = localStorage.getItem('bp_proxy') === '1';
    var endpoint = useProxy ? 'http://localhost:3742/api' : 'https://api.anthropic.com/v1/messages';
    var headers = {'Content-Type': 'application/json'};
    if (!useProxy && apiKey) {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    }
    var resp = await fetch(endpoint, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{role:'user', content:[
          {type:'image', source:{type:'base64', media_type:'image/jpeg', data:base64}},
          {type:'text', text:'Dies ist eine Zulassungsbescheinigung. Antworte NUR mit diesem JSON (kein Markdown):\n{"name":"Vollständiger Name","adresse":"Straße Nr, PLZ Ort","marke":"Marke Modell","kennzeichen":"Kennzeichen","vin":"Fahrgestellnummer","erstzulassung":"TT.MM.JJJJ"}\nNicht lesbare Felder leer lassen.'}
        ]}]
      })
    });

    if (!resp.ok) { var t = await resp.text(); throw new Error('API ' + resp.status + ': ' + t.substr(0,150)); }
    var data = await resp.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    var text = (data.content || []).map(function(c){ return c.text || ''; }).join('');
    var match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Kein JSON erhalten: ' + text.substr(0,150));
    var p = JSON.parse(match[0]);

    status.innerHTML =
      '<img src="' + dataUrl + '" class="scan-preview">' +
      '<div class="card" style="margin-top:1rem">' +
        '<h3>Erkannte Daten — bitte prüfen</h3>' +
        '<div class="scan-field"><label>Name</label><input id="sr-name" value="' + esc(p.name||'') + '"></div>' +
        '<div class="scan-field"><label>Adresse</label><input id="sr-adr" value="' + esc(p.adresse||'') + '"></div>' +
        '<div class="scan-field"><label>Marke / Modell</label><input id="sr-marke" value="' + esc(p.marke||'') + '"></div>' +
        '<div class="scan-field"><label>Kennzeichen</label><input id="sr-kz" value="' + esc(p.kennzeichen||'') + '"></div>' +
        '<div class="scan-field"><label>VIN / Fahrgestellnr.</label><input id="sr-vin" value="' + esc(p.vin||'') + '"></div>' +
        '<div class="scan-field"><label>Erstzulassung</label><input id="sr-ez" value="' + esc(p.erstzulassung||'') + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:1rem">' +
        '<button class="btn" id="scan-retry">Anderes Bild</button>' +
        '<button class="btn primary" id="scan-save">&#10003; Kunde &amp; Fahrzeug anlegen</button>' +
      '</div>';

    document.getElementById('scan-retry').addEventListener('click', function(){ document.getElementById('scan-file').click(); });
    document.getElementById('scan-save').addEventListener('click', createFromScan);

  } catch(err) {
    status.innerHTML =
      '<div class="alert danger" style="margin-top:1rem"><strong>Fehler:</strong> ' + esc(err.message) + '</div>' +
      '<button class="btn" id="scan-retry2" style="margin-top:8px">Erneut versuchen</button>';
    document.getElementById('scan-retry2').addEventListener('click', function(){ document.getElementById('scan-file').click(); });
    console.error(err);
  }
}

function createFromScan() {
  var p = {
    name:         document.getElementById('sr-name').value,
    adresse:      document.getElementById('sr-adr').value,
    marke:        document.getElementById('sr-marke').value,
    kennzeichen:  document.getElementById('sr-kz').value,
    vin:          document.getElementById('sr-vin').value,
    erstzulassung:document.getElementById('sr-ez').value
  };
  var d = getDB(), kidNew = uid();
  d.kunden.push({id:kidNew, name:p.name||'Unbekannt', adresse:p.adresse||'', uid:'', email:''});
  d.fahrzeuge.push({id:uid(), kundeId:kidNew, kundeName:p.name||'Unbekannt', marke:p.marke||'', kennzeichen:p.kennzeichen||'', vin:p.vin||'', erstzulassung:p.erstzulassung||'', erstellt:new Date().toISOString()});
  saveDB(d);
  closeModal();
  SP('kunden');
}

// ================================================================
// SETTINGS
// ================================================================
document.getElementById('nav-einstellungen').addEventListener('click', function(){ SP('einstellungen'); });

function initSettings() {
  var key = localStorage.getItem('bp_apikey') || '';
  var proxy = localStorage.getItem('bp_proxy') === '1';
  document.getElementById('api-key-input').value = key;
  document.getElementById('api-method').value = proxy ? 'proxy' : 'direct';
  toggleApiMethod();
}

function toggleApiMethod() {
  var method = document.getElementById('api-method').value;
  document.getElementById('api-key-section').style.display = method === 'direct' ? 'block' : 'none';
  document.getElementById('proxy-section').style.display   = method === 'proxy'  ? 'block' : 'none';
}

document.getElementById('api-method').addEventListener('change', toggleApiMethod);

document.getElementById('btn-save-api').addEventListener('click', function(){
  var method = document.getElementById('api-method').value;
  var key    = document.getElementById('api-key-input').value.trim();
  localStorage.setItem('bp_proxy',  method === 'proxy' ? '1' : '0');
  localStorage.setItem('bp_apikey', key);
  var el = document.getElementById('api-test-result');
  el.innerHTML = '<div class="alert success">&#10003; Gespeichert!</div>';
  setTimeout(function(){ el.innerHTML=''; }, 2000);
});

document.getElementById('btn-test-api').addEventListener('click', async function(){
  var el = document.getElementById('api-test-result');
  el.innerHTML = '<div class="alert info"><span class="spinner"></span>Teste Verbindung...</div>';
  try {
    var apiKey  = localStorage.getItem('bp_apikey') || '';
    var useProxy = localStorage.getItem('bp_proxy') === '1';
    var endpoint = useProxy ? 'http://localhost:3742/api' : 'https://api.anthropic.com/v1/messages';
    var headers = {'Content-Type': 'application/json'};
    if (!useProxy && apiKey) { headers['x-api-key'] = apiKey; headers['anthropic-version'] = '2023-06-01'; }
    var resp = await fetch(endpoint, {
      method: 'POST', headers: headers,
      body: JSON.stringify({model:'claude-haiku-4-5-20251001', max_tokens:10, messages:[{role:'user',content:'Hi'}]})
    });
    var data = await resp.json();
    if (data.content || data.id) {
      el.innerHTML = '<div class="alert success">&#10003; Verbindung erfolgreich! Claude antwortet.</div>';
    } else {
      el.innerHTML = '<div class="alert danger">Fehler: ' + JSON.stringify(data.error||data).substr(0,200) + '</div>';
    }
  } catch(err) {
    el.innerHTML = '<div class="alert danger">Fehler: ' + err.message + '</div>';
  }
});

// ================================================================
// INIT
// ================================================================
function editKunde(id) {
  var d=getDB(), k=d.kunden.find(function(x){return x.id===id;});
  if(!k) return;
  var kFzList=d.fahrzeuge.filter(function(f){return f.kundeId===id;}).map(function(f){return {id:f.id,marke:f.marke||'',kz:f.kennzeichen||''};});
  if(!kFzList.length) kFzList=[{marke:'',kz:''}];
  function renderKFz() {
    document.getElementById('k-fz-list').innerHTML=kFzList.map(function(fz,i){
      return '<div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">'+
        '<input class="kfz-m" placeholder="Marke" value="'+esc(fz.marke)+'" data-i="'+i+'" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif">'+
        '<input class="kfz-k" placeholder="Kennzeichen" value="'+esc(fz.kz)+'" data-i="'+i+'" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif">'+
        (kFzList.length>1?'<button class="btn kfz-x" data-i="'+i+'" style="padding:4px 8px;font-size:11px">&#x2715;</button>':'')+
      '</div>';
    }).join('');
    document.querySelectorAll('.kfz-m').forEach(function(el){el.oninput=function(){kFzList[this.dataset.i].marke=this.value;};});
    document.querySelectorAll('.kfz-k').forEach(function(el){el.oninput=function(){kFzList[this.dataset.i].kz=this.value;};});
    document.querySelectorAll('.kfz-x').forEach(function(el){el.onclick=function(){kFzList.splice(parseInt(this.dataset.i),1);renderKFz();};});
  }
  document.getElementById('modal-body').innerHTML=
    '<h3>Kunde bearbeiten</h3>'+
    '<div class="fg"><label>Name *</label><input type="text" id="k-name" value="'+esc(k.name||'')+'"></div>'+
    '<div class="fg"><label>Adresse</label><textarea id="k-adr">'+esc(k.adresse||'')+'</textarea></div>'+
    '<div class="fr c2"><div class="fg"><label>UID</label><input id="k-uid" value="'+esc(k.uid||'')+'"></div><div class="fg"><label>E-Mail</label><input id="k-email" type="email" value="'+esc(k.email||'')+'"></div></div>'+
    '<div style="margin-top:1rem;padding-top:1rem;border-top:1px solid #eee">'+
      '<div style="font-family:sans-serif;font-size:12px;font-weight:500;color:#666;margin-bottom:8px">Fahrzeuge</div>'+
      '<div id="k-fz-list"></div>'+
      '<button class="btn" id="k-add-fz" style="font-size:12px;margin-top:4px">+ Fahrzeug</button>'+
    '</div>'+
    '<div style="text-align:right;margin-top:1rem"><button class="btn primary" id="btn-save-kunde-edit">Speichern</button></div>';
  openModal(); renderKFz();
  document.getElementById('k-add-fz').onclick=function(){kFzList.push({marke:'',kz:''});renderKFz();};
  document.getElementById('btn-save-kunde-edit').addEventListener('click',function(){
    var name=document.getElementById('k-name').value.trim();
    if(!name){alert('Name eingeben');return;}
    var d2=getDB(), ki=d2.kunden.findIndex(function(x){return x.id===id;});
    if(ki!==-1) d2.kunden[ki]=Object.assign(d2.kunden[ki],{name:name,adresse:document.getElementById('k-adr').value,uid:document.getElementById('k-uid').value,email:document.getElementById('k-email').value});
    d2.fahrzeuge=d2.fahrzeuge.filter(function(f){return f.kundeId!==id;});
    kFzList.forEach(function(fz){if(fz.marke||fz.kz){d2.fahrzeuge.push({id:uid(),kundeId:id,kundeName:name,marke:fz.marke,kennzeichen:fz.kz,vin:'',erstzulassung:'',erstellt:new Date().toISOString()});}});
    saveDB(d2);closeModal();renderKunden();
  });
}
function editLief(id) {
  var d=getDB(), l=d.lieferanten.find(function(x){return x.id===id;});
  if(!l) return;
  document.getElementById('modal-body').innerHTML=
    '<h3>Lieferant bearbeiten</h3>'+
    '<div class="fg"><label>Name *</label><input type="text" id="l-name" value="'+esc(l.name||'')+'"></div>'+
    '<div class="fg"><label>Adresse</label><textarea id="l-adr">'+esc(l.adresse||'')+'</textarea></div>'+
    '<div class="fr c2"><div class="fg"><label>UID</label><input id="l-uid" value="'+esc(l.uid||'')+'"></div><div class="fg"><label>E-Mail</label><input id="l-email" type="email" value="'+esc(l.email||'')+'"></div></div>'+
    '<div style="text-align:right;margin-top:1rem"><button class="btn primary" id="btn-save-lief-edit">Speichern</button></div>';
  openModal();
  document.getElementById('btn-save-lief-edit').addEventListener('click',function(){
    var name=document.getElementById('l-name').value.trim();
    if(!name){alert('Name eingeben');return;}
    var d2=getDB(), li=d2.lieferanten.findIndex(function(x){return x.id===id;});
    if(li!==-1) d2.lieferanten[li]=Object.assign(d2.lieferanten[li],{name:name,adresse:document.getElementById('l-adr').value,uid:document.getElementById('l-uid').value,email:document.getElementById('l-email').value});
    saveDB(d2);closeModal();renderLief();
  });
}
function editFz(id) {
  var d=getDB(), f=d.fahrzeuge.find(function(x){return x.id===id;});
  if(!f) return;
  var kOpts=d.kunden.map(function(k){return '<option value="'+k.id+'"'+(k.id===f.kundeId?' selected':'')+'>'+esc(k.name)+'</option>';}).join('');
  document.getElementById('modal-body').innerHTML=
    '<h3>Fahrzeug bearbeiten</h3>'+
    '<div class="fg"><label>Kunde</label><select id="fz-kid"><option value="">— kein Kunde —</option>'+kOpts+'</select></div>'+
    '<div class="fr c2"><div class="fg"><label>Marke / Modell</label><input id="fz-marke" value="'+esc(f.marke||'')+'"></div><div class="fg"><label>Kennzeichen</label><input id="fz-kz" value="'+esc(f.kennzeichen||'')+'"></div></div>'+
    '<div class="fr c2"><div class="fg"><label>VIN</label><input id="fz-vin" value="'+esc(f.vin||'')+'"></div><div class="fg"><label>Erstzulassung</label><input id="fz-ez" value="'+esc(f.erstzulassung||'')+'"></div></div>'+
    '<div style="text-align:right;margin-top:1rem"><button class="btn primary" id="btn-save-fz-edit">Speichern</button></div>';
  openModal();
  document.getElementById('btn-save-fz-edit').addEventListener('click',function(){
    var d2=getDB(), fi=d2.fahrzeuge.findIndex(function(x){return x.id===id;});
    if(fi!==-1){
      var kid=document.getElementById('fz-kid').value;
      var kn=d2.kunden.find(function(x){return x.id===kid;});
      d2.fahrzeuge[fi]=Object.assign(d2.fahrzeuge[fi],{kundeId:kid,kundeName:kn?kn.name:'',marke:document.getElementById('fz-marke').value.trim(),kennzeichen:document.getElementById('fz-kz').value.trim(),vin:document.getElementById('fz-vin').value.trim(),erstzulassung:document.getElementById('fz-ez').value.trim()});
    }
    saveDB(d2);closeModal();renderFahrzeuge();
  });
}

function updateItemExtra(i, field, value) {
  if (field === 'extraLabel') {
    itemsData[i].extraLabel = value;
    // No renderItems - keeps focus in the field
  } else {
    itemsData[i][field] = parseFloat(value) || 0;
    renderSum();
  }
}

var _malgunFontB64 = null;
var _georgiaFontB64 = null;
var _georgiaBoldFontB64 = null;

function loadMalgunFont() {
  if (window.electronAPI && window.electronAPI.readFont) {
    window.electronAPI.readFont('malgunsl.ttf').then(function(b64) {
      if (b64) _malgunFontB64 = b64;
    });
    window.electronAPI.readFont('georgia.ttf').then(function(b64) {
      if (b64) _georgiaFontB64 = b64;
    });
    window.electronAPI.readFont('georgiab.ttf').then(function(b64) {
      if (b64) _georgiaBoldFontB64 = b64;
    });
  }
}

window.onload = function(){ loadMalgunFont(); renderDash(); };

var _motTimer = null;
var _motCanvas = null;
var _motCtx = null;
var _particles = [];

var MOTIVATIONS = [
  { msg: 'I luv u 💕', emoji: '❤️', color1: '#ff6b9d', color2: '#ff8e53', type: 'hearts' },
  { msg: 'Ich glaub an dich!', emoji: '🔥', color1: '#ff6b00', color2: '#ffcc00', type: 'fireworks' },
  { msg: 'Du schaffst das!', emoji: '💪', color1: '#1D9E75', color2: '#00d4aa', type: 'fireworks' },
  { msg: 'Alles wird gut ✨', emoji: '⭐', color1: '#a78bfa', color2: '#60a5fa', type: 'stars' },
  { msg: 'I luv u so much!', emoji: '🥰', color1: '#f472b6', color2: '#fb7185', type: 'hearts' },
  { msg: 'Du bist die Beste!', emoji: '👑', color1: '#fbbf24', color2: '#f59e0b', type: 'fireworks' },
];

function showMotivation() {
  var mot = MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)];
  var overlay = document.getElementById('motivation-overlay');
  document.getElementById('mot-emoji').textContent = mot.emoji;
  document.getElementById('mot-msg').textContent = mot.msg;
  document.getElementById('mot-msg').style.background = 'linear-gradient(135deg,' + mot.color1 + ',' + mot.color2 + ')';
  document.getElementById('mot-msg').style.webkitBackgroundClip = 'text';
  document.getElementById('mot-msg').style.webkitTextFillColor = 'transparent';
  document.getElementById('mot-msg').style.backgroundClip = 'text';
  overlay.style.display = 'flex';

  // Reset text animation
  var txt = document.getElementById('motivation-text');
  txt.style.animation = 'none';
  txt.offsetHeight;
  txt.style.animation = 'motPop 0.5s cubic-bezier(0.34,1.56,0.64,1)';

  // Start particle animation
  _motCanvas = document.getElementById('motivation-canvas');
  _motCanvas.width = window.innerWidth;
  _motCanvas.height = window.innerHeight;
  _motCtx = _motCanvas.getContext('2d');
  _particles = [];
  startParticles(mot.type, mot.color1, mot.color2);
}

function closeMotivation() {
  document.getElementById('motivation-overlay').style.display = 'none';
  _particles = [];
  if (_motTimer) { cancelAnimationFrame(_motTimer); _motTimer = null; }
  if (_motCtx) _motCtx.clearRect(0, 0, _motCanvas.width, _motCanvas.height);
}

function startParticles(type, c1, c2) {
  var W = _motCanvas.width, H = _motCanvas.height;

  function spawnBurst() {
    if (type === 'hearts') {
      for (var i=0; i<6; i++) {
        _particles.push({
          x: Math.random()*W, y: H + 20,
          vx: (Math.random()-0.5)*2, vy: -(3+Math.random()*4),
          size: 20+Math.random()*40, alpha: 1,
          color: Math.random()>0.5?c1:c2, type:'heart',
          sway: Math.random()*0.05, swayOffset: Math.random()*Math.PI*2
        });
      }
    } else if (type === 'fireworks' || type === 'stars') {
      var ex = 100+Math.random()*(W-200), ey = 50+Math.random()*(H/2);
      var col = Math.random()>0.5?c1:c2;
      for (var j=0; j<30; j++) {
        var ang = Math.random()*Math.PI*2, spd = 3+Math.random()*6;
        _particles.push({
          x:ex, y:ey, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd,
          size: type==='stars'?3:2+Math.random()*3, alpha:1,
          color:col, type:'spark', gravity:0.12
        });
      }
    }
  }

  var spawnInterval = setInterval(function(){
    if (document.getElementById('motivation-overlay').style.display==='none') { clearInterval(spawnInterval); return; }
    spawnBurst();
  }, type==='hearts'?600:400);
  spawnBurst();

  function animate() {
    if (document.getElementById('motivation-overlay').style.display==='none') return;
    _motCtx.clearRect(0,0,W,H);
    _particles = _particles.filter(function(p){ return p.alpha>0.05 && p.y<H+60 && p.y>-60; });
    _particles.forEach(function(p){
      _motCtx.save();
      _motCtx.globalAlpha = p.alpha;
      if (p.type==='heart') {
        p.x += p.vx + Math.sin(Date.now()*p.sway+p.swayOffset)*0.5;
        p.y += p.vy;
        p.alpha -= 0.005;
        _motCtx.font = p.size+'px serif';
        _motCtx.fillStyle = p.color;
        _motCtx.fillText('❤', p.x, p.y);
      } else {
        p.vx *= 0.98; p.vy += p.gravity;
        p.x += p.vx; p.y += p.vy;
        p.alpha -= 0.018;
        _motCtx.beginPath();
        _motCtx.arc(p.x, p.y, p.size, 0, Math.PI*2);
        _motCtx.fillStyle = p.color;
        _motCtx.fill();
      }
      _motCtx.restore();
    });
    _motTimer = requestAnimationFrame(animate);
  }
  animate();
}

// ================================================================
// DOWNLOAD FUNCTIONS (Bankbuch / Kassabuch / Export)
// ================================================================
function initBuchMonat(art) {
  var sm=document.getElementById('buch-'+art+'-m'), sy=document.getElementById('buch-'+art+'-y');
  if(!sm||!sy) return;
  var now=new Date();
  sm.innerHTML='<option value="">Alle Monate</option>'+MONTHS.map(function(mn,i){return '<option value="'+i+'">'+mn+'</option>';}).join('');
  sm.value=now.getMonth();
  sy.innerHTML='';
  for(var y=now.getFullYear()-2;y<=now.getFullYear();y++) sy.innerHTML+='<option value="'+y+'">'+y+'</option>';
  sy.value=now.getFullYear();
  sm.onchange=function(){updateBuchMonat(art);};
  sy.onchange=function(){updateBuchMonat(art);};
  updateBuchMonat(art);
}
function updateBuchMonat(art) {
  var sm=document.getElementById('buch-'+art+'-m'), sy=document.getElementById('buch-'+art+'-y');
  if(!sm||!sy) return;
  var buchId=art==='bank'?'bankbuch':'kassabuch';
  var vonEl=document.getElementById('f-'+buchId+'-von'), bisEl=document.getElementById('f-'+buchId+'-bis');
  if(sm.value==='') {
    if(vonEl) vonEl.value=''; if(bisEl) bisEl.value='';
  } else {
    var m=parseInt(sm.value), y=parseInt(sy.value);
    var lastDay=new Date(y,m+1,0).getDate();
    if(vonEl) vonEl.value=y+'-'+String(m+1).padStart(2,'0')+'-01';
    if(bisEl) bisEl.value=y+'-'+String(m+1).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
  }
  renderBuchKassa(art);
}
function getBuchInvs(art) {
  var d=getDB(), pageId=art==='bank'?'bankbuch':'kassabuch';
  var s=(document.getElementById('s-'+pageId)||{value:''}).value.toLowerCase();
  var von=(document.getElementById('f-'+pageId+'-von')||{value:''}).value;
  var bis=(document.getElementById('f-'+pageId+'-bis')||{value:''}).value;
  var st=(document.getElementById('f-'+pageId+'-status')||{value:''}).value;
  var invs=d.invoices.filter(function(i){return i.zahlungsart===art;});
  if(s) invs=invs.filter(function(i){return((i.nummer||'')+(i.partner_name||'')).toLowerCase().indexOf(s)!==-1;});
  if(von) invs=invs.filter(function(i){return i.datum>=von;});
  if(bis) invs=invs.filter(function(i){return i.datum<=bis;});
  if(st) invs=invs.filter(function(i){return i.status===st;});
  return invs.sort(function(a,b){return a.datum>b.datum?1:-1;});
}
function buildRows(invs) {
  var rows=[['RE Datum','RE Nr.','Lfd. Nr.','Zahlungsart','Einnahmen','USt.','Ausgabe','USt.','Saldo']];
  invs.forEach(function(inv){
    var nt=netto(inv),va=vatAmt(inv),br=Math.round((nt+va+(inv.materialkosten||0))*100)/100;
    var isAR=inv.typ==='ausgang';
    var lfd=(inv.nummer||'').replace(/[^0-9]/g,'').replace(/^0+/,'');
    var zart=inv.zahlungsart==='kassa'?'Kassa':'Bank';
    rows.push([fmtD(inv.datum),inv.nummer||'',lfd,zart,
      isAR?br.toFixed(2).replace('.',','):'',
      isAR?va.toFixed(2).replace('.',','):'',
      isAR?'':br.toFixed(2).replace('.',','),
      isAR?'':va.toFixed(2).replace('.',','),
      '']);
  });
  var tEB=0,tEV=0,tAB=0,tAV=0;
  invs.forEach(function(i){
    var va=vatAmt(i),br=netto(i)+va+(i.materialkosten||0);
    if(i.typ==='ausgang'){tEB+=br;tEV+=va;}else{tAB+=br;tAV+=va;}
  });
  var saldo=tEB-tAB;
  var salStr=(saldo>=0?'+ ':'− ')+Math.abs(saldo).toFixed(2).replace('.',',');
  rows.push([]);
  rows.push(['GESAMT','','','',tEB.toFixed(2).replace('.',','),tEV.toFixed(2).replace('.',','),tAB.toFixed(2).replace('.',','),tAV.toFixed(2).replace('.',','),salStr]);
  return rows;
}
function toCSV(rows){
  return '\uFEFF'+rows.map(function(r){return r.map(function(c){return '"'+String(c||'').replace(/"/g,'""')+'"';}).join(';');}).join('\r\n');
}
function toPDF(rows,title){
  if(!window.jspdf){alert('PDF nicht verfuegbar');return;}
  var doc=new window.jspdf.jsPDF({unit:'mm',format:'a4'});
  var ML=10,y=16,cw=[22,32,16,18,26,18,26,18,16];
  doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(30,30,30);doc.text(title,ML,y);y+=5;
  doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.setTextColor(140,140,140);
  doc.text('Erstellt: '+fmtD(new Date().toISOString().split('T')[0]),ML,y);y+=7;
  var totalW=cw.reduce(function(a,b){return a+b;},0);
  doc.setFillColor(235,235,235);doc.rect(ML,y-4,totalW,7,'F');
  doc.setFont('helvetica','bold');doc.setFontSize(7.5);doc.setTextColor(40,40,40);
  var cx=ML;rows[0].forEach(function(h,i){doc.text(String(h||''),cx+1,y);cx+=cw[i];});y+=7;
  doc.setFont('helvetica','normal');
  rows.slice(1).forEach(function(row,ri){
    if(!row.length){y+=2;return;}
    if(y>280){doc.addPage();y=16;}
    // Bold last 2 rows (totals)
    var isTot = ri >= rows.length-3;
    if(isTot){doc.setFont('helvetica','bold');doc.setFillColor(240,240,240);doc.rect(ML,y-4,totalW,7,'F');}
    else if(ri%2===1){doc.setFillColor(250,250,250);doc.rect(ML,y-4,totalW,7,'F');}
    doc.setTextColor(30,30,30);cx=ML;
    row.forEach(function(cell,i){var t=String(cell||'');if(t.length>14)t=t.substr(0,13)+'~';doc.text(t,cx+1,y);cx+=cw[i];});
    if(isTot)doc.setFont('helvetica','normal');
    y+=7;
  });
  doc.save(title+'.pdf');
}
function dlBuch(art,fmt){
  var title=art==='bank'?'Bankbuch':'Kassabuch';
  var rows=buildRows(getBuchInvs(art));
  if(fmt==='excel'){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([toCSV(rows)],{type:'text/csv;charset=utf-8;'}));a.download=title+'_'+new Date().toISOString().split('T')[0]+'.csv';a.click();}
  else toPDF(rows,title);
}
function dlExport(fmt){
  var d=getDB();
  var m=parseInt(document.getElementById('ex-m').value);
  var yr=parseInt(document.getElementById('ex-y').value);
  var lastDay=new Date(yr,m+1,0).getDate();
  var dVonEl=document.getElementById('ex-d-von'), dBisEl=document.getElementById('ex-d-bis');
  var dVon=dVonEl?parseInt(dVonEl.value):1, dBis=dBisEl?parseInt(dBisEl.value):lastDay;
  var vonStr=yr+'-'+String(m+1).padStart(2,'0')+'-'+String(dVon).padStart(2,'0');
  var bisStr=yr+'-'+String(m+1).padStart(2,'0')+'-'+String(dBis).padStart(2,'0');
  var invs=d.invoices.filter(function(i){if(!i.datum)return false;return i.datum>=vonStr&&i.datum<=bisStr;}).sort(function(a,b){return a.datum>b.datum?1:-1;});
  var dayPart=(dVon===1&&dBis===lastDay)?'':'_'+dVon+'-'+dBis;
  var title='Export_'+String(m+1).padStart(2,'0')+'_'+yr+dayPart;
  var rows=buildRows(invs);
  if(fmt==='excel'){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([toCSV(rows)],{type:'text/csv;charset=utf-8;'}));a.download=title+'.csv';a.click();}
  else toPDF(rows,title);
}
function dlExportYear(fmt){
  var d=getDB();
  var yr=parseInt(document.getElementById('ex-y').value);
  var invs=d.invoices.filter(function(i){if(!i.datum)return false;var dt=new Date(i.datum);return dt.getFullYear()===yr;}).sort(function(a,b){return a.datum>b.datum?1:-1;});
  var title='Export_'+yr;
  var rows=buildRows(invs);
  if(fmt==='excel'){var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([toCSV(rows)],{type:'text/csv;charset=utf-8;'}));a.download=title+'.csv';a.click();}
  else toPDF(rows,title);
}

// ================================================================
// KOSTENVORANSCHLAG
// ================================================================
var kvItemsData = [{fz_marke:'', fz_kz:'', beschreibung:'', anzahl:1, betrag:0}];

function initKVForm() {
  var now = new Date().toISOString().split('T')[0];
  var datEl = document.getElementById('kv-datum');
  if (datEl) datEl.value = now;
  var pinfoEl = document.getElementById('kv-pinfo');
  if (pinfoEl) pinfoEl.value = '';
  var alertEl = document.getElementById('kv-alerts');
  if (alertEl) alertEl.innerHTML = '';
  var partnerEl = document.getElementById('kv-partner');
  if (partnerEl) partnerEl.value = '';
  var detailEl = document.getElementById('kv-partner-detail');
  if (detailEl) detailEl.style.display = 'none';
  var mwstEl = document.getElementById('kv-mwst-pct');
  if (mwstEl) mwstEl.value = '20';

  kvItemsData = [{fz_marke:'', fz_kz:'', beschreibung:'', anzahl:1, betrag:0}];
  kvPopulatePartner();
  renderKVItems();
  renderKVSum();

  var btnAdd = document.getElementById('kv-btn-add-item');
  if (btnAdd) btnAdd.onclick = function(){ addKVItem(); };
  var btnSave = document.getElementById('kv-btn-save');
  if (btnSave) btnSave.onclick = function(){ saveKV(); };
  var btnSaveB = document.getElementById('kv-btn-save-bottom');
  if (btnSaveB) btnSaveB.onclick = function(){ saveKV(); };
  var btnReset = document.getElementById('kv-btn-reset');
  if (btnReset) btnReset.onclick = function(){ initKVForm(); };
  var btnResetB = document.getElementById('kv-btn-reset-bottom');
  if (btnResetB) btnResetB.onclick = function(){ initKVForm(); };
  var btnNewP = document.getElementById('kv-btn-new-partner');
  if (btnNewP) btnNewP.onclick = function(){ openKVKundeModal(); };
  var partnerSel = document.getElementById('kv-partner');
  if (partnerSel) partnerSel.onchange = function(){ kvFillPD(); };
  var mwstInput = document.getElementById('kv-mwst-pct');
  if (mwstInput) mwstInput.oninput = function(){ renderKVSum(); };
}

function kvPopulatePartner() {
  var d = getDB();
  var sel = document.getElementById('kv-partner');
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="">-- Bitte wählen --</option>' +
    d.kunden.map(function(p){ return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('');
  if (cur) sel.value = cur;
}

function kvFillPD() {
  var partnerEl = document.getElementById('kv-partner');
  var detail = document.getElementById('kv-partner-detail');
  var infoEl = document.getElementById('kv-partner-info-display');
  if (!partnerEl || !detail || !infoEl) return;
  var id = partnerEl.value;
  if (!id) { detail.style.display = 'none'; return; }
  var d = getDB();
  var p = d.kunden.find(function(x){ return x.id === id; });
  if (!p) { detail.style.display = 'none'; return; }
  var pinfo = document.getElementById('kv-pinfo');
  if (pinfo) pinfo.value = p.name + (p.adresse ? '\n' + p.adresse : '');
  infoEl.innerHTML =
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">' +
      '<strong style="font-size:14px">' + esc(p.name) + '</strong>' +
    '</div>' +
    (p.adresse ? '<div style="color:#666;margin-top:3px">' + esc(p.adresse.replace(/\n/g, ', ')) + '</div>' : '') +
    (p.uid ? '<div style="color:#999;font-size:12px">UID: ' + esc(p.uid) + '</div>' : '') +
    (p.email ? '<div style="color:#999;font-size:12px">' + esc(p.email) + '</div>' : '');
  detail.style.display = 'block';
}

function openKVKundeModal() {
  document.getElementById('modal-body').innerHTML =
    '<h3>Neuer Kunde</h3>' +
    '<div class="fg"><label>Name *</label><input type="text" id="kvk-name"></div>' +
    '<div class="fg"><label>Adresse</label><textarea id="kvk-adr"></textarea></div>' +
    '<div class="fr c2"><div class="fg"><label>UID</label><input id="kvk-uid" type="text"></div><div class="fg"><label>E-Mail</label><input id="kvk-email" type="email"></div></div>' +
    '<div style="text-align:right;margin-top:1rem"><button class="btn primary" id="btn-kvk-save">Speichern</button></div>';
  openModal();
  document.getElementById('btn-kvk-save').addEventListener('click', function(){
    var name = document.getElementById('kvk-name').value.trim();
    if (!name) { alert('Name eingeben'); return; }
    var d = getDB();
    var newP = {id:uid(), name:name, adresse:document.getElementById('kvk-adr').value, uid:document.getElementById('kvk-uid').value, email:document.getElementById('kvk-email').value, erstellt:new Date().toISOString()};
    d.kunden.push(newP); saveDB(d);
    closeModal();
    kvPopulatePartner();
    var sel = document.getElementById('kv-partner');
    if (sel) { sel.value = newP.id; kvFillPD(); }
  });
}

function renderKVItems() {
  var container = document.getElementById('kv-items-container');
  if (!container) return;
  var badgeStyle = 'font-size:11px;padding:2px 10px;border-radius:20px;border:1px solid #ddd;background:#fff;cursor:pointer;font-family:sans-serif;color:#555';
  var html = '<table class="itbl" style="width:100%"><thead><tr>' +
    '<th style="text-align:left;padding:8px 6px">Fahrzeug (Marke / KZ)</th>' +
    '<th style="text-align:left;padding:8px 6px">Beschreibung</th>' +
    '<th style="text-align:center;padding:8px 6px;width:70px">Anzahl</th>' +
    '<th style="text-align:right;padding:8px 6px;width:110px">Betrag (€)</th>' +
    '<th style="width:36px;padding:8px 6px"></th>' +
    '</tr></thead><tbody>';
  kvItemsData.forEach(function(it, i) {
    html += '<tr>' +
      '<td style="padding:4px 4px">' +
        '<input type="text" value="' + esc(it.fz_marke || '') + '" data-i="' + i + '" class="kv-fz-marke" placeholder="Marke/Modell" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif;margin-bottom:3px;display:block">' +
        '<input type="text" value="' + esc(it.fz_kz || '') + '" data-i="' + i + '" class="kv-fz-kz" placeholder="Kennzeichen" style="width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif;display:block">' +
      '</td>' +
      '<td style="padding:4px 4px">' +
        '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">' +
          getPosBadges().map(function(b){ return '<button type="button" class="kv-pos-badge" data-i="' + i + '" data-val="'+esc(b)+'" style="' + badgeStyle + '">'+esc(b)+'</button>'; }).join('') +
        '</div>' +
        '<input type="text" value="' + esc(it.beschreibung) + '" data-i="' + i + '" class="kv-beschreibung" placeholder="Details..." style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif">' +
      '</td>' +
      '<td style="padding:4px 4px"><input type="number" value="' + it.anzahl + '" data-i="' + i + '" class="kv-anzahl" min="1" step="1" style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif;text-align:center"></td>' +
      '<td style="padding:4px 4px"><input type="number" value="' + (it.betrag || '') + '" data-i="' + i + '" class="kv-betrag" min="0" step="0.01" placeholder="0,00" style="width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:12px;font-family:sans-serif;text-align:right"></td>' +
      '<td style="padding:4px 2px;text-align:center">' +
        (kvItemsData.length > 1 ? '<button class="btn danger kv-del" data-i="' + i + '" style="padding:4px 8px;font-size:11px">&#x2715;</button>' : '') +
      '</td></tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
  container.querySelectorAll('.kv-fz-marke').forEach(function(el){
    el.oninput = function(){ kvItemsData[parseInt(this.dataset.i)].fz_marke = this.value; };
  });
  container.querySelectorAll('.kv-fz-kz').forEach(function(el){
    el.oninput = function(){ kvItemsData[parseInt(this.dataset.i)].fz_kz = this.value; };
  });
  container.querySelectorAll('.kv-beschreibung').forEach(function(el){
    el.oninput = function(){ kvItemsData[parseInt(this.dataset.i)].beschreibung = this.value; renderKVSum(); };
  });
  container.querySelectorAll('.kv-pos-badge').forEach(function(btn){
    btn.addEventListener('click', function(){
      var idx = parseInt(this.dataset.i);
      var val = this.dataset.val;
      var input = container.querySelector('.kv-beschreibung[data-i="' + idx + '"]');
      var cur = input ? input.value : (kvItemsData[idx].beschreibung || '');
      var sep = (cur && !cur.endsWith(' ')) ? ' ' : '';
      var newVal = cur + sep + val;
      if (input) input.value = newVal;
      kvItemsData[idx].beschreibung = newVal;
    });
  });
  container.querySelectorAll('.kv-anzahl').forEach(function(el){
    el.oninput = function(){ kvItemsData[parseInt(this.dataset.i)].anzahl = parseFloat(this.value) || 1; renderKVSum(); };
  });
  container.querySelectorAll('.kv-betrag').forEach(function(el){
    el.oninput = function(){ kvItemsData[parseInt(this.dataset.i)].betrag = parseFloat(this.value) || 0; renderKVSum(); };
  });
  container.querySelectorAll('.kv-del').forEach(function(el){
    el.onclick = function(){
      kvItemsData.splice(parseInt(this.dataset.i), 1);
      renderKVItems();
    };
  });
}

function addKVItem() {
  kvItemsData.push({fz_marke:'', fz_kz:'', beschreibung:'', anzahl:1, betrag:0});
  renderKVItems();
}

function renderKVSum() {
  var mwstPct = parseFloat((document.getElementById('kv-mwst-pct') || {value:'20'}).value) || 0;
  var netto = kvItemsData.reduce(function(s, it){
    return s + (parseFloat(it.anzahl) || 1) * (parseFloat(it.betrag) || 0);
  }, 0);
  var mwst = netto * mwstPct / 100;
  var gesamt = netto + mwst;
  var nettoEl = document.getElementById('kv-sum-netto');
  var mwstEl = document.getElementById('kv-sum-mwst');
  var gesamtEl = document.getElementById('kv-sum-gesamt');
  if (nettoEl) nettoEl.textContent = fmt(netto);
  if (mwstEl) mwstEl.textContent = fmt(mwst);
  if (gesamtEl) gesamtEl.textContent = fmt(gesamt);
}

function saveKV() {
  var datum = (document.getElementById('kv-datum') || {value:''}).value;
  var pinfo = (document.getElementById('kv-pinfo') || {value:''}).value.trim();
  var mwstPct = parseFloat((document.getElementById('kv-mwst-pct') || {value:'20'}).value) || 20;
  var partnerSel = document.getElementById('kv-partner');
  var partnerId = partnerSel ? partnerSel.value : '';
  var partnerName = '';
  if (partnerId) {
    var d0 = getDB();
    var p0 = d0.kunden.find(function(x){ return x.id === partnerId; });
    if (p0) partnerName = p0.name;
  }
  var kv = {
    id: uid(),
    partner_id: partnerId,
    partner_name: partnerName,
    partner_info: pinfo,
    datum: datum || new Date().toISOString().split('T')[0],
    items: kvItemsData.map(function(it){
      return {
        fz_marke: (it.fz_marke || '').trim(),
        fz_kz: (it.fz_kz || '').trim(),
        beschreibung: it.beschreibung,
        anzahl: parseFloat(it.anzahl) || 1,
        betrag: parseFloat(it.betrag) || 0
      };
    }),
    mwst_pct: mwstPct,
    erstellt: new Date().toISOString()
  };
  var d = getDB();
  if (!d.kostenvoranschlaege) d.kostenvoranschlaege = [];
  d.kostenvoranschlaege.push(kv);
  // Neue Fahrzeuge aus den Items im Register speichern
  kv.items.forEach(function(it) {
    if (!it.fz_kz) return;
    var exists = d.fahrzeuge.find(function(f){
      return (f.kennzeichen || '').trim().toUpperCase() === it.fz_kz.toUpperCase();
    });
    if (!exists) {
      d.fahrzeuge.push({
        id: uid(),
        kundeId: partnerId || '',
        kundeName: partnerName || '',
        marke: it.fz_marke || '',
        kennzeichen: it.fz_kz,
        vin: '',
        erstzulassung: '',
        erstellt: new Date().toISOString()
      });
    }
  });
  saveDB(d);
  genKVPDF(kv);
  setTimeout(function(){ SP('kv-liste'); }, 600);
}

function genKVPDF(kv) {
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({unit:'mm', format:'a4'});
  var d = getDB(), v = d.vorlage || dfV();
  var ff = v.font==='georgia' ? 'times' : v.font==='courier' ? 'courier' : 'helvetica';
  var xL = 25;
  var xR = 190;

  // ── Georgia Font laden (Fallback: times) ──────────────────────────
  var georgiaFont = 'times';
  if (_georgiaFontB64) {
    try {
      doc.addFileToVFS('georgia.ttf', _georgiaFontB64);
      doc.addFont('georgia.ttf', 'Georgia', 'normal');
      georgiaFont = 'Georgia';
    } catch(e) {}
  }
  if (_georgiaBoldFontB64) {
    try {
      doc.addFileToVFS('georgiab.ttf', _georgiaBoldFontB64);
      doc.addFont('georgiab.ttf', 'Georgia', 'bold');
    } catch(e) {}
  }

  function setF(sz, bold) {
    doc.setFont('times', 'normal');
    doc.setFontSize(sz || 11);
    doc.setTextColor(30, 30, 30);
  }

  function numFmt(n) {
    return new Intl.NumberFormat('de-AT', {minimumFractionDigits:2, maximumFractionDigits:2}).format(n);
  }

  // ── KOPFZEILE (Georgia, zentriert) ───────────────────────────────
  doc.setTextColor(30, 30, 30);
  doc.setFont(georgiaFont, 'bold');
  doc.setFontSize(24);
  doc.text('KAROSSERIEFACHWERKSTÄTTE', 105, 25, {align:'center'});
  doc.setFontSize(22);
  doc.text('KURT LINDITSCH GMBH', 105, 34, {align:'center'});
  doc.setFont(georgiaFont, 'normal');
  doc.setFontSize(9);
  doc.text('Jägerweg 42, A-8041 GRAZ', 105, 41, {align:'center'});
  doc.text('E-Mail: linditsch@a1.net     Tel.: 0676/343 134 2', 105, 46, {align:'center'});

  // TITEL — fett, oben (vor Datum)
  doc.setFont(ff, 'bold');
  doc.setFontSize(14);
  doc.setTextColor(30, 30, 30);
  doc.text('Kostenvoranschlag', xL, 110);

  // DATUM rechtsbündig
  setF(11);
  doc.text('Graz, ' + fmtD(kv.datum), xR, 66, {align:'right'});

  // KUNDENDATEN
  var y = 77;
  setF(11);
  if (kv.partner_info) {
    kv.partner_info.split('\n').forEach(function(l){ if(l.trim()){ doc.text(l.trim(), xL, y); y += 6; } });
  }

  // TABELLE HEADER
  var tY = 124;
  var col1 = xL;        // Fahrzeug
  var col2 = xL + 60;   // Beschreibung
  var col3 = xL + 130;  // Anzahl (zentriert)
  var col4 = xR;        // Betrag (rechtsbündig)

  doc.setFillColor(245, 245, 242);
  doc.rect(xL, tY - 5, xR - xL, 8, 'F');
  setF(10, true);
  doc.text('Fahrzeug', col1, tY);
  doc.text('Beschreibung', col2, tY);
  doc.text('Anzahl', col3, tY, {align:'center'});
  doc.text('Betrag (€)', col4, tY, {align:'right'});
  doc.setDrawColor(30, 30, 30);
  doc.setLineWidth(0.3);
  doc.line(xL, tY + 2, xR, tY + 2);

  // TABELLE ZEILEN
  setF(10, false);
  var yCur = tY + 9;
  var nettoTotal = 0;
  var mwstPct = kv.mwst_pct || 20;

  (kv.items || []).forEach(function(it) {
    var lineNetto = (parseFloat(it.anzahl) || 1) * (parseFloat(it.betrag) || 0);
    nettoTotal += lineNetto;
    setF(10, false);
    // Fahrzeug: Marke auf Zeile 1, KZ auf Zeile 2 (gleiche Schriftgröße)
    var hasFz = it.fz_marke || it.fz_kz;
    if (it.fz_marke) doc.text(it.fz_marke.substring(0, 22), col1, yCur);
    if (it.fz_kz) {
      var kzY = it.fz_marke ? yCur + 5 : yCur;
      doc.text(it.fz_kz.substring(0, 14), col1, kzY);
    }
    // Beschreibung
    var beschStr = (it.beschreibung || '').substring(0, 35);
    doc.text(beschStr, col2, yCur);
    // Anzahl
    doc.text(String(it.anzahl || 1), col3, yCur, {align:'center'});
    // Betrag
    doc.text(numFmt(lineNetto), col4, yCur, {align:'right'});
    yCur += (it.fz_marke && it.fz_kz) ? 13 : 8;
  });

  // Linie unter Tabelle
  doc.setDrawColor(30, 30, 30);
  doc.setLineWidth(0.3);
  doc.line(xL, yCur, xR, yCur);
  yCur += 7;

  // ZUSAMMENFASSUNG
  var mwstAmt = nettoTotal * mwstPct / 100;
  var gesamtAmt = nettoTotal + mwstAmt;

  setF(11, false);
  var allAmts = [nettoTotal, mwstAmt, gesamtAmt];
  var maxNumW = 0;
  allAmts.forEach(function(n) {
    var w = doc.getTextWidth(numFmt(n));
    if (w > maxNumW) maxNumW = w;
  });
  var xEuro = xR - maxNumW - 5;
  var lineStart = xEuro - 1;

  function tRow(label, n, yy, bold) {
    setF(11, bold);
    doc.text(label, xL, yy);
    doc.text('€', xEuro, yy);
    doc.text(numFmt(n), xR, yy, {align:'right'});
  }

  var yNetto  = yCur;
  var yMwst   = yCur + 5;
  var yGesamt = yCur + 10;

  tRow('Netto', nettoTotal, yNetto);
  tRow('+' + mwstPct + '% MwSt.', mwstAmt, yMwst);
  doc.setDrawColor(30, 30, 30);
  doc.setLineWidth(0.3);
  doc.line(lineStart, yMwst + 2, lineStart + 20, yMwst + 2);

  var yGesamtAmt = yGesamt + 0.5;
  setF(11, false);
  doc.text('Gesamtbetrag (Brutto)', xL, yGesamt);
  doc.text('€', xEuro, yGesamtAmt);
  doc.text(numFmt(gesamtAmt), xR, yGesamtAmt, {align:'right'});
  doc.setLineWidth(0.3);
  doc.line(lineStart, yGesamtAmt + 2, lineStart + 20, yGesamtAmt + 2);
  doc.line(lineStart, yGesamtAmt + 3, lineStart + 20, yGesamtAmt + 3);

  // HINWEIS linksbündig
  setF(9, false);
  doc.setTextColor(80, 80, 80);
  doc.text('Dies ist ein unverbindlicher Kostenvoranschlag und keine Rechnung.', xL, 255);
  doc.text('Änderungen vorbehalten.', xL, 261);

  // FUßZEILE (ohne "Zahlbar sofort..." — nur Bankdaten + UID)
  doc.setFont(georgiaFont, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(30, 30, 30);
  doc.text('Bankverbindung: Steierm. Sparkasse Graz, IBAN: AT072081500000073536, BIC: STSPAT2GXXX', 105, 277, {align:'center'});
  doc.text('UID-Nr. ATU 58185458, LG f. ZRS GRAZ, FN 251792h', 105, 282, {align:'center'});

  var kvName = (kv.partner_name || '').replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  var kvFilename = 'Kostenvoranschlag' + (kvName ? '_' + kvName : '') + (kv.datum ? '_' + kv.datum : '') + '.pdf';
  var kvPath = localStorage.getItem('bp_path_kv');
  savePDFToFolder(doc, kvFilename, kvPath, function(){ doc.save(kvFilename); });
}

// ================================================================
// KV LISTE
// ================================================================
function renderKVListe() {
  var d = getDB();
  var kvs = (d.kostenvoranschlaege || []).slice().reverse(); // neueste zuerst
  var el = document.getElementById('tbl-kv-liste');
  if (!el) return;

  var s = ((document.getElementById('s-kv-liste') || {}).value || '').toLowerCase();
  if (s) {
    kvs = kvs.filter(function(kv) {
      var fzList = (kv.items || []).map(function(it){ return (it.fz_kz || '') + ' ' + (it.fz_marke || ''); }).join(' ');
      var kundeStr = (kv.partner_name || kv.partner_info || '').split('\n')[0];
      return (fmtD(kv.datum) + ' ' + kundeStr + ' ' + fzList).toLowerCase().indexOf(s) !== -1;
    });
  }

  if (!kvs.length) {
    el.innerHTML = '<div class="empty">Keine Angebote vorhanden</div>';
    return;
  }

  var rows = kvs.map(function(kv) {
    var kundeStr = kv.partner_name || (kv.partner_info || '').split('\n')[0] || '—';
    var fzBadges = (kv.items || [])
      .filter(function(it){ return it.fz_kz || it.fz_marke; })
      .map(function(it){
        var label = [it.fz_marke, it.fz_kz].filter(Boolean).join(' / ');
        return '<span class="badge blue" style="margin:1px">&#128663; ' + esc(label) + '</span>';
      }).join(' ');
    var nettoTotal = (kv.items || []).reduce(function(s, it){
      return s + (parseFloat(it.anzahl)||1) * (parseFloat(it.betrag)||0);
    }, 0);
    var mwstAmt = nettoTotal * ((kv.mwst_pct || 20) / 100);
    var bruttoTotal = nettoTotal + mwstAmt;
    return '<tr>' +
      '<td>' + fmtD(kv.datum) + '</td>' +
      '<td>' + esc(kundeStr) + '</td>' +
      '<td>' + (fzBadges || '—') + '</td>' +
      '<td style="text-align:right;font-family:\'Courier New\',monospace">' + fmt(bruttoTotal) + '</td>' +
      '<td style="white-space:nowrap">' +
        '<button class="btn" style="padding:4px 8px;font-size:11px" data-action="pdf" data-id="' + kv.id + '">&#128196; PDF</button> ' +
        '<button class="btn danger" style="padding:4px 8px;font-size:11px" data-action="del" data-id="' + kv.id + '">Löschen</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  el.innerHTML = '<table><thead><tr>' +
    '<th>Datum</th><th>Kunde</th><th>Fahrzeuge</th><th style="text-align:right">Brutto</th><th>Aktionen</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';

  el.querySelectorAll('button[data-action]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = this.dataset.id;
      if (this.dataset.action === 'pdf') {
        var kv2 = (getDB().kostenvoranschlaege || []).find(function(k){ return k.id === id; });
        if (kv2) genKVPDF(kv2);
      }
      if (this.dataset.action === 'del') delKV(id);
    });
  });
}

function delKV(id) {
  if (!confirm('Angebot löschen?')) return;
  var d = getDB();
  d.kostenvoranschlaege = (d.kostenvoranschlaege || []).filter(function(k){ return k.id !== id; });
  saveDB(d);
  renderKVListe();
}

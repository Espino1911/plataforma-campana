/* Plataforma de Campaña · Fase 1: estructura territorial y redes afectivas */
(() => {
'use strict';
const CFG = window.PLATAFORMA_CONFIG;
const sb = supabase.createClient(CFG.url, CFG.key, {auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}});
const APP_URL = location.origin + location.pathname.replace(/index\.html$/, '');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const fmt = n => n == null || isNaN(n) ? '—' : Math.round(n).toLocaleString('es-MX');
const pct = (a, b) => b ? Math.min(999, a / b * 100) : 0;
const store = {
  get(k, d) { try { const v = localStorage.getItem('pc_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('pc_' + k, JSON.stringify(v)); } catch (e) {} }
};
function toast(m, ms = 2600) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), ms); }
function errMsg(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'Falta confirmar tu correo: revisa tu bandeja y abre el enlace de confirmación.';
  if (/User already registered/i.test(m)) return 'Ese correo ya tiene acceso. Usa "Entrar" o "Olvidé mi contraseña".';
  if (/row-level security/i.test(m)) return 'Tu rol no tiene permiso para esta acción.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sin conexión con el servidor. Revisa tu señal.';
  if (/password.*(6|characters)/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  return m;
}

const ROLES = {admin: 'Administración', coordinador: 'Coordinación', enlace: 'Enlace seccional', promotor: 'Promotor', brigadista: 'Brigadista', capturista: 'Capturista', representante: 'Representante', consulta: 'Consulta'};
const CAPTURA = ['admin', 'coordinador', 'enlace', 'promotor', 'brigadista', 'capturista'];
const VALIDA = ['admin', 'coordinador', 'enlace', 'capturista'];
const GESTIONA = ['admin', 'coordinador', 'enlace'];
const S = {session: null, operador: false, campanas: [], c: null, camp: null, geo: null, nombres: null, secSet: new Set(), view: 'inicio', recovery: false};

// ---------- Geografía local (asignar sección sin señal) ----------
async function cargarGeo() {
  if (S.geo) return S.geo;
  const [g, n] = await Promise.all([fetch('data/geo.json').then(r => r.json()), fetch('data/nombres.json').then(r => r.json())]);
  const fc = topojson.feature(g, g.objects.sec);
  fc.features.forEach(f => {
    let b = [180, 90, -180, -90];
    const walk = c => { if (typeof c[0] === 'number') { if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1]; } else c.forEach(walk); };
    walk(f.geometry.coordinates); f.bbox = b;
  });
  S.geo = fc; S.nombres = n;
  return fc;
}
function enAnillo(x, y, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) ins = !ins;
  }
  return ins;
}
function seccionLocal(lon, lat) {
  if (!S.geo) return null;
  for (const f of S.geo.features) {
    const b = f.bbox; if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) if (enAnillo(lon, lat, p[0]) && !p.slice(1).some(h => enAnillo(lon, lat, h))) return f.properties.seccion;
  }
  return null;
}
const titulo = s => String(s || '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Del|La|Las|Los|Y)\b/g, w => w.toLowerCase());

// ---------- Cola sin señal ----------
const cola = {
  get() { return store.get('cola', []); },
  set(v) { store.set('cola', v); pintarSync(); },
  push(item) { const c = this.get(); c.push(item); this.set(c); },
};
let syncing = false;
async function sincronizar() {
  if (syncing || !S.session) return;
  const items = cola.get(); if (!items.length) return;
  syncing = true;
  let ok = 0;
  for (const it of items) {
    if (it.error) continue;
    const {error} = await sb.from('personas').insert(it.data);
    if (!error || error.code === '23505') { ok++; it.done = true; continue; }
    if (/fetch|network|Load failed/i.test(error.message)) break;
    it.error = errMsg(error);
  }
  cola.set(cola.get().filter(i => !items.find(x => x.data.id === i.data.id && x.done)).map(i => { const x = items.find(y => y.data.id === i.data.id); return x && x.error ? Object.assign(i, {error: x.error}) : i; }));
  syncing = false;
  if (ok) { toast(`${ok} registro${ok > 1 ? 's' : ''} sincronizado${ok > 1 ? 's' : ''}`); if (S.view === 'inicio' || S.view === 'personas') ir(S.view); }
}
function pintarSync() {
  const el = $('#sync'); if (!el) return;
  const c = cola.get(), pend = c.filter(i => !i.error).length, err = c.filter(i => i.error).length;
  el.innerHTML = !navigator.onLine ? `<span class="pill warn">Sin señal${pend ? ' · ' + pend + ' por enviar' : ''}</span>`
    : err ? `<span class="pill bad">${err} con error</span>` : pend ? `<span class="pill warn">${pend} por enviar</span>` : '';
}
addEventListener('online', () => { pintarSync(); sincronizar(); });
addEventListener('offline', pintarSync);
setInterval(sincronizar, 60000);

// ---------- Arranque ----------
async function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('r')) return vistaPublica(params.get('r'));
  sb.auth.onAuthStateChange((ev, session) => {
    if (ev === 'PASSWORD_RECOVERY') { S.recovery = true; S.session = session; return vistaNuevaClave(); }
    if (ev === 'SIGNED_OUT') { S.session = null; S.c = null; vistaAcceso(); }
  });
  const {data} = await sb.auth.getSession();
  S.session = data.session;
  if (S.recovery) return;
  if (!S.session) return vistaAcceso();
  await entrar();
}

async function entrar() {
  render(`<div class="center"><p class="muted">Abriendo tu campaña…</p></div>`);
  try {
    await sb.rpc('vincular_cuenta');
    const [{data: camps, error}, {data: ops}] = await Promise.all([sb.rpc('mis_campanas'), sb.from('plataforma_operadores').select('user_id')]);
    if (error) throw error;
    S.campanas = camps || []; S.operador = !!(ops && ops.length);
    store.set('campanas', S.campanas); store.set('operador', S.operador);
  } catch (e) {
    S.campanas = store.get('campanas', []); S.operador = store.get('operador', false);
    if (!S.campanas.length) return render(`<div class="center"><div class="auth"><div class="alerta bad">${esc(errMsg(e))}</div><button class="btn wide" onclick="location.reload()">Reintentar</button></div></div>`);
  }
  if (!S.campanas.length) return S.operador ? vistaCrearCampana(true) : vistaSinCampana();
  const pref = store.get('campana');
  S.c = S.campanas.find(c => c.campana_id === pref) || S.campanas[0];
  await abrirCampana();
}

async function abrirCampana() {
  store.set('campana', S.c.campana_id);
  try {
    const [{data: camp}, {data: secs}] = await Promise.all([
      sb.from('campanas').select('*').eq('id', S.c.campana_id).single(),
      sb.from('campana_secciones').select('seccion').eq('campana_id', S.c.campana_id)
    ]);
    if (camp) { S.camp = camp; store.set('camp_' + S.c.campana_id, camp); }
    if (secs) { S.secSet = new Set(secs.map(s => s.seccion)); store.set('secs_' + S.c.campana_id, [...S.secSet]); }
  } catch (e) {}
  S.camp = S.camp || store.get('camp_' + S.c.campana_id, {nombre: S.c.nombre, aviso_version: 'v1'});
  if (!S.secSet.size) S.secSet = new Set(store.get('secs_' + S.c.campana_id, []));
  cargarGeo().catch(() => {});
  armarShell();
  const h = location.hash.slice(1);
  ir(VISTAS[h] ? h : 'inicio');
  sincronizar();
}

// ---------- Estructura de pantalla ----------
const ICON = {
  inicio: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  registrar: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.8"/>',
  personas: '<circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.7.7 2.8 2.4 3 5.2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  red: '<circle cx="12" cy="5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="5" cy="19" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="19" cy="19" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v4M12 11.5 6.2 17M12 11.5l5.8 5.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  mapa: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  analisis: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  equipo: '<path d="M4 20v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  ajustes: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" fill="none" stroke="currentColor" stroke-width="1.5"/>'
};
function tabsDeRol() {
  const r = S.c.rol;
  const t = ['inicio'];
  if (CAPTURA.includes(r)) t.push('registrar');
  if (r !== 'consulta') t.push('personas');
  if (CAPTURA.includes(r)) t.push('red');
  t.push(['admin', 'coordinador', 'enlace', 'consulta'].includes(r) ? 'analisis' : 'mapa');
  if (GESTIONA.includes(r)) t.push('equipo');
  t.push('ajustes');
  return t;
}
const NOMBRE_TAB = {inicio: 'Inicio', registrar: 'Registrar', personas: 'Personas', red: 'Red', mapa: 'Mapa', analisis: 'Análisis', equipo: 'Equipo', ajustes: 'Más'};
function armarShell() {
  const tabs = tabsDeRol();
  render(`<div class="shell">
    <header class="top">
      <div class="t"><small>${esc(ROLES[S.c.rol])}</small><b>${esc(S.camp.nombre || S.c.nombre)}</b></div>
      <div id="sync" class="sync"></div>
    </header>
    <nav class="tabs" style="--n:${tabs.length}">${tabs.map(t => `<a href="${t === 'analisis' ? 'analisis.html' : '#' + t}" data-v="${t}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t]}</svg>${NOMBRE_TAB[t]}</a>`).join('')}</nav>
    <main id="main"></main>
  </div>`);
  pintarSync();
}
function render(h) { $('#app').innerHTML = h; }
function ir(v) {
  if (!tabsDeRol().includes(v)) v = 'inicio';
  S.view = v;
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  $$('nav.tabs a').forEach(a => a.setAttribute('aria-current', a.dataset.v === v ? 'page' : 'false'));
  scrollTo(0, 0);
  VISTAS[v]();
}
addEventListener('hashchange', () => { if (S.c && VISTAS[location.hash.slice(1)]) ir(location.hash.slice(1)); });
const M = h => { const m = $('#main'); if (m) m.innerHTML = h; return m; };

// ---------- Inicio: tablero ----------
async function vInicio() {
  M(`<p class="muted">Cargando tablero…</p>`);
  const [{data: r, error}, {data: av}] = await Promise.all([sb.rpc('resumen_campana', {p_campana: S.c.campana_id}), sb.rpc('avance_secciones', {p_campana: S.c.campana_id})]);
  if (error) return M(`<div class="alerta bad">${esc(errMsg(error))}</div>`);
  const e = r.estructura, dias = r.dias_restantes;
  const ritmoOk = e.necesario_diario == null || e.ritmo_diario_14d >= e.necesario_diario;
  const card = (t, val, meta, sub, off) => `<div class="card tarjeta kpi ${off ? 'off' : ''}"><div class="h"><b>${t}</b>${off ? '<span class="pill">Fase siguiente</span>' : meta ? `<span class="pill ${pct(val, meta) >= 100 ? 'good' : pct(val, meta) >= 50 ? 'acc' : 'warn'}">${Math.round(pct(val, meta))}%</span>` : ''}</div>
    <strong class="num">${off ? '—' : fmt(val)}</strong>${meta && !off ? `<div class="bar"><i style="width:${Math.min(100, pct(val, meta))}%"></i></div>` : ''}<div class="sub">${sub}</div></div>`;
  const rezago = (av || []).filter(s => s.meta > 0).map(s => ({...s, brecha: s.meta - s.registrados})).sort((a, b) => b.brecha - a.brecha).slice(0, 10);
  const avisoFalta = S.c.rol === 'admin' && !S.camp.aviso_privacidad_url;
  M(`${avisoFalta ? `<div class="alerta">Falta el enlace al aviso de privacidad integral de la campaña. Agrégalo en <a href="#ajustes">Más → Datos de la campaña</a> antes de registrar personas reales.</div>` : ''}
  <div class="grid g3">
    ${card('Estructura', e.registrados, e.meta, `${fmt(e.validados)} validados · meta ${fmt(e.meta)}`)}
    ${card('Redes afectivas', r.redes.promotores, null, 'promotores activos con enlace')}
    ${card('Comités', r.comites.instalados, r.comites.meta, `meta: un comité por sección (${fmt(r.comites.meta)})`)}
    ${card('Brigadas', 0, 0, 'visitas casa por casa', true)}
    ${card('Call Center', 0, 0, 'llamadas y confirmaciones', true)}
    ${card('Sociedad Civil', 0, 0, 'organizaciones y eventos', true)}
  </div>
  <h3>Ritmo hacia el día de la elección</h3>
  <div class="card">
    ${dias == null || S.camp.fecha_eleccion == null ? `<p class="note">Captura la fecha de la elección en Más → Datos de la campaña para calcular el ritmo necesario.</p>` : `
    <div class="grid g3">
      <div class="kpi"><small>Días restantes</small><strong class="num">${fmt(dias)}</strong></div>
      <div class="kpi"><small>Ritmo actual</small><strong class="num">${e.ritmo_diario_14d}</strong><div class="sub">registros por día (14 días)</div></div>
      <div class="kpi"><small>Ritmo necesario</small><strong class="num" style="color:var(${ritmoOk ? '--good' : '--warn'})">${e.necesario_diario ?? '—'}</strong><div class="sub">registros por día</div></div>
    </div>
    <p class="note" style="margin:10px 0 0">${ritmoOk ? 'Al ritmo actual se alcanza la meta.' : `Al ritmo actual se llegaría a <b class="num">${fmt(e.proyeccion_dia_eleccion)}</b> registros el día de la elección, ${Math.round(pct(e.proyeccion_dia_eleccion, e.meta))}% de la meta.`}</p>`}
  </div>
  <h3>Secciones con mayor brecha contra su meta</h3>
  <div class="card"><div class="tbl-wrap"><table>
    <thead><tr><th>Sección</th><th>Municipio</th><th class="r">Meta</th><th class="r">Registrados</th><th class="r">Avance</th></tr></thead>
    <tbody>${rezago.map(s => `<tr><td class="num">${s.seccion}</td><td>${esc(titulo(s.municipio))}</td><td class="r num">${fmt(s.meta)}</td><td class="r num">${fmt(s.registrados)}</td><td class="r num">${Math.round(pct(s.registrados, s.meta))}%</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin secciones asignadas todavía.</td></tr>'}</tbody>
  </table></div>
  <p class="note" style="margin:10px 0 0">Meta de cada sección = lista nominal 2026 × participación de ${esc(({pres24: 'Presidencia 2024', gub24: 'Gubernatura 2024', dl24: 'Diputaciones locales 2024', df24: 'Diputaciones federales 2024', ayu25: 'Ayuntamientos 2025'})[S.camp.eleccion_referencia] || 'la elección de referencia')} × objetivo de ${Math.round((S.camp.objetivo_pct || .5) * 100)}%.</p></div>`);
}

// ---------- Registrar persona ----------
let gpsPos = null;
function vRegistrar() {
  gpsPos = null;
  const esProm = S.c.rol === 'promotor';
  M(`<h2>Registrar persona</h2><p class="note">Funciona sin señal: el registro se guarda en el teléfono y se envía al reconectar.</p>
  <form class="f card" id="fReg" autocomplete="off">
    <div class="row"><div class="fld"><label for="rNom">Nombre(s)</label><input id="rNom" required minlength="2"></div>
    <div class="fld"><label for="rApe">Apellidos</label><input id="rApe"></div></div>
    <div class="fld"><label for="rTel">Teléfono (10 dígitos)</label><input id="rTel" inputmode="tel" pattern="[0-9 ()+-]{10,16}"></div>
    <div class="row"><div class="fld"><label for="rCal">Calle</label><input id="rCal"></div><div class="fld" style="flex:0 1 110px"><label for="rNum">Número</label><input id="rNum"></div></div>
    <div class="row"><div class="fld"><label for="rCol">Colonia o localidad</label><input id="rCol"></div><div class="fld" style="flex:0 1 120px"><label for="rCP">C.P.</label><input id="rCP" inputmode="numeric" maxlength="5"></div></div>
    <div class="gps"><div class="st" id="gpsSt">Ubicación del domicilio: sin capturar</div><button type="button" class="btn sm" id="gpsBtn">Usar mi ubicación</button></div>
    <div class="fld"><label for="rSec">Sección (si no hay GPS)</label><input id="rSec" inputmode="numeric" placeholder="Se llena sola con el GPS"></div>
    <div class="row"><div class="fld"><label for="rComp">Nivel de compromiso</label><select id="rComp"><option value="simpatizante">Simpatizante</option><option value="indeciso">Indeciso</option><option value="promotor">Promotor</option></select></div></div>
    <label class="chk"><input type="checkbox" id="rProm"> Será promotor: tendrá su propio enlace para invitar a su red.</label>
    ${!esProm ? `<div class="fld"><label for="rRec">¿Quién lo invitó? (opcional)</label><select id="rRec"><option value="">Nadie / captura directa</option></select></div>` : ''}
    <div class="consent">${textoAviso(S.camp)}<label class="chk" style="margin-top:10px"><input type="checkbox" id="rOk" required> La persona leyó o escuchó este aviso y <b>autoriza expresamente</b> el uso de sus datos para estos fines.</label></div>
    <button class="btn pri wide" id="rGo">Guardar registro</button>
  </form>`);
  if (!esProm) sb.from('personas').select('id,nombre,apellidos,seccion').eq('campana_id', S.c.campana_id).eq('es_promotor', true).is('borrado', null).order('nombre').limit(500)
    .then(({data}) => { const s = $('#rRec'); if (s && data) s.insertAdjacentHTML('beforeend', data.map(p => `<option value="${p.id}">${esc(p.nombre + ' ' + (p.apellidos || ''))} · secc. ${p.seccion ?? '—'}</option>`).join('')); });
  $('#rComp').onchange = e => { if (e.target.value === 'promotor') $('#rProm').checked = true; };
  $('#gpsBtn').onclick = capturarGPS;
  $('#fReg').onsubmit = async ev => {
    ev.preventDefault();
    if (!$('#rOk').checked) return toast('Falta la autorización de la persona');
    const secMan = parseInt($('#rSec').value, 10);
    if (!gpsPos && !secMan) return toast('Captura la ubicación o escribe la sección');
    if (secMan && S.secSet.size && !S.secSet.has(secMan)) toast('La sección ' + secMan + ' está fuera del ámbito: se guardará marcada para revisión', 3500);
    const d = {
      id: crypto.randomUUID(), campana_id: S.c.campana_id,
      nombre: $('#rNom').value.trim(), apellidos: $('#rApe').value.trim() || null, telefono: $('#rTel').value.trim() || null,
      calle: $('#rCal').value.trim() || null, numero: $('#rNum').value.trim() || null, colonia: $('#rCol').value.trim() || null, codigo_postal: $('#rCP').value.trim() || null,
      compromiso: $('#rComp').value, es_promotor: $('#rProm').checked,
      consentimiento: true, aviso_version: S.camp.aviso_version || 'v1', origen: 'captura'
    };
    if (gpsPos) { d.ubicacion = `SRID=4326;POINT(${gpsPos.lon} ${gpsPos.lat})`; d.precision_m = Math.round(gpsPos.acc); }
    if (secMan && (!gpsPos || secMan !== gpsPos.sec)) { d.seccion = secMan; d.seccion_origen = 'manual'; }
    else if (gpsPos && gpsPos.sec) { d.seccion = gpsPos.sec; d.seccion_origen = 'gps'; }
    if (esProm) d.reclutado_por = S.miPersona || store.get('miPersona_' + S.c.campana_id, null);
    else if ($('#rRec').value) d.reclutado_por = $('#rRec').value;
    cola.push({data: d, t: Date.now()});
    toast(navigator.onLine ? 'Registro guardado' : 'Guardado sin señal: se enviará al reconectar');
    vRegistrar();
    sincronizar();
  };
  if (esProm && !S.miPersona && navigator.onLine) asegurarMiPersona();
}
async function asegurarMiPersona() {
  // el promotor necesita su propio registro para que su red cuelgue de él
  try {
    let {data} = await sb.from('miembros').select('persona_id').eq('id', S.c.miembro_id).single();
    if (!data || !data.persona_id) { await sb.rpc('mi_enlace', {p_campana: S.c.campana_id}); ({data} = await sb.from('miembros').select('persona_id').eq('id', S.c.miembro_id).single()); }
    S.miPersona = data && data.persona_id; if (S.miPersona) store.set('miPersona_' + S.c.campana_id, S.miPersona);
  } catch (e) {}
}
function capturarGPS() {
  const st = $('#gpsSt');
  if (!navigator.geolocation) { st.textContent = 'Este teléfono no permite ubicación. Escribe la sección.'; return; }
  st.textContent = 'Buscando ubicación…';
  navigator.geolocation.getCurrentPosition(async p => {
    await cargarGeo().catch(() => {});
    const lat = p.coords.latitude, lon = p.coords.longitude, acc = p.coords.accuracy, sec = seccionLocal(lon, lat);
    gpsPos = {lat, lon, acc, sec};
    const fuera = sec && S.secSet.size && !S.secSet.has(sec);
    st.innerHTML = sec ? `Sección <b class="num">${sec}</b>${fuera ? ' <span class="pill warn">fuera del ámbito</span>' : ''} · precisión ${Math.round(acc)} m` : `Ubicación tomada (precisión ${Math.round(acc)} m), fuera de Veracruz o sin sección.`;
    if (sec) $('#rSec').value = sec;
    if (acc > 80) st.insertAdjacentHTML('beforeend', '<br><span class="muted">Precisión baja: confirma que estás en el domicilio.</span>');
  }, e => { st.textContent = e.code === 1 ? 'Permiso de ubicación negado. Actívalo en el navegador o escribe la sección.' : 'No se obtuvo la ubicación. Intenta de nuevo o escribe la sección.'; },
  {enableHighAccuracy: true, timeout: 20000, maximumAge: 0});
}
function textoAviso(c) {
  const resp = c.responsable_datos || c.responsable || 'el equipo de la campaña';
  return `<b>Aviso de privacidad.</b> ${esc(resp)} tratará tu nombre, teléfono, domicilio, ubicación y tu simpatía política (dato personal sensible) solo para organizar las actividades de ${esc(c.nombre || c.campana || 'la campaña')} y contactarte sobre ellas. No se venden ni se ceden a terceros ajenos a la campaña, y se borran al concluir el proceso electoral.
    ${c.contacto_privacidad ? ` Para ver, corregir o borrar tus datos escribe a ${esc(c.contacto_privacidad)}.` : ''}
    ${c.aviso_privacidad_url ? ` <a href="${esc(c.aviso_privacidad_url)}" target="_blank" rel="noopener">Aviso de privacidad integral</a>.` : ''}`;
}

// ---------- Personas ----------
let pFiltro = {q: '', f: 'todas', pag: 0};
async function vPersonas() {
  M(`<h2>Personas</h2>
  <div class="row" style="margin:10px 0">
    <div class="fld" style="flex:2 1 200px"><input id="pQ" placeholder="Buscar nombre, teléfono o sección" value="${esc(pFiltro.q)}"></div>
    <div class="fld" style="flex:1 1 140px"><select id="pF">
      <option value="todas">Todas</option><option value="porvalidar">Por validar</option><option value="promotores">Promotores</option><option value="duplicados">Posibles duplicados</option><option value="revisar">Sección por revisar</option></select></div>
  </div>
  <div id="pList" class="card"><p class="muted">Cargando…</p></div>`);
  $('#pF').value = pFiltro.f;
  let t; $('#pQ').oninput = e => { clearTimeout(t); t = setTimeout(() => { pFiltro.q = e.target.value.trim(); pFiltro.pag = 0; listaPersonas(); }, 350); };
  $('#pF').onchange = e => { pFiltro.f = e.target.value; pFiltro.pag = 0; listaPersonas(); };
  listaPersonas();
}
async function listaPersonas() {
  let q = sb.from('personas').select('id,nombre,apellidos,telefono,colonia,seccion,seccion_fuera,compromiso,es_promotor,validado,duplicado_de,origen,creado', {count: 'exact'})
    .eq('campana_id', S.c.campana_id).is('borrado', null).order('creado', {ascending: false}).range(pFiltro.pag * 50, pFiltro.pag * 50 + 49);
  const v = pFiltro.q;
  if (v) { if (/^\d{1,5}$/.test(v)) q = q.eq('seccion', +v); else if (/^\d{6,}$/.test(v.replace(/\D/g, ''))) q = q.ilike('telefono_norm', '%' + v.replace(/\D/g, '').slice(-10) + '%'); else { const w = v.replace(/[,()*%.]/g, ' ').trim(); q = q.or(`nombre.ilike.*${w}*,apellidos.ilike.*${w}*`); } }
  if (pFiltro.f === 'porvalidar') q = q.eq('validado', false);
  if (pFiltro.f === 'promotores') q = q.eq('es_promotor', true);
  if (pFiltro.f === 'duplicados') q = q.not('duplicado_de', 'is', null);
  if (pFiltro.f === 'revisar') q = q.eq('seccion_fuera', true);
  const {data, count, error} = await q;
  const el = $('#pList'); if (!el) return;
  if (error) return el.innerHTML = `<div class="alerta bad">${esc(errMsg(error))}</div>`;
  const puedeValidar = VALIDA.includes(S.c.rol), puedeBaja = GESTIONA.includes(S.c.rol);
  el.innerHTML = `<p class="note" style="margin:0 0 6px">${fmt(count)} persona${count === 1 ? '' : 's'} visibles para tu rol</p><div class="list">${(data || []).map(p => `
    <div class="item" data-id="${p.id}"><div class="b"><b>${esc(p.nombre)} ${esc(p.apellidos || '')}</b>
      <span>Secc. <span class="num">${p.seccion ?? '—'}</span>${p.colonia ? ' · ' + esc(p.colonia) : ''}${p.telefono ? ' · ' + esc(p.telefono) : ''}</span>
      <div class="row" style="gap:5px;margin-top:5px">${p.validado ? '<span class="pill good">Validado</span>' : '<span class="pill">Sin validar</span>'}${p.es_promotor ? '<span class="pill acc">Promotor</span>' : ''}${p.duplicado_de ? '<span class="pill bad">Posible duplicado</span>' : ''}${p.seccion_fuera ? '<span class="pill warn">Revisar sección</span>' : ''}${p.origen === 'invitacion' ? '<span class="pill">Por enlace</span>' : ''}</div></div>
      <div class="acts">${puedeValidar && !p.validado ? `<button class="btn sm" data-a="val">Validar</button>` : ''}${p.es_promotor ? `<button class="btn sm" data-a="red">Red</button>` : `<button class="btn sm" data-a="prom">Hacer promotor</button>`}${puedeBaja ? `<button class="btn sm" data-a="baja" title="Dar de baja">Baja</button>` : ''}</div></div>`).join('') || '<p class="empty">Sin registros con este filtro.</p>'}</div>
    <div class="row" style="justify-content:space-between;margin-top:10px">${pFiltro.pag ? '<button class="btn sm" id="pPrev">Anteriores</button>' : '<span></span>'}${count > (pFiltro.pag + 1) * 50 ? '<button class="btn sm" id="pNext">Siguientes</button>' : ''}</div>`;
  $$('.item [data-a]', el).forEach(b => b.onclick = () => accionPersona(b.closest('.item').dataset.id, b.dataset.a, b));
  const pv = $('#pPrev'); if (pv) pv.onclick = () => { pFiltro.pag--; listaPersonas(); };
  const nx = $('#pNext'); if (nx) nx.onclick = () => { pFiltro.pag++; listaPersonas(); };
}
async function accionPersona(id, a, btn) {
  btn.disabled = true;
  if (a === 'val') { const {error} = await sb.from('personas').update({validado: true}).eq('id', id); toast(error ? errMsg(error) : 'Validado'); return listaPersonas(); }
  if (a === 'baja') {
    if (btn.dataset.ok !== '1') { btn.dataset.ok = '1'; btn.disabled = false; btn.textContent = '¿Confirmar baja?'; btn.classList.add('pri'); return; }
    const {error} = await sb.from('personas').update({borrado: new Date().toISOString()}).eq('id', id); toast(error ? errMsg(error) : 'Dado de baja'); return listaPersonas();
  }
  if (a === 'prom') { const {data, error} = await sb.rpc('crear_invitacion', {p_persona: id}); if (error) { btn.disabled = false; return toast(errMsg(error)); } mostrarEnlace(data, 'Enlace de promotor'); return listaPersonas(); }
  if (a === 'red') { btn.disabled = false; return verArbol(id); }
}

// ---------- Red afectiva ----------
async function vRed() {
  M(`<h2>Red afectiva</h2><p class="note">Un simpatizante suma uno; un promotor suma su red completa.</p>
  <h3>Mi enlace de promotor</h3><div class="card" id="miEnlace"><p class="muted">Generando…</p></div>
  <h3>Top 10 promotores</h3><div class="card" id="top"><p class="muted">Cargando…</p></div>
  <h3>Mi red</h3><div class="card tree" id="miRed"><p class="muted">Cargando…</p></div>`);
  const [{data: tok, error: e1}, {data: top}] = await Promise.all([sb.rpc('mi_enlace', {p_campana: S.c.campana_id}), sb.rpc('top_promotores', {p_campana: S.c.campana_id, p_n: 10})]);
  const me = $('#miEnlace'); if (!me) return;
  if (e1) me.innerHTML = `<div class="alerta bad">${esc(errMsg(e1))}</div>`; else me.innerHTML = enlaceHTML(tok);
  bindEnlace(me, tok);
  $('#top').innerHTML = (top && top.length) ? `<div class="tbl-wrap"><table><thead><tr><th>#</th><th>Promotor</th><th class="r">Directos</th><th class="r">Red total</th><th class="r">Validados</th></tr></thead><tbody>${top.map((p, i) => `<tr><td class="num">${i + 1}</td><td>${esc(p.nombre)}<br><span class="muted num" style="font-size:12px">secc. ${p.seccion ?? '—'}${p.meta_red ? ' · meta ' + p.meta_red : ''}</span></td><td class="r num">${fmt(p.directos)}</td><td class="r num">${fmt(p.red_total)}</td><td class="r num">${fmt(p.validados)}${p.pct_validado != null ? `<br><span class="muted" style="font-size:12px">${p.pct_validado}%</span>` : ''}</td></tr>`).join('')}</tbody></table></div><p class="note" style="margin:8px 0 0">Ordenado por registros validados. Los posibles duplicados no cuentan.</p>` : '<p class="empty">Aún no hay promotores con red.</p>';
  const {data: mm} = await sb.from('miembros').select('persona_id').eq('id', S.c.miembro_id).single();
  S.miPersona = mm && mm.persona_id; if (S.miPersona) store.set('miPersona_' + S.c.campana_id, S.miPersona);
  if (S.miPersona) arbolEn($('#miRed'), S.miPersona); else $('#miRed').innerHTML = '<p class="empty">Tu red aparecerá aquí cuando alguien se registre con tu enlace.</p>';
}
function enlaceURL(tok) { return APP_URL + '?r=' + encodeURIComponent(tok); }
function qrSVG(text) { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({cellSize: 5, margin: 2, scalable: true}); }
function enlaceHTML(tok) {
  const u = enlaceURL(tok);
  return `<div class="qr">${qrSVG(u)}</div><div class="spacer"></div><div class="linkbox"><input readonly value="${esc(u)}" id="lnk_${esc(tok)}" aria-label="Enlace de invitación"><button class="btn sm" data-copy>Copiar</button></div>
  <div class="spacer"></div><button class="btn pri wide" data-share>Compartir por WhatsApp u otra app</button>
  <p class="note" style="margin:8px 0 0">Quien abra este enlace se registra directamente en tu red, sin cuenta ni contraseña, y acepta el aviso de privacidad.</p>`;
}
function bindEnlace(el, tok) {
  const u = enlaceURL(tok), msg = `Te invito a sumarte a ${S.camp.nombre}. Regístrate aquí: ${u}`;
  const c = $('[data-copy]', el); if (c) c.onclick = () => { const inp = $('input', el); try { navigator.clipboard.writeText(u).then(() => toast('Enlace copiado'), () => { inp.select(); document.execCommand('copy'); toast('Enlace copiado'); }); } catch (e) { inp.select(); document.execCommand('copy'); toast('Enlace copiado'); } };
  const s = $('[data-share]', el); if (s) s.onclick = () => { if (navigator.share) navigator.share({title: S.camp.nombre, text: msg, url: u}).catch(() => {}); else location.href = 'https://wa.me/?text=' + encodeURIComponent(msg); };
}
function mostrarEnlace(tok, titulo) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:60;display:grid;place-items:center;padding:16px';
  d.innerHTML = `<div class="card" style="width:100%;max-width:380px"><div class="row" style="justify-content:space-between"><b>${esc(titulo)}</b><button class="btn sm" data-x>Cerrar</button></div><div class="spacer"></div>${enlaceHTML(tok)}</div>`;
  document.body.appendChild(d); bindEnlace(d, tok);
  $('[data-x]', d).onclick = () => d.remove(); d.onclick = e => { if (e.target === d) d.remove(); };
}
async function arbolEn(el, id) {
  const {data, error} = await sb.rpc('arbol_red', {p_persona: id});
  if (error) return el.innerHTML = `<div class="alerta bad">${esc(errMsg(error))}</div>`;
  const hijos = {}; data.forEach(n => (hijos[n.reclutado_por] = hijos[n.reclutado_por] || []).push(n));
  const raiz = data.find(n => n.nivel === 0);
  const li = n => `<li><b>${esc(n.nombre)}</b> <span class="muted num" style="font-size:12px">secc. ${n.seccion ?? '—'}</span> ${n.es_promotor ? '<span class="pill acc">Promotor</span>' : ''}${n.validado ? ' <span class="pill good">✓</span>' : ''}${hijos[n.persona_id] ? `<ul>${hijos[n.persona_id].map(li).join('')}</ul>` : ''}</li>`;
  const total = data.length - 1, niveles = Math.max(0, ...data.map(n => n.nivel));
  el.innerHTML = `<p class="note" style="margin:0 0 8px"><b class="num">${fmt(total)}</b> persona${total === 1 ? '' : 's'} en la red · ${niveles} nivel${niveles === 1 ? '' : 'es'}</p><ul>${raiz ? li(raiz) : ''}</ul>`;
}
function verArbol(id) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:60;display:grid;place-items:center;padding:16px';
  d.innerHTML = `<div class="card" style="width:100%;max-width:520px;max-height:85vh;overflow:auto"><div class="row" style="justify-content:space-between"><b>Árbol de reclutamiento</b><span class="row" style="gap:6px"><button class="btn sm" data-l>Enlace</button><button class="btn sm" data-x>Cerrar</button></span></div><div class="spacer"></div><div class="tree" id="arb"><p class="muted">Cargando…</p></div></div>`;
  document.body.appendChild(d);
  $('[data-x]', d).onclick = () => d.remove(); d.onclick = e => { if (e.target === d) d.remove(); };
  $('[data-l]', d).onclick = async () => { const {data, error} = await sb.rpc('crear_invitacion', {p_persona: id}); if (error) return toast(errMsg(error)); d.remove(); mostrarEnlace(data, 'Enlace de promotor'); };
  arbolEn($('#arb', d), id);
}

// ---------- Mapa ----------
let mapa = null;
async function vMapa() {
  M(`<h2>Mapa del territorio</h2>
  <div class="row" style="margin:8px 0"><label class="chk"><input type="checkbox" id="mAv" checked> Avance contra meta</label><label class="chk"><input type="checkbox" id="mPe" checked> Personas registradas</label></div>
  <div class="legend"><span><i style="background:#c6d3d8"></i>Sin registros</span><span><i style="background:#e5a020"></i>&lt;25%</span><span><i style="background:#9cc27a"></i>25–75%</span><span><i style="background:#1e7a46"></i>&gt;75%</span></div>
  <div id="mapa"></div><p class="note">Toca una sección para ver su meta y su avance. Los puntos solo muestran personas de tu territorio o tu red.</p>`);
  await cargarGeo();
  const [{data: av}, {data: pts}] = await Promise.all([
    sb.rpc('avance_secciones', {p_campana: S.c.campana_id}),
    S.c.rol === 'consulta' ? Promise.resolve({data: []}) : sb.from('personas').select('lat,lon,es_promotor,validado').eq('campana_id', S.c.campana_id).is('borrado', null).not('lat', 'is', null).limit(5000)
  ]);
  const avMap = new Map((av || []).map(s => [s.seccion, s]));
  if (mapa) { mapa.remove(); mapa = null; }
  mapa = L.map('mapa', {preferCanvas: true, zoomControl: true, attributionControl: false, renderer: L.canvas({padding: .3})});
  const feats = S.geo.features.filter(f => avMap.has(f.properties.seccion) || S.secSet.has(f.properties.seccion));
  const color = s => { if (!s || !s.registrados) return '#c6d3d8'; const p = pct(s.registrados, s.meta); return p > 75 ? '#1e7a46' : p >= 25 ? '#9cc27a' : '#e5a020'; };
  const capaAv = L.geoJSON({type: 'FeatureCollection', features: feats}, {
    style: f => ({fillColor: color(avMap.get(f.properties.seccion)), fillOpacity: .75, color: '#ffffff', weight: .8}),
    onEachFeature: (f, l) => { const s = avMap.get(f.properties.seccion); l.bindPopup(`<b>Sección ${f.properties.seccion}</b><br>${s ? `${esc(titulo(s.municipio))}<br>Meta: <b>${fmt(s.meta)}</b><br>Registrados: <b>${fmt(s.registrados)}</b> (${Math.round(pct(s.registrados, s.meta))}%)<br>Validados: ${fmt(s.validados)} · Promotores: ${fmt(s.promotores)}` : 'Fuera de tu territorio'}`); }
  }).addTo(mapa);
  const capaPe = L.layerGroup((pts || []).map(p => L.circleMarker([p.lat, p.lon], {radius: p.es_promotor ? 5 : 3.5, color: '#fff', weight: 1, fillColor: p.es_promotor ? '#0d5c6b' : '#13202a', fillOpacity: .9}))).addTo(mapa);
  try { mapa.fitBounds(capaAv.getBounds(), {padding: [12, 12]}); } catch (e) { mapa.setView([19.53, -96.92], 12); }
  $('#mAv').onchange = e => e.target.checked ? capaAv.addTo(mapa) : mapa.removeLayer(capaAv);
  $('#mPe').onchange = e => e.target.checked ? capaPe.addTo(mapa) : mapa.removeLayer(capaPe);
}

// ---------- Equipo ----------
async function vEquipo() {
  const r = S.c.rol;
  const rolesPermitidos = r === 'admin' ? Object.keys(ROLES) : ['enlace', 'promotor', 'brigadista', 'capturista', 'representante'].filter(x => !(r === 'enlace' && x === 'enlace'));
  M(`<h2>Equipo</h2><p class="note">Da de alta a cada integrante con su correo. La persona entra a esta misma app con "Crear acceso" usando ese correo y queda ligada a su rol y territorio.</p>
  <h3>Agregar integrante</h3>
  <form class="f card" id="fEq">
    <div class="row"><div class="fld"><label for="eNom">Nombre</label><input id="eNom" required></div><div class="fld"><label for="eTel">Teléfono</label><input id="eTel" inputmode="tel"></div></div>
    <div class="fld"><label for="eCor">Correo</label><input id="eCor" type="email" required autocomplete="off"></div>
    <div class="row"><div class="fld"><label for="eRol">Rol</label><select id="eRol">${rolesPermitidos.map(x => `<option value="${x}">${ROLES[x]}</option>`).join('')}</select></div>
    <div class="fld"><label for="eSup">Reporta a</label><select id="eSup"></select></div></div>
    <div class="fld"><label for="eSec">Secciones asignadas</label><input id="eSec" placeholder="Ej. 1900-1915, 1950, 2042"><span class="note" id="eSecN">Puedes asignar secciones de tu propio territorio.</span></div>
    <button class="btn pri">Agregar al equipo</button>
  </form>
  <h3>Integrantes</h3><div class="card" id="eList"><p class="muted">Cargando…</p></div>`);
  const [{data: eq, error}, {data: asig}] = await Promise.all([sb.rpc('equipo_campana', {p_campana: S.c.campana_id}), sb.rpc('secciones_asignables', {p_campana: S.c.campana_id})]);
  if (error) return $('#eList').innerHTML = `<div class="alerta bad">${esc(errMsg(error))}</div>`;
  const asignables = new Set((asig || []).map(Number));
  $('#eSecN').textContent = `Puedes asignar ${fmt(asignables.size)} secciones${asignables.size ? ` (de la ${Math.min(...asignables)} a la ${Math.max(...asignables)})` : ''}.`;
  $('#eSup').innerHTML = (eq || []).filter(m => GESTIONA.includes(m.rol) && m.activo).map(m => `<option value="${m.id}" ${m.id === S.c.miembro_id ? 'selected' : ''}>${esc(m.nombre)} · ${ROLES[m.rol]}</option>`).join('');
  $('#eList').innerHTML = `<div class="list">${(eq || []).map(m => `<div class="item"><div class="b"><b>${esc(m.nombre)}</b><span>${ROLES[m.rol]}${m.superior ? ' · reporta a ' + esc(m.superior) : ''} · ${fmt(m.secciones)} secc.</span><br><span class="num" style="font-size:12.5px">${esc(m.correo)}</span>
    <div class="row" style="gap:5px;margin-top:5px">${m.vinculado ? '<span class="pill good">Con acceso</span>' : '<span class="pill warn">Pendiente de crear acceso</span>'}${m.activo ? '' : '<span class="pill bad">Desactivado</span>'}</div></div>
    ${m.id !== S.c.miembro_id ? `<div class="acts"><button class="btn sm" data-m="${m.id}" data-act="${m.activo ? 0 : 1}">${m.activo ? 'Desactivar' : 'Reactivar'}</button></div>` : ''}</div>`).join('')}</div>`;
  $$('#eList [data-m]').forEach(b => b.onclick = async () => { b.disabled = true; const {error} = await sb.from('miembros').update({activo: b.dataset.act === '1'}).eq('id', b.dataset.m); toast(error ? errMsg(error) : 'Actualizado'); vEquipo(); });
  $('#fEq').onsubmit = async ev => {
    ev.preventDefault();
    const secs = parseSecciones($('#eSec').value), fuera = secs.filter(s => !asignables.has(s));
    if (fuera.length) return toast(`Fuera de tu territorio: ${fuera.slice(0, 8).join(', ')}${fuera.length > 8 ? '…' : ''}`, 4000);
    const btn = $('#fEq button.pri'); btn.disabled = true;
    const {data: m, error} = await sb.from('miembros').insert({campana_id: S.c.campana_id, nombre: $('#eNom').value.trim(), telefono: $('#eTel').value.trim() || null,
      correo: $('#eCor').value.trim().toLowerCase(), rol: $('#eRol').value, superior_id: $('#eSup').value || null}).select('id').single();
    if (error) { btn.disabled = false; return toast(/duplicate|unique/i.test(error.message) ? 'Ese correo ya está en el equipo' : errMsg(error), 4000); }
    if (secs.length) {
      const {error: e2} = await sb.from('miembro_secciones').insert(secs.map(s => ({miembro_id: m.id, campana_id: S.c.campana_id, seccion: s})));
      if (e2) toast('Integrante agregado, pero no se asignaron secciones: ' + errMsg(e2), 5000);
    }
    toast('Integrante agregado. Pídele que entre con "Crear acceso" usando su correo.', 4500);
    vEquipo();
  };
}
function parseSecciones(t) {
  const out = new Set();
  String(t || '').split(/[,;\s]+/).filter(Boolean).forEach(p => {
    const m = p.match(/^(\d+)-(\d+)$/);
    if (m) { const a = +m[1], b = +m[2]; for (let i = Math.min(a, b); i <= Math.max(a, b) && out.size < 3000; i++) out.add(i); }
    else if (/^\d+$/.test(p)) out.add(+p);
  });
  return [...out];
}

// ---------- Más: campaña, cuenta ----------
async function vAjustes() {
  const c = S.camp, admin = S.c.rol === 'admin';
  M(`<h2>Más</h2>
  ${S.campanas.length > 1 ? `<h3>Cambiar de campaña</h3><div class="card"><div class="fld"><select id="aCamp">${S.campanas.map(x => `<option value="${x.campana_id}" ${x.campana_id === S.c.campana_id ? 'selected' : ''}>${esc(x.nombre)} · ${ROLES[x.rol]}</option>`).join('')}</select></div></div>` : ''}
  ${admin ? `<h3>Datos de la campaña</h3>
  <form class="f card" id="fCamp">
    <div class="fld"><label for="aNom">Nombre</label><input id="aNom" value="${esc(c.nombre)}" required></div>
    <div class="fld"><label for="aResp">Responsable de los datos personales</label><input id="aResp" value="${esc(c.responsable_datos || '')}" placeholder="Nombre de la persona o entidad responsable"></div>
    <div class="fld"><label for="aCont">Contacto para privacidad (correo o teléfono)</label><input id="aCont" value="${esc(c.contacto_privacidad || '')}"></div>
    <div class="fld"><label for="aAviso">Enlace al aviso de privacidad integral</label><input id="aAviso" type="url" value="${esc(c.aviso_privacidad_url || '')}" placeholder="https://"></div>
    <div class="row"><div class="fld"><label for="aFecha">Fecha de la elección</label><input id="aFecha" type="date" value="${esc(c.fecha_eleccion || '')}"></div>
    <div class="fld"><label for="aObj">Objetivo de votación (%)</label><input id="aObj" type="number" min="5" max="95" step="1" value="${Math.round((c.objetivo_pct || .5) * 100)}"></div></div>
    <div class="fld"><label for="aRef">Elección de referencia para la participación</label><select id="aRef">
      <option value="dl24">Diputaciones locales 2024</option><option value="df24">Diputaciones federales 2024</option><option value="gub24">Gubernatura 2024</option><option value="pres24">Presidencia 2024</option><option value="ayu25">Ayuntamientos 2025</option></select></div>
    <button class="btn pri">Guardar</button>
  </form>` : ''}
  ${S.operador ? `<h3>Operación de la plataforma</h3><div class="card"><button class="btn wide" id="aNueva">Crear otra campaña</button></div>` : ''}
  <h3>Mi cuenta</h3><div class="card"><p class="note" style="margin:0 0 10px">${esc(S.session.user.email)} · ${ROLES[S.c.rol]}</p>
    <button class="btn wide" id="aSalir">Cerrar sesión</button>
    <p class="note" style="margin:10px 0 0">Versión ${esc(CFG.version)}. Al cerrar sesión se conservan en el teléfono los registros pendientes de enviar.</p></div>`);
  const sel = $('#aCamp'); if (sel) sel.onchange = async e => { S.c = S.campanas.find(x => x.campana_id === e.target.value); S.camp = null; S.secSet = new Set(); await abrirCampana(); };
  if (admin) {
    $('#aRef').value = c.eleccion_referencia || 'dl24';
    $('#fCamp').onsubmit = async ev => {
      ev.preventDefault();
      const upd = {nombre: $('#aNom').value.trim(), responsable_datos: $('#aResp').value.trim() || null, contacto_privacidad: $('#aCont').value.trim() || null,
        aviso_privacidad_url: $('#aAviso').value.trim() || null, fecha_eleccion: $('#aFecha').value || null,
        objetivo_pct: Math.max(5, Math.min(95, +$('#aObj').value || 50)) / 100, eleccion_referencia: $('#aRef').value};
      const {data, error} = await sb.from('campanas').update(upd).eq('id', S.c.campana_id).select('*').single();
      if (error) return toast(errMsg(error));
      S.camp = data; store.set('camp_' + S.c.campana_id, data); toast('Datos guardados');
    };
  }
  const nv = $('#aNueva'); if (nv) nv.onclick = () => vistaCrearCampana(false);
  $('#aSalir').onclick = async () => { await sb.auth.signOut(); };
}

const VISTAS = {inicio: vInicio, registrar: vRegistrar, personas: vPersonas, red: vRed, mapa: vMapa, equipo: vEquipo, ajustes: vAjustes};

// ---------- Crear campaña (operador) ----------
async function vistaCrearCampana(primera) {
  await cargarGeo().catch(() => {});
  const n = S.nombres || {df: {}, dl: {}, mun: {}};
  const opts = t => t === 'estado' ? '<option value="">Todo Veracruz</option>' : Object.entries(n[t === 'distrito_federal' ? 'df' : t === 'distrito_local' ? 'dl' : 'mun']).map(([k, v]) => [+k, v]).sort((a, b) => t === 'municipio' ? a[1].localeCompare(b[1], 'es') : a[0] - b[0]).map(([k, v]) => `<option value="${k}">${t === 'municipio' ? '' : String(k).padStart(2, '0') + ' · '}${esc(titulo(v))}</option>`).join('');
  render(`<div class="center"><div class="auth" style="max-width:520px">
    <div class="brand"><img src="icons/icon-192.png" alt=""><div><b>${primera ? 'Crea la primera campaña' : 'Nueva campaña'}</b><span class="muted">Eres operador de la plataforma</span></div></div>
    <form class="f card" id="fNC">
      <div class="fld"><label for="cNom">Nombre de la campaña</label><input id="cNom" required placeholder="Ej. Piloto Distrito Local 10 Xalapa 2027"></div>
      <div class="row"><div class="fld"><label for="cCargo">Cargo</label><select id="cCargo"><option value="diputacion_local">Diputación local</option><option value="diputacion_federal">Diputación federal</option><option value="ayuntamiento">Ayuntamiento</option><option value="gubernatura">Gubernatura</option><option value="senaduria">Senaduría</option><option value="otro">Otro</option></select></div>
      <div class="fld" style="flex:0 1 110px"><label for="cAnio">Año</label><input id="cAnio" type="number" min="2026" max="2040" value="2027"></div></div>
      <div class="row"><div class="fld"><label for="cTipo">Ámbito</label><select id="cTipo"><option value="distrito_local">Distrito local</option><option value="distrito_federal">Distrito federal</option><option value="municipio">Municipio</option><option value="estado">Estado</option></select></div>
      <div class="fld"><label for="cClave">Cuál</label><select id="cClave"></select></div></div>
      <div class="row"><div class="fld"><label for="cFecha">Fecha de la elección</label><input id="cFecha" type="date" value="2027-06-06"></div><div class="fld"><label for="cObj">Objetivo (%)</label><input id="cObj" type="number" min="5" max="95" value="50"></div></div>
      <div class="fld"><label for="cResp">Responsable de los datos personales</label><input id="cResp" placeholder="Candidatura, partido o persona responsable"></div>
      <div class="fld"><label for="cAdm">Correo de quien administrará la campaña (opcional)</label><input id="cAdm" type="email" placeholder="Si lo dejas vacío, la administras tú"></div>
      <button class="btn pri wide">Crear campaña</button>
      ${primera ? '' : '<button type="button" class="btn wide" id="cCancel">Cancelar</button>'}
    </form></div></div>`);
  const fill = () => { $('#cClave').innerHTML = opts($('#cTipo').value); if ($('#cTipo').value === 'distrito_local') $('#cClave').value = '10'; };
  $('#cTipo').onchange = fill; fill();
  const cc = $('#cCancel'); if (cc) cc.onclick = () => { armarShell(); ir('ajustes'); };
  $('#fNC').onsubmit = async ev => {
    ev.preventDefault(); const b = $('#fNC .pri'); b.disabled = true;
    const tipo = $('#cTipo').value, cargoRef = {diputacion_local: 'dl24', diputacion_federal: 'df24', ayuntamiento: 'ayu25', gubernatura: 'gub24', senaduria: 'pres24', otro: 'dl24'}[$('#cCargo').value];
    const {data, error} = await sb.rpc('crear_campana', {p_nombre: $('#cNom').value.trim(), p_cargo: $('#cCargo').value, p_anio: +$('#cAnio').value, p_ambito_tipo: tipo,
      p_ambito_clave: tipo === 'estado' ? null : +$('#cClave').value, p_eleccion_referencia: cargoRef, p_objetivo: (+$('#cObj').value || 50) / 100,
      p_fecha_eleccion: $('#cFecha').value || null, p_responsable: $('#cResp').value.trim() || null,
      p_admin_correo: $('#cAdm').value.trim().toLowerCase() || null, p_admin_nombre: null});
    if (error) { b.disabled = false; return toast(errMsg(error), 4000); }
    toast('Campaña creada');
    store.set('campana', data);
    entrar();
  };
}
function vistaSinCampana() {
  render(`<div class="center"><div class="auth"><div class="brand"><img src="icons/icon-192.png" alt=""><div><b>Aún no tienes campaña asignada</b></div></div>
    <div class="card"><p>Tu cuenta <b>${esc(S.session.user.email)}</b> todavía no está dada de alta en ninguna campaña.</p><p class="note">Pide a tu coordinación que te registre en el equipo con este mismo correo. Después vuelve a entrar.</p>
    <div class="row"><button class="btn pri" onclick="location.reload()">Ya me dieron de alta</button><button class="btn" id="out">Cerrar sesión</button></div></div></div></div>`);
  $('#out').onclick = () => sb.auth.signOut();
}

// ---------- Acceso ----------
function vistaAcceso(modo = 'entrar') {
  render(`<div class="center"><div class="auth">
    <div class="brand"><img src="icons/icon-192.png" alt=""><div><b>Plataforma de Campaña</b><span class="muted">Estructura territorial y redes</span></div></div>
    <div class="seg" role="tablist"><button data-m="entrar" aria-pressed="${modo === 'entrar'}">Entrar</button><button data-m="crear" aria-pressed="${modo === 'crear'}">Crear acceso</button></div>
    <form class="f card" id="fAcc">
      <div class="fld"><label for="aEm">Correo</label><input id="aEm" type="email" required autocomplete="email" value="${esc(store.get('ultimoCorreo', ''))}"></div>
      ${modo !== 'olvido' ? `<div class="fld"><label for="aPw">Contraseña</label><input id="aPw" type="password" required minlength="6" autocomplete="${modo === 'crear' ? 'new-password' : 'current-password'}"></div>` : ''}
      ${modo === 'crear' ? '<p class="note" style="margin:0">Usa el correo con el que tu coordinación te dio de alta. Te llegará un correo para confirmar.</p>' : ''}
      <button class="btn pri wide">${modo === 'entrar' ? 'Entrar' : modo === 'crear' ? 'Crear mi acceso' : 'Enviar enlace para cambiar contraseña'}</button>
      ${modo === 'entrar' ? '<button type="button" class="btn wide" data-m="olvido">Olvidé mi contraseña</button>' : modo === 'olvido' ? '<button type="button" class="btn wide" data-m="entrar">Volver</button>' : ''}
      <div id="aMsg"></div>
    </form>
    <p class="note" style="text-align:center;margin-top:14px">Uso exclusivo del equipo de campaña. Los cambios a los datos quedan registrados en bitácora.</p></div></div>`);
  $$('[data-m]').forEach(b => b.onclick = () => vistaAcceso(b.dataset.m));
  $('#fAcc').onsubmit = async ev => {
    ev.preventDefault();
    const email = $('#aEm').value.trim().toLowerCase(), pw = $('#aPw') && $('#aPw').value, msg = $('#aMsg'), b = $('#fAcc .pri');
    store.set('ultimoCorreo', email); b.disabled = true; msg.innerHTML = '';
    let r;
    if (modo === 'entrar') r = await sb.auth.signInWithPassword({email, password: pw});
    else if (modo === 'crear') r = await sb.auth.signUp({email, password: pw, options: {emailRedirectTo: APP_URL}});
    else r = await sb.auth.resetPasswordForEmail(email, {redirectTo: APP_URL});
    b.disabled = false;
    if (r.error) return msg.innerHTML = `<div class="alerta bad">${esc(errMsg(r.error))}</div>`;
    if (modo === 'entrar') { S.session = r.data.session; return entrar(); }
    if (modo === 'crear' && r.data.session) { S.session = r.data.session; return entrar(); }
    msg.innerHTML = `<div class="alerta ok">${modo === 'crear' ? 'Listo. Revisa tu correo y abre el enlace de confirmación; después entra con tu contraseña.' : 'Si el correo está registrado, te llegó un enlace para cambiar tu contraseña.'}</div>`;
  };
}
function vistaNuevaClave() {
  render(`<div class="center"><div class="auth"><div class="brand"><img src="icons/icon-192.png" alt=""><div><b>Nueva contraseña</b></div></div>
    <form class="f card" id="fNP"><div class="fld"><label for="nPw">Contraseña nueva</label><input id="nPw" type="password" minlength="6" required autocomplete="new-password"></div><button class="btn pri wide">Guardar y entrar</button><div id="nMsg"></div></form></div></div>`);
  $('#fNP').onsubmit = async ev => {
    ev.preventDefault();
    const {error} = await sb.auth.updateUser({password: $('#nPw').value});
    if (error) return $('#nMsg').innerHTML = `<div class="alerta bad">${esc(errMsg(error))}</div>`;
    S.recovery = false; history.replaceState(null, '', location.pathname); entrar();
  };
}

// ---------- Registro público por enlace de promotor ----------
async function vistaPublica(token) {
  render(`<div class="center"><p class="muted">Cargando invitación…</p></div>`);
  const {data, error} = await sb.rpc('datos_invitacion', {p_token: token});
  const inv = data && data[0];
  if (error || !inv) return render(`<div class="center"><div class="auth"><div class="alerta bad">${error ? esc(errMsg(error)) : 'Este enlace no es válido o ya fue desactivado. Pide uno nuevo a quien te invitó.'}</div></div></div>`);
  let pos = null;
  render(`<div class="center"><div class="auth" style="max-width:480px">
    <div class="brand"><img src="icons/icon-192.png" alt=""><div><b>${esc(inv.campana)}</b><span class="muted">Te invita ${esc(inv.promotor)}</span></div></div>
    <form class="f card" id="fPub" autocomplete="on">
      <div class="row"><div class="fld"><label for="uNom">Nombre(s)</label><input id="uNom" required minlength="2" autocomplete="given-name"></div><div class="fld"><label for="uApe">Apellidos</label><input id="uApe" autocomplete="family-name"></div></div>
      <div class="fld"><label for="uTel">Teléfono celular</label><input id="uTel" inputmode="tel" required pattern="[0-9 ()+-]{10,16}" autocomplete="tel"></div>
      <div class="row"><div class="fld"><label for="uCal">Calle</label><input id="uCal" autocomplete="address-line1"></div><div class="fld" style="flex:0 1 100px"><label for="uNum">Número</label><input id="uNum"></div></div>
      <div class="row"><div class="fld"><label for="uCol">Colonia</label><input id="uCol"></div><div class="fld" style="flex:0 1 110px"><label for="uCP">C.P.</label><input id="uCP" inputmode="numeric" maxlength="5" autocomplete="postal-code"></div></div>
      <div class="gps"><div class="st" id="uGps">Si estás en tu domicilio, comparte tu ubicación para ubicar tu sección (opcional).</div><button type="button" class="btn sm" id="uGpsB">Compartir ubicación</button></div>
      <div class="consent">${textoAviso({nombre: inv.campana, responsable_datos: inv.responsable, contacto_privacidad: inv.contacto_privacidad, aviso_privacidad_url: inv.aviso_privacidad_url})}
        <label class="chk" style="margin-top:10px"><input type="checkbox" id="uOk" required> Leí el aviso y <b>autorizo expresamente</b> el uso de mis datos, incluida mi simpatía política, para estos fines.</label></div>
      <label class="chk"><input type="checkbox" id="uProm"> Quiero invitar a más personas: dame mi propio enlace.</label>
      <button class="btn pri wide">Registrarme</button><div id="uMsg"></div>
    </form></div></div>`);
  $('#uGpsB').onclick = () => {
    const st = $('#uGps');
    if (!navigator.geolocation) return st.textContent = 'Tu teléfono no permite compartir ubicación. Puedes registrarte sin ella.';
    st.textContent = 'Buscando ubicación…';
    navigator.geolocation.getCurrentPosition(p => { pos = p.coords; st.textContent = `Ubicación lista (precisión ${Math.round(p.coords.accuracy)} m).`; },
      () => { st.textContent = 'No se pudo obtener la ubicación. Puedes registrarte sin ella.'; }, {enableHighAccuracy: true, timeout: 20000});
  };
  $('#fPub').onsubmit = async ev => {
    ev.preventDefault(); const b = $('#fPub .pri'); b.disabled = true;
    const {data: r, error} = await sb.rpc('registrar_por_invitacion', {p_token: token, p_nombre: $('#uNom').value.trim(), p_apellidos: $('#uApe').value.trim(), p_telefono: $('#uTel').value.trim(),
      p_calle: $('#uCal').value.trim() || null, p_numero: $('#uNum').value.trim() || null, p_colonia: $('#uCol').value.trim() || null, p_codigo_postal: $('#uCP').value.trim() || null,
      p_lat: pos ? pos.latitude : null, p_lon: pos ? pos.longitude : null, p_precision: pos ? pos.accuracy : null, p_consentimiento: $('#uOk').checked, p_quiere_promover: $('#uProm').checked});
    b.disabled = false;
    if (error) return $('#uMsg').innerHTML = `<div class="alerta bad">${esc(errMsg(error))}</div>`;
    S.camp = {nombre: inv.campana};
    render(`<div class="center"><div class="auth" style="max-width:420px"><div class="alerta ok">Gracias, ${esc($('#uNom') ? $('#uNom').value : '')} quedaste registrado en la red de ${esc(inv.promotor)}.</div>
      ${r && r.token_promotor ? `<div class="card" id="pubEnl"><b>Tu enlace para invitar</b><div class="spacer"></div>${enlaceHTML(r.token_promotor)}</div>` : '<p class="note">Ya puedes cerrar esta página.</p>'}</div></div>`);
    if (r && r.token_promotor) bindEnlace($('#pubEnl'), r.token_promotor);
  };
}

// ---------- Instalación y sin conexión ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const had = !!navigator.serviceWorker.controller; let rel = false;
  navigator.serviceWorker.register('sw.js').then(reg => setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000)).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !rel && !$('form input:focus')) { rel = true; location.reload(); } });
}
boot().catch(e => render(`<div class="center"><div class="auth"><div class="alerta bad">${esc(errMsg(e))}</div><button class="btn wide" onclick="location.reload()">Reintentar</button></div></div>`));
})();

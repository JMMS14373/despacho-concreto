/* App Despacho de Concreto — interior mina (PWA, funciona sin señal) */
(function () {
  'use strict';

  // Versión de la app: súbala cada vez que publique cambios. Aparece en pantalla, en cada registro y en el cierre (PDF, Excel y CSV).
  const APP_VERSION = '1.4.2', APP_FECHA = '2026-10-25';

  /* ---------------- utilidades ---------------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LS = {
    get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } },
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  const fechaLocal = (d = new Date()) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const hoy = () => fechaLocal().slice(0, 10);
  const hora = (iso) => (iso || '').slice(11, 16);
  const num = (v) => Math.round(Number(v || 0) * 100) / 100;
  // Hora de inicio del turno Día y del turno Noche (minutos del día). Se toman de tblShift del maestro; sin maestro: 06:00 y 18:00.
  const HT = { dia: 360, noche: 1080 };
  const aMin = (hhmm) => { const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  function ajustarTurnos() {
    const t = (M && M.turnos) || [];
    const d = t.find(x => /^(DAY|DIA)/.test(x.id || '')), n = t.find(x => /^(NIGHT|NOCHE)/.test(x.id || ''));
    HT.dia = (d && aMin(d.inicio)) ?? 360; HT.noche = (n && aMin(n.inicio)) ?? 1080;
    const f = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
    if (window.Cierre && Cierre.config) Cierre.config({ dia: f(HT.dia), noche: f(HT.noche) });
  }
  const turnoDe = (iso) => { const x = (iso || fechaLocal()); const m = Number(x.slice(11, 13)) * 60 + Number(x.slice(14, 16)); return m >= HT.dia && m < HT.noche ? 'Día' : 'Noche'; };
  const guardiaActual = () => LS.get('guardia', '') || '—';
  // Perfil de este celular: DESPACHADOR (todo el despacho) u OPERADOR_ROBOJET (registra su aplicación en el frente, sin señal)
  const PERFILES = [['DESPACHADOR', 'Despachador'], ['OPERADOR_ROBOJET', 'Operador de Robojet']];
  const perfil = () => LS.get('perfil', 'DESPACHADOR');
  const VISTAS_PERFIL = { DESPACHADOR: ['despachos', 'nueva', 'liberar', 'flota', 'maestros'], OPERADOR_ROBOJET: ['aplicar', 'maestros'] };
  function aplicarPerfil() {
    const ok = VISTAS_PERFIL[perfil()] || VISTAS_PERFIL.DESPACHADOR;
    $$('.nav button').forEach(b => { b.hidden = !ok.includes(b.dataset.vista); });
  }

  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ver' + (error ? ' err' : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.className = 'toast'; }, error ? 4500 : 2600);
  }

  /* ---------------- catálogos técnicos (genéricos) ---------------- */
  const MEZCLAS = [
    { id: 'MZ-LAN-4000', n: 'Lanzado 4000' }, { id: 'MZ-EST-3000', n: '3000 PSI' },
    { id: 'MZ-EST-4000', n: '4000 PSI' }, { id: 'MZ-EST-5000', n: '5000 PSI' }, { id: 'MZ-MR-4', n: 'MR 4 MPa' },
  ];
  const CATEG_BASE = ['Muro', 'Losa comedor', 'Losa refugio', 'Losa SAM', 'Cuneta', 'NA'];
  const METODOS = [['ROBOJET', 'Robojet'], ['GRAVEDAD', 'Gravedad'], ['AUTOBOMBA', 'Autobomba'],
    ['BOMBA_ESTACIONARIA', 'B. estacionaria'], ['GRUA_BACHA', 'Grúa-bacha'], ['TRASIEGO', 'Trasiego'], ['OTROS', 'Otros']];
  const EST_REM = { DESPACHADO: ['POR LIBERAR', 'e-lib'], LIBERADO: ['LIBERADO', 'e-ok'], CANCELADO: ['CANCELADO', 'e-can'] };
  const EST_EQ = { OPERATIVO: ['OPERATIVO', 'e-ok'], INOPERATIVO: ['INOPERATIVO', 'e-mal'], MANTENIMIENTO: ['EN TALLER', 'e-lib'],
    STANDBY: ['STANDBY', 'e-ruta'], BAJA: ['BAJA', 'e-can'] };
  const CAMBIOS = [['MANTENIMIENTO', 'En taller'], ['INOPERATIVO', 'Inoperativo'], ['STANDBY', 'Standby'], ['OPERATIVO', 'Operativo']];
  const CATEGORIAS = [['CORRECTIVO', 'Correctivo (falla)'], ['PREVENTIVO', 'Preventivo'], ['OPERACIONAL', 'Operacional'], ['OTRO', 'Otro']];
  const duracion = (desde) => {
    const min = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60000));
    return min < 60 ? `${min} min` : min < 1440 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${Math.floor(min / 1440)} d ${Math.floor((min % 1440) / 60)} h`;
  };
  const AREAS = [{ id: 'OPM', nombre: 'Operación Mina' }, { id: 'ST', nombre: 'Servicios Técnicos' }, { id: 'OC', nombre: 'Obras Civiles' }];
  const CARGOS = [['DESPACHADOR', 'Despachador'], ['CONDUCTOR', 'Operador de Mixer'], ['OPERADOR_ROBOJET', 'Operador de Robojet']];
  // Mezclas: las del maestro (tblMezcla); las de ejemplo solo si el maestro no las trae. El id guardado es el nombre de la mezcla.
  const listaMezclas = () => (M && M.mezclas && M.mezclas.length) ? M.mezclas.map(m => ({ id: m.id, n: m.nombre, vaceado: m.vaceado })) : MEZCLAS.map(m => ({ ...m, vaceado: /-EST-/.test(m.id) }));
  const listaAreas = () => (M && M.areas && M.areas.length) ? M.areas : AREAS;
  const areaN = (id) => (listaAreas().find(a => a.id === id) || AREAS.find(a => a.id === id) || {}).nombre || id || '';
  const mezclaN = (id) => (listaMezclas().find(m => m.id === id) || MEZCLAS.find(m => m.id === id) || {}).n || id;
  const mezclaTxt = (r) => mezclaN(r.mezcla) + (r.categoria && r.categoria !== 'NA' ? ' · ' + r.categoria : '');

  /* ---------------- datos del dispositivo (IndexedDB) ---------------- */
  let _db;
  function db() {
    if (_db) return _db;
    _db = new Promise((ok, mal) => {
      const r = indexedDB.open('despacho-concreto-datos', 3);
      r.onupgradeneeded = () => {
        const d = r.result, st = d.objectStoreNames;
        if (!st.contains('remisiones')) d.createObjectStore('remisiones', { keyPath: 'numero' });
        if (!st.contains('liberaciones')) d.createObjectStore('liberaciones', { keyPath: 'remision_num' });
        if (!st.contains('eventos')) d.createObjectStore('eventos', { keyPath: 'id', autoIncrement: true });
        if (!st.contains('aplicaciones')) d.createObjectStore('aplicaciones', { keyPath: 'id' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
    return _db;
  }
  async function tx(store, modo, fn) {
    const d = await db();
    return new Promise((ok, mal) => {
      const t = d.transaction(store, modo), rq = fn(t.objectStore(store));
      t.oncomplete = () => ok(rq && rq.result);
      t.onerror = () => mal(t.error);
    });
  }
  const Datos = {
    todas: (s) => tx(s, 'readonly', o => o.getAll()),
    una: (s, k) => tx(s, 'readonly', o => o.get(k)),
    poner: (s, v) => tx(s, 'readwrite', o => o.put(v)),
  };

  /* ---------------- estado ---------------- */
  let M = null;                       // maestro guardado en el celular
  const E = { vista: 'despachos', filtro: 'TODOS', rmLiberar: null, previa: null, equipo: null, cierre: null };
  const lab = (id) => M && M.labores.find(l => l.id === id);
  const per = (id) => M && M.personas.find(p => p.id === id);
  const contrN = (id) => (M && (M.contratistas.find(c => c.id === id) || {}).nombre) || id || '';

  /* ---------------- estado vigente de equipos: gana el registro más reciente ---------------- */
  const fechaMaestro = () => (M && M.fecha ? fechaLocal(new Date(M.fecha)) : '0000');
  async function estadosEquipos() {
    const ev = await Datos.todas('eventos');
    const ult = new Map();
    ev.sort((a, b) => a.momento.localeCompare(b.momento) || a.id - b.id).forEach(e => ult.set(e.equipo, e));
    const fm = fechaMaestro();
    return new Map(M.equipos.map(e => {
      const x = ult.get(e.id);
      return [e.id, x && x.momento >= fm
        ? { estado: x.estado, desde: x.momento, motivo: x.motivo, categoria: x.categoria, fuente: 'app' }
        : { estado: e.estado, desde: null, motivo: e.observacion, fuente: 'maestro' }];
    }));
  }
  async function validarEquipo(codigo) {
    if (!M) return { ok: false, error: 'No hay maestro cargado en este celular.' };
    const e = M.equipos.find(x => x.id.toUpperCase() === String(codigo).toUpperCase());
    if (!e) return { ok: false, error: `El equipo ${codigo} no está en el maestro v${M.version}.` };
    if (!e.activo) return { ok: false, error: `El equipo ${codigo} está dado de baja.`, equipo: e };
    const st = (await estadosEquipos()).get(e.id);
    if (st.estado !== 'OPERATIVO') {
      const [et] = EST_EQ[st.estado] || [st.estado];
      return { ok: false, equipo: e, error: `${e.id} está ${et.toLowerCase()}${st.desde ? ' desde ' + hora(st.desde) : ''}${st.motivo ? ' · ' + st.motivo : ''}: no se puede despachar.` };
    }
    return { ok: true, equipo: e };
  }
  const existeEquipo = async (codigo) => {
    const e = M && M.equipos.find(x => x.id.toUpperCase() === String(codigo).toUpperCase());
    return e ? { ok: true, equipo: e } : { ok: false, error: `El equipo ${codigo} no está en el maestro.` };
  };

  /* ---------------- encabezado y navegación ---------------- */
  const TITULOS = {
    despachos: ['PLANTA DE CONCRETO · 混凝土站', 'Despachos del turno'],
    nueva: ['发货单', 'Nueva remisión'],
    liberar: ['混凝土供应验收单', 'Liberación de concreto'],
    aplicar: ['ROBOJET · 喷浆', 'Aplicación'],
    flota: ['MIXER · ROBOJET · 车队', 'Flota'],
    maestros: ['主数据', 'Maestros'],
  };
  function encabezado() {
    const [sub, tit] = TITULOS[E.vista];
    $('#topSub').textContent = sub;
    $('#topTitulo').textContent = tit;
    const d = new Date();
    const f = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
    $('#topChips').innerHTML =
      `<span>${esc(f)} · ${turnoDe()} · Guardia ${esc(guardiaActual())}</span>` +
      `<span>App v${esc(APP_VERSION)} · ${M ? 'Maestro v' + esc(M.version) : 'Sin maestro'}</span>`;
    aplicarPerfil();
    $$('.nav button').forEach(b => b.toggleAttribute('aria-current', b.dataset.vista === E.vista) || b.removeAttribute('aria-current'));
    $$('.nav button').forEach(b => { if (b.dataset.vista === E.vista) b.setAttribute('aria-current', 'page'); });
  }
  function red() {
    const on = navigator.onLine;
    $('#red').classList.toggle('off', !on);
    $('#redTxt').textContent = on ? 'En línea' : 'Sin señal';
  }

  async function ir(vista, extra) {
    // Si hay una versión nueva esperando, se aplica al pasar a una pantalla sin formulario abierto.
    const vaAFormulario = vista === 'nueva' || (vista === 'liberar' && extra && extra.rmLiberar);
    if (typeof pendiente !== 'undefined' && pendiente && !vaAFormulario && aplicarActualizacion(vista)) return;
    if (!(VISTAS_PERFIL[perfil()] || []).includes(vista)) vista = VISTAS_PERFIL[perfil()][0];
    if (vista !== 'maestros') Pin.cerrar();      // el acceso de maestro se cierra al salir de la pantalla
    E.vista = vista;
    Object.assign(E, extra || {});
    encabezado();
    const main = $('#vista');
    if (!M && vista !== 'maestros') {
      main.innerHTML = `<div class="card vacio"><b>No hay maestro en este celular</b>
        <span>Cargue el maestro (labores, equipos y operadores) para empezar. Después funciona sin señal.</span>
        <button type="button" class="btn btn-pri" data-ir="maestros">Ir a Maestros</button></div>`;
      return;
    }
    await VISTAS[vista](main);
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }

  /* ================= 1. DESPACHOS ================= */
  async function vDespachos(main) {
    const rem = (await Datos.todas('remisiones')).sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
    const deHoy = rem.filter(r => r.fecha_hora.startsWith(hoy()) && r.estado !== 'CANCELADO');
    const sinLib = rem.filter(r => r.estado === 'DESPACHADO').length;
    const filtros = [['TODOS', 'Todos'], ['DESPACHADO', 'Por liberar'], ['LIBERADO', 'Liberados'], ['CANCELADO', 'Cancelados']];
    const vis = rem.filter(r => E.filtro === 'TODOS' || r.estado === E.filtro).slice(0, 150);
    main.innerHTML = `
      <section class="kpis" aria-label="Resumen de hoy">
        <div class="kpi"><span>m³ hoy</span><b>${num(deHoy.reduce((s, r) => s + r.volumen_m3, 0))}</b></div>
        <div class="kpi"><span>Viajes hoy</span><b>${deHoy.length}</b></div>
        <div class="kpi ${sinLib ? 'alerta' : ''}"><span>Sin liberar</span><b>${sinLib}</b></div>
      </section>
      <div class="filtros" role="radiogroup" aria-label="Filtro de estado">
        ${filtros.map(([v, t]) => `<label class="op"><input type="radio" name="filtro" value="${v}" ${E.filtro === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
      </div>
      ${vis.length ? `<ul class="lista">${vis.map(itemRem).join('')}</ul>`
        : `<div class="vacio">No hay remisiones ${E.filtro === 'TODOS' ? 'registradas' : 'en este estado'}.</div>`}
      <div id="panelCierre"></div>
      <div class="barra">
        <button type="button" class="btn btn-sec" id="cerrarTurno">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/></svg>Cierre</button>
        <label class="btn btn-sec carga" style="position:relative" title="Recibir aplicaciones de los operadores de Robojet">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>Recibir
          <input type="file" id="recibirApl" accept=".json,application/json" multiple></label>
        <button type="button" class="btn btn-sec" id="exportar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v2h16v-2"/></svg>Excel</button>
        <button type="button" class="btn btn-pri" style="flex:1" data-ir="nueva">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nueva remisión</button>
      </div>`;
    $$('input[name=filtro]', main).forEach(i => i.addEventListener('change', () => { E.filtro = i.value; vDespachos(main); }));
    $('#exportar', main).addEventListener('click', exportar);
    $('#recibirApl', main).addEventListener('change', (e) => { if (e.target.files.length) recibirAplicaciones([...e.target.files], main); });
    $('#cerrarTurno', main).addEventListener('click', () => { E.cierre = E.cierre ? null : cierreInicial(); panelCierre(main); });
    panelCierre(main);
    $$('[data-cancelar]', main).forEach(b => b.addEventListener('click', () => cancelar(Number(b.dataset.cancelar), main)));
  }
  /* ---------- cierre de turno: PDF, Excel o CSV ---------- */
  function cierreInicial() {
    const ahora = new Date(), h = ahora.getHours();
    const m = h * 60 + ahora.getMinutes();
    if (m < HT.dia) { const ayer = new Date(ahora.getTime() - 864e5); return { dia: fechaLocal(ayer).slice(0, 10), turno: 'NOCHE' }; }
    return { dia: hoy(), turno: m < HT.noche ? 'DIA' : 'NOCHE' };
  }
  async function resumenCierre() {
    return Cierre.construir({
      remisiones: await Datos.todas('remisiones'), liberaciones: await Datos.todas('liberaciones'), aplicaciones: await Datos.todas('aplicaciones'), eventos: await Datos.todas('eventos'),
      estadosAhora: await estadosEquipos(), maestro: M, appVersion: APP_VERSION, mezclaN, areaN, guardia: guardiaActual(), dia: E.cierre.dia, turno: E.cierre.turno,
    });
  }
  async function panelCierre(main) {
    const caja = $('#panelCierre', main);
    if (!caja) return;
    if (!E.cierre) { caja.innerHTML = ''; return; }
    const sum = await resumenCierre(), k = sum.kpi;
    caja.innerHTML = `<section class="card destacada" aria-label="Cierre de turno">
      <b>Cierre de turno · 关班</b>
      <div class="dos">
        <label class="campo">Fecha<input type="date" id="cDia" value="${esc(E.cierre.dia)}"></label>
        <label class="campo">Turno<select id="cTurno">${Object.entries(Cierre.TURNOS).map(([v, t]) => `<option value="${v}" ${v === E.cierre.turno ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
      <div class="aviso info"><b>${k.viajes} viajes · ${k.m3} m³ despachados</b>
        <span>${k.recibidos} m³ aplicados (Robojet) · ${k.sinLiberar} Mixers en ruta · ${k.canceladas} canceladas</span>
        <span>Conciliación: ${k.conciliadas} ok · ${k.conDiferencia} con diferencia · ${k.sinAplicacion} sin aplicación registrada</span>
        <span style="font-size:12px">Ventana: ${esc(sum.ventana[0].replace('T', ' '))} a ${esc(sum.ventana[1].replace('T', ' '))}</span></div>
      <div class="barra" style="flex-wrap:wrap">
        <button type="button" class="btn btn-pri" id="cExcel" style="flex:2">Excel</button>
        <button type="button" class="btn btn-sec" id="cPdf" style="flex:1">PDF</button>
        <button type="button" class="btn btn-sec" id="cCsv" style="flex:1">CSV</button></div>
      <span style="font-size:12px;color:var(--gris)">PDF: en la ventana de impresión elija «Guardar como PDF».</span>
    </section>`;
    $('#cDia', caja).addEventListener('change', e => { E.cierre.dia = e.target.value || hoy(); panelCierre(main); });
    $('#cTurno', caja).addEventListener('change', e => { E.cierre.turno = e.target.value; panelCierre(main); });
    $('#cExcel', caja).addEventListener('click', async () => { Cierre.excel(await resumenCierre(), XLSX); toast('Excel de cierre generado'); });
    $('#cCsv', caja).addEventListener('click', async () => { Cierre.csv(await resumenCierre()); toast('CSV de cierre generado'); });
    $('#cPdf', caja).addEventListener('click', async () => { Cierre.imprimir(await resumenCierre()); });
  }
  function itemRem(r) {
    const [et, cl] = EST_REM[r.estado] || [r.estado, 'e-can'];
    return `<li class="item">
      <div class="item-fila"><span class="item-rm">Rm ${esc(r.numero)}</span><span class="estado ${cl}">${et}</span></div>
      <div class="item-t">${esc(r.contratista)} · ${esc(r.labor)}</div>
      <div class="item-meta"><span>${esc(r.fecha_hora.slice(5, 10))} ${esc(hora(r.fecha_hora))}</span><span>${esc(mezclaTxt(r))}</span>
        <span>${esc(num(r.volumen_m3))} m³</span><span>${esc(r.equipo)}</span></div>
      ${r.estado === 'DESPACHADO' ? `<div class="item-acc">
        <button type="button" class="btn btn-osc btn-peq" data-ir="liberar" data-rm="${esc(r.numero)}">Liberar</button>
        <button type="button" class="btn btn-sec btn-peq" data-cancelar="${esc(r.numero)}">Cancelar</button></div>` : ''}
    </li>`;
  }
  async function cancelar(numero, main) {
    if (!confirm(`¿Cancelar la remisión ${numero}?`)) return;
    const r = await Datos.una('remisiones', numero);
    if (!r || r.estado !== 'DESPACHADO') return toast('Solo se cancela una remisión sin liberar.', true);
    r.estado = 'CANCELADO'; r.cancelada = fechaLocal();
    await Datos.poner('remisiones', r);
    toast(`Remisión ${numero} cancelada`);
    vDespachos(main);
  }

  /* ================= 2. NUEVA REMISIÓN ================= */
  async function vNueva(main) {
    const rem = await Datos.todas('remisiones');
    const sig = rem.length ? Math.max(...rem.map(r => r.numero)) + 1 : '';
    const L = Maestro.listas(M);
    const st = await estadosEquipos();
    L.equiposDisponibles = L.equiposDisponibles.filter(e => st.get(e.id).estado === 'OPERATIVO');
    E.equipo = null;
    const opt = (arr, f, vacio) => `<option value="">${vacio}</option>` + arr.map(f).join('');
    main.innerHTML = `
      <form id="fRem" novalidate>
        <label class="campo">Área técnica · 技术区域
          <select name="area" required>${opt(listaAreas(), a => `<option value="${esc(a.id)}" ${a.id === LS.get('area', '') ? 'selected' : ''}>${esc(a.nombre)}</option>`, 'Seleccionar…')}</select></label>
        <div class="dos">
          <label class="campo">N.º remisión
            <input name="numero" type="number" inputmode="numeric" min="1" required value="${esc(sig)}"></label>
          <label class="campo">Fecha y hora
            <input name="fecha_hora" type="datetime-local" required value="${fechaLocal()}"></label>
        </div>
        <label class="campo">Contratista · 承包商
          <select name="contratista" required>${opt(M.contratistas, c => `<option value="${esc(c.id)}">${esc(c.nombre)} · ${esc(c.id)}</option>`, 'Seleccionar…')}</select></label>
        <label class="campo">Labor · 工作面 (solo activas)
          <select name="labor" required></select></label>
        <fieldset><legend>Mezcla · 配合比</legend>
          <div class="opciones">${listaMezclas().map((m, i) => `<label class="op"><input type="radio" name="mezcla" value="${esc(m.id)}" ${i === 0 ? 'checked' : ''}><span>${esc(m.n)}</span></label>`).join('')}</div>
        </fieldset>
        <label class="campo" id="campoCat">Categoría · 类别 (solo vaceado)
          <select name="categoria">${opt((L.categorias && L.categorias.length ? L.categorias : CATEG_BASE).map(c => ({ id: c })), c => `<option value="${esc(c.id)}">${esc(c.id)}</option>`, 'Seleccionar…')}</select></label>
        <div class="campo">Volumen · 体积 (m³)
          <div class="stepper">
            <button type="button" data-paso="-0.5" aria-label="Restar 0,5 m³">−</button>
            <input name="volumen_m3" type="number" inputmode="decimal" step="0.5" min="0.5" max="12" value="3.5" aria-label="Volumen en m³">
            <button type="button" data-paso="0.5" aria-label="Sumar 0,5 m³">+</button>
          </div></div>
        <div class="campo">Equipo · 车辆
          <div class="equipo-fila">
            <button type="button" class="btn btn-osc" id="btnQR" style="min-height:56px">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3"/><rect x="7" y="7" width="4" height="4"/><rect x="13" y="13" width="4" height="4"/></svg>QR</button>
            <div class="equipo-sel" id="eqSel" aria-live="polite"><b>—</b><small>Escanee el QR o elija de la lista</small></div>
          </div>
          <select name="equipo" aria-label="Equipo (lista)">${opt(L.equiposDisponibles, e => `<option value="${esc(e.id)}">${esc(e.id)} · ${esc(e.tipo)}</option>`, 'o elegir de la lista (solo operativos)…')}</select>
        </div>
        <fieldset><legend>Quién registra · 登记人</legend>
          <div class="dos">
            <label class="campo">Cargo
              <select name="cargo">${CARGOS.map(([v, t]) => `<option value="${v}" ${v === LS.get('cargo', 'DESPACHADOR') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            <label class="campo">Nombre
              <select name="persona" required></select></label>
          </div>
          <div class="dos">
            <label class="campo">Guardia (automática)
              <input name="guardia" readonly value="—" aria-live="polite"></label>
            <label class="campo">Tipo de equipo
              <select name="tipo_equipo" disabled><option value="NA">NA</option><option value="MIXER">Mixer</option><option value="ROBOJET">Robojet</option></select></label>
          </div>
        </fieldset>
        <label class="campo">Operador de Mixer · 司机
          <select name="conductor">${opt(L.conductores, p => `<option value="${esc(p.id)}">${esc(p.nombre)} · ${esc(p.id)}</option>`, '—')}</select></label>
        <label class="campo">Observaciones<textarea name="obs" maxlength="300"></textarea></label>
        <div id="errRem"></div>
        <div class="barra"><button type="submit" class="btn btn-pri btn-grande">Despachar · 发货</button></div>
      </form>`;
    const f = $('#fRem', main);
    const llenarLabores = () => {
      const c = f.contratista.value;
      const ls = L.laboresActivas.filter(l => !c || !l.contratista || l.contratista === c)
        .sort((a, b) => a.id.localeCompare(b.id));
      f.labor.innerHTML = `<option value="">Seleccionar… (${ls.length})</option>` +
        ls.map(l => `<option value="${esc(l.id)}">${esc(l.id)} · ${l.tipo === 'PANEL' ? 'Panel' : 'Desarrollo'}</option>`).join('');
    };
    llenarLabores();
    f.contratista.addEventListener('change', llenarLabores);
    // Categoría: solo si la mezcla es de vaceado; en otro caso queda NA
    const mezclaSel = () => listaMezclas().find(m => m.id === (f.mezcla.value || ($('input[name=mezcla]:checked', f) || {}).value));
    const ajustaCategoria = () => {
      const v = !!(mezclaSel() || {}).vaceado, c = $('#campoCat', f);
      f.categoria.disabled = !v;
      if (!v) { f.categoria.innerHTML = '<option value="">NA (automático)</option>'; f.categoria.value = ''; }
      else if (f.categoria.options.length < 2 || f.categoria.options[0].textContent.startsWith('NA')) {
        f.categoria.innerHTML = '<option value="">Seleccionar…</option>' + (L.categorias && L.categorias.length ? L.categorias : CATEG_BASE).map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
      }
    };
    $$('input[name=mezcla]', f).forEach(r => r.addEventListener('change', ajustaCategoria));
    ajustaCategoria();
    // Cargo → nombres de ese cargo → guardia automática (columna Guard del maestro)
    const llenarPersonas = (previa) => {
      const ps = L.porCargo(f.cargo.value);
      f.persona.innerHTML = `<option value="">Seleccionar… (${ps.length})</option>` + ps.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)} · ${esc(p.id)}</option>`).join('');
      if (previa && ps.some(p => p.id === previa)) f.persona.value = previa;
      ponGuardia();
    };
    const persona = () => L.porCargo(f.cargo.value).find(p => p.id === f.persona.value);
    function ponGuardia() {
      const p = persona();
      f.guardia.value = p ? (p.guardia || 'Sin guardia en el maestro') : '—';
      if (p && p.guardia) { LS.set('guardia', p.guardia); encabezado(); }
      if (p && f.cargo.value === 'CONDUCTOR' && !f.conductor.value) f.conductor.value = p.id;
      // Tipo de equipo: solo se habilita si la persona opera mixer y robojet (dos cargos en el maestro); si no, NA
      const multi = !!(p && p.multiple), te = f.tipo_equipo;
      te.disabled = !multi;
      te.value = multi ? (f.cargo.value === 'OPERADOR_ROBOJET' ? 'ROBOJET' : 'MIXER') : 'NA';
    }
    f.cargo.addEventListener('change', () => { LS.set('cargo', f.cargo.value); llenarPersonas(); });
    f.persona.addEventListener('change', () => { LS.set('persona', f.persona.value); ponGuardia(); });
    llenarPersonas(LS.get('persona', ''));
    $$('[data-paso]', f).forEach(b => b.addEventListener('click', () => {
      const v = Math.min(12, Math.max(0.5, num(Number(f.volumen_m3.value || 0) + Number(b.dataset.paso))));
      f.volumen_m3.value = v;
    }));
    const marcarEquipo = (e) => {
      E.equipo = e ? e.id : null;
      const caja = $('#eqSel', f);
      caja.className = 'equipo-sel' + (e ? ' ok' : '');
      caja.innerHTML = e ? `<b>${esc(e.id)}</b><small>${esc(e.tipo)} · Operativo ✓</small>`
        : '<b>—</b><small>Escanee el QR o elija de la lista</small>';
      f.equipo.value = e ? e.id : '';
    };
    f.equipo.addEventListener('change', async () => {
      if (!f.equipo.value) return marcarEquipo(null);
      const v = await validarEquipo(f.equipo.value);
      v.ok ? marcarEquipo(v.equipo) : (marcarEquipo(null), toast(v.error, true));
    });
    $('#btnQR', f).addEventListener('click', async () => {
      const v = await escanear(validarEquipo);
      if (v.ok) { marcarEquipo(v.equipo); toast(`Equipo ${v.equipo.id} listo`); }
      else if (v.error !== 'Escaneo cancelado.') toast(v.error, true);
    });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = [];
      const numero = Number(f.numero.value);
      if (!Number.isInteger(numero) || numero < 1) err.push('Número de remisión inválido.');
      const previa = numero ? await Datos.una('remisiones', numero) : null;
      if (previa && previa.estado !== 'CANCELADO') err.push(`La remisión ${numero} ya existe.`);
      if (!f.area.value) err.push('Elija el área técnica.');
      if (!f.contratista.value) err.push('Elija la contratista.');
      const cat = (mezclaSel() || {}).vaceado ? f.categoria.value : 'NA';
      if (!cat) err.push('Elija la categoría del vaceado.');
      const pr = persona();
      if (!pr) err.push('Elija quién registra (cargo y nombre).');
      else if (!pr.guardia) err.push(`${pr.nombre} no tiene guardia en el maestro.`);
      if (pr && pr.multiple && !['MIXER', 'ROBOJET'].includes(f.tipo_equipo.value)) err.push('Elija el tipo de equipo (Mixer o Robojet).');
      if (!f.labor.value) err.push('Elija la labor.');
      const vol = Number(f.volumen_m3.value);
      if (!(vol >= 0.5 && vol <= 12)) err.push('El volumen debe estar entre 0,5 y 12 m³.');
      if (!E.equipo) err.push('Escanee o elija el equipo.');
      else {
        const v = await validarEquipo(E.equipo);
        if (!v.ok) err.push(v.error);
      }
      $('#errRem', f).innerHTML = err.length ? `<div class="aviso err" role="alert">${err.map(e => `<span>${esc(e)}</span>`).join('')}</div>` : '';
      if (err.length) return;
      const fh = f.fecha_hora.value || fechaLocal();
      await Datos.poner('remisiones', {
        numero, fecha_hora: fh, area: f.area.value, contratista: f.contratista.value, labor: f.labor.value,
        mezcla: f.mezcla.value, categoria: cat, volumen_m3: num(vol), equipo: E.equipo,
        conductor: f.conductor.value || null, despachador: pr.rol === 'DESPACHADOR' ? pr.id : null,
        registrado_por: pr.id, cargo: pr.rol, tipo_equipo: pr.multiple ? f.tipo_equipo.value : 'NA',
        turno: turnoDe(fh), guardia: pr.guardia, observaciones: f.obs.value.trim() || null,
        estado: 'DESPACHADO', maestro_version: M.version, app_version: APP_VERSION, registrado: fechaLocal(),
      });
      LS.set('area', f.area.value);
      toast(`Remisión ${numero} despachada`);
      ir('despachos');
    });
  }

  /* ---------------- escáner QR (diálogo) ---------------- */
  async function escanear(validar) {
    const dlg = $('#dlgQR'), ctrl = new AbortController();
    const cerrar = () => ctrl.abort();
    $('#qrCancelar').onclick = cerrar;
    dlg.addEventListener('cancel', cerrar, { once: true });
    dlg.showModal();
    try { return await QR.escanearEquipo($('#qrVideo'), { signal: ctrl.signal, timeoutMs: 45000, validar }); }
    finally { if (dlg.open) dlg.close(); }
  }

  /* ================= 3. LIBERAR ================= */
  /* Liberar = el Mixer regresó a planta. Cierra el ciclo del Mixer (salida → regreso).
     La labor real, los m³ aplicados y la firma llegan después, en el registro de aplicación del operador de Robojet. */
  async function vLiberar(main) {
    const pend = (await Datos.todas('remisiones')).filter(r => r.estado === 'DESPACHADO')
      .sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
    const r = E.rmLiberar ? pend.find(x => x.numero === Number(E.rmLiberar)) : null;
    if (!r) {
      E.rmLiberar = null;
      main.innerHTML = pend.length
        ? `<p class="titulo-sec">¿Qué Mixer regresó a planta? (${pend.length} en ruta)</p>
           <ul class="lista">${pend.map(p => `<li><button type="button" class="item" style="width:100%;text-align:left;border:0" data-ir="liberar" data-rm="${esc(p.numero)}">
             <div class="item-fila"><span class="item-rm">Rm ${esc(p.numero)}</span><span class="estado e-lib">EN RUTA</span></div>
             <div class="item-t">${esc(p.contratista)} · ${esc(p.labor)}</div>
             <div class="item-meta"><span>${esc(hora(p.fecha_hora))}</span><span>${esc(mezclaTxt(p))}</span><span>${esc(num(p.volumen_m3))} m³</span><span>${esc(p.equipo)}</span></div>
           </button></li>`).join('')}</ul>`
        : `<div class="card vacio">No hay Mixers en ruta.</div>`;
      return;
    }
    main.innerHTML = `
      <section class="card destacada">
        <div class="item-fila"><span style="font-size:13px;color:var(--gris)">Remisión</span><span class="estado e-lib">EN RUTA</span></div>
        <span class="item-rm" style="font-size:26px">Rm ${esc(r.numero)}</span>
        <div class="item-meta" style="font-size:14px"><span>${esc(contrN(r.contratista))}</span><span>${esc(mezclaTxt(r))}</span>
          <span>${esc(num(r.volumen_m3))} m³</span><span>${esc(r.equipo)}</span><span>Salió ${esc(r.fecha_hora.replace('T', ' '))}</span></div>
      </section>
      <form id="fLib" novalidate>
        <label class="campo">Hora de regreso a planta · 返回时间
          <input name="regreso" type="datetime-local" required value="${fechaLocal()}"></label>
        <div class="aviso info"><span>La labor real y los m³ aplicados los registra el operador de Robojet. Se concilian en el cierre.</span></div>
        <label class="campo">Observaciones<textarea name="obs" maxlength="300"></textarea></label>
        <div id="errLib"></div>
        <div class="barra">
          <button type="button" class="btn btn-sec" data-ir="liberar" data-rm="">Volver</button>
          <button type="submit" class="btn btn-pri" style="flex:1">Mixer regresó · Liberar</button></div>
      </form>`;
    const f = $('#fLib', main);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const reg = f.regreso.value || fechaLocal(), err = [];
      if (reg < r.fecha_hora) err.push('La hora de regreso no puede ser anterior a la salida.');
      $('#errLib', f).innerHTML = err.length ? `<div class="aviso err" role="alert">${err.map(e => `<span>${esc(e)}</span>`).join('')}</div>` : '';
      if (err.length) return;
      const min = Math.round((new Date(reg) - new Date(r.fecha_hora)) / 60000);
      await Datos.poner('liberaciones', {
        remision_num: r.numero, fecha_hora: reg, minutos_ciclo: min, contratista: r.contratista, mezcla: r.mezcla,
        observaciones: f.obs.value.trim() || null, app_version: APP_VERSION, maestro_version: M.version, registrado_por: 'Guardia ' + guardiaActual(),
      });
      r.estado = 'LIBERADO';
      await Datos.poner('remisiones', r);
      toast(`Rm ${r.numero}: ciclo del Mixer cerrado (${min} min)`);
      ir('despachos', { rmLiberar: null });
    });
  }

  /* ================= 3b. APLICACIÓN (operador de Robojet, sin señal) ================= */
  async function vAplicar(main) {
    const L = Maestro.listas(M);
    const robojets = M.equipos.filter(e => e.activo && e.tipo === 'ROBOJET');
    const ops = L.porCargo('OPERADOR_ROBOJET'), mixers = L.porCargo('CONDUCTOR');
    const aps = (await Datos.todas('aplicaciones')).sort((a, b) => b.fin.localeCompare(a.fin));
    const hoyAps = aps.filter(a => a.fin.startsWith(hoy()));
    const porEntregar = aps.filter(a => !a.entregada).length;
    const lineaHtml = (n) => `<div class="dos linea" data-linea><label class="campo">N.º remisión<input name="rm" type="number" inputmode="numeric" min="1" required></label>
      <label class="campo">m³ aplicados<input name="m3" type="number" inputmode="decimal" step="0.5" min="0.5" max="12"></label></div>`;
    main.innerHTML = `
      <section class="kpis" aria-label="Resumen">
        <div class="kpi"><span>Aplicaciones hoy</span><b>${hoyAps.length}</b></div>
        <div class="kpi"><span>m³ hoy</span><b>${num(hoyAps.reduce((s, a) => s + a.lineas.reduce((x, l) => x + l.m3, 0), 0))}</b></div>
        <div class="kpi ${porEntregar ? 'alerta' : ''}"><span>Por entregar</span><b>${porEntregar}</b></div>
      </section>
      <form id="fApl" novalidate>
        <label class="campo">Robojet · 喷浆台车
          <select name="equipo" required><option value="">Seleccionar…</option>${robojets.map(e => `<option value="${esc(e.id)}" ${e.id === LS.get('eq_robojet', '') ? 'selected' : ''}>${esc(e.id)}</option>`).join('')}</select></label>
        <div class="dos">
          <label class="campo">Operador de Robojet
            <select name="operador" required><option value="">Seleccionar…</option>${ops.map(p => `<option value="${esc(p.id)}" ${p.id === LS.get('op_robojet', '') ? 'selected' : ''}>${esc(p.nombre)} · ${esc(p.id)}</option>`).join('')}</select></label>
          <label class="campo">Guardia (automática)<input name="guardia" readonly value="—"></label>
        </div>
        <label class="campo">Labor donde se aplicó · 实际工作面
          <select name="labor" required><option value="">Seleccionar… (${L.laboresActivas.length})</option>${L.laboresActivas.sort((a, b) => a.id.localeCompare(b.id)).map(l => `<option value="${esc(l.id)}">${esc(l.id)}</option>`).join('')}</select></label>
        <fieldset><legend>Remisiones aplicadas · 使用的发货单</legend>
          <div id="lineas">${lineaHtml()}</div>
          <button type="button" class="btn btn-sec btn-peq" id="masRm">+ Otra remisión</button>
        </fieldset>
        <label class="campo">Inicio de la aplicación<input name="inicio" type="datetime-local" required value="${fechaLocal()}"></label>
        <label class="campo">Operador de Mixer que entregó (firma)
          <select name="mixer" required><option value="">Seleccionar…</option>${mixers.map(p => `<option value="${esc(p.id)}">${esc(p.nombre)} · ${esc(p.id)}</option>`).join('')}</select></label>
        <div class="firmas"><div class="firma" data-firma="mixer"><span>Firma del operador de Mixer · 司机签名</span><canvas aria-label="Firma del operador de Mixer"></canvas><button type="button">Borrar</button></div></div>
        <label class="campo">Observaciones<textarea name="obs" maxlength="300"></textarea></label>
        <div id="errApl"></div>
        <div class="barra"><button type="submit" class="btn btn-pri btn-grande">Guardar · tarea realizada</button></div>
      </form>
      <button type="button" class="btn btn-sec" id="entregar">Entregar en planta (${porEntregar} pendientes)</button>
      ${hoyAps.length ? `<p class="titulo-sec">Hoy · 今天</p><ul class="lista">${hoyAps.map(a => `<li class="item">
        <div class="item-fila"><span class="item-rm">${esc(a.labor)}</span><span class="estado ${a.entregada ? 'e-ok' : 'e-lib'}">${a.entregada ? 'ENTREGADA' : 'POR ENTREGAR'}</span></div>
        <div class="item-meta"><span>${esc(hora(a.inicio))}–${esc(hora(a.fin))}</span><span>Rm ${esc(a.lineas.map(l => l.remision).join(', '))}</span><span>${esc(num(a.lineas.reduce((s, l) => s + l.m3, 0)))} m³</span></div></li>`).join('')}</ul>` : ''}`;
    const f = $('#fApl', main);
    const firma = padFirma($('[data-firma]', f));
    const ponGuardia = () => { const p = ops.find(x => x.id === f.operador.value); f.guardia.value = p ? (p.guardia || 'Sin guardia en el maestro') : '—'; if (p && p.guardia) { LS.set('guardia', p.guardia); encabezado(); } };
    f.operador.addEventListener('change', () => { LS.set('op_robojet', f.operador.value); ponGuardia(); });
    f.equipo.addEventListener('change', () => LS.set('eq_robojet', f.equipo.value));
    ponGuardia();
    $('#masRm', f).addEventListener('click', () => { $('#lineas', f).insertAdjacentHTML('beforeend', lineaHtml()); });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = [];
      const lineas = $$('[data-linea]', f).map(d => ({ remision: Number($('[name=rm]', d).value), m3: num($('[name=m3]', d).value) }))
        .filter(l => l.remision || l.m3);
      if (!f.equipo.value) err.push('Elija el Robojet.');
      const op = ops.find(x => x.id === f.operador.value);
      if (!op) err.push('Elija el operador de Robojet.');
      else if (!op.guardia) err.push(`${op.nombre} no tiene guardia en el maestro.`);
      if (!f.labor.value) err.push('Elija la labor donde se aplicó.');
      if (!lineas.length) err.push('Escriba al menos una remisión con sus m³.');
      if (lineas.some(l => !Number.isInteger(l.remision) || l.remision < 1 || !(l.m3 >= 0.5 && l.m3 <= 12))) err.push('Cada remisión necesita número válido y m³ entre 0,5 y 12.');
      if (new Set(lineas.map(l => l.remision)).size !== lineas.length) err.push('Hay una remisión repetida en la lista.');
      if (!f.mixer.value) err.push('Elija el operador de Mixer que entregó.');
      if (firma.vacia()) err.push('Falta la firma del operador de Mixer.');
      $('#errApl', f).innerHTML = err.length ? `<div class="aviso err" role="alert">${err.map(e => `<span>${esc(e)}</span>`).join('')}</div>` : '';
      if (err.length) return;
      const fin = fechaLocal();
      await Datos.poner('aplicaciones', {
        id: `${f.equipo.value}-${fin.replace(/\D/g, '')}-${Math.random().toString(36).slice(2, 6)}`,
        equipo: f.equipo.value, operador: op.id, guardia: op.guardia, labor: f.labor.value,
        inicio: f.inicio.value || fin, fin, lineas, operador_mixer: f.mixer.value, firma_mixer: firma.dato(),
        observaciones: f.obs.value.trim() || null, entregada: false, app_version: APP_VERSION, maestro_version: M.version,
      });
      toast('Aplicación guardada · ciclo del Robojet cerrado');
      ir('aplicar');
    });
    $('#entregar', main).addEventListener('click', () => entregarAplicaciones());
  }

  // Entrega en planta: un archivo (.json) que el despachador recibe en su celular; se comparte o se descarga.
  async function entregarAplicaciones() {
    const todas = await Datos.todas('aplicaciones');
    const pend = todas.filter(a => !a.entregada);
    if (!pend.length) return toast('No hay aplicaciones por entregar.');
    const carga = { tipo: 'DC-APLICACIONES', app_version: APP_VERSION, maestro_version: M.version, generado: fechaLocal(), aplicaciones: pend };
    const eq = [...new Set(pend.map(a => a.equipo))].join('_');
    const nombre = `aplicaciones_${eq}_${fechaLocal().slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(carga)], { type: 'application/json' });
    let hecho = false;
    try {
      const file = new File([blob], nombre, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Aplicaciones Robojet' }); hecho = true; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    if (!hecho) {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    for (const a of pend) await Datos.poner('aplicaciones', { ...a, entregada: true });
    toast(`${pend.length} aplicaciones listas para entregar`);
    ir('aplicar');
  }

  // Recepción en planta (despachador): une las aplicaciones de uno o varios celulares; repetir el mismo archivo no duplica.
  async function recibirAplicaciones(archivos, main) {
    let nuevas = 0, repetidas = 0;
    for (const file of archivos) {
      try {
        const d = JSON.parse(await file.text());
        if (d.tipo !== 'DC-APLICACIONES' || !Array.isArray(d.aplicaciones)) throw new Error('formato');
        for (const a of d.aplicaciones) {
          if (!a.id || !a.equipo || !Array.isArray(a.lineas)) continue;
          if (await Datos.una('aplicaciones', a.id)) repetidas++; else { await Datos.poner('aplicaciones', { ...a, entregada: true }); nuevas++; }
        }
      } catch (e) { toast(`«${file.name}» no es un archivo de aplicaciones.`, true); }
    }
    toast(`${nuevas} aplicaciones recibidas${repetidas ? ` · ${repetidas} ya estaban` : ''}`);
    vDespachos(main);
  }
  function padFirma(caja) {
    const cv = $('canvas', caja), ctx = cv.getContext('2d');
    let trazo = false, vacia = true;
    const ajustar = () => {
      const r = cv.getBoundingClientRect(), k = window.devicePixelRatio || 1;
      cv.width = r.width * k; cv.height = r.height * k;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1B1F24';
    };
    ajustar();
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => { trazo = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
    cv.addEventListener('pointermove', e => { if (!trazo) return; ctx.lineTo(...pos(e)); ctx.stroke(); vacia = false; caja.classList.add('ok'); });
    cv.addEventListener('pointerup', () => { trazo = false; });
    $('button', caja).addEventListener('click', () => { ajustar(); vacia = true; caja.classList.remove('ok'); });
    return { vacia: () => vacia, dato: () => (vacia ? null : cv.toDataURL('image/png')) };
  }

  /* ================= 4. FLOTA (estado dinámico de equipos) ================= */
  async function vFlota(main) {
    const pend = (await Datos.todas('remisiones')).filter(r => r.estado === 'DESPACHADO');
    const enFrente = new Map(pend.map(r => [r.equipo, r]));
    const st = await estadosEquipos();
    const eq = M.equipos.filter(e => e.activo);
    const est = (e) => st.get(e.id).estado;
    const libres = eq.filter(e => est(e) === 'OPERATIVO' && !enFrente.has(e.id)).length;
    const taller = eq.filter(e => est(e) === 'MANTENIMIENTO').length;
    const parados = eq.filter(e => !['OPERATIVO', 'MANTENIMIENTO'].includes(est(e))).length;
    const orden = (e) => (est(e) === 'MANTENIMIENTO' ? 0 : est(e) !== 'OPERATIVO' ? 1 : enFrente.has(e.id) ? 2 : 3);
    const edit = E.eqEditar ? eq.find(e => e.id === E.eqEditar) : null;
    main.innerHTML = `
      <section class="kpis k4" aria-label="Resumen de flota">
        <div class="kpi"><span>Disponibles</span><b>${libres}</b></div>
        <div class="kpi"><span>En ruta</span><b style="color:var(--ruta-fg)">${enFrente.size}</b></div>
        <div class="kpi ${taller ? 'alerta' : ''}"><span>En taller</span><b>${taller}</b></div>
        <div class="kpi"><span>Parados</span><b style="color:var(--mal-fg)">${parados}</b></div>
      </section>
      <button type="button" class="btn btn-osc btn-grande" id="qrFlota">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3"/><rect x="7" y="7" width="4" height="4"/><rect x="13" y="13" width="4" height="4"/></svg>
        Escanear equipo para cambiar estado</button>
      <div id="editor">${edit ? editorEstado(edit, st.get(edit.id), enFrente.get(edit.id)) : ''}</div>
      <ul class="lista">${eq.sort((a, b) => orden(a) - orden(b) || a.id.localeCompare(b.id)).map(e => {
        const s = st.get(e.id), r = enFrente.get(e.id);
        const [et, cl] = s.estado === 'OPERATIVO' && r ? ['EN RUTA', 'e-ruta'] : (EST_EQ[s.estado] || [s.estado, 'e-can']);
        const det = s.estado !== 'OPERATIVO'
          ? `${s.desde ? `Desde ${s.desde.slice(5, 10)} ${hora(s.desde)} (${duracion(s.desde)})` : 'Según maestro'}${s.motivo ? ' · ' + s.motivo : ''}`
          : r ? `Rm ${r.numero} → ${r.labor} · ${num(r.volumen_m3)} m³` : 'Disponible en planta';
        return `<li class="item" style="flex-direction:row;align-items:center;gap:12px">
          <div class="eq-ico">${esc(e.tipo)}</div>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">
            <div class="item-fila"><span class="item-rm">${esc(e.id)}</span><span class="estado ${cl}">${et}</span></div>
            <span style="font-size:14px;color:var(--tinta2);overflow-wrap:anywhere">${esc(det)}</span>
            <button type="button" class="btn btn-sec btn-peq" style="align-self:flex-start" data-editar="${esc(e.id)}">Cambiar estado</button>
          </div></li>`;
      }).join('')}</ul>`;
    $('#qrFlota', main).addEventListener('click', async () => {
      const v = await escanear(existeEquipo);
      if (v.ok) { E.eqEditar = v.equipo.id; vFlota(main); }
      else if (v.error !== 'Escaneo cancelado.') toast(v.error, true);
    });
    $$('[data-editar]', main).forEach(b => b.addEventListener('click', () => { E.eqEditar = b.dataset.editar; vFlota(main); }));
    const f = $('#fEstado', main);
    if (!f) return;
    $('#cerrarEditor', f).addEventListener('click', () => { E.eqEditar = null; vFlota(main); });
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const nuevo = f.estado.value, r = enFrente.get(edit.id), err = [];
      if (nuevo === st.get(edit.id).estado) err.push('El equipo ya está en ese estado.');
      if (nuevo !== 'OPERATIVO' && r) err.push(`Tiene la remisión ${r.numero} sin liberar: libérela o cancélela primero.`);
      if (nuevo !== 'OPERATIVO' && !f.motivo.value.trim()) err.push('Escriba el motivo.');
      $('#errEstado', f).innerHTML = err.length ? `<div class="aviso err" role="alert">${err.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '';
      if (err.length) return;
      const momento = f.momento.value || fechaLocal();
      await Datos.poner('eventos', {
        equipo: edit.id, momento, estado: nuevo, categoria: nuevo === 'OPERATIVO' ? null : f.categoria.value,
        motivo: f.motivo.value.trim() || null, registrado_por: 'Guardia ' + guardiaActual(),
        maestro_version: M.version,
      });
      toast(`${edit.id}: ${(EST_EQ[nuevo] || [nuevo])[0].toLowerCase()}`);
      E.eqEditar = null;
      vFlota(main);
    });
  }
  function editorEstado(e, s, r) {
    const [et, cl] = EST_EQ[s.estado] || [s.estado, 'e-can'];
    const sugerido = s.estado === 'OPERATIVO' ? 'MANTENIMIENTO' : 'OPERATIVO';
    return `<form id="fEstado" class="card destacada" novalidate>
      <div class="item-fila"><span class="item-rm">${esc(e.id)}</span><span class="estado ${cl}">${et}</span></div>
      ${s.desde ? `<span style="font-size:13px;color:var(--gris)">Desde ${esc(s.desde.replace('T', ' '))} · ${duracion(s.desde)}${s.motivo ? ' · ' + esc(s.motivo) : ''}</span>` : ''}
      ${r ? `<div class="aviso warn"><b>Remisión ${esc(r.numero)} sin liberar</b><span>No se puede sacar de servicio hasta liberarla o cancelarla.</span></div>` : ''}
      <fieldset><legend>Nuevo estado</legend>
        <div class="opciones">${CAMBIOS.map(([v, t]) => `<label class="op"><input type="radio" name="estado" value="${v}" ${v === sugerido ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
      </fieldset>
      <div class="dos">
        <label class="campo">Tipo<select name="categoria">${CATEGORIAS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
        <label class="campo">Desde<input name="momento" type="datetime-local" value="${fechaLocal()}"></label>
      </div>
      <label class="campo">Motivo<input name="motivo" maxlength="120" placeholder="Ej.: falla hidráulica, cambio de llanta…"></label>
      <div id="errEstado"></div>
      <div style="display:flex;gap:8px">
        <button type="button" class="btn btn-sec" id="cerrarEditor" style="flex:1">Cerrar</button>
        <button type="submit" class="btn btn-pri" style="flex:2">Guardar estado</button></div>
    </form>`;
  }

  /* ================= 5. MAESTROS ================= */
  const ESTADO_MAESTRO = () => `
      <section class="card" style="background:var(--oscuro);color:#fff;flex-direction:row;align-items:center;gap:12px">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="${M ? '#5FD08A' : '#F2A900'}" stroke-width="2" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></svg>
        <div style="display:flex;flex-direction:column">
          <b>${M ? `En este celular: versión ${esc(M.version)}` : 'Sin maestro en este celular'}</b>
          <span style="font-size:13px;color:#C9D2DA">${M ? `Cargado ${esc(M.cargadoEn ? new Date(M.cargadoEn).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '')} · funciona sin señal` : 'Cárguelo con señal, en superficie'}</span>
        </div></section>`;

  const selectorPerfil = () => `<label class="campo">Perfil de este celular
        <select id="perfilSel">${PERFILES.map(([v, t]) => `<option value="${v}" ${v === perfil() ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
  const ligarPerfil = (main) => { const el = $('#perfilSel', main); if (el) el.addEventListener('change', () => { LS.set('perfil', el.value); toast('Perfil: ' + PERFILES.find(p => p[0] === el.value)[1]); ir('maestros'); }); };
  async function vMaestros(main) {
    const url = LS.get('urlMaestro', '');
    const L = M ? Maestro.listas(M) : null;
    if (!Pin.autorizado()) {
      main.innerHTML = `${ESTADO_MAESTRO()}
        <section class="card" style="align-items:center;text-align:center;gap:10px">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
          <b>Carga del maestro protegida</b>
          <span style="font-size:14px;color:var(--gris)">Para cargar o actualizar el maestro se pide el PIN de maestro.</span>
          <button type="button" class="btn btn-pri btn-grande" id="pinAbrir">Ingresar PIN · 输入密码</button>
        </section>
        ${selectorPerfil()}
        <p class="version-app" id="versionApp"></p>`;
      ligarPerfil(main);
      fechaApp().then(f => { const el = $('#versionApp', main); if (el) el.textContent = `App v${APP_VERSION} (${APP_FECHA})` + (f ? ` · publicada: ${f}` : ''); });
      $('#pinAbrir', main).addEventListener('click', async () => {
        const r = await Pin.acceso();
        if (r === 'reiniciado') { M = null; ajustarTurnos(); toast('Maestro borrado de este celular. Cárguelo de nuevo.'); }
        else if (r === 'sin-https') return toast('Abra la app con la dirección https://', true);
        if (r === true || r === 'reiniciado') ir('maestros');
      });
      return;
    }
    main.innerHTML = `
      ${ESTADO_MAESTRO()}
      <label class="campo">Enlace del maestro en SharePoint / OneDrive
        <input id="url" type="url" inputmode="url" placeholder="https://…" value="${esc(url)}"></label>
      <div class="dos">
        <button type="button" class="btn btn-sec carga" id="abrir">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a5 5 0 1 1 1.6-9.7A6 6 0 0 1 20 11a4 4 0 0 1-1 7.9"/><path d="M12 12v8M9 17l3 3 3-3"/></svg>1 · Abrir SharePoint</button>
        <label class="btn btn-pri carga" style="position:relative">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>2 · Cargar maestro
          <input type="file" id="archivo" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      </div>
      <button type="button" class="btn btn-sec" id="demo">Probar con maestro de ejemplo (datos genéricos)</button>
      <div id="previa"></div>
      ${M ? `<p class="titulo-sec">Guardado en el celular · 本机数据</p>
      <ul class="lista">
        ${[['Labores', `${M.labores.filter(l => l.tipo === 'DESARROLLO').length} desarrollo · ${M.labores.filter(l => l.tipo === 'PANEL').length} paneles · ${L.laboresActivas.length} activas`, M.labores.length],
           ['Equipos', `${L.equiposDisponibles.length} operativos`, M.equipos.length],
           ['Personal activo', `${L.conductores.length} operadores de mixer · ${L.operadoresRobojet.length} de robojet · ${L.despachadores.length} despachadores`, L.conductores.length + L.operadoresRobojet.length + L.despachadores.length],
           ['Mezclas', `${(M.mezclas || []).length ? (M.mezclas.filter(m => m.vaceado).length + ' de vaceado · ' + (M.categorias || []).length + ' categorías') : 'del catálogo de ejemplo'}`, (M.mezclas || []).length],
           ['Áreas técnicas', listaAreas().map(a => a.nombre).join(' · '), listaAreas().length],
           ['Contratistas', M.contratistas.map(c => c.id).join(' · '), M.contratistas.length]]
          .map(([n, d, c]) => `<li class="item" style="flex-direction:row;align-items:center"><div style="flex:1"><div class="item-t">${n}</div><div class="item-meta">${esc(d)}</div></div><b style="font-size:24px">${c}</b></li>`).join('')}
      </ul>` : ''}
      ${selectorPerfil()}
      <button type="button" class="btn btn-sec" id="pinCambiar">Cambiar PIN de maestro</button>
      <p class="version-app" id="versionApp"></p>`;
    fechaApp().then(f => { const el = $('#versionApp', main); if (el) el.textContent = `App v${APP_VERSION} (${APP_FECHA})` + (f ? ` · publicada: ${f}` : ''); });
    ligarPerfil(main);
    $('#pinCambiar', main).addEventListener('click', async () => { if (await Pin.cambiar()) toast('PIN cambiado'); });
    $('#url', main).addEventListener('change', e => LS.set('urlMaestro', e.target.value.trim()));
    $('#abrir', main).addEventListener('click', () => {
      const u = $('#url', main).value.trim();
      if (!/^https:\/\//i.test(u)) return toast('Pegue primero el enlace https del maestro.', true);
      LS.set('urlMaestro', u);
      window.open(u, '_blank', 'noopener');
    });
    $('#demo', main).addEventListener('click', async () => {
      try {
        const res = await fetch('ejemplo/maestro_ejemplo.xlsx');
        if (!res.ok) throw new Error('No se encontró el maestro de ejemplo.');
        const buf = await res.arrayBuffer();
        procesar({ name: 'maestro_ejemplo.xlsx', arrayBuffer: async () => buf });
      } catch (err) { toast(err.message, true); }
    });
    $('#archivo', main).addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) procesar(file);
    });
    async function procesar(file) {
      const caja = $('#previa', main);
      caja.innerHTML = '<div class="aviso info">Leyendo el maestro…</div>';
      try {
        const m = await Maestro.leerArchivo(file);
        if (m.errores.length) {
          caja.innerHTML = `<div class="aviso err" role="alert"><b>No se puede cargar (${m.errores.length} errores)</b>${m.errores.slice(0, 8).map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
          return;
        }
        const d = await Maestro.comparar(m);
        E.previa = m;
        const fila = (n, x) => `<span>${n}</span><span class="n">${x.total}</span><span class="n ${x.nuevos.length ? 'mas' : ''}">${x.nuevos.length ? '+' + x.nuevos.length : 0}</span><span class="n ${x.cambios.length ? 'cam' : ''}">${x.cambios.length}</span>`;
        caja.innerHTML = `<section class="card destacada" aria-label="Vista previa">
          <div class="item-fila"><b>Versión ${esc(d.versionActual ?? '—')} → ${esc(d.versionNueva)}</b><span style="font-size:13px;color:var(--gris)">${esc(m.archivo)}</span></div>
          <div class="tabla"><span class="h">Tabla</span><span class="h n">Total</span><span class="h n">Nuevos</span><span class="h n">Cambios</span>
            ${fila('Labores', d.labores)}${fila('Equipos', d.equipos)}${fila('Personas', d.personas)}</div>
          ${d.cambiosEstado.length ? `<div class="aviso warn"><b>Cambios de estado de equipos</b>${d.cambiosEstado.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
          ${m.avisos.length ? `<div class="aviso warn"><b>${m.avisos.length} avisos</b>${m.avisos.slice(0, 6).map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
          ${!d.esMasNueva ? `<div class="aviso err"><b>Este archivo no es más nuevo que el del celular.</b><span>Pida al administrador que suba el número de versión.</span></div>` : ''}
          <div style="display:flex;gap:8px">
            <button type="button" class="btn btn-sec" id="descartar" style="flex:1">Cancelar</button>
            <button type="button" class="btn btn-osc" id="guardar" style="flex:2" ${d.esMasNueva ? '' : 'disabled'}>Guardar en el celular</button></div>
        </section>`;
        $('#descartar', caja).addEventListener('click', () => { E.previa = null; caja.innerHTML = ''; });
        $('#guardar', caja).addEventListener('click', async () => {
          try {
            M = await Maestro.guardar(E.previa); ajustarTurnos();
            E.previa = null;
            toast(`Maestro v${M.version} guardado en el celular`);
            ir('maestros');
          } catch (err) { toast(err.message, true); }
        });
      } catch (err) {
        caja.innerHTML = `<div class="aviso err" role="alert"><b>No se pudo leer el archivo</b><span>${esc(err.message)}</span></div>`;
      }
    }
  }

  /* ---------------- exportar a Excel ---------------- */
  async function exportar() {
    const rem = await Datos.todas('remisiones');
    const lib = await Datos.todas('liberaciones');
    const hR = rem.map(r => ({
      'Remisión': r.numero, 'Fecha hora': r.fecha_hora.replace('T', ' '), 'Turno': r.turno, 'Guardia': r.guardia,
      'Área técnica': areaN(r.area), 'Contratista': r.contratista, 'Labor': r.labor, 'Mezcla': mezclaN(r.mezcla), 'Cód. mezcla': r.mezcla, 'Categoría': r.categoria || '', 'Volumen m3': r.volumen_m3,
      'Equipo': r.equipo, 'Conductor': r.conductor, 'Despachador': r.despachador, 'Estado': r.estado,
      'Observaciones': r.observaciones, 'Versión maestro': r.maestro_version,
    }));
    const hL = lib.map(l => ({
      'Remisión': l.remision_num, 'Fecha hora': l.fecha_hora.replace('T', ' '), 'Contratista': l.contratista, 'Labor': l.labor, 'Ciclo Mixer (min)': l.minutos_ciclo,
      'Mezcla': mezclaN(l.mezcla), 'Cód. mezcla': l.mezcla, 'Recibido m3': l.cantidad_m3, 'Método': l.metodo, 'Min por m3': l.tiempo_min_por_m3,
      'Operador': l.operador, 'Firma contratista': l.firma_contratista ? 'Sí' : 'No',
      'Firma interventoría': l.firma_interventoria ? 'Sí' : 'No', 'Firma mandante': l.firma_mandante ? 'Sí' : 'No',
      'Observaciones': l.observaciones,
    }));
    const hA = (await Datos.todas('aplicaciones')).flatMap(a => a.lineas.map(l => ({
      'Id aplicación': a.id, 'Robojet': a.equipo, 'Operador Robojet': a.operador, 'Guardia': a.guardia, 'Labor aplicada': a.labor,
      'Remisión': l.remision, 'm³ aplicados': l.m3, 'Inicio': a.inicio.replace('T', ' '), 'Fin': a.fin.replace('T', ' '),
      'Operador Mixer (firma)': a.operador_mixer, 'Firma mixer': a.firma_mixer ? 'Sí' : 'No', 'Observaciones': a.observaciones, 'Versión app': a.app_version,
    })));
    const hE = (await Datos.todas('eventos')).sort((a, b) => a.momento.localeCompare(b.momento)).map(e => ({
      'Equipo': e.equipo, 'Desde': e.momento.replace('T', ' '), 'Estado': e.estado, 'Categoría': e.categoria,
      'Motivo': e.motivo, 'Registrado por': e.registrado_por, 'Versión maestro': e.maestro_version,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hR.length ? hR : [{ 'Remisión': '' }]), 'Remisiones');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hL.length ? hL : [{ 'Remisión': '' }]), 'Liberaciones');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hE.length ? hE : [{ 'Equipo': '' }]), 'Estados equipos');
    if (hA.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hA), 'Aplicaciones');
    XLSX.writeFile(wb, `despachos_${hoy()}.xlsx`);
    toast('Excel generado');
  }

  /* ---------------- arranque ---------------- */
  const VISTAS = { despachos: vDespachos, nueva: vNueva, liberar: vLiberar, aplicar: vAplicar, flota: vFlota, maestros: vMaestros };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ir]');
    if (!b) return;
    e.preventDefault();
    const extra = {};
    if ('rm' in b.dataset) extra.rmLiberar = b.dataset.rm || null;
    ir(b.dataset.ir, extra);
  });
  $$('.nav button').forEach(b => b.addEventListener('click', () => ir(b.dataset.vista, { rmLiberar: null, eqEditar: null })));
  window.addEventListener('online', red);
  window.addEventListener('offline', red);

  /* ---------------- actualizaciones automáticas desde el repositorio ----------------
     Al subir archivos nuevos a GitHub, la app lo detecta comparando la fecha/huella de sus
     archivos y ofrece «Actualizar». No hay que cambiar ningún número de versión a mano. */
  const ARCH_APP = ['index.html', 'app/app.js', 'app/cierre.js', 'app/maestro.js', 'app/pin.js', 'app/qr.js', 'app/styles.css'];
  let firmaInicial = null, revisando = false, swReg = null, pendiente = false;
  const SS = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* nada */ } },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) { /* nada */ } },
  };
  // Hay un formulario a medio llenar: no se actualiza para no perder datos.
  const enCurso = () => E.vista === 'nueva' || E.vista === 'aplicar' || (E.vista === 'liberar' && !!E.rmLiberar) || !!E.eqEditar;
  function aplicarActualizacion(destino) {
    if (!pendiente) return false;
    SS.set('vistaTrasActualizar', destino || E.vista);
    SS.set('actualizada', '1');
    location.reload();
    return true;
  }
  async function firmaApp() {
    const partes = await Promise.all(ARCH_APP.map(async (u) => {
      const r = await fetch(u, { method: 'HEAD', cache: 'no-store' });
      if (!r.ok) throw new Error('sin respuesta');
      return r.headers.get('etag') || r.headers.get('last-modified') || r.headers.get('content-length') || '';
    }));
    return partes.join('|');
  }
  async function fechaApp() {
    try {
      const r = await fetch('app/app.js', { method: 'HEAD', cache: 'no-store' });
      const lm = r.headers.get('last-modified');
      return lm ? new Date(lm).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : null;
    } catch (e) { return null; }
  }
  async function revisarVersion() {
    if (revisando || !navigator.onLine || location.protocol === 'file:') return;
    revisando = true;
    try {
      const f = await firmaApp();
      if (firmaInicial === null) firmaInicial = f;
      else if (f !== firmaInicial) pendiente = true;
      if (swReg) swReg.update().catch(() => {});
    } catch (e) { /* sin señal o servidor no disponible: se revisa luego */ }
    finally { revisando = false; }
    // Se aplica sola solo si nadie está llenando un formulario; si no, al terminar.
    if (pendiente && !enCurso()) aplicarActualizacion();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisarVersion(); });
  window.addEventListener('online', revisarVersion);
  setInterval(revisarVersion, 5 * 60 * 1000);

  (async function iniciar() {
    red();
    try { M = await Maestro.cargarGuardado() || null; } catch (e) { M = null; }
    ajustarTurnos();
    const tras = SS.get('vistaTrasActualizar');
    SS.del('vistaTrasActualizar');
    await ir(M ? (tras && VISTAS[tras] ? tras : VISTAS_PERFIL[perfil()][0]) : 'maestros');
    if (SS.get('actualizada')) { SS.del('actualizada'); toast('App actualizada'); }
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      try { swReg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' }); } catch (e) { /* sin SW */ }
    }
    revisarVersion();
  })();
})();

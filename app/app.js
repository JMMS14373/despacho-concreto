/* App Despacho de Concreto — interior mina (PWA, funciona sin señal) */
(function () {
  'use strict';

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
  const turnoDe = (iso) => { const h = Number((iso || fechaLocal()).slice(11, 13)); return h >= 6 && h < 18 ? 'Día' : 'Noche'; };

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
  const mezclaN = (id) => (MEZCLAS.find(m => m.id === id) || {}).n || id;

  /* ---------------- datos del dispositivo (IndexedDB) ---------------- */
  let _db;
  function db() {
    if (_db) return _db;
    _db = new Promise((ok, mal) => {
      const r = indexedDB.open('despacho-concreto-datos', 2);
      r.onupgradeneeded = () => {
        const d = r.result, st = d.objectStoreNames;
        if (!st.contains('remisiones')) d.createObjectStore('remisiones', { keyPath: 'numero' });
        if (!st.contains('liberaciones')) d.createObjectStore('liberaciones', { keyPath: 'remision_num' });
        if (!st.contains('eventos')) d.createObjectStore('eventos', { keyPath: 'id', autoIncrement: true });
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
  const E = { vista: 'despachos', filtro: 'TODOS', rmLiberar: null, previa: null, equipo: null };
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
      `<span>${esc(f)} · ${turnoDe()} · Guardia ${esc(LS.get('guardia', 'A'))}</span>` +
      `<span>${M ? 'Maestro v' + esc(M.version) : 'Sin maestro'}</span>`;
    $$('.nav button').forEach(b => b.toggleAttribute('aria-current', b.dataset.vista === E.vista) || b.removeAttribute('aria-current'));
    $$('.nav button').forEach(b => { if (b.dataset.vista === E.vista) b.setAttribute('aria-current', 'page'); });
  }
  function red() {
    const on = navigator.onLine;
    $('#red').classList.toggle('off', !on);
    $('#redTxt').textContent = on ? 'En línea' : 'Sin señal';
  }

  async function ir(vista, extra) {
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
      <div class="barra">
        <button type="button" class="btn btn-sec" id="exportar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 18v2h16v-2"/></svg>Excel</button>
        <button type="button" class="btn btn-pri" style="flex:1" data-ir="nueva">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Nueva remisión</button>
      </div>`;
    $$('input[name=filtro]', main).forEach(i => i.addEventListener('change', () => { E.filtro = i.value; vDespachos(main); }));
    $('#exportar', main).addEventListener('click', exportar);
    $$('[data-cancelar]', main).forEach(b => b.addEventListener('click', () => cancelar(Number(b.dataset.cancelar), main)));
  }
  function itemRem(r) {
    const [et, cl] = EST_REM[r.estado] || [r.estado, 'e-can'];
    return `<li class="item">
      <div class="item-fila"><span class="item-rm">Rm ${esc(r.numero)}</span><span class="estado ${cl}">${et}</span></div>
      <div class="item-t">${esc(r.contratista)} · ${esc(r.labor)}</div>
      <div class="item-meta"><span>${esc(r.fecha_hora.slice(5, 10))} ${esc(hora(r.fecha_hora))}</span><span>${esc(mezclaN(r.mezcla))}</span>
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
          <div class="opciones">${MEZCLAS.map((m, i) => `<label class="op"><input type="radio" name="mezcla" value="${m.id}" ${i === 0 ? 'checked' : ''}><span>${m.n}</span></label>`).join('')}</div>
        </fieldset>
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
        <div class="dos">
          <label class="campo">Conductor · 司机
            <select name="conductor">${opt(L.conductores, p => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.nombre)}</option>`, '—')}</select></label>
          <label class="campo">Despachador
            <select name="despachador">${opt(L.despachadores, p => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.nombre)}</option>`, '—')}</select></label>
        </div>
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
      if (!f.contratista.value) err.push('Elija la contratista.');
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
        numero, fecha_hora: fh, contratista: f.contratista.value, labor: f.labor.value,
        mezcla: f.mezcla.value, volumen_m3: num(vol), equipo: E.equipo,
        conductor: f.conductor.value || null, despachador: f.despachador.value || null,
        turno: turnoDe(fh), guardia: LS.get('guardia', 'A'), observaciones: f.obs.value.trim() || null,
        estado: 'DESPACHADO', maestro_version: M.version, registrado: fechaLocal(),
      });
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
  async function vLiberar(main) {
    const pend = (await Datos.todas('remisiones')).filter(r => r.estado === 'DESPACHADO')
      .sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora));
    const r = E.rmLiberar ? pend.find(x => x.numero === Number(E.rmLiberar)) : null;
    if (!r) {
      E.rmLiberar = null;
      main.innerHTML = pend.length
        ? `<p class="titulo-sec">Elija la remisión que llegó al frente (${pend.length})</p>
           <ul class="lista">${pend.map(p => `<li><button type="button" class="item" style="width:100%;text-align:left;border:0" data-ir="liberar" data-rm="${esc(p.numero)}">
             <div class="item-fila"><span class="item-rm">Rm ${esc(p.numero)}</span><span class="estado e-lib">POR LIBERAR</span></div>
             <div class="item-t">${esc(p.contratista)} · ${esc(p.labor)}</div>
             <div class="item-meta"><span>${esc(hora(p.fecha_hora))}</span><span>${esc(mezclaN(p.mezcla))}</span><span>${esc(num(p.volumen_m3))} m³</span><span>${esc(p.equipo)}</span></div>
           </button></li>`).join('')}</ul>`
        : `<div class="card vacio">No hay remisiones pendientes por liberar.</div>`;
      return;
    }
    const L = Maestro.listas(M);
    const ops = [...L.operadoresRobojet, ...L.conductores];
    main.innerHTML = `
      <section class="card destacada">
        <div class="item-fila"><span style="font-size:13px;color:var(--gris)">Remisión</span><span class="estado e-lib">POR LIBERAR</span></div>
        <span class="item-rm" style="font-size:26px">Rm ${esc(r.numero)}</span>
        <div class="item-meta" style="font-size:14px"><span>${esc(contrN(r.contratista))}</span><span>${esc(mezclaN(r.mezcla))}</span>
          <span>${esc(num(r.volumen_m3))} m³</span><span>${esc(r.equipo)}</span><span>${esc(r.fecha_hora.replace('T', ' '))}</span></div>
      </section>
      <form id="fLib" novalidate>
        <label class="campo">Labor real · 工作面
          <select name="labor">${L.laboresActivas.sort((a, b) => a.id.localeCompare(b.id)).map(l => `<option value="${esc(l.id)}" ${l.id === r.labor ? 'selected' : ''}>${esc(l.id)}</option>`).join('')}</select></label>
        <div class="dos">
          <label class="campo">Recibido (m³)<input name="cantidad" type="number" inputmode="decimal" step="0.1" min="0.1" max="12" value="${esc(r.volumen_m3)}"></label>
          <label class="campo">Tiempo (min/m³)<input name="tiempo" type="number" inputmode="decimal" min="0" max="240"></label>
        </div>
        <fieldset><legend>Método de instalación · 使用方式</legend>
          <div class="opciones grid3">${METODOS.map(([v, t], i) => `<label class="op"><input type="radio" name="metodo" value="${v}" ${i === 0 ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        </fieldset>
        <label class="campo">Operador
          <select name="operador"><option value="">—</option>${ops.map(p => `<option value="${esc(p.id)}">${esc(p.id)} · ${esc(p.nombre)}</option>`).join('')}</select></label>
        <fieldset><legend>Firmas · 签名</legend>
          <div class="firmas">
            ${[['contratista', 'Contratista'], ['interventoria', 'Interventoría'], ['mandante', 'Mandante']].map(([k, t]) =>
              `<div class="firma" data-firma="${k}"><span>${t}</span><canvas aria-label="Firma ${t}"></canvas><button type="button">Borrar</button></div>`).join('')}
          </div></fieldset>
        <label class="campo">Observaciones<textarea name="obs" maxlength="300"></textarea></label>
        <div id="errLib"></div>
        <div class="barra">
          <button type="button" class="btn btn-sec" data-ir="liberar" data-rm="">Volver</button>
          <button type="submit" class="btn btn-pri" style="flex:1">Liberar · 验收</button></div>
      </form>`;
    const f = $('#fLib', main);
    const firmas = Object.fromEntries($$('[data-firma]', f).map(d => [d.dataset.firma, padFirma(d)]));
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const cant = Number(f.cantidad.value), err = [], alertas = [];
      if (!(cant > 0 && cant <= 12)) err.push('Cantidad recibida inválida.');
      if (!f.labor.value) err.push('Elija la labor.');
      if (firmas.mandante.vacia()) err.push('Falta la firma del mandante.');
      $('#errLib', f).innerHTML = err.length ? `<div class="aviso err" role="alert">${err.map(e => `<span>${esc(e)}</span>`).join('')}</div>` : '';
      if (err.length) return;
      if (cant > r.volumen_m3) alertas.push(`Recibido ${cant} m³ > despachado ${r.volumen_m3} m³`);
      if (f.labor.value !== r.labor) alertas.push(`Labor real distinta a la despachada (${r.labor})`);
      await Datos.poner('liberaciones', {
        remision_num: r.numero, fecha_hora: fechaLocal(), contratista: r.contratista, labor: f.labor.value,
        mezcla: r.mezcla, cantidad_m3: num(cant), metodo: f.metodo.value,
        tiempo_min_por_m3: f.tiempo.value === '' ? null : Number(f.tiempo.value),
        operador: f.operador.value || null,
        firma_contratista: firmas.contratista.dato(), firma_interventoria: firmas.interventoria.dato(),
        firma_mandante: firmas.mandante.dato(),
        observaciones: [f.obs.value.trim(), ...alertas].filter(Boolean).join('; ') || null,
        maestro_version: M.version,
      });
      r.estado = 'LIBERADO';
      await Datos.poner('remisiones', r);
      toast(alertas.length ? `Liberada con alerta: ${alertas[0]}` : `Remisión ${r.numero} liberada`, alertas.length > 0);
      ir('despachos', { rmLiberar: null });
    });
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
        motivo: f.motivo.value.trim() || null, registrado_por: 'Guardia ' + LS.get('guardia', 'A'),
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
  async function vMaestros(main) {
    const url = LS.get('urlMaestro', '');
    const guardia = LS.get('guardia', 'A');
    const L = M ? Maestro.listas(M) : null;
    main.innerHTML = `
      <section class="card" style="background:var(--oscuro);color:#fff;flex-direction:row;align-items:center;gap:12px">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="${M ? '#5FD08A' : '#F2A900'}" stroke-width="2" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/></svg>
        <div style="display:flex;flex-direction:column">
          <b>${M ? `En este celular: versión ${esc(M.version)}` : 'Sin maestro en este celular'}</b>
          <span style="font-size:13px;color:#C9D2DA">${M ? `Cargado ${esc(M.cargadoEn ? new Date(M.cargadoEn).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '')} · funciona sin señal` : 'Cárguelo con señal, en superficie'}</span>
        </div></section>
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
           ['Operadores', `${L.conductores.length} conductores · ${L.operadoresRobojet.length} robojet`, L.conductores.length + L.operadoresRobojet.length],
           ['Despachadores', L.despachadores.length ? 'Activos' : 'Pendiente por cargar', L.despachadores.length],
           ['Contratistas', M.contratistas.map(c => c.id).join(' · '), M.contratistas.length]]
          .map(([n, d, c]) => `<li class="item" style="flex-direction:row;align-items:center"><div style="flex:1"><div class="item-t">${n}</div><div class="item-meta">${esc(d)}</div></div><b style="font-size:24px">${c}</b></li>`).join('')}
      </ul>` : ''}
      <label class="campo">Guardia de este celular
        <select id="guardia">${['A', 'B', 'C'].map(g => `<option ${g === guardia ? 'selected' : ''}>${g}</option>`).join('')}</select></label>`;
    $('#url', main).addEventListener('change', e => LS.set('urlMaestro', e.target.value.trim()));
    $('#guardia', main).addEventListener('change', e => { LS.set('guardia', e.target.value); encabezado(); });
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
            M = await Maestro.guardar(E.previa);
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
      'Contratista': r.contratista, 'Labor': r.labor, 'Mezcla': mezclaN(r.mezcla), 'Cód. mezcla': r.mezcla, 'Volumen m3': r.volumen_m3,
      'Equipo': r.equipo, 'Conductor': r.conductor, 'Despachador': r.despachador, 'Estado': r.estado,
      'Observaciones': r.observaciones, 'Versión maestro': r.maestro_version,
    }));
    const hL = lib.map(l => ({
      'Remisión': l.remision_num, 'Fecha hora': l.fecha_hora.replace('T', ' '), 'Contratista': l.contratista, 'Labor': l.labor,
      'Mezcla': mezclaN(l.mezcla), 'Cód. mezcla': l.mezcla, 'Recibido m3': l.cantidad_m3, 'Método': l.metodo, 'Min por m3': l.tiempo_min_por_m3,
      'Operador': l.operador, 'Firma contratista': l.firma_contratista ? 'Sí' : 'No',
      'Firma interventoría': l.firma_interventoria ? 'Sí' : 'No', 'Firma mandante': l.firma_mandante ? 'Sí' : 'No',
      'Observaciones': l.observaciones,
    }));
    const hE = (await Datos.todas('eventos')).sort((a, b) => a.momento.localeCompare(b.momento)).map(e => ({
      'Equipo': e.equipo, 'Desde': e.momento.replace('T', ' '), 'Estado': e.estado, 'Categoría': e.categoria,
      'Motivo': e.motivo, 'Registrado por': e.registrado_por, 'Versión maestro': e.maestro_version,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hR.length ? hR : [{ 'Remisión': '' }]), 'Remisiones');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hL.length ? hL : [{ 'Remisión': '' }]), 'Liberaciones');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(hE.length ? hE : [{ 'Equipo': '' }]), 'Estados equipos');
    XLSX.writeFile(wb, `despachos_${hoy()}.xlsx`);
    toast('Excel generado');
  }

  /* ---------------- arranque ---------------- */
  const VISTAS = { despachos: vDespachos, nueva: vNueva, liberar: vLiberar, flota: vFlota, maestros: vMaestros };

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

  (async function iniciar() {
    red();
    try { M = await Maestro.cargarGuardado() || null; } catch (e) { M = null; }
    await ir(M ? 'despachos' : 'maestros');
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
    }
  })();
})();

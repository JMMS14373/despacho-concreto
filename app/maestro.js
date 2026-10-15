/* ==========================================================================
   maestro.js — Botón «Cargar maestro» de la app móvil (PWA)

   Lee en el propio celular el Excel maestro descargado de SharePoint/OneDrive,
   lo valida, lo compara con el que ya está guardado y lo guarda en el
   dispositivo (IndexedDB) para trabajar SIN SEÑAL en interior mina.

   Requiere SheetJS en la página:
     <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>

   Uso:
     const m = await Maestro.leerArchivo(file);        // file de <input type="file">
     const d = await Maestro.comparar(m);              // qué cambia vs el guardado
     if (!m.errores.length) await Maestro.guardar(m);  // queda en el dispositivo
     const actual = await Maestro.cargarGuardado();    // listas para los formularios
   ========================================================================== */
(function (global) {
  'use strict';

  const HOJA = 'Maestro 主数据';

  // Primer encabezado de cada tabla → nombre de la tabla (igual al Excel)
  const TABLAS = {
    'Version': 'tblMeta',
    'Contractor': 'tblContractor',
    'Shift': 'tblShift',
    'Guard': 'tblGuard',
    'Status': 'tblMachineStatus',
    'Type': 'tblMachineType',
    'Range': 'tblRange',
    'Dispatcher name': 'tblDispatcher',
    'Operator name': 'tblOperator',
    'Machine name': 'tblMachine',
    'Month': 'tblLabor',
  };
  const OBLIGATORIAS = ['tblMeta', 'tblContractor', 'tblMachine', 'tblOperator', 'tblLabor'];

  const ESTADOS = { 'OPERATIVO': 'OPERATIVO', 'INOPERATIVO': 'INOPERATIVO', 'EN MANTENIMIENTO': 'MANTENIMIENTO',
                    'STANDBY': 'STANDBY', 'BAJA': 'BAJA' };
  const TIPOS = { 'MIXER': 'MIXER', 'ROBOJET': 'ROBOJET', 'BOMBA': 'BOMBA', 'OTRO': 'OTRO' };
  const ROLES = { 'CONDUCTOR MIXER': 'CONDUCTOR', 'OPERADOR ROBOJET': 'OPERADOR_ROBOJET' };

  // 'Operativo / 运行' → 'OPERATIVO'
  const es = (v) => (v == null || String(v).trim() === '') ? null :
    String(v).split('/')[0].normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
  const enc = (h) => String(h).split('/')[0].trim();
  const activo = (v) => !(v === false || v === 0 || /^(false|falso|no|0)$/i.test(String(v ?? '').trim()));
  const vacio = (v) => v == null || String(v).trim() === '';

  /* ---------- 1. Leer las tablas de la hoja (bloques separados por columna vacía) ---------- */
  function extraerTablas(ws) {
    const filas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const cab = filas[0] || [];
    const tablas = {};
    let c = 0;
    while (c < cab.length) {
      if (vacio(cab[c])) { c++; continue; }
      const ini = c;
      while (c < cab.length && !vacio(cab[c])) c++;
      const headers = cab.slice(ini, c).map(enc);
      const nombre = TABLAS[headers[0]];
      if (!nombre) continue;
      const datos = [];
      for (let r = 1; r < filas.length; r++) {
        const celdas = (filas[r] || []).slice(ini, c);
        if (celdas.every(vacio)) break;          // fin de la tabla
        const o = {};
        headers.forEach((h, i) => { o[h] = celdas[i] ?? null; });
        datos.push(o);
      }
      tablas[nombre] = datos;
    }
    return tablas;
  }

  /* ---------- 2. Transformar y validar (mismas reglas que cargar_maestro.py) ---------- */
  function transformar(t) {
    const errores = [], avisos = [];
    const meta = t.tblMeta && t.tblMeta[0] || {};
    const version = Number(meta['Version']);
    if (!version) errores.push('tblMeta: falta el número de versión');

    const contratistas = (t.tblContractor || []).filter(f => !vacio(f['Code']))
      .map(f => ({ id: String(f['Code']).trim(), nombre: es(f['Contractor']) }));
    const codContr = Object.fromEntries(contratistas.map(c => [c.nombre, c.id]));
    const contr = (n) => vacio(n) ? null : (codContr[es(n)] || undefined);

    const equipos = [];
    (t.tblMachine || []).forEach((f, i) => {
      const id = vacio(f['Machine Code']) ? null : String(f['Machine Code']).trim();
      if (!id) return errores.push(`tblMachine fila ${i + 2}: sin código`);
      let tipo = TIPOS[es(f['Type'])];
      if (!tipo) { avisos.push(`Equipo ${id}: sin tipo → Otro`); tipo = 'OTRO'; }
      const estado = ESTADOS[es(f['Status']) || 'OPERATIVO'];
      if (!estado) return errores.push(`Equipo ${id}: estado «${f['Status']}» no válido`);
      const c = contr(f['Contractor']);
      if (c === undefined) return errores.push(`Equipo ${id}: contratista «${f['Contractor']}» no existe`);
      equipos.push({ id, nombre: f['Machine name'], tipo, estado, contratista: c,
                     capacidad: f['Capacity [m³]'], observacion: f['Observation'], activo: activo(f['Active']) });
    });

    const personas = [];
    const addPersonas = (tabla, colNombre, rolFijo) => (t[tabla] || []).forEach((f, i) => {
      const nombre = f[colNombre];
      if (vacio(nombre) || String(nombre).startsWith('[')) return;
      if (vacio(f['Code'])) return errores.push(`${tabla} fila ${i + 2}: ${nombre} sin código`);
      const rol = rolFijo || ROLES[es(f['Range'])];
      if (!rol) return errores.push(`${tabla} fila ${i + 2}: rango «${f['Range']}» no válido`);
      personas.push({ id: String(f['Code']).trim(), nombre: String(nombre).trim(), rol,
                      contratista: contr(f['Contractor']) || null, guardia: f['Guard'] || null,
                      turno: es(f['Shift']), activo: activo(f['Active']) });
    });
    addPersonas('tblOperator', 'Operator name');
    addPersonas('tblDispatcher', 'Dispatcher name', 'DESPACHADOR');
    const ids = new Set();
    personas.forEach(p => { if (ids.has(p.id)) errores.push(`Código de persona repetido: ${p.id}`); ids.add(p.id); });

    // Labores: una por Name; si aparece en varios meses gana la última fila
    const lab = new Map(), heads = new Map();
    (t.tblLabor || []).forEach(f => {
      const head = f['Heading'], name = f['Name'] || head;
      if (vacio(head)) return;
      lab.set(name, {
        id: String(name), heading: String(head),
        sistema: String(head).slice(0, 2), nivel: String(head).slice(3, 7),
        tipo: (es(f['Type']) || '').startsWith('PANEL') ? 'PANEL' : 'DESARROLLO',
        categoria: f['Category'], seccion: f['Size [m]'], metrosPlan: f['Meters Plan [m]'],
        contratista: contr(f['Contractor']) || null, mes: f['Month'], activo: activo(f['Active']),
      });
      if (!heads.has(head)) heads.set(head, new Set());
      heads.get(head).add(name);
    });
    const labores = [...lab.values()];

    const turnos = (t.tblShift || []).map(f => ({ id: (es(f['Shift']) || '').replace(/ /g, '_'),
      nombre: f['Shift'], inicio: f['Start'], fin: f['End'] }));

    return {
      version, fecha: meta['Date'] ?? null, responsable: meta['Updated by'] ?? null, notas: meta['Notes'] ?? null,
      contratistas, equipos, personas, labores, turnos,
      guardias: (t.tblGuard || []).map(f => f['Guard']).filter(Boolean),
      errores, avisos,
    };
  }

  async function leerArchivo(file) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const ws = wb.Sheets[HOJA];
    if (!ws) return { errores: [`El archivo no tiene la hoja «${HOJA}». ¿Es el maestro correcto?`], avisos: [] };
    const t = extraerTablas(ws);
    const faltan = OBLIGATORIAS.filter(n => !t[n]);
    if (faltan.length) return { errores: [`Faltan tablas: ${faltan.join(', ')}`], avisos: [] };
    const m = transformar(t);
    m.archivo = file.name;
    return m;
  }

  /* ---------- 3. Guardar en el dispositivo (IndexedDB) ---------- */
  const DB = 'despacho-concreto', STORE = 'maestro';
  const abrir = () => new Promise((ok, mal) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => mal(rq.error);
  });
  async function op(modo, fn) {
    const db = await abrir();
    return new Promise((ok, mal) => {
      const tx = db.transaction(STORE, modo), rq = fn(tx.objectStore(STORE));
      tx.oncomplete = () => ok(rq && rq.result);
      tx.onerror = () => mal(tx.error);
    });
  }
  const cargarGuardado = () => op('readonly', s => s.get('actual'));

  async function guardar(m) {
    if (m.errores && m.errores.length) throw new Error('El maestro tiene errores; no se guarda.');
    const actual = await cargarGuardado();
    if (actual && m.version < actual.version)
      throw new Error(`Este archivo es la versión ${m.version} y el celular ya tiene la ${actual.version}.`);
    const registro = { ...m, cargadoEn: new Date().toISOString() };
    await op('readwrite', s => { if (actual) s.put(actual, 'anterior'); return s.put(registro, 'actual'); });
    return registro;
  }

  /* ---------- 4. Comparar con lo guardado (vista previa antes de aplicar) ---------- */
  async function comparar(m) {
    const actual = await cargarGuardado();
    const dif = (nuevo = [], viejo = [], campos) => {
      const v = new Map(viejo.map(x => [x.id, x]));
      const res = { total: nuevo.length, nuevos: [], cambios: [], retirados: [] };
      nuevo.forEach(x => {
        const y = v.get(x.id);
        if (!y) res.nuevos.push(x.id);
        else if (campos.some(k => String(x[k]) !== String(y[k]))) res.cambios.push(x.id);
        v.delete(x.id);
      });
      res.retirados = [...v.keys()];
      return res;
    };
    const cambiosEstado = (m.equipos || []).flatMap(e => {
      const y = actual && actual.equipos.find(a => a.id === e.id);
      return y && y.estado !== e.estado ? [`${e.id}: ${y.estado} → ${e.estado}`] : [];
    });
    return {
      versionActual: actual ? actual.version : null,
      versionNueva: m.version,
      esMasNueva: !actual || m.version > actual.version,
      labores: dif(m.labores, actual && actual.labores, ['activo', 'contratista', 'categoria']),
      equipos: dif(m.equipos, actual && actual.equipos, ['estado', 'tipo', 'activo', 'contratista']),
      personas: dif(m.personas, actual && actual.personas, ['rol', 'activo', 'guardia']),
      cambiosEstado,
    };
  }

  /* ---------- 5. Listas para los formularios ---------- */
  const listas = (m) => ({
    laboresActivas: m.labores.filter(l => l.activo),
    equiposDisponibles: m.equipos.filter(e => e.activo && e.estado === 'OPERATIVO'),
    conductores: m.personas.filter(p => p.activo && p.rol === 'CONDUCTOR'),
    operadoresRobojet: m.personas.filter(p => p.activo && p.rol === 'OPERADOR_ROBOJET'),
    despachadores: m.personas.filter(p => p.activo && p.rol === 'DESPACHADOR'),
  });

  global.Maestro = { leerArchivo, transformar, extraerTablas, comparar, guardar, cargarGuardado, listas };
})(typeof window !== 'undefined' ? window : globalThis);

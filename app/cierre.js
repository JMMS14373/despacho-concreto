/* ==========================================================================
   cierre.js — Cierre de turno: resumen del despacho en PDF, Excel o CSV

   Toma lo registrado en el equipo para una fecha y un turno y arma:
     · PDF  → una página para la reunión diaria (se guarda con «Guardar como PDF» del equipo)
     · Excel→ hoja Resumen + detalle + estados de equipos + hoja en formato del compilado de Geomecánica
     · CSV  → una fila por remisión (con su liberación), abre directo en Excel
   Todo se calcula en el celular; no necesita señal ni sube nada.
   ========================================================================== */
(function (global) {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sumar = (dia, n) => { const d = new Date(dia + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
  const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hora = (s) => (s || '').slice(11, 16);
  const ddmmyy = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}`;

  const TURNOS = { DIA: 'Día', NOCHE: 'Noche', TODO: 'Jornada completa' };

  /* Ventana de tiempo: el día y la noche arrancan en las horas de tblShift del maestro (por defecto 06:00 y 18:00). */
  const HORA = { dia: '06:00', noche: '18:00' };            // se ajusta con el turno del maestro (tblShift)
  const config = (h) => { if (h && h.dia) HORA.dia = h.dia; if (h && h.noche) HORA.noche = h.noche; };
  function ventana(dia, turno) {
    if (turno === 'DIA') return [`${dia}T${HORA.dia}`, `${dia}T${HORA.noche}`];
    if (turno === 'NOCHE') return [`${dia}T${HORA.noche}`, `${sumar(dia, 1)}T${HORA.dia}`];
    return [`${dia}T${HORA.dia}`, `${sumar(dia, 1)}T${HORA.dia}`];
  }
  const dentro = (t, [a, b]) => !!t && t >= a && t < b;

  function agrupar(filas, clave, nombre) {
    const m = new Map();
    filas.forEach(r => {
      const k = clave(r) || '—';
      const x = m.get(k) || { clave: k, nombre: nombre ? nombre(k) : k, viajes: 0, m3: 0 };
      x.viajes += 1; x.m3 += Number(r.volumen_m3 || 0);
      m.set(k, x);
    });
    return [...m.values()].map(x => ({ ...x, m3: r2(x.m3) })).sort((a, b) => b.m3 - a.m3);
  }

  /* d = { remisiones, liberaciones, aplicaciones, eventos, estadosAhora (Map), maestro, mezclaN, guardia, dia, turno } */
  function construir(d) {
    const vent = ventana(d.dia, d.turno);
    const contrN = (id) => ((d.maestro.contratistas || []).find(c => c.id === id) || {}).nombre || id;
    const rems = d.remisiones.filter(r => dentro(r.fecha_hora, vent)).sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
    const validas = rems.filter(r => r.estado !== 'CANCELADO');
    const canceladas = rems.filter(r => r.estado === 'CANCELADO');
    const sinLiberar = validas.filter(r => r.estado === 'DESPACHADO');
    const libs = d.liberaciones.filter(l => dentro(l.fecha_hora, vent)).sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
    const libDe = new Map(d.liberaciones.map(l => [l.remision_num, l]));
    // Conciliación por remisión: lo pedido (despacho) contra lo aplicado (registro del operador de Robojet)
    const apps = (d.aplicaciones || []);
    const lineasPor = new Map();
    apps.forEach(a => a.lineas.forEach(l => {
      const x = lineasPor.get(l.remision) || [];
      x.push({ m3: Number(l.m3), labor: a.labor, equipo: a.equipo, operador: a.operador, fin: a.fin, firma: !!a.firma_mixer });
      lineasPor.set(l.remision, x);
    }));
    const conc = validas.map(r => {
      const lib = libDe.get(r.numero) || null;
      let lin = lineasPor.get(r.numero) || [];
      // liberaciones anteriores a la 1.4.0 traían la labor y los m³ recibidos
      if (!lin.length && lib && lib.cantidad_m3 != null && lib.labor)
        lin = [{ m3: Number(lib.cantidad_m3), labor: lib.labor, equipo: '', operador: lib.operador || '', fin: lib.fecha_hora, firma: !!lib.firma_mandante }];
      const m3Ap = r2(lin.reduce((s, x) => s + x.m3, 0));
      const labores = [...new Set(lin.map(x => x.labor))];
      const detalle = [];
      let estado;
      if (!lin.length) estado = 'SIN APLICACIÓN REGISTRADA';
      else {
        const dl = labores.some(x => x !== r.labor), dm = Math.abs(m3Ap - Number(r.volumen_m3)) > 0.05;
        if (dl) detalle.push(`aplicada en ${labores.join(', ')}; pedida para ${r.labor}`);
        if (dm) detalle.push(`aplicados ${m3Ap} m³; despachados ${r.volumen_m3} m³`);
        estado = !dl && !dm ? 'CONCILIADA' : dl && dm ? 'LUGAR Y m³ DISTINTOS' : dl ? 'LUGAR DISTINTO' : 'm³ DISTINTOS';
      }
      return { r, lib, lineas: lin, m3Aplicados: m3Ap, labores, robojets: [...new Set(lin.map(x => x.equipo).filter(Boolean))],
        operadores: [...new Set(lin.map(x => x.operador).filter(Boolean))], estado, detalle: detalle.join('; '),
        ciclo: lib && lib.minutos_ciclo != null ? lib.minutos_ciclo : null, regreso: lib ? lib.fecha_hora : '', firma: lin.some(x => x.firma) };
    });
    const concDe = new Map(conc.map(x => [x.r.numero, x]));
    const alertas = conc.filter(x => x.detalle).map(x => ({ remision: x.r.numero, texto: x.estado + ': ' + x.detalle }));
    const sinAplicacion = conc.filter(x => x.estado === 'SIN APLICACIÓN REGISTRADA');
    const appsVentana = apps.filter(a => dentro(a.fin, vent)).sort((a, b) => a.fin.localeCompare(b.fin));
    const eventos = d.eventos.filter(e => dentro(e.momento, vent)).sort((a, b) => a.momento.localeCompare(b.momento));
    const noOperativos = [...d.estadosAhora.entries()].filter(([, s]) => s.estado !== 'OPERATIVO')
      .map(([equipo, s]) => ({ equipo, estado: s.estado, desde: s.desde, motivo: s.motivo }));
    return {
      dia: d.dia, turno: d.turno, turnoNombre: TURNOS[d.turno], ventana: vent, guardia: d.guardia, mezclaN: d.mezclaN, areaN: d.areaN || ((x) => x || ''), contrN,
      generado: iso(new Date()) + ' ' + pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()),
      version: d.maestro.version, appVersion: d.appVersion || '—',
      versionesApp: (() => { const m = new Map(); validas.concat(canceladas).forEach(r => { const v = r.app_version || 'anterior'; m.set(v, (m.get(v) || 0) + 1); });
        return [...m.entries()].map(([v, n]) => `${v === 'anterior' ? 'anterior a la 1.3.0' : v} (${n})`).join(', '); })(),
      remisiones: validas, canceladas, sinLiberar, liberaciones: libs, libDe, conc, concDe, sinAplicacion, appsVentana, alertas, eventos, noOperativos,
      kpi: {
        viajes: validas.length, m3: r2(validas.reduce((s, r) => s + Number(r.volumen_m3 || 0), 0)),
        recibidos: r2(conc.reduce((s, x) => s + x.m3Aplicados, 0)), liberadas: libs.length,
        conciliadas: conc.filter(x => x.estado === 'CONCILIADA').length, conDiferencia: alertas.length, sinAplicacion: sinAplicacion.length,
        sinLiberar: sinLiberar.length, m3SinLiberar: r2(sinLiberar.reduce((s, r) => s + Number(r.volumen_m3 || 0), 0)),
        canceladas: canceladas.length,
      },
      porContratista: agrupar(validas, r => r.contratista, contrN),
      porMezcla: agrupar(validas, r => r.mezcla, d.mezclaN),
      porLabor: agrupar(validas, r => r.labor).slice(0, 10),
    };
  }

  const nombreArchivo = (s, ext) => `cierre_${s.dia}_${s.turno.toLowerCase()}.${ext}`;
  const turnoES = (t) => (t === 'Día' || t === 'DIA' ? 'DIA' : t === 'Noche' || t === 'NOCHE' ? 'NOCHE' : String(t || '').toUpperCase());

  /* ---------- Excel ---------- */
  function excel(s, XLSX) {
    const wb = XLSX.utils.book_new();
    const k = s.kpi;
    const tabla = (titulo, filas, col1) => [[titulo], [col1, 'Viajes', 'm³'], ...filas.map(f => [f.nombre, f.viajes, f.m3]), []];
    const resumen = [
      ['CIERRE DE DESPACHO'], [`${s.dia} · ${s.turnoNombre} (${s.ventana[0].replace('T', ' ')} a ${s.ventana[1].replace('T', ' ')})`],
      [`Guardia ${s.guardia} · Maestro v${s.version} · App v${s.appVersion} · Generado ${s.generado}`],
      [`Versiones de la app que registraron en el periodo: ${s.versionesApp || '—'}`], [],
      ['Viajes', k.viajes], ['m³ despachados', k.m3], ['m³ aplicados (registro del Robojet)', k.recibidos], ['Ciclos de Mixer cerrados (liberadas)', k.liberadas],
      ['Mixers en ruta (sin liberar)', k.sinLiberar], ['m³ en ruta', k.m3SinLiberar],
      ['Conciliadas', k.conciliadas], ['Con diferencia (lugar o m³)', k.conDiferencia], ['Sin aplicación registrada', k.sinAplicacion], ['Remisiones canceladas', k.canceladas], [],
      ...tabla('Por contratista', s.porContratista, 'Contratista'),
      ...tabla('Por mezcla', s.porMezcla, 'Mezcla'),
      ...tabla('Por labor (10 principales)', s.porLabor, 'Labor'),
      ['Mixers en ruta (sin liberar)'], ['Remisión', 'Hora', 'Equipo', 'Labor', 'm³'],
      ...s.sinLiberar.map(r => [r.numero, hora(r.fecha_hora), r.equipo, r.labor, r.volumen_m3]), [],
      ['Equipos no operativos ahora'], ['Equipo', 'Estado', 'Desde', 'Motivo'],
      ...s.noOperativos.map(e => [e.equipo, e.estado, (e.desde || '').replace('T', ' '), e.motivo || '']), [],
      ['Conciliación: diferencias entre lo pedido y lo aplicado'], ['Remisión', 'Detalle'], ...s.alertas.map(a => [a.remision, a.texto]),
    ];
    const wsR = XLSX.utils.aoa_to_sheet(resumen);
    wsR['!cols'] = [{ wch: 38 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

    const det = s.remisiones.concat(s.canceladas).sort((a, b) => a.numero - b.numero).map(r => {
      const x = s.concDe.get(r.numero) || {};
      return {
        'Remisión': r.numero, 'Fecha': r.fecha_hora.slice(0, 10), 'Hora salida': hora(r.fecha_hora), 'Turno': r.turno, 'Guardia': r.guardia, 'Área técnica': s.areaN(r.area),
        'Contratista': s.contrN(r.contratista), 'Labor pedida': r.labor, 'Mezcla': s.mezclaN(r.mezcla), 'Categoría': r.categoria || '', 'm³ despachados': r.volumen_m3,
        'Equipo (Mixer)': r.equipo, 'Tipo de equipo (operador)': r.tipo_equipo || 'NA', 'Operador de Mixer': r.conductor, 'Despachador': r.despachador, 'Estado': r.estado,
        'Regreso a planta': x.regreso ? x.regreso.replace('T', ' ') : '', 'Ciclo Mixer (min)': x.ciclo ?? '',
        'Labor aplicada': x.labores ? x.labores.join(', ') : '', 'm³ aplicados': x.lineas && x.lineas.length ? x.m3Aplicados : '',
        'Robojet': x.robojets ? x.robojets.join(', ') : '', 'Operador de Robojet': x.operadores ? x.operadores.join(', ') : '', 'Firma Mixer': x.lineas && x.lineas.length ? (x.firma ? 'Sí' : 'No') : '',
        'Conciliación': r.estado === 'CANCELADO' ? 'CANCELADA' : (x.estado || ''), 'Detalle conciliación': x.detalle || '',
        'Versión app': r.app_version || 'anterior', 'Observaciones despacho': r.observaciones, 'Observaciones liberación': (x.lib || {}).observaciones,
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(det.length ? det : [{ 'Remisión': '' }]), 'Remisiones');

    const apl = s.appsVentana.flatMap(a => a.lineas.map(l => ({ 'Robojet': a.equipo, 'Operador de Robojet': a.operador, 'Guardia': a.guardia, 'Labor aplicada': a.labor,
      'Remisión': l.remision, 'm³ aplicados': l.m3, 'Inicio': a.inicio.replace('T', ' '), 'Fin': a.fin.replace('T', ' '), 'Operador de Mixer (firma)': a.operador_mixer,
      'Firma': a.firma_mixer ? 'Sí' : 'No', 'Observaciones': a.observaciones, 'Versión app': a.app_version })));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(apl.length ? apl : [{ 'Robojet': '' }]), 'Aplicaciones Robojet');

    const ev = s.eventos.map(e => ({ 'Equipo': e.equipo, 'Desde': e.momento.replace('T', ' '), 'Estado': e.estado, 'Tipo': e.categoria, 'Motivo': e.motivo, 'Registrado por': e.registrado_por }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ev.length ? ev : [{ 'Equipo': '' }]), 'Estados equipos');

    // Formato del compilado de Geomecánica: se pega tal cual. Tipo de actividad, sub-área y CAPEX/OPEX no se registran en la app todavía.
    const geo = s.remisiones.map(r => ({
      'FECHA': ddmmyy(r.fecha_hora), 'MES': '', 'HORA': hora(r.fecha_hora), 'TURNO': turnoES(r.turno), 'REMISIÓN': r.numero,
      'USUARIO': s.contrN(r.contratista).toUpperCase().replace(/\s+/g, '_'), 'TIPO ACTIVIDAD': '', 'LUGAR EXACTO': ((s.concDe.get(r.numero) || {}).labores || [])[0] || r.labor,
      'M3': r.volumen_m3, 'MIXER': r.equipo, 'ROBOJET': ((s.concDe.get(r.numero) || {}).robojets || []).join(', '), 'SUB-ÁREA': '', 'COMENTARIOS': r.observaciones || '', 'CAPEX/OPEX': '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(geo.length ? geo : [{ 'FECHA': '' }]), 'Formato Geomecánica');
    XLSX.writeFile(wb, nombreArchivo(s, 'xlsx'));
  }

  /* ---------- CSV: una fila por remisión, con BOM para que Excel respete los acentos ---------- */
  function csv(s) {
    const cab = ['Remisión', 'Fecha', 'Hora', 'Turno', 'Guardia', 'Área técnica', 'Contratista', 'Labor despachada', 'Mezcla', 'Categoría', 'm3 despachados', 'Equipo (Mixer)', 'Tipo de equipo (operador)', 'Operador de Mixer',
      'Despachador', 'Estado', 'Regreso a planta', 'Ciclo Mixer (min)', 'Labor aplicada', 'm3 aplicados', 'Robojet', 'Operador de Robojet', 'Conciliación', 'Detalle conciliación', 'Observaciones despacho', 'Observaciones liberación', 'Versión app'];
    const celda = (v) => { const t = v == null ? '' : String(v); return /[",;\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const filas = s.remisiones.concat(s.canceladas).sort((a, b) => a.numero - b.numero).map(r => {
      const x = s.concDe.get(r.numero) || {};
      return [r.numero, r.fecha_hora.slice(0, 10), hora(r.fecha_hora), r.turno, r.guardia, s.areaN(r.area), s.contrN(r.contratista), r.labor, s.mezclaN(r.mezcla), r.categoria || '', r.volumen_m3,
        r.equipo, r.tipo_equipo || 'NA', r.conductor, r.despachador, r.estado, x.regreso ? x.regreso.replace('T', ' ') : '', x.ciclo ?? '',
        x.labores ? x.labores.join(' + ') : '', x.lineas && x.lineas.length ? x.m3Aplicados : '', x.robojets ? x.robojets.join(' + ') : '', x.operadores ? x.operadores.join(' + ') : '',
        r.estado === 'CANCELADO' ? 'CANCELADA' : (x.estado || ''), x.detalle || '', r.observaciones, (x.lib || {}).observaciones, r.app_version || 'anterior'].map(celda).join(',');
    });
    const blob = new Blob(['﻿' + [cab.join(','), ...filas].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombreArchivo(s, 'csv');
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- PDF: página imprimible; el equipo la guarda como PDF ---------- */
  function pdfHtml(s) {
    const k = s.kpi;
    const tabla = (titulo, filas, col1) => filas.length ? `<h3>${esc(titulo)}</h3><table><tr><th>${esc(col1)}</th><th class="n">Viajes</th><th class="n">m³</th></tr>${filas.map(f => `<tr><td>${esc(f.nombre)}</td><td class="n">${f.viajes}</td><td class="n">${f.m3}</td></tr>`).join('')}</table>` : '';
    const lista = (titulo, cab, filas) => filas.length ? `<h3>${esc(titulo)}</h3><table><tr>${cab.map(c => `<th>${esc(c)}</th>`).join('')}</tr>${filas.map(f => `<tr>${f.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : '';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(nombreArchivo(s, 'pdf').replace('.pdf', ''))}</title><style>
      @page { size: A4; margin: 14mm; }
      body { font: 11px/1.35 "Segoe UI", Arial, sans-serif; color: #1B1F24; margin: 0; }
      h1 { font-size: 18px; margin: 0 0 2px; } .sub { color: #55606B; margin-bottom: 10px; }
      h3 { font-size: 12px; margin: 12px 0 4px; border-bottom: 1px solid #C8CCD0; padding-bottom: 2px; }
      .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
      .kpi { border: 1px solid #C8CCD0; border-radius: 6px; padding: 6px 8px; } .kpi b { display: block; font-size: 18px; } .kpi span { color: #55606B; }
      .kpi.alerta { background: #FFF4D6; border-color: #F2A900; }
      table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 2px 6px; border-bottom: 1px solid #E4E6E8; }
      th { background: #F4F3EF; font-weight: 600; } .n { text-align: right; } .vacio { color: #55606B; }
      .dos { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; } footer { margin-top: 14px; color: #55606B; font-size: 10px; }
    </style></head><body>
      <h1>Cierre de despacho · ${esc(s.dia)} · ${esc(s.turnoNombre)}</h1>
      <div class="sub">Guardia ${esc(s.guardia)} · ${esc(s.ventana[0].replace('T', ' '))} a ${esc(s.ventana[1].replace('T', ' '))} · Maestro v${esc(s.version)} · App v${esc(s.appVersion)}</div>
      <div class="kpis">
        <div class="kpi"><b>${k.viajes}</b><span>Viajes</span></div>
        <div class="kpi"><b>${k.m3}</b><span>m³ despachados</span></div>
        <div class="kpi"><b>${k.recibidos}</b><span>m³ aplicados (${k.conciliadas} conciliadas)</span></div>
        <div class="kpi ${k.conDiferencia || k.sinAplicacion ? 'alerta' : ''}"><b>${k.conDiferencia}</b><span>Con diferencia · ${k.sinAplicacion} sin aplicación · ${k.sinLiberar} Mixers en ruta</span></div>
      </div>
      <div class="dos"><div>${tabla('Por contratista', s.porContratista, 'Contratista')}${tabla('Por mezcla', s.porMezcla, 'Mezcla')}</div>
        <div>${tabla('Por labor (10 principales)', s.porLabor, 'Labor')}</div></div>
      ${lista('Conciliación: diferencias entre lo pedido y lo aplicado', ['Rm', 'Detalle'], s.alertas.map(a => [a.remision, a.texto]))}
      ${lista('Sin aplicación registrada', ['Rm', 'Hora', 'Mixer', 'Labor pedida', 'm³'], s.sinAplicacion.map(x => [x.r.numero, hora(x.r.fecha_hora), x.r.equipo, x.r.labor, x.r.volumen_m3]))}
      ${lista('Mixers en ruta (sin liberar)', ['Rm', 'Hora', 'Equipo', 'Labor', 'm³'], s.sinLiberar.map(r => [r.numero, hora(r.fecha_hora), r.equipo, r.labor, r.volumen_m3]))}
      ${lista('Equipos fuera de servicio ahora', ['Equipo', 'Estado', 'Desde', 'Motivo'], s.noOperativos.map(e => [e.equipo, e.estado, (e.desde || 'según maestro').replace('T', ' '), e.motivo || '']))}
      ${k.canceladas ? `<p class="vacio">Remisiones canceladas en el periodo: ${k.canceladas}</p>` : ''}
      <footer>Generado ${esc(s.generado)} con la app de despacho v${esc(s.appVersion)}. Versiones que registraron en el periodo: ${esc(s.versionesApp || '—')}. Datos del equipo donde se registró.</footer>
    </body></html>`;
  }

  function imprimir(s) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(pdfHtml(s)); f.contentDocument.close();
    const lanzar = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } finally { setTimeout(() => f.remove(), 60000); } };
    setTimeout(lanzar, 250);
  }

  global.Cierre = { config, construir, excel, csv, imprimir, pdfHtml, ventana, TURNOS };
})(typeof window !== 'undefined' ? window : globalThis);

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

  /* Ventana de tiempo: el día va de 06:00 a 17:59; la noche de 18:00 a 05:59 del día siguiente. */
  function ventana(dia, turno) {
    if (turno === 'DIA') return [`${dia}T06:00`, `${dia}T18:00`];
    if (turno === 'NOCHE') return [`${dia}T18:00`, `${sumar(dia, 1)}T06:00`];
    return [`${dia}T06:00`, `${sumar(dia, 1)}T06:00`];
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

  /* d = { remisiones, liberaciones, eventos, estadosAhora (Map), maestro, mezclaN, guardia, dia, turno } */
  function construir(d) {
    const vent = ventana(d.dia, d.turno);
    const contrN = (id) => ((d.maestro.contratistas || []).find(c => c.id === id) || {}).nombre || id;
    const rems = d.remisiones.filter(r => dentro(r.fecha_hora, vent)).sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
    const validas = rems.filter(r => r.estado !== 'CANCELADO');
    const canceladas = rems.filter(r => r.estado === 'CANCELADO');
    const sinLiberar = validas.filter(r => r.estado === 'DESPACHADO');
    const libs = d.liberaciones.filter(l => dentro(l.fecha_hora, vent)).sort((a, b) => a.fecha_hora.localeCompare(b.fecha_hora));
    const libDe = new Map(d.liberaciones.map(l => [l.remision_num, l]));
    const alertas = libs.filter(l => /Recibido .* > despachado|Labor real distinta/.test(l.observaciones || ''))
      .map(l => ({ remision: l.remision_num, texto: l.observaciones }));
    const eventos = d.eventos.filter(e => dentro(e.momento, vent)).sort((a, b) => a.momento.localeCompare(b.momento));
    const noOperativos = [...d.estadosAhora.entries()].filter(([, s]) => s.estado !== 'OPERATIVO')
      .map(([equipo, s]) => ({ equipo, estado: s.estado, desde: s.desde, motivo: s.motivo }));
    return {
      dia: d.dia, turno: d.turno, turnoNombre: TURNOS[d.turno], ventana: vent, guardia: d.guardia, mezclaN: d.mezclaN, contrN,
      generado: iso(new Date()) + ' ' + pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()),
      version: d.maestro.version,
      remisiones: validas, canceladas, sinLiberar, liberaciones: libs, libDe, alertas, eventos, noOperativos,
      kpi: {
        viajes: validas.length, m3: r2(validas.reduce((s, r) => s + Number(r.volumen_m3 || 0), 0)),
        recibidos: r2(libs.reduce((s, l) => s + Number(l.cantidad_m3 || 0), 0)), liberadas: libs.length,
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
      [`Guardia ${s.guardia} · Maestro v${s.version} · Generado ${s.generado}`], [],
      ['Viajes', k.viajes], ['m³ despachados', k.m3], ['m³ recibidos (liberados en el periodo)', k.recibidos],
      ['Remisiones sin liberar', k.sinLiberar], ['m³ sin liberar', k.m3SinLiberar], ['Remisiones canceladas', k.canceladas], [],
      ...tabla('Por contratista', s.porContratista, 'Contratista'),
      ...tabla('Por mezcla', s.porMezcla, 'Mezcla'),
      ...tabla('Por labor (10 principales)', s.porLabor, 'Labor'),
      ['Remisiones sin liberar'], ['Remisión', 'Hora', 'Equipo', 'Labor', 'm³'],
      ...s.sinLiberar.map(r => [r.numero, hora(r.fecha_hora), r.equipo, r.labor, r.volumen_m3]), [],
      ['Equipos no operativos ahora'], ['Equipo', 'Estado', 'Desde', 'Motivo'],
      ...s.noOperativos.map(e => [e.equipo, e.estado, (e.desde || '').replace('T', ' '), e.motivo || '']), [],
      ['Alertas de liberación'], ['Remisión', 'Detalle'], ...s.alertas.map(a => [a.remision, a.texto]),
    ];
    const wsR = XLSX.utils.aoa_to_sheet(resumen);
    wsR['!cols'] = [{ wch: 38 }, { wch: 12 }, { wch: 12 }, { wch: 28 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, wsR, 'Resumen');

    const det = s.remisiones.concat(s.canceladas).sort((a, b) => a.numero - b.numero).map(r => {
      const l = s.libDe.get(r.numero) || {};
      return {
        'Remisión': r.numero, 'Fecha': r.fecha_hora.slice(0, 10), 'Hora': hora(r.fecha_hora), 'Turno': r.turno, 'Guardia': r.guardia,
        'Contratista': s.contrN(r.contratista), 'Labor despachada': r.labor, 'Mezcla': s.mezclaN(r.mezcla), 'm³ despachados': r.volumen_m3,
        'Equipo': r.equipo, 'Conductor': r.conductor, 'Despachador': r.despachador, 'Estado': r.estado,
        'Liberada': l.fecha_hora ? l.fecha_hora.replace('T', ' ') : '', 'Labor real': l.labor, 'm³ recibidos': l.cantidad_m3,
        'Método': l.metodo, 'Min por m³': l.tiempo_min_por_m3, 'Operador': l.operador,
        'Observaciones despacho': r.observaciones, 'Observaciones liberación': l.observaciones,
      };
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(det.length ? det : [{ 'Remisión': '' }]), 'Remisiones');

    const ev = s.eventos.map(e => ({ 'Equipo': e.equipo, 'Desde': e.momento.replace('T', ' '), 'Estado': e.estado, 'Tipo': e.categoria, 'Motivo': e.motivo, 'Registrado por': e.registrado_por }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ev.length ? ev : [{ 'Equipo': '' }]), 'Estados equipos');

    // Formato del compilado de Geomecánica: se pega tal cual. Tipo de actividad, sub-área y CAPEX/OPEX no se registran en la app todavía.
    const geo = s.remisiones.map(r => ({
      'FECHA': ddmmyy(r.fecha_hora), 'MES': '', 'HORA': hora(r.fecha_hora), 'TURNO': turnoES(r.turno), 'REMISIÓN': r.numero,
      'USUARIO': s.contrN(r.contratista).toUpperCase().replace(/\s+/g, '_'), 'TIPO ACTIVIDAD': '', 'LUGAR EXACTO': r.labor,
      'M3': r.volumen_m3, 'MIXER': r.equipo, 'ROBOJET': '', 'SUB-ÁREA': '', 'COMENTARIOS': r.observaciones || '', 'CAPEX/OPEX': '',
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(geo.length ? geo : [{ 'FECHA': '' }]), 'Formato Geomecánica');
    XLSX.writeFile(wb, nombreArchivo(s, 'xlsx'));
  }

  /* ---------- CSV: una fila por remisión, con BOM para que Excel respete los acentos ---------- */
  function csv(s) {
    const cab = ['Remisión', 'Fecha', 'Hora', 'Turno', 'Guardia', 'Contratista', 'Labor despachada', 'Mezcla', 'm3 despachados', 'Equipo', 'Conductor',
      'Despachador', 'Estado', 'Liberada', 'Labor real', 'm3 recibidos', 'Método', 'Min por m3', 'Operador', 'Observaciones despacho', 'Observaciones liberación'];
    const celda = (v) => { const t = v == null ? '' : String(v); return /[",;\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const filas = s.remisiones.concat(s.canceladas).sort((a, b) => a.numero - b.numero).map(r => {
      const l = s.libDe.get(r.numero) || {};
      return [r.numero, r.fecha_hora.slice(0, 10), hora(r.fecha_hora), r.turno, r.guardia, s.contrN(r.contratista), r.labor, s.mezclaN(r.mezcla), r.volumen_m3,
        r.equipo, r.conductor, r.despachador, r.estado, l.fecha_hora ? l.fecha_hora.replace('T', ' ') : '', l.labor, l.cantidad_m3, l.metodo,
        l.tiempo_min_por_m3, l.operador, r.observaciones, l.observaciones].map(celda).join(',');
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
      <div class="sub">Guardia ${esc(s.guardia)} · ${esc(s.ventana[0].replace('T', ' '))} a ${esc(s.ventana[1].replace('T', ' '))} · Maestro v${esc(s.version)}</div>
      <div class="kpis">
        <div class="kpi"><b>${k.viajes}</b><span>Viajes</span></div>
        <div class="kpi"><b>${k.m3}</b><span>m³ despachados</span></div>
        <div class="kpi"><b>${k.recibidos}</b><span>m³ recibidos (${k.liberadas} liberaciones)</span></div>
        <div class="kpi ${k.sinLiberar ? 'alerta' : ''}"><b>${k.sinLiberar}</b><span>Sin liberar (${k.m3SinLiberar} m³)</span></div>
      </div>
      <div class="dos"><div>${tabla('Por contratista', s.porContratista, 'Contratista')}${tabla('Por mezcla', s.porMezcla, 'Mezcla')}</div>
        <div>${tabla('Por labor (10 principales)', s.porLabor, 'Labor')}</div></div>
      ${lista('Remisiones sin liberar', ['Rm', 'Hora', 'Equipo', 'Labor', 'm³'], s.sinLiberar.map(r => [r.numero, hora(r.fecha_hora), r.equipo, r.labor, r.volumen_m3]))}
      ${lista('Equipos fuera de servicio ahora', ['Equipo', 'Estado', 'Desde', 'Motivo'], s.noOperativos.map(e => [e.equipo, e.estado, (e.desde || 'según maestro').replace('T', ' '), e.motivo || '']))}
      ${lista('Alertas de liberación', ['Rm', 'Detalle'], s.alertas.map(a => [a.remision, a.texto]))}
      ${k.canceladas ? `<p class="vacio">Remisiones canceladas en el periodo: ${k.canceladas}</p>` : ''}
      <footer>Generado ${esc(s.generado)} desde la app de despacho. Datos del equipo donde se registró.</footer>
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

  global.Cierre = { construir, excel, csv, imprimir, pdfHtml, ventana, TURNOS };
})(typeof window !== 'undefined' ? window : globalThis);

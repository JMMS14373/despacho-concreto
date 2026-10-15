/* ==========================================================================
   qr.js — «Escanear equipo» antes del despacho (funciona sin señal)

   Lee con la cámara el QR pegado en el equipo (DC1|EQ|<código>), lo busca en
   el maestro guardado en el celular y bloquea equipos que no estén Operativos.

   Usa el lector nativo del navegador (BarcodeDetector, Android/Chrome) y si no
   existe (iPhone) usa jsQR:
     <script src="https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js"></script>
   Requiere HTTPS (Netlify/GitHub Pages lo dan) para acceder a la cámara.

   Uso:
     const r = await QR.escanearEquipo(videoEl);   // abre cámara hasta leer un QR válido
     if (r.ok) seleccionarEquipo(r.equipo); else mostrarError(r.error);
   ========================================================================== */
(function (global) {
  'use strict';
  const PREFIJO = 'DC1|EQ|';

  function interpretar(texto) {
    if (!texto || !texto.startsWith(PREFIJO)) return { ok: false, error: 'Este QR no es de un equipo de la app.' };
    return { ok: true, codigo: texto.slice(PREFIJO.length).trim() };
  }

  async function validarEquipo(codigo) {
    const m = await global.Maestro.cargarGuardado();
    if (!m) return { ok: false, error: 'No hay maestro cargado en este celular.' };
    const e = m.equipos.find(x => x.id.toUpperCase() === codigo.toUpperCase());
    if (!e) return { ok: false, error: `El equipo ${codigo} no está en el maestro v${m.version}. Actualice el maestro.` };
    if (!e.activo) return { ok: false, error: `El equipo ${codigo} está dado de baja en el maestro.`, equipo: e };
    if (e.estado !== 'OPERATIVO') return { ok: false, error: `${codigo} está ${e.estado}: no se puede despachar.`, equipo: e };
    return { ok: true, equipo: e };
  }

  async function leerQR(video, { timeoutMs = 30000, signal } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    video.setAttribute('playsinline', '');
    await video.play();
    const nativo = 'BarcodeDetector' in global ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
    const lienzo = document.createElement('canvas');
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    const fin = Date.now() + timeoutMs;
    try {
      while (Date.now() < fin) {
        if (signal && signal.aborted) throw new Error('Escaneo cancelado.');
        if (video.readyState >= 2) {
          if (nativo) {
            const r = await nativo.detect(video);
            if (r.length) return r[0].rawValue;
          } else if (global.jsQR) {
            lienzo.width = video.videoWidth; lienzo.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
            const r = global.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
            if (r) return r.data;
          } else {
            throw new Error('Este navegador no puede leer QR. Elija el equipo de la lista.');
          }
        }
        await new Promise(ok => setTimeout(ok, 150));
      }
      throw new Error('No se leyó ningún QR. Acerque la cámara o elija el equipo de la lista.');
    } finally {
      stream.getTracks().forEach(t => t.stop());
    }
  }

  async function escanearEquipo(video, opciones) {
    try {
      const q = interpretar(await leerQR(video, opciones));
      if (!q.ok) return q;
      if (navigator.vibrate) navigator.vibrate(80);
      return await ((opciones && opciones.validar) || validarEquipo)(q.codigo);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  global.QR = { PREFIJO, interpretar, validarEquipo, escanearEquipo };
})(typeof window !== 'undefined' ? window : globalThis);

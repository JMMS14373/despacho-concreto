/* ==========================================================================
   pin.js — PIN de 4 dígitos para el ACCESO DE MAESTRO (cargar / actualizar el maestro)

   · El maestro (nombres, equipos, labores) nunca está en GitHub: se carga desde el archivo
     de SharePoint/OneDrive. Este PIN controla quién puede hacer esa carga.
   · El PIN no se guarda: solo queda una huella (PBKDF2-SHA256 con sal) en el celular.
   · El acceso se cierra solo al salir de la pantalla Maestros o tras 5 min sin tocar.
   · 5 intentos fallidos seguidos bloquean 30 s; cada intento más duplica la espera (máx. 15 min).
   · «Olvidé mi PIN»: borra el maestro y el PIN de este celular (las remisiones registradas se
     conservan). Quien lo restablece no obtiene datos: debe volver a cargar el archivo del maestro.
   · Limitación: 4 dígitos son 10.000 combinaciones; frena el uso casual, no un ataque técnico.
   ========================================================================== */
(function (global) {
  'use strict';

  const ITER = 250000, MAX_SIN_BLOQUEO = 5, VIGENCIA_MS = 5 * 60 * 1000;
  const K = { sal: 'pin.sal', hue: 'pin.huella', fallos: 'pin.fallos', hasta: 'pin.hasta' };
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } },
  };
  const b64 = (u8) => { let s = ''; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const deb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const $ = (s, r = document) => r.querySelector(s);

  let hasta = 0;                                    // hasta cuándo está abierto el acceso
  const hayCripto = () => !!(global.crypto && global.crypto.subtle);
  const configurado = () => !!(LS.get(K.sal) && LS.get(K.hue));
  const autorizado = () => Date.now() < hasta;
  const renovar = () => { if (autorizado()) hasta = Date.now() + VIGENCIA_MS; };
  const cerrar = () => { hasta = 0; };
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev => document.addEventListener(ev, renovar, { passive: true, capture: true }));

  async function huella(pin, sal) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: ITER, hash: 'SHA-256' }, base, 256)));
  }
  async function guardarPin(pin) {
    const sal = crypto.getRandomValues(new Uint8Array(16));
    if (!LS.set(K.sal, b64(sal)) || !LS.set(K.hue, await huella(pin, sal))) throw new Error('No se pudo guardar el PIN en este navegador.');
    LS.del(K.fallos); LS.del(K.hasta);
  }
  const comprobar = async (pin) => (await huella(pin, deb64(LS.get(K.sal)))) === LS.get(K.hue);

  /* ---------- reglas y bloqueo por intentos ---------- */
  const SENCILLOS = new Set(['0123', '1234', '2345', '3456', '4567', '5678', '6789', '9876', '8765', '7654', '6543', '5432', '4321', '3210', '1212', '2580']);
  function pinDebil(pin) {
    if (/^(\d)\1{3}$/.test(pin)) return 'No use cuatro dígitos iguales.';
    if (SENCILLOS.has(pin)) return 'Ese PIN es muy fácil de adivinar. Elija otro.';
    return null;
  }
  const esperaTras = (n) => n < MAX_SIN_BLOQUEO ? 0 : Math.min(15 * 60, 30 * 2 ** (n - MAX_SIN_BLOQUEO));
  const segundosBloqueo = () => Math.max(0, Math.ceil((Number(LS.get(K.hasta) || 0) - Date.now()) / 1000));
  function registrarFallo() {
    const n = Number(LS.get(K.fallos) || 0) + 1;
    LS.set(K.fallos, String(n));
    const s = esperaTras(n);
    if (s) LS.set(K.hasta, String(Date.now() + s * 1000));
    return n;
  }

  /* ---------- pantalla con teclado numérico ---------- */
  function pantalla() {
    let el = $('#pin');
    if (!el) { el = document.createElement('div'); el.id = 'pin'; el.className = 'pin'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.appendChild(el); }
    return el;
  }
  const fondo = (si) => { const a = $('.app'); if (a) { si ? a.setAttribute('inert', '') : a.removeAttribute('inert'); } };
  function ocultar() { const el = $('#pin'); if (el) { el.hidden = true; el.innerHTML = ''; } fondo(false); }

  /* Devuelve el PIN escrito, null si cancela, o '__OLVIDO__'. `validar(pin)` devuelve un texto de error o null. */
  function pedir({ titulo, sub, cancelable = true, olvido = false, validar = null, bloqueable = false }) {
    const el = pantalla();
    fondo(true);
    return new Promise((ok) => {
      let dig = '', t = null;
      el.hidden = false;
      el.innerHTML = `
        <div class="pin-caja">
          <h2>${titulo}</h2><p class="pin-sub">${sub || ''}</p>
          <div class="pin-puntos" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
          <p class="pin-msg" id="pinMsg" role="alert"></p>
          <div class="pin-teclas">
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-d="${n}" aria-label="${n}">${n}</button>`).join('')}
            <button type="button" data-acc="borrar" class="aux" aria-label="Borrar">⌫</button>
            <button type="button" data-d="0" aria-label="0">0</button>
            <button type="button" data-acc="cancelar" class="aux" ${cancelable ? '' : 'hidden'}>Cancelar</button>
          </div>
          ${olvido ? '<button type="button" class="pin-olvido" data-acc="olvido">Olvidé mi PIN</button>' : ''}
        </div>`;
      const msg = (x) => { $('#pinMsg', el).textContent = x || ''; };
      const pintar = () => el.querySelectorAll('.pin-puntos i').forEach((p, i) => p.classList.toggle('on', i < dig.length));
      const hab = (si) => el.querySelectorAll('button[data-d]').forEach(b => { b.disabled = !si; });
      const salir = (v) => { document.removeEventListener('keydown', teclado, true); clearInterval(t); ok(v); };
      function bloqueado() {
        const s = bloqueable ? segundosBloqueo() : 0;
        if (s > 0) { hab(false); msg(`Demasiados intentos. Espere ${s >= 60 ? Math.ceil(s / 60) + ' min' : s + ' s'} · 请稍候`); return true; }
        if (el.querySelector('button[data-d]').disabled) { hab(true); msg(''); }
        return false;
      }
      async function completo() {
        const pin = dig; dig = ''; setTimeout(pintar, 120);
        const err = validar ? await validar(pin) : null;
        if (err) { msg(err); el.classList.remove('sacude'); void el.offsetWidth; el.classList.add('sacude'); bloqueado(); return; }
        salir(pin);
      }
      function tecla(d) { if (dig.length >= 4 || bloqueado()) return; dig += d; msg(''); pintar(); if (dig.length === 4) completo(); }
      function accion(a) {
        if (a === 'borrar') { dig = dig.slice(0, -1); pintar(); }
        else if (a === 'cancelar') salir(null);
        else if (a === 'olvido') confirmarOlvido(el, () => salir('__OLVIDO__'), () => salir(null));
      }
      function teclado(e) {
        if (/^\d$/.test(e.key)) { tecla(e.key); e.preventDefault(); }
        else if (e.key === 'Backspace') { accion('borrar'); e.preventDefault(); }
        else if (e.key === 'Escape' && cancelable) { accion('cancelar'); e.preventDefault(); }
      }
      el.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.d != null) tecla(b.dataset.d); else if (b.dataset.acc) accion(b.dataset.acc); };
      document.addEventListener('keydown', teclado, true);
      t = setInterval(bloqueado, 1000);
      bloqueado(); pintar();
    });
  }

  function confirmarOlvido(el, borrar, volver) {
    $('.pin-caja', el).innerHTML = `
      <h2>¿Olvidó el PIN?</h2>
      <p class="pin-sub">Para crear uno nuevo se <b>borra el maestro de este celular</b> (nombres, equipos y labores). Las remisiones ya registradas se conservan.
      Después debe cargar otra vez el archivo del maestro.</p>
      <div class="pin-botones">
        <button type="button" class="btn btn-sec" id="olvNo">Volver</button>
        <button type="button" class="btn btn-pri" id="olvSi">Borrar maestro y crear PIN</button>
      </div>`;
    $('#olvNo', el).onclick = volver;
    $('#olvSi', el).onclick = borrar;
  }

  function borrarMaestro() {
    return new Promise((ok) => {
      const r = indexedDB.deleteDatabase('despacho-concreto');   // base del maestro (las remisiones están en otra)
      r.onsuccess = r.onerror = r.onblocked = () => ok();
    }).then(() => { [K.sal, K.hue, K.fallos, K.hasta].forEach(LS.del); });
  }

  async function crear(tituloExtra) {
    for (;;) {
      const a = await pedir({ titulo: tituloExtra || 'Cree el PIN de maestro · 设置密码', sub: 'Cuatro dígitos. Se pedirá para cargar o actualizar el maestro.', validar: async (p) => pinDebil(p) });
      if (a === null) return null;
      const b = await pedir({ titulo: 'Repita el PIN · 再输入一次', sub: 'Escríbalo otra vez para confirmar.', validar: async (p) => p === a ? null : 'No coincide. Vuelva a intentar.' });
      if (b === a) return a;
      if (b === null) return null;
    }
  }

  /* ---------- API ---------- */
  /* Abre el acceso de maestro. Devuelve true si quedó autorizado, false si canceló, 'reiniciado' si se borró el maestro. */
  async function acceso() {
    if (autorizado()) return true;
    if (!hayCripto()) { window.alert && 0; return 'sin-https'; }
    try {
      if (!configurado()) {
        const pin = await crear();
        if (pin === null) return false;
        await guardarPin(pin);
        hasta = Date.now() + VIGENCIA_MS;
        return true;
      }
      const r = await pedir({
        titulo: 'Acceso de maestro · 主数据权限', sub: 'Ingrese su PIN para cargar o actualizar el maestro.', olvido: true, bloqueable: true,
        validar: async (p) => {
          if (await comprobar(p)) return null;
          const n = registrarFallo(), rest = MAX_SIN_BLOQUEO - n;
          return rest > 0 ? `PIN incorrecto. Quedan ${rest} intentos antes del bloqueo.` : 'PIN incorrecto.';
        },
      });
      if (r === null) return false;
      if (r === '__OLVIDO__') {
        await borrarMaestro();
        const pin = await crear('Cree un PIN nuevo · 新密码');
        if (pin !== null) { await guardarPin(pin); hasta = Date.now() + VIGENCIA_MS; }
        return pin === null ? false : 'reiniciado';
      }
      LS.del(K.fallos); LS.del(K.hasta);
      hasta = Date.now() + VIGENCIA_MS;
      return true;
    } finally { ocultar(); }
  }

  /* Cambiar el PIN (requiere haber abierto el acceso). Devuelve true si se cambió. */
  async function cambiar() {
    try {
      const actual = await pedir({ titulo: 'PIN actual', sub: 'Escríbalo para continuar.', bloqueable: true,
        validar: async (p) => { if (await comprobar(p)) return null; registrarFallo(); return 'PIN incorrecto.'; } });
      if (actual === null) return false;
      const nuevo = await crear('PIN nuevo · 新密码');
      if (nuevo === null) return false;
      await guardarPin(nuevo);
      return true;
    } finally { ocultar(); }
  }

  global.Pin = { acceso, cambiar, cerrar, autorizado, configurado };
})(typeof window !== 'undefined' ? window : globalThis);

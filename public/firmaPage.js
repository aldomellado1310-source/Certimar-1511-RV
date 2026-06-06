// Lógica de la página de firma por link. Bit puro testeable + wiring del DOM.
function firmaFormListo(hasFirma, nombre, email) {
  var nombreOk = String(nombre || '').trim().length >= 3;
  var emailOk  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
  return !!hasFirma && nombreOk && emailOk;
}

// --- Wiring del navegador (no se ejecuta en node) ---
if (typeof window !== 'undefined') {
  window.firmaFormListo = firmaFormListo;

  window.initFirmaPage = function() {
    var params = new URLSearchParams(location.search);
    var NRO    = params.get('nro')   || '';
    var TOKEN  = params.get('token') || '';
    var hasFirma = false, drawing = false, canvas, ctx;
    var fns = firebase.app().functions('us-central1');

    function $(id) { return document.getElementById(id); }
    function checkForm() {
      $('btn-submit').disabled = !firmaFormListo(hasFirma, $('f-nombre').value, $('f-email').value);
    }

    function initCanvas() {
      canvas = $('firma-canvas');
      ctx = canvas.getContext('2d');
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
      canvas.height = 120 * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctx.strokeStyle = '#111827'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      function pos(e){ var r=canvas.getBoundingClientRect(); var s=e.touches?e.touches[0]:e; return {x:s.clientX-r.left,y:s.clientY-r.top}; }
      function start(e){ e.preventDefault(); drawing=true; var p=pos(e); ctx.beginPath(); ctx.moveTo(p.x,p.y); }
      function move(e){ e.preventDefault(); if(!drawing) return; var p=pos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); }
      function end(){ drawing=false; hasFirma=true; checkForm(); }
      canvas.addEventListener('mousedown',start); canvas.addEventListener('mousemove',move);
      canvas.addEventListener('mouseup',end);     canvas.addEventListener('mouseleave',end);
      canvas.addEventListener('touchstart',start,{passive:false});
      canvas.addEventListener('touchmove', move, {passive:false});
      canvas.addEventListener('touchend',  end);
    }

    window.clearFirma = function(){
      var dpr = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      hasFirma = false;
      checkForm();
    };
    window.checkFirmaForm = checkForm;

    window.enviarFirma = async function(){
      if (!hasFirma) return;
      var btn = $('btn-submit');
      btn.innerHTML = '<span class="spinner"></span>Enviando…'; btn.disabled = true;
      try {
        var res = await fns.httpsCallable('procesarFirmaCliente')({
          nro: NRO, token: TOKEN, firmaB64: canvas.toDataURL('image/png'),
          nombre: $('f-nombre').value.trim(), email: $('f-email').value.trim()
        });
        if (res.data && res.data.ok) { $('msg-ok').style.display='block'; btn.style.display='none'; }
        else throw new Error('Error al guardar');
      } catch(e) {
        $('msg-err').textContent = '❌ ' + (e.message || e); $('msg-err').style.display='block';
        btn.innerHTML = 'Reintentar'; btn.disabled = false;
      }
    };

    fns.httpsCallable('getRegistroParaFirma')({ nro: NRO, token: TOKEN })
      .then(function(res){
        $('loading').style.display='none';
        var d = res.data.data;
        $('f-nro').textContent=d.nroRegistro; $('f-fecha').textContent=d.fecha;
        $('f-centro').textContent=d.centroCultivo; $('f-nroCentro').textContent=d.nroCentro;
        $('f-titular').textContent=d.titular; $('f-acs').textContent=d.acs;
        $('f-obs').textContent=d.observaciones || '(Sin observaciones)';
        $('f-nombre').value=d.nombreResponsable || ''; $('f-email').value=d.emailResponsable || '';
        $('content').style.display='block'; initCanvas(); checkForm();
      })
      .catch(function(e){
        $('loading').innerHTML = '<p style="color:#991b1b;padding:20px;text-align:center">' +
          (e.message || 'No se pudo cargar el registro') + '</p>';
      });
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { firmaFormListo: firmaFormListo };
}

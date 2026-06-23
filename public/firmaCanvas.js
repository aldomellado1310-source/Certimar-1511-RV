// Cálculo de encaje "contain": escala (imgW × imgH) dentro de (boxW × boxH)
// preservando proporción y centrando. Devuelve dimensiones y offset de dibujo.
function firmaFitContain(imgW, imgH, boxW, boxH) {
  if (!imgW || !imgH) return { dw: boxW, dh: boxH, dx: 0, dy: 0 };
  var ratio = Math.min(boxW / imgW, boxH / imgH);
  var dw = imgW * ratio, dh = imgH * ratio;
  return { dw: dw, dh: dh, dx: (boxW - dw) / 2, dy: (boxH - dh) / 2 };
}

// Doble export: browser y node
if (typeof window !== 'undefined') { window.firmaFitContain = firmaFitContain; }
if (typeof module !== 'undefined' && module.exports) { module.exports = { firmaFitContain: firmaFitContain }; }

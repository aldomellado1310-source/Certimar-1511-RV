# CC condicional por tipo de certificación seleccionada

## Contexto

Al enviar el correo de Registro de Visita, `public/index.html` arma la copia (CC)
con una lista fija: `['operaciones@certimar.cl', 'eflores@certimar.cl']`. Esto
ocurre en 3 puntos idénticos:

1. `handleEnviarMail` (~línea 3745) — envío principal desde el formulario.
2. `handleCompletionEnviar` (~línea 5045) — envío desde el diálogo de completado
   post-guardado.
3. `admReenviarMail` (~línea 5453) — reenvío manual desde el panel admin.

Se requiere que la copia a `operaciones@certimar.cl` deje de ser incondicional
y pase a depender de qué certificación marcó el certificador en el checklist
de "Norma aplicable" (`r-cicE2`, `r-ca`, `r-vs`, `r-res1511`, `r-desinfeccion`).

## Regla de negocio

Dado el conjunto de certificaciones marcadas:

- **`1821-x`** = cualquiera de `1821-CIC E2`, `1821-CA`, `1821-VS`.
- **`1511`** = certificación `1511`.

| Marcado                  | CC certificación-dependiente                          |
|--------------------------|--------------------------------------------------------|
| `1821-x` + `1511`        | `informes@certimar.cl` y `operaciones@certimar.cl`     |
| Solo `1821-x`            | `informes@certimar.cl`                                  |
| Solo `1511`               | `operaciones@certimar.cl`                               |
| Ninguno de los dos (ej. solo DESINFECCIÓN) | Ambos, `informes@certimar.cl` y `operaciones@certimar.cl` (respaldo) |

`eflores@certimar.cl` se mantiene como CC fijo en todos los casos, sin cambios.

Si el destinatario principal (`to`) coincide con alguna de las direcciones de
copia, esa dirección se excluye de la lista de CC (comportamiento actual, se
conserva).

## Diseño técnico

### Convención del proyecto para lógica pura testeable

El proyecto ya separa lógica pura en archivos `public/*.js` dedicados
(`gmailAuth.js`, `pdfMail.js`, `metricsLog.js`, `firmaCanvas.js`), cada uno
con un guard al final para exportar a Node sin afectar el navegador:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { nombreFuncion: nombreFuncion };
}
```

y su correspondiente `test/<archivo>.test.js` que usa `node:assert` y se
ejecuta con `node test/<archivo>.test.js` (sin runner ni framework). Esta
feature sigue el mismo patrón en vez de dejar la lógica solo inline en
`index.html`.

### Nuevo archivo: `public/resolucionCC.js`

Incluye una copia local de la normalización de `resoluciones` (mismo
comportamiento que `buildResExt`, que sigue viviendo en `index.html` para
sus otros usos) y la función `getResolucionCCs`:

```js
// Normaliza 'resoluciones' (objeto de checkboxes u string de Firestore)
// a un string tipo "1821-CIC E2, 1511". Espejo de buildResExt() en index.html.
function _resolucionesAString(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  var arr = [];
  if (res.cicE2)        arr.push('1821-CIC E2');
  if (res.ca)           arr.push('1821-CA');
  if (res.vs)            arr.push('1821-VS');
  if (res.res1511)       arr.push('1511');
  if (res.desinfeccion)  arr.push('DESINFECCIÓN');
  return arr.join(', ');
}

// Dado el estado de 'resoluciones' marcadas, retorna los correos de
// copia (CC) que dependen del tipo de certificación seleccionada.
function getResolucionCCs(resoluciones) {
  var tokens = _resolucionesAString(resoluciones)
    .split(',')
    .map(function(s) { return s.trim(); })
    .filter(Boolean);
  var tiene1821 = tokens.some(function(t) { return t.indexOf('1821-') === 0; });
  var tiene1511 = tokens.indexOf('1511') !== -1;

  var emails = [];
  if (tiene1821) emails.push('informes@certimar.cl');
  if (tiene1511) emails.push('operaciones@certimar.cl');
  if (!tiene1821 && !tiene1511) {
    emails.push('informes@certimar.cl', 'operaciones@certimar.cl');
  }
  return emails;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getResolucionCCs: getResolucionCCs };
}
```

Se incluye en `index.html` junto a los demás scripts propios:

```html
<script src="resolucionCC.js?v=20260701"></script>
```

Nota: se duplica la normalización de `resoluciones` en vez de hacer que
`buildResExt` (inline en `index.html`) dependa de `resolucionCC.js`, o
viceversa, para no reordenar la carga de scripts existente ni tocar los
demás usos de `buildResExt`. Es una función pequeña (5 líneas) y de bajo
riesgo de divergencia; no amerita una abstracción compartida.

### Puntos de integración

En los 3 sitios, reemplazar:

```js
var fixedCCs = ['operaciones@certimar.cl', 'eflores@certimar.cl']
  .filter(function(c) { return c !== <destinatario>; });
```

por:

```js
var fixedCCs = ['eflores@certimar.cl'].concat(getResolucionCCs(datos.resoluciones))
  .filter(function(c) { return c !== <destinatario>; });
```

donde `<destinatario>` es la variable local ya usada en cada sitio
(`emailDest`, `email`, `dest` respectivamente). En los 3 casos `datos` ya
contiene `resoluciones` en el momento en que se construye `fixedCCs`:

- `handleEnviarMail` y `handleCompletionEnviar`: `datos = getDatos()`, que
  incluye `resoluciones` como objeto de checkboxes.
- `admReenviarMail`: `datos = Object.assign({}, r, {...})`, donde
  `r.resoluciones` es el string ya persistido en Firestore.

No se requiere deduplicar manualmente `informes@certimar.cl` /
`operaciones@certimar.cl` con `extraCC` (CC manual ingresado por el usuario)
porque ya existe una deduplicación vía `Set` donde aplica (`handleEnviarMail`,
`handleCompletionEnviar`). `admReenviarMail` no tiene campo de CC manual, por
lo que no aplica.

## Fuera de alcance

- No se modifica el CCO (`bcc`) existente.
- No se modifica la plantilla del cuerpo del correo.
- No se modifica el checklist de UI ni el guardado en Firestore del campo
  `resoluciones`.

## Testing

- **Automatizado:** `test/resolucionCC.test.js` (nuevo), siguiendo el patrón
  de `test/gmailAuth.test.js`. Cubre con `assert` los 4 casos de la tabla de
  reglas, tanto con `resoluciones` como objeto de checkboxes como con string
  de Firestore. Se ejecuta con `node test/resolucionCC.test.js`.
- **Manual:** los 3 puntos de integración (`handleEnviarMail`,
  `handleCompletionEnviar`, `admReenviarMail`) no tienen automatización en
  este proyecto (dependen del DOM, Firestore y Gmail API). Se verifican a
  mano probando el formulario real: marcar distintas combinaciones de
  checkboxes y revisar el CC resultante antes de enviar (o inspeccionar el
  `raw` armado por `buildRawEmail` en consola).

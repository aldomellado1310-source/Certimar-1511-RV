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

### Nueva función helper: `getResolucionCCs(resoluciones)`

Se agrega junto a `buildResExt` (`public/index.html:3628`), reutilizando su
misma normalización de entrada: `resoluciones` puede venir como objeto de
formulario (`{cicE2, ca, vs, res1511, desinfeccion}`) o como string ya
guardado en Firestore (`"1821-CIC E2, 1511"`).

```js
function getResolucionCCs(resoluciones) {
  var tokens = buildResExt(resoluciones)
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
```

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

No hay suite de tests automatizados para `public/index.html` en este
proyecto (es un archivo HTML/JS monolítico sin bundler). La verificación será
manual: probar los 4 casos de la tabla de reglas en el formulario real
(marcando distintas combinaciones de checkboxes y revisando el CC resultante
antes de enviar, o inspeccionando el `raw` armado por `buildRawEmail` en
consola).

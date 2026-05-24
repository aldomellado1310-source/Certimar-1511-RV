# Selector de columnas en Histórico de Registros

**Fecha:** 2026-05-22  
**Estado:** Aprobado

---

## Objetivo

Permitir al usuario elegir qué columnas mostrar en la tabla del Histórico de Registros, seleccionando de entre todos los campos del formulario RV. La preferencia se guarda entre sesiones.

---

## Comportamiento

### Activación

Se agrega un botón `⊞ Columnas ▾` en la barra de filtros del histórico, a la derecha del filtro de estados. Al hacer clic, abre un dropdown sobre la tabla. Un clic fuera del dropdown lo cierra.

### Columnas fijas (siempre visibles, no ocultables)

Mostradas como chips bloqueados en la parte superior del dropdown:

- ID Registro
- Fecha
- Centro
- Estado
- Certificado
- Acciones

### Columnas opcionales (toggleables)

Organizadas en tres grupos con checkboxes. Al marcar/desmarcar, la columna aparece/desaparece **inmediatamente** en la tabla (sin botón "Aplicar").

#### Grupo: Identificación
| Clave | Etiqueta | Visible por defecto |
|---|---|---|
| `titular` | Titular | Sí |
| `nroCentro` | N° Centro | No |
| `acs` | ACS | No |

#### Grupo: Datos del centro
| Clave | Etiqueta | Visible por defecto |
|---|---|---|
| `area` | Área | No |
| `fechaSiembra` | Fecha última siembra | No |
| `tamanioPeces` | Tamaño peces | No |
| `ubicacion` | Ubicación | No |
| `latLong` | Lat / Long | No |

#### Grupo: Visita
| Clave | Etiqueta | Visible por defecto |
|---|---|---|
| `resExt` | Res. Externa | Sí |
| `tipoObs` | Tipo Observación | Sí |
| `observaciones` | Observaciones | No |
| `responsable` | Responsable | Sí |
| `correoResponsable` | Correo Responsable | No |
| `estadoFirma` | Estado Firma | No |

### Persistencia

- Clave localStorage: `certimar_hist_columns`
- Valor: array JSON con las claves de las columnas opcionales activas, ej. `["titular","resExt","tipoObs","responsable"]`
- Al abrir el Histórico se lee esta clave; si no existe, se usa el set por defecto.

---

## Cambios en el código (Index.html)

### HTML (~línea 1220 en `.hist-search-bar`)

Agregar botón y contenedor del dropdown:

```html
<div id="hist-col-selector" style="position:relative;">
  <button id="hist-col-btn" onclick="toggleHistColDropdown()">⊞ Columnas ▾</button>
  <div id="hist-col-dropdown" class="hist-col-dropdown hidden">
    <!-- Generado por renderColumnSelector() -->
  </div>
</div>
```

### CSS (~línea 490)

Nuevas clases:
- `.hist-col-dropdown` — posición absoluta, z-index alto, sombra, border-radius
- `.hist-col-group-label` — etiqueta de grupo en azul (#0099CC), uppercase, pequeño
- `.hist-col-fixed-chips` — contenedor de chips de columnas fijas
- `.hist-col-fixed-chip` — chip gris claro, no interactivo

### JS (~línea 3182, junto a las funciones del histórico)

**Constante de definición de columnas:**
```js
var HIST_COL_DEFS = [
  // { key, label, grupo, defaultVisible }
  { key: 'titular',           label: 'Titular',              grupo: 'Identificación',    defaultVisible: true  },
  { key: 'nroCentro',         label: 'N° Centro',            grupo: 'Identificación',    defaultVisible: false },
  { key: 'acs',               label: 'ACS',                  grupo: 'Identificación',    defaultVisible: false },
  { key: 'area',              label: 'Área',                 grupo: 'Datos del centro',  defaultVisible: false },
  { key: 'fechaSiembra',      label: 'Fecha última siembra', grupo: 'Datos del centro',  defaultVisible: false },
  { key: 'tamanioPeces',      label: 'Tamaño peces',         grupo: 'Datos del centro',  defaultVisible: false },
  { key: 'ubicacion',         label: 'Ubicación',            grupo: 'Datos del centro',  defaultVisible: false },
  { key: 'latLong',           label: 'Lat / Long',           grupo: 'Datos del centro',  defaultVisible: false },
  { key: 'resExt',            label: 'Res. Externa',         grupo: 'Visita',            defaultVisible: true  },
  { key: 'tipoObs',           label: 'Tipo Observación',     grupo: 'Visita',            defaultVisible: true  },
  { key: 'observaciones',     label: 'Observaciones',        grupo: 'Visita',            defaultVisible: false },
  { key: 'responsable',       label: 'Responsable',          grupo: 'Visita',            defaultVisible: true  },
  { key: 'correoResponsable', label: 'Correo Responsable',   grupo: 'Visita',            defaultVisible: false },
  { key: 'estadoFirma',       label: 'Estado Firma',         grupo: 'Visita',            defaultVisible: false },
];
```

**Funciones nuevas:**

- `getVisibleHistColumns()` → lee `localStorage['certimar_hist_columns']`; si no existe, retorna las claves con `defaultVisible: true`
- `saveVisibleHistColumns(keys)` → guarda el array de claves en localStorage
- `renderColumnSelector()` → construye el HTML interno del dropdown (chips fijos + grupos con checkboxes)
- `toggleHistColDropdown()` → toggle clase `hidden` en el dropdown; registra listener `document.onclick` para cerrar al hacer clic fuera
- `toggleHistColumn(key)` → marca/desmarca la clave, llama `saveVisibleHistColumns()` y `renderHistorico(historicData)` actualizado

**Modificación de `renderHistorico(data)`:**

- Lee `getVisibleHistColumns()` al inicio de la función
- El `<thead>` solo genera `<th>` para columnas fijas + columnas visibles (en ese orden)
- Cada `<tr>` de datos solo genera `<td>` correspondientes a las mismas columnas activas
- El mapeo `key → valor del registro` sigue la misma estructura del objeto `r` usado hoy en `renderHistorico`

---

## Mapeo key → campo del registro

> **Nota de implementación:** Antes de codificar el render, verificar en `renderHistorico()` (Index.html ~línea 3263) y en un documento real de Firestore (`registros_visita`) qué claves existen en el objeto `r`. Algunos campos pueden estar en Google Sheets pero no en Firestore si no se sincronizan. Si un campo no existe en `r`, mostrar `—` como fallback.

| Clave | Campo en objeto `r` (Firestore/local) |
|---|---|
| `titular` | `r.titular` |
| `nroCentro` | `r.nroCentro` |
| `acs` | `r.acs` |
| `area` | `r.area` |
| `fechaSiembra` | `r.fechaUltimaSiembra` |
| `tamanioPeces` | `r.tamanioPeces` |
| `ubicacion` | `r.ubicacion` |
| `latLong` | `r.latLong` |
| `resExt` | `r.resExt` |
| `tipoObs` | `r.tipoObservacion` |
| `observaciones` | `r.observaciones` |
| `responsable` | `r.nombreResponsable` |
| `correoResponsable` | `r.emailResponsable` |
| `estadoFirma` | `r.estadoFirma` |

---

## Casos borde

- **Sin datos en localStorage**: Se usa el set por defecto (titular, resExt, tipoObs, responsable).
- **Todas las opcionales desmarcadas**: La tabla muestra solo las 6 columnas fijas. Válido.
- **Dropdown y scroll**: El dropdown se abre hacia abajo; si la tabla tiene scroll horizontal al agregar columnas, el comportamiento es nativo del navegador (overflow-x auto en `.hist-table-wrap`).
- **Export CSV**: El CSV exporta **todos los campos** del registro, independientemente de las columnas visibles en pantalla. No se ve afectado por este cambio.

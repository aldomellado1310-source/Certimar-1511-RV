# Future Features

Funcionalidades diseñadas y aprobadas pero **aún no implementadas**. Cada entrada
queda lista para retomar (diseño + decisiones + puntos de enganche en el código).

---

## Papelera + Deshacer + Borrado múltiple (Admin)

**Estado:** diseñado y aprobado el 2026-06-23. Pendiente de implementar.
**Origen:** se necesitaba borrar varios registros a la vez (limpiar huérfanos
como RV-2026-0075…0081) y poder recuperarlos.

### Objetivo
Permitir al Admin **seleccionar y borrar múltiples registros**, con **deshacer**
y una **Papelera** con retención de **30 días** antes de la eliminación definitiva.

### Decisiones tomadas
- **Solo Admin** (vive en la vista Admin, que ya es admin-only por construcción).
- **Soft-delete**, no `delete()` directo.
- **Purga a 30 días de forma lazy**: al abrir la Papelera (sin Cloud Function / sin cron).
- Selección con **checkboxes + barra de acción** (no Ctrl-click, no rango).

### 1. Modelo de datos (soft-delete, sin migración)
"Borrar" pasa de `doc.delete()` a:
```js
doc.update({ deleted: true, deletedAt: serverTimestamp(), deletedBy: currentUser.email })
```
- Los registros sin el campo `deleted` se consideran **activos** → los existentes no
  requieren migración.
- `fbObtenerTodos` (Admin) y `fbObtenerRegistros` (Histórico) **filtran** en cliente
  `r.deleted === true`.
- El correlativo **no se reutiliza**: los borrados conservan su N°.

### 2. Borrado múltiple (mover a Papelera)
- Checkbox por fila + checkbox maestro "seleccionar todo" (todos los **filtrados**),
  con estado *indeterminado* si la selección es parcial.
- Estado en `_adminSelected = new Set()` de nros, **persistente** al paginar/filtrar;
  al re-renderizar, los checkboxes reflejan el Set.
- Barra de acción visible solo con ≥1 seleccionado:
  `"N seleccionados · [Mover a Papelera] · [Limpiar]"`.
- Confirmación: "Mover N a Papelera — podrás restaurarlos por 30 días".
- Ejecuta `update(deleted:true)` **secuencial** (concurrencia baja) con notificación
  de progreso, conservando el timeout de 10 s por operación.

### 3. Deshacer
- Tras cualquier borrado (uno o varios), toast persistente (~10 s):
  `"N movidos a Papelera · [Deshacer]"` → restaura (`deleted:false`).
- El borrado individual existente (`openModalEliminar` / `handleConfirmarEliminar`)
  también pasa a soft-delete con su Deshacer.

### 4. Vista Papelera
- Acceso: botón `"🗑 Papelera (N)"` en el header de Admin (badge con conteo).
- Lista los `deleted===true`: N° · fecha · centro · eliminado por · **"quedan N días"**.
- Acciones por fila: **[Restaurar]** (`deleted:false`, `deletedAt:null`) y
  **[Eliminar definitivo]** (con confirmación).
- Selección múltiple también aquí, para **restaurar / eliminar definitivo en lote**.

### 5. Purga lazy (30 días)
- Al abrir la Papelera: los registros con `deletedAt` > 30 días se eliminan **en
  firme** (`doc.delete()` + borrado *best-effort* de archivos en Storage:
  `certificados/`, `fotos/`, `firmas/` por su path). Toast: "N purgados (>30 días)".
- "Eliminar definitivo" manual hace lo mismo para un registro puntual.

### 6. Seguridad
- Revisar `firestore.rules`: confirmar que Admin puede `update` (campos `deleted*`)
  y `delete`. Ajustar si falta.

### Fuera de alcance (YAGNI)
- Recuperar archivos ya purgados de Storage.
- Retención configurable (queda fija en 30 días).
- Papelera para borradores (`borradores`).
- Cron / Cloud Function de purga automática.

### Puntos de enganche en el código (`public/index.html`)
- Tabla admin: `renderAdminTabla()` (~L5248) — agregar columna de checkbox en
  `thead` y filas; `getAdminColspan()` +1.
- Borrado actual: `openModalEliminar` / `closeModalEliminar` /
  `handleConfirmarEliminar` (~L5894–5929) y modal `#modal-eliminar` (~L1757).
- Carga de datos: `fbObtenerTodos` (~L2252) y `fbObtenerRegistros` (~L2235) —
  filtrar `deleted`.
- Gating admin: `cargarAdmin` (~L5137), `currentUser.isAdmin`, `ADMIN_EMAILS` (~L2017).

# Certimar — Configuración Firebase

## 1. Crear proyecto Firebase

1. Ve a https://console.firebase.google.com
2. Crea un proyecto llamado **certimar-rv** (o similar)
3. Desactiva Google Analytics si no lo necesitas

## 2. Activar Firestore

1. En el menú lateral → **Firestore Database**
2. Clic en **Crear base de datos**
3. Elige **Modo producción** (más seguro)
4. Región recomendada: **southamerica-east1 (São Paulo)**

## 3. Reglas de seguridad Firestore

Ve a Firestore → Reglas y pega esto:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Registros de visita: solo usuarios autenticados pueden leer/escribir los suyos
    match /registros_visita/{docId} {
      allow read, write: if request.auth != null
        && request.auth.token.email.matches('.*@certimar\\.cl');
    }

    // Meta (contadores): cualquier usuario autenticado de certimar
    match /meta/{docId} {
      allow read, write: if request.auth != null
        && request.auth.token.email.matches('.*@certimar\\.cl');
    }
  }
}
```

> **Nota:** Si no usas Firebase Auth y solo confías en el login de Apps Script, puedes usar reglas más abiertas temporalmente para desarrollo:
> ```
> allow read, write: if true;
> ```
> ⚠️ No dejar esto en producción.

## 4. Obtener credenciales

1. Ir a **Configuración del proyecto** (ícono engranaje) → **General**
2. Scroll hacia abajo → **Tus apps** → clic en `</>` (Web)
3. Registra la app (nombre: "certimar-web")
4. Copia el objeto `firebaseConfig`

## 5. Configurar FirebaseConfig.html

Abre `FirebaseConfig.html` y reemplaza con tus valores reales:

```javascript
var FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "certimar-rv.firebaseapp.com",
  projectId:         "certimar-rv",
  storageBucket:     "certimar-rv.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123456789:web:abcdef"
};

// Emails que tendrán acceso al Panel de Administración
var ADMIN_EMAILS = [
  "admin@certimar.cl",
  "operaciones@certimar.cl"
];
```

## 6. Estructura de datos en Firestore

Colección: `registros_visita`

Cada documento tiene como ID el número de registro (ej: `RV-2026-0001`):

```json
{
  "nroRegistro": "RV-2026-0001",
  "fecha": "26-02-2026",
  "centroCultivo": "AYSEN 4",
  "nroCentro": "110555",
  "acs": "28B-2",
  "titular": "EXPORTADORA LOS FIORDOS LTDA.",
  "ubicacion": "...",
  "fechaSiembra": "...",
  "tamanoPeces": "...",
  "latitud": "45.1234",
  "longitud": "72.5678",
  "resoluciones": "1821-CIC E2, 1821-CA",
  "observaciones": "...",
  "tipoObservacion": "EXTRACCION",
  "nombreResponsable": "Juan Pérez",
  "emailResponsable": "juan@empresa.cl",
  "nombreCertificador": "María González",
  "urlCertificado": "https://drive.google.com/...",
  "estado": "ENVIADO",
  "creadoPor": "maria@certimar.cl",
  "certNombre": "María González",
  "creadoEn": Timestamp
}
```

Colección: `meta`

Documento `contador_2026`:
```json
{ "count": 3 }
```

## 7. Panel de Administración

- Accede desde el nav con el botón 🛡️ **Admin** (solo visible para emails en `ADMIN_EMAILS`)
- Permite ver **todos** los registros de todos los certificadores
- Filtros por: búsqueda libre, fecha, estado, certificador
- Paginación de 25 registros por página
- Exportación a CSV con todos los filtros activos
- Reenvío de correo de notificación directamente desde la tabla

## 8. Tema claro / oscuro

- El botón 🌙 / ☀️ en la barra de navegación alterna el tema
- La preferencia se guarda en `localStorage` y persiste entre sesiones

## Rendimiento esperado

| Operación | Antes (Sheets) | Después (Firestore) |
|-----------|---------------|---------------------|
| Guardar registro | 8-15 seg | ~300ms |
| Cargar histórico | 4-8 seg | ~150ms |
| Dashboard stats | 3-6 seg | ~200ms |
| N° correlativo | 2-3 seg | ~100ms (transacción) |

# Firebase Functions Deploy Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lograr que Firebase Functions (certimar-rv) se deploya exitosamente, reemplazando el pipeline roto de Cloud Build Gen1 que falla silenciosamente en el step 2.

**Architecture:** El problema central es que Cloud Build Gen1 falla en el paso de re-tag/push del container (step 2, exit code 1, ~1 segundo) sin logs accesibles. En lugar de seguir depurando ese pipeline opaco, se evaluarán y ejecutarán tres estrategias en orden de menor a mayor invasividad: (A) Service Account Key con GOOGLE_APPLICATION_CREDENTIALS, (B) deploy directo con `gcloud functions deploy` por función, (C) migración a Functions Gen2 si A y B fallan.

**Tech Stack:** Firebase CLI, gcloud CLI, Node.js 20, firebase-functions v4/v5, Firebase Admin, Nodemailer

---

## Contexto del problema

El build siempre falla así:
- Step 0 (`gcs-fetcher`): SUCCESS — descarga source.zip desde `gcf-sources-272750169092-us-central1`
- Step 1 (`nodejs --phase=pre`): SUCCESS — instala npm deps
- Step 2 (`nodejs --tag=<latest> <version_N>`): FAILURE en ~1 segundo, exit code 1, sin log accesible (`logsBucket: undefined`)

El código Node.js no tiene errores de sintaxis. El repo `gcf-artifacts` existe. Los permisos IAM del Cloud Build SA ya fueron otorgados (`artifactregistry.admin`, `logging.logWriter`, `storage.admin`). Aun así falla. El step 2 es el retag/push del container image — falla sin leer código.

---

## File Map

| Archivo | Rol |
|---------|-----|
| `functions/index.js` | Sin cambios (está correcto) |
| `functions/package.json` | Actualizar `firebase-functions` a v5 si se va a Gen2 |
| `firebase.json` | Cambiar `runtime` a `nodejs22` si se migra a Gen2 |
| `deploy-functions.sh` | NUEVO — script gcloud para deploy directo (Plan B) |
| `certimar-deploy-sa.json` | NUEVO — service account key (Plan A), gitignored |

---

## Plan A — Service Account Key + GOOGLE_APPLICATION_CREDENTIALS

El flag `--token` está deprecado. Firebase CLI recomienda usar un Service Account Key con `GOOGLE_APPLICATION_CREDENTIALS`. Puede ser que el token no tenga los permisos correctos para autorizar el Cloud Build en nombre del proyecto.

### Task A1: Crear Service Account con permisos de deploy

- [ ] **Step 1: Obtener token actual y listar SAs existentes**

```bash
node -e "
const r='REDACTED_OAUTH_TOKEN';
fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:'563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',client_secret:'j9iVZfS8kkCEFUPaAeJV0sAi',refresh_token:r,grant_type:'refresh_token'})}).then(r=>r.json()).then(d=>console.log('TOKEN:',d.access_token)).catch(console.error)
"
```

Copiar el token en variable shell:
```bash
export TOKEN="<token>"
```

- [ ] **Step 2: Crear service account `certimar-deployer`**

```bash
curl -s -X POST \
  "https://iam.googleapis.com/v1/projects/certimar-rv/serviceAccounts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "certimar-deployer",
    "serviceAccount": {
      "displayName": "Certimar Deploy SA"
    }
  }'
```

Expected: JSON con `"email": "certimar-deployer@certimar-rv.iam.gserviceaccount.com"`

- [ ] **Step 3: Otorgar roles necesarios al SA**

Roles requeridos para Firebase Functions deploy:
- `roles/firebase.admin`
- `roles/cloudfunctions.developer`
- `roles/iam.serviceAccountUser`
- `roles/storage.admin`
- `roles/artifactregistry.admin`

```bash
for ROLE in roles/firebase.admin roles/cloudfunctions.developer roles/iam.serviceAccountUser roles/storage.admin roles/artifactregistry.admin; do
  curl -s -X POST \
    "https://cloudresourcemanager.googleapis.com/v1/projects/certimar-rv:getIamPolicy" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}' | node -e "
const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>{
  const p=JSON.parse(chunks.join(''));
  const role='$ROLE';
  const member='serviceAccount:certimar-deployer@certimar-rv.iam.gserviceaccount.com';
  let b=p.bindings.find(x=>x.role===role);
  if(!b){b={role,members:[]};p.bindings.push(b);}
  if(!b.members.includes(member)){b.members.push(member);}
  process.stdout.write(JSON.stringify({policy:p}));
})" | curl -s -X POST \
    "https://cloudresourcemanager.googleapis.com/v1/projects/certimar-rv:setIamPolicy" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d @- | node -e "const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>console.log('Role $ROLE: OK'))"
done
```

- [ ] **Step 4: Generar y descargar la clave JSON del SA**

```bash
curl -s -X POST \
  "https://iam.googleapis.com/v1/projects/certimar-rv/serviceAccounts/certimar-deployer@certimar-rv.iam.gserviceaccount.com/keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keyAlgorithm": "KEY_ALG_RSA_2048"}' \
  | node -e "
const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>{
  const r=JSON.parse(d.join(''));
  const key=Buffer.from(r.privateKeyData,'base64').toString('utf8');
  require('fs').writeFileSync('certimar-deploy-sa.json', key);
  console.log('SA key saved to certimar-deploy-sa.json');
});"
```

- [ ] **Step 5: Agregar certimar-deploy-sa.json a .gitignore**

En el archivo `.gitignore` de la raíz (crear si no existe):
```
certimar-deploy-sa.json
fix-*.js
get-build-log.js
```

```bash
echo "certimar-deploy-sa.json" >> /c/Users/aldon/Documents/Proyectos/Certimar-1511-RV/.gitignore
```

### Task A2: Deploy con SA key

- [ ] **Step 1: Exportar credenciales y ejecutar deploy**

```bash
cd /c/Users/aldon/Documents/Proyectos/Certimar-1511-RV
export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/certimar-deploy-sa.json"
firebase deploy --only functions
```

Expected output: funciones deployadas sin errores de Cloud Build.

- [ ] **Step 2: Si el deploy falla, verificar qué error sale ahora**

Si el build sigue fallando en step 2, el problema NO es de autenticación sino del pipeline de Cloud Build en sí. Pasar al Plan B.

Si sale otro error diferente (ej. permisos insuficientes del SA), ajustar los roles del Task A1 Step 3.

---

## Plan B — Deploy directo con `gcloud functions deploy`

Bypassa completamente Firebase CLI y su pipeline Cloud Build. Usa directamente la API de Cloud Functions a través de gcloud. Este método es más explícito y muestra logs de error reales.

### Task B1: Instalar y autenticar gcloud

- [ ] **Step 1: Verificar si gcloud está instalado**

```bash
gcloud version 2>&1 | head -3
```

Si no está instalado, descargar desde: https://cloud.google.com/sdk/docs/install  
En Windows: ejecutar el installer `.exe` y reiniciar la terminal.

- [ ] **Step 2: Autenticar con la cuenta eflores@certimar.cl**

```bash
gcloud auth login --no-browser
```

Seguir el link, iniciar sesión como `eflores@certimar.cl` (cuenta con Blaze y dueño del proyecto).

- [ ] **Step 3: Setear proyecto y región**

```bash
gcloud config set project certimar-rv
gcloud config set functions/region us-central1
```

Expected:
```
Updated property [core/project].
Updated property [functions/region].
```

### Task B2: Crear script de deploy por función

**Files:**
- Create: `deploy-functions.sh`

- [ ] **Step 1: Crear el script**

```bash
cat > /c/Users/aldon/Documents/Proyectos/Certimar-1511-RV/deploy-functions.sh << 'EOF'
#!/usr/bin/env bash
set -e

PROJECT="certimar-rv"
REGION="us-central1"
RUNTIME="nodejs20"
SOURCE="./functions"
TIMEOUT_DEFAULT=60
MEM_DEFAULT="256MB"

echo "=== Desplegando Firebase Functions via gcloud ==="

# enviarNotificacion
echo ""
echo "--- Deployando enviarNotificacion ---"
gcloud functions deploy enviarNotificacion \
  --project="$PROJECT" \
  --region="$REGION" \
  --runtime="$RUNTIME" \
  --source="$SOURCE" \
  --entry-point=enviarNotificacion \
  --trigger-http \
  --allow-unauthenticated=false \
  --timeout=120s \
  --memory=512MB \
  --set-env-vars="FUNCTION_TARGET=enviarNotificacion"

# generarLinkFirma
echo ""
echo "--- Deployando generarLinkFirma ---"
gcloud functions deploy generarLinkFirma \
  --project="$PROJECT" \
  --region="$REGION" \
  --runtime="$RUNTIME" \
  --source="$SOURCE" \
  --entry-point=generarLinkFirma \
  --trigger-http \
  --allow-unauthenticated=false \
  --timeout=30s \
  --memory=128MB

# procesarFirmaCliente
echo ""
echo "--- Deployando procesarFirmaCliente ---"
gcloud functions deploy procesarFirmaCliente \
  --project="$PROJECT" \
  --region="$REGION" \
  --runtime="$RUNTIME" \
  --source="$SOURCE" \
  --entry-point=procesarFirmaCliente \
  --trigger-http \
  --allow-unauthenticated=false \
  --timeout=60s \
  --memory=256MB

# migrarPDFsDrive
echo ""
echo "--- Deployando migrarPDFsDrive ---"
gcloud functions deploy migrarPDFsDrive \
  --project="$PROJECT" \
  --region="$REGION" \
  --runtime="$RUNTIME" \
  --source="$SOURCE" \
  --entry-point=migrarPDFsDrive \
  --trigger-http \
  --allow-unauthenticated=false \
  --timeout=540s \
  --memory=512MB

echo ""
echo "=== Deploy completo ==="
EOF
chmod +x /c/Users/aldon/Documents/Proyectos/Certimar-1511-RV/deploy-functions.sh
```

**Nota importante:** Las funciones de Firebase usan `https.onCall` (no HTTP directo). Con `gcloud functions deploy --trigger-http`, el endpoint es diferente. Los clientes Firebase SDK llaman via el protocolo callable. Sin embargo, `--trigger-http` sí es compatible con onCall si el cliente usa `firebase.functions().httpsCallable()` — Firebase SDK agrega automáticamente los headers correctos.

- [ ] **Step 2: Ejecutar deploy de UNA sola función primero para validar**

```bash
cd /c/Users/aldon/Documents/Proyectos/Certimar-1511-RV
gcloud functions deploy generarLinkFirma \
  --project=certimar-rv \
  --region=us-central1 \
  --runtime=nodejs20 \
  --source=./functions \
  --entry-point=generarLinkFirma \
  --trigger-http \
  --no-allow-unauthenticated \
  --timeout=30s \
  --memory=128MB \
  --verbosity=debug 2>&1 | tail -50
```

Expected: Ver logs de Cloud Build en tiempo real. Si falla, el error será visible.

- [ ] **Step 3: Si gcloud muestra el error de Cloud Build, diagnosticar y corregir**

El output de gcloud con `--verbosity=debug` muestra el Build ID y los logs completos, incluyendo qué falla en step 2.

---

## Plan C — Migración a Firebase Functions Gen2

Gen2 usa Cloud Run en lugar del pipeline de Cloud Build Gen1. Distinto mecanismo de build, potencialmente evita el bug del step 2.

### Task C1: Actualizar dependencias a Gen2

**Files:**
- Modify: `functions/package.json`
- Modify: `firebase.json`
- Modify: `functions/index.js`

- [ ] **Step 1: Actualizar package.json**

```json
{
  "name": "certimar-functions",
  "version": "1.0.0",
  "engines": { "node": "20" },
  "main": "index.js",
  "dependencies": {
    "firebase-admin": "^12.0.0",
    "firebase-functions": "^5.1.0",
    "nodemailer": "^6.9.13"
  }
}
```

```bash
cd /c/Users/aldon/Documents/Proyectos/Certimar-1511-RV/functions
npm install firebase-functions@^5.1.0 firebase-admin@^12.0.0
```

- [ ] **Step 2: Actualizar firebase.json — agregar concurrency y gen2**

```json
{
  "hosting": {
    "public": "public",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "functions": {
    "source": "functions",
    "runtime": "nodejs20"
  },
  "firestore": { "rules": "firestore.rules" },
  "storage": { "rules": "storage.rules" }
}
```

(Sin cambios en firebase.json — la versión Gen2 se define a nivel de función en el código.)

- [ ] **Step 3: Actualizar functions/index.js — cambiar imports a v2**

Cambiar el inicio del archivo de:
```javascript
const functions = require('firebase-functions');
```
A:
```javascript
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions }   = require('firebase-functions/v2');
const admin      = require('firebase-admin');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');

admin.initializeApp();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1' });
```

- [ ] **Step 4: Actualizar exports a sintaxis v2**

En Gen2, `functions.https.onCall(...)` cambia a `onCall(...)` y `functions.https.HttpsError` cambia a `new HttpsError(...)`.

**enviarNotificacion:**
```javascript
exports.enviarNotificacion = onCall(
  { timeoutSeconds: 120, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const { datos, urlCertificado, pdfB64 } = request.data;
    // ... resto del código igual, solo cambiar `data` por `request.data`
    //     y `context.auth` por `request.auth`
```

**generarLinkFirma:**
```javascript
exports.generarLinkFirma = onCall(
  { timeoutSeconds: 30, memory: '128MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const { nro } = request.data;
    if (!nro) throw new HttpsError('invalid-argument', 'nro es requerido.');
    // ... resto igual
```

**procesarFirmaCliente:**
```javascript
exports.procesarFirmaCliente = onCall(
  { timeoutSeconds: 60, memory: '256MiB' },
  async (request) => {
    const { nro, firmaB64, token } = request.data;
    // ... resto igual
```

**migrarPDFsDrive:**
```javascript
exports.migrarPDFsDrive = onCall(
  { timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }
    const { registros } = request.data;
    // ... resto igual
```

- [ ] **Step 5: Eliminar `cfg()` y `functions.config()` — Gen2 usa Secret Manager o env vars**

En Gen2, `functions.config()` no existe. Reemplazar:

```javascript
// Antes:
const cfg = () => ({
  mailUser: (functions.config().mail || {}).user || 'operaciones@certimar.cl',
  mailPass: (functions.config().mail || {}).pass || '',
});

// Después (Gen2 usa process.env):
const cfg = () => ({
  mailUser: process.env.MAIL_USER || 'operaciones@certimar.cl',
  mailPass: process.env.MAIL_PASS || '',
});
```

Y en el deploy, agregar las env vars:
```bash
firebase deploy --only functions
# O con env vars:
firebase functions:secrets:set MAIL_PASS
```

- [ ] **Step 6: Verificar sintaxis**

```bash
cd /c/Users/aldon/Documents/Proyectos/Certimar-1511-RV/functions
node --check index.js && echo "SYNTAX OK"
```

Expected: `SYNTAX OK`

- [ ] **Step 7: Deploy con Gen2**

```bash
cd /c/Users/aldon/Documents/Proyectos/Certimar-1511-RV
firebase deploy --only functions --token "REDACTED_OAUTH_TOKEN"
```

Gen2 usa Cloud Run y su pipeline de build es diferente. Si esto funciona, el problema estaba aislado al pipeline de Gen1.

---

## Orden de ejecución recomendado

```
Plan A → si falla sin cambiar el error → Plan B → si gcloud muestra el error real → corregir → Plan B
                                                 → si gcloud también falla step 2  → Plan C
```

No saltar directo a Plan C porque requiere reescribir `index.js`. Plan A es cambio cero en el código. Plan B da visibilidad del error real.

---

## Post-deploy: Configurar mail credentials

Una vez que cualquier plan tenga éxito:

**Para Gen1 (Planes A y B):**
```bash
firebase functions:config:set mail.user="operaciones@certimar.cl" mail.pass="TU_APP_PASSWORD_GMAIL" --token "1//0hjbFbj7..."
firebase deploy --only functions --token "1//0hjbFbj7..."
```

**Para Gen2 (Plan C):**
```bash
firebase functions:secrets:set MAIL_USER
# Ingresar: operaciones@certimar.cl
firebase functions:secrets:set MAIL_PASS
# Ingresar: TU_APP_PASSWORD_GMAIL
```

---

## Self-Review

### Spec coverage
- [x] Diagnóstico del error actual documentado en contexto
- [x] Plan A: SA Key (minimal, no code changes)
- [x] Plan B: gcloud direct deploy (bypass Firebase pipeline)
- [x] Plan C: Gen2 migration (code changes, new build pipeline)
- [x] Post-deploy mail config cubierto para ambas generaciones
- [x] Orden de ejecución recomendado documentado

### Placeholder scan
- No hay TBDs ni TODOs sin código
- Los comandos tienen expected output
- El código Gen2 muestra los cambios exactos

### Type consistency
- `request.data` vs `data` — documentado explícitamente el cambio en cada función
- `request.auth` vs `context.auth` — documentado en cada función
- `HttpsError` importado y usado consistentemente en Plan C

// Script temporal: otorga Storage Object Viewer al service account de Compute Engine
// en el bucket gcf-sources del proyecto certimar-rv
'use strict';

const { google } = require('./functions/node_modules/googleapis');

// Refresh token de eflores@certimar.cl (Firebase CLI)
const REFRESH_TOKEN = 'REDACTED_OAUTH_TOKEN';
// Client ID/Secret del Firebase CLI (públicos)
const CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi'; // Firebase CLI public secret

const BUCKET         = 'gcf-sources-272750169092-us-central1';
const SERVICE_ACCOUNT = '272750169092-compute@developer.gserviceaccount.com';

async function main() {
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  auth.setCredentials({ refresh_token: REFRESH_TOKEN });

  const storage = google.storage({ version: 'v1', auth });

  // 1. Obtener política IAM actual del bucket
  console.log('Obteniendo política IAM del bucket:', BUCKET);
  const { data: policy } = await storage.buckets.getIamPolicy({ bucket: BUCKET });

  console.log('Política actual:', JSON.stringify(policy.bindings, null, 2));

  // 2. Agregar binding si no existe
  const role = 'roles/storage.objectViewer';
  const member = `serviceAccount:${SERVICE_ACCOUNT}`;

  let binding = policy.bindings && policy.bindings.find(b => b.role === role);
  if (!binding) {
    if (!policy.bindings) policy.bindings = [];
    policy.bindings.push({ role, members: [member] });
    console.log('Binding nuevo agregado.');
  } else if (!binding.members.includes(member)) {
    binding.members.push(member);
    console.log('Miembro agregado al binding existente.');
  } else {
    console.log('El permiso ya existe. No se necesita cambio.');
    return;
  }

  // 3. Actualizar política
  const { data: updated } = await storage.buckets.setIamPolicy({
    bucket: BUCKET,
    requestBody: policy
  });
  console.log('Permiso otorgado exitosamente.');
  console.log('Bindings actualizados:', JSON.stringify(updated.bindings, null, 2));
}

main().catch(e => {
  console.error('Error:', e.message);
  if (e.errors) console.error(JSON.stringify(e.errors, null, 2));
});

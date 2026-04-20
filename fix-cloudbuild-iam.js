'use strict';
const CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const REFRESH_TOKEN = 'REDACTED_OAUTH_TOKEN';
const PROJECT_ID    = 'certimar-rv';
const PROJECT_NUM   = '272750169092';

async function getToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method : 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body   : new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token' })
  });
  const d = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(d));
  return d.access_token;
}

async function main() {
  const token = await getToken();
  console.log('Token OK');

  // Obtener política IAM del proyecto
  const iamUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:getIamPolicy`;
  const iamRes = await fetch(iamUrl, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  const policy = await iamRes.json();

  if (!iamRes.ok) { console.log('IAM error:', JSON.stringify(policy)); return; }

  // Mostrar bindings del Cloud Build SA
  const cbSA = `serviceAccount:${PROJECT_NUM}@cloudbuild.gserviceaccount.com`;
  console.log('\nRoles actuales del Cloud Build SA:');
  (policy.bindings || []).forEach(b => {
    if (b.members && b.members.includes(cbSA)) console.log(' -', b.role);
  });

  // Roles necesarios para Cloud Functions deploy
  const requiredRoles = [
    'roles/artifactregistry.admin',
    'roles/cloudbuild.builds.builder',
    'roles/logging.logWriter',
    'roles/storage.admin'
  ];

  let changed = false;
  for (const role of requiredRoles) {
    let binding = (policy.bindings || []).find(b => b.role === role);
    if (!binding) {
      if (!policy.bindings) policy.bindings = [];
      policy.bindings.push({ role, members: [cbSA] });
      console.log('Agregado:', role);
      changed = true;
    } else if (!binding.members.includes(cbSA)) {
      binding.members.push(cbSA);
      console.log('Miembro agregado a:', role);
      changed = true;
    } else {
      console.log('Ya existe:', role);
    }
  }

  if (!changed) { console.log('\nTodos los permisos ya existen.'); return; }

  // Actualizar política
  const setUrl = `https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:setIamPolicy`;
  const setRes = await fetch(setUrl, {
    method : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body   : JSON.stringify({ policy })
  });
  const result = await setRes.json();
  if (!setRes.ok) { console.log('Set IAM error:', JSON.stringify(result)); return; }
  console.log('\nPermisos actualizados exitosamente.');
}

main().catch(e => console.error('Error:', e.message));

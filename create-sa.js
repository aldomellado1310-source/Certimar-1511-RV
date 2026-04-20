'use strict';
const CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const REFRESH_TOKEN = 'REDACTED_OAUTH_TOKEN';
const PROJECT_ID    = 'certimar-rv';
const PROJECT_NUM   = '272750169092';
const SA_EMAIL      = `certimar-deployer@${PROJECT_ID}.iam.gserviceaccount.com`;

async function getToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token' })
  });
  const d = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(d));
  return d.access_token;
}

async function main() {
  const token = await getToken();
  console.log('Token OK');

  // 1. Crear SA
  const createRes = await fetch(`https://iam.googleapis.com/v1/projects/${PROJECT_ID}/serviceAccounts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId: 'certimar-deployer', serviceAccount: { displayName: 'Certimar Deploy SA' } })
  });
  const createData = await createRes.json();
  if (createRes.status === 409) {
    console.log('SA ya existe:', SA_EMAIL);
  } else if (!createRes.ok) {
    console.log('Error creando SA:', JSON.stringify(createData));
    return;
  } else {
    console.log('SA creado:', createData.email);
  }

  // 2. Otorgar roles en el proyecto
  const roles = [
    'roles/firebase.admin',
    'roles/cloudfunctions.developer',
    'roles/iam.serviceAccountUser',
    'roles/storage.admin',
    'roles/artifactregistry.admin',
    'roles/cloudbuild.builds.editor',
    'roles/logging.logWriter'
  ];

  const iamRes = await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:getIamPolicy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  const policy = await iamRes.json();
  if (!iamRes.ok) { console.log('IAM get error:', JSON.stringify(policy)); return; }

  const member = `serviceAccount:${SA_EMAIL}`;
  let changed = false;
  for (const role of roles) {
    let binding = (policy.bindings || []).find(b => b.role === role);
    if (!binding) {
      if (!policy.bindings) policy.bindings = [];
      policy.bindings.push({ role, members: [member] });
      changed = true;
    } else if (!binding.members.includes(member)) {
      binding.members.push(member);
      changed = true;
    }
    console.log(`Role ${role}: OK`);
  }

  if (changed) {
    const setRes = await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT_ID}:setIamPolicy`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy })
    });
    const setData = await setRes.json();
    if (!setRes.ok) { console.log('IAM set error:', JSON.stringify(setData)); return; }
    console.log('Roles otorgados exitosamente.');
  } else {
    console.log('Todos los roles ya estaban asignados.');
  }

  // 3. Crear key JSON
  const keyRes = await fetch(`https://iam.googleapis.com/v1/projects/${PROJECT_ID}/serviceAccounts/${SA_EMAIL}/keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyAlgorithm: 'KEY_ALG_RSA_2048' })
  });
  const keyData = await keyRes.json();
  if (!keyRes.ok) { console.log('Key error:', JSON.stringify(keyData)); return; }
  const keyJson = Buffer.from(keyData.privateKeyData, 'base64').toString('utf8');
  require('fs').writeFileSync('certimar-deploy-sa.json', keyJson);
  console.log('Key guardada en certimar-deploy-sa.json');
}

main().catch(e => console.error('Error:', e.message));

'use strict';
const CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const REFRESH_TOKEN = 'REDACTED_OAUTH_TOKEN';
const PROJECT_ID    = 'certimar-rv';
const REGION        = 'us-central1';

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

  // Listar repositorios existentes en AR
  const listUrl = `https://artifactregistry.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/repositories`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  const listData = await listRes.json();
  console.log('\nRepositorios AR existentes:');
  (listData.repositories || []).forEach(r => console.log(' -', r.name, '|', r.format));

  // Crear repositorio gcf-artifacts si no existe
  const repoName = 'gcf-artifacts';
  const exists = (listData.repositories || []).some(r => r.name.endsWith('/' + repoName));

  if (exists) {
    console.log(`\nRepositorio '${repoName}' ya existe.`);
  } else {
    console.log(`\nCreando repositorio '${repoName}'...`);
    const createUrl = `https://artifactregistry.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/repositories?repositoryId=${repoName}`;
    const createRes = await fetch(createUrl, {
      method : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body   : JSON.stringify({ format: 'DOCKER', description: 'Cloud Functions artifacts' })
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      console.log('Error creando repositorio:', JSON.stringify(createData));
    } else {
      console.log('Repositorio creado:', createData.name || 'OK (operación async)');
    }
  }
}

main().catch(e => console.error('Error:', e.message));

'use strict';
const CLIENT_ID     = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';
const REFRESH_TOKEN = 'REDACTED_OAUTH_TOKEN';
const PROJECT_ID    = 'certimar-rv';
const PROJECT_NUM   = '272750169092';
const REGION        = 'us-central1';
// Most recent build ID
const BUILD_ID = '1fdbd8da-d496-42c9-9a61-4128defd7e48';

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

  // Check build
  const buildRes = await fetch(`https://cloudbuild.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/builds/${BUILD_ID}`, { headers: { Authorization: `Bearer ${token}` } });
  const build = await buildRes.json();
  console.log('Build status:', build.status);
  console.log('LogsBucket:', build.logsBucket);
  console.log('Steps:', (build.steps||[]).map(s => `${s.name?.split('/').pop()} → ${s.status}`).join(', '));

  // Try known log bucket patterns
  const buckets = [
    `${PROJECT_NUM}.cloudbuild-logs.googleusercontent.com`,
    `${PROJECT_ID}_cloudbuild`,
    `gcf-sources-${PROJECT_NUM}-${REGION}`
  ];

  for (const bucket of buckets) {
    const url = `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(`log-${BUILD_ID}.txt`)}?alt=media`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      console.log(`\nLog found in: ${bucket}`);
      const log = await r.text();
      console.log(log.slice(-3000));
      return;
    } else {
      console.log(`Bucket ${bucket}: HTTP ${r.status}`);
    }
  }

  // List objects in any of those buckets
  for (const bucket of buckets) {
    const listUrl = `https://storage.googleapis.com/storage/v1/b/${bucket}/o?prefix=log-&maxResults=5`;
    const r = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const data = await r.json();
      console.log(`\nBucket ${bucket} objects:`, (data.items||[]).map(i=>i.name));
    }
  }
}

main().catch(e => console.error('Error:', e.message));

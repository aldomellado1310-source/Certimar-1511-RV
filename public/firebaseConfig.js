var FIREBASE_CONFIG = {
  apiKey           : 'AIzaSyBVKhR5iqXFCW7OQjH2bMvn2nfrh4PjXgQ',
  authDomain       : 'certimar-rv.firebaseapp.com',
  projectId        : 'certimar-rv',
  storageBucket    : 'certimar-rv.firebasestorage.app',
  messagingSenderId: '272750169092',
  appId            : '1:272750169092:web:14e734d16daaf3f070f951'
};

// OAuth Web Client ID del proyecto certimar-rv (Google Cloud Console -> APIs y servicios ->
// Credenciales). Lo usa gmailAuth.js para pedir el token de gmail.send vía GIS.
// IMPORTANTE: reemplazar el placeholder por el Client ID real antes de desplegar.
var GOOGLE_OAUTH_CLIENT_ID = '272750169092-av9vdjv73uqj3ckm02qi7j7vmjnvv5gb.apps.googleusercontent.com';

// Los roles se gestionan en Firestore: colección /usuarios, campo rol: 'admin' | 'supervisor' | 'user'


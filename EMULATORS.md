# Emuladores Firebase — pruebas locales sin tocar producción

Este flujo levanta Firestore, Functions, Hosting y Storage en tu máquina.
**Auth queda apuntando a Google real**, así que el login con `signInWithPopup`
funciona igual que en producción, y los OAuth de Gmail también van contra
Google de verdad (los correos sí se envían — usa una cuenta de prueba).

## Requisitos una sola vez

1. Java 11+ instalado (Firestore emulator lo necesita).
   ```bash
   java -version
   ```
2. Dependencias de Functions instaladas:
   ```bash
   cd functions && npm install && cd ..
   ```
3. `functions/.env` con `GMAIL_OAUTH_CLIENT_ID` y `GMAIL_OAUTH_CLIENT_SECRET`
   ya creados (ver `README` o la guía de OAuth).
4. En Google Cloud Console → OAuth Client ID añade (si no están):
   - Authorized JavaScript origins: `http://localhost:5000`
   - Authorized redirect URIs:      `http://localhost:5000/oauth-callback.html`

## Arrancar

```bash
firebase emulators:start
```

Endpoints útiles:

| Servicio        | URL                            |
|-----------------|--------------------------------|
| App             | http://localhost:5000          |
| Emulator UI     | http://localhost:4000          |
| Firestore UI    | http://localhost:4000/firestore|
| Functions logs  | http://localhost:4000/logs     |
| Storage UI      | http://localhost:4000/storage  |

Al abrir `http://localhost:5000` verás en consola del navegador:

```
[Firebase] MODO EMULADOR — Firestore:8080 / Storage:9199 / …
```

Eso confirma que la app está hablando con los emuladores y NO con producción.
Si no aparece, abriste por una URL que no es localhost.

## Persistir datos entre reinicios

Por defecto el emulator arranca vacío y se borra al apagar.

```bash
# Primera vez: exporta al detener
firebase emulators:start --export-on-exit=./.emulator-data

# Siguientes veces: importa al arrancar + exporta al detener
firebase emulators:start --import=./.emulator-data --export-on-exit
```

`.emulator-data/` está ignorado por git (añadirlo a `.gitignore` si no lo está).

## Flujo de prueba OAuth Gmail

1. Login con tu cuenta Google en `http://localhost:5000`.
2. Crear un registro → guardar → abrir modal de correo.
3. Banner amarillo "Gmail no conectado" → clic **Conectar Gmail**.
4. Popup Google → autoriza → popup se cierra → banner verde.
5. En Firestore UI (`http://localhost:4000/firestore`) ahora existe
   `users_gmail/{tu-uid}` con `email`, `refreshToken`, `scopes`.
6. Enviar correo de prueba a ti mismo → revisa logs en `localhost:4000/logs`
   buscando `[enviarNotificacion] paso 5/6 OK`.

## Apagar y reiniciar

`Ctrl+C` en la terminal. Si exportaste, los datos quedan en `.emulator-data/`.

## Volver a producción

No requiere ningún paso — abrir `https://certimar-rv.web.app` siempre habla
con producción. La auto-detección solo aplica en `localhost`.

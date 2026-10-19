# Talentra forms — Cloudflare

Receptor independiente de Docker para la landing. No se registra en Sites ni utiliza el Worker de la web personal. Mantiene registros y outbox en D1; Resend solo es transporte.

## Estado vigente · 20/10/2026

La configuración pasa a `WAITLIST_MODE=public`, `MAIL_ENABLED=true`, responsable **Jimena Rioja, responsable del proyecto Talentra**, contacto/destino **talentra.encuentratutalento@gmail.com**. La publicación y prueba final se registran en `talentra-app/candidate-portal/docs/qa/waitlist-e2e-20261019.md` del repositorio hermano; no confundir un dry-run con un despliegue.

La D1 de producción es **talentra-waitlist-production**, ID **02ec5430-4463-4249-b5ec-5fb3b5e1e992**, jurisdicción UE. El esquema se aplicó manualmente una vez y se comprobó contador0 antes de la prueba final. La D1 staging se conserva separada y ya no recibe altas del Worker.

El nombre/URL del Worker sigue siendo `talentra-forms-staging` por compatibilidad; ahora su binding `DB` apunta a producción. **No es un sandbox**: no ejecutar cargas, seeds, pruebas de borrado o migraciones iniciales remotas contra él. Secretos y cron cada cinco minutos se conservan. Turnstile Managed solo admite `solutions-with-ai.github.io`, sin localhost ni pre-clearance. Se conserva la observabilidad que ya estaba activada; no registrar payloads, cabeceras Authorization ni claves en código.

Pendiente del titular: identificación fiscal/domicilio y, si corresponden, datos registrales, así como revisión de garantías contractuales/transferencias. Se han dejado señalados; esta entrega no certifica conformidad legal ni ausencia de fallos. No considerar cerrada la preparación legal de una campaña hasta resolverlos.

Resultado técnico actual: **59 Worker/SQLite**, **273 backend**, **38 frontend** y build PASS. Cinco escenarios públicos simulados quedan solo en SQLite, sin correos externos. La fase staging sí verificó dos mensajes en el Gmail real. La prueba final de la URL publicada tiene su propio resultado en el informe, no se hereda automáticamente.

## Recursos y privacidad

- Cuenta comprobada: Talentra, `8032bfdb5a43d17d464a99edd12d60da`.
- D1 staging: `talentra-waitlist-staging`, `e80ebe86-3820-4f0c-ac56-47ee7507600f`, jurisdicción EU. Identificadores no secretos; no reutilizarlos en cuentas de otros clientes.
- El esquema está en `migrations/0001_waitlist.sql`. Si se aplicó manualmente por consola, no volver a aplicarlo con Wrangler sobre esa misma base. Inspeccionar las tablas antes de cualquier operación y crear migraciones nuevas para cambios posteriores; no reescribir una migración aplicada.
- La landing sigue en GitHub Pages. No comprar dominio ni activar un plan de pago para esta fase. Revisar cuotas Free y estado del proveedor antes de una campaña.
- No guarda IP sin transformar, geolocalización, User-Agent, referrer ni URLs de campaña completas. Los límites usan un hash ligado a un secreto y caducan. No hay CVs.
- Inscripciones: 180 días. Jobs terminales: 7 días; payload eliminado al aceptar envío o fallar definitivamente. La limpieza requiere el trigger programado. CSV ya descargados/correos recibidos se eliminan aparte. Al borrar una inscripción se cancelan exportaciones pendientes para evitar copias obsoletas; una entrega en curso devuelve409 y requiere volver a intentarlo.
- Modo test solo admite `@example.test`. Modo público exige además responsable/contacto configurados. Estas variables no sustituyen la revisión legal pendiente del titular.

## Pruebas reproducibles

Node >=22.13; `package-lock.json` fija el árbol. No instalar herramientas globales.

```bash
cd tools/cloudflare
npm ci --ignore-scripts
npm test
npm run test:integration
npm run deploy:check
npx wrangler d1 migrations apply DB --local
npx wrangler d1 execute DB --local --command "SELECT count(*) AS total FROM entries"
```

Los tests de integración ejecutan SQLite real con adaptador de la interfaz D1 y red simulada. No equivalen a E2E de Cloudflare/Resend. La migración `--local` valida adicionalmente el runtime workerd/D1 local. No añadir `--remote` a comandos de pruebas. En Docker utilizar Debian con `ca-certificates`; Alpine no ejecuta el binario glibc de workerd. No desactivar TLS.

## Configuración del Worker (no incluye valores secretos)

Variables: `WAITLIST_MODE`, `MAIL_ENABLED`, `ALLOWED_ORIGINS`, `ALLOWED_HOSTNAME`, `TURNSTILE_SITE_KEY`, `PRIVACY_NAME`, `PRIVACY_EMAIL`. El destino de correo es fijo: `talentra.encuentratutalento@gmail.com`.

Secrets separados: `RESEND_API_KEY` (la clave de envío creada por el titular), `TURNSTILE_SECRET`, `ADMIN_TOKEN` y `RATE_LIMIT_SECRET`. Los dos últimos deben ser valores distintos, aleatorios, de al menos32 caracteres, guardados privadamente. El titular introduce credenciales mediante la UI/terminal privado: no pegarlas en chat, HTML, `.env`, JSON de configuración, Git ni logs. No emitir ni copiar una clave en una captura.

Turnstile: acción `talentra_waitlist`, hostname exacto configurado; el servidor verifica success/hostname/action. El widget actual se promovió a producción retirando localhost. Cualquier futura prueba local debe usar credenciales oficiales de pruebas y SQLite/workerd locales, o un entorno staging separado aprobado, nunca debilitar este widget. Nunca exponer la secret key; la sitekey sí es pública. Caducidad/reuso requieren renovar el desafío.

La credencial `ADMIN_TOKEN` es exclusivamente servidor-servidor. Ninguna página está autorizada a leer registros con una clave pública. La app conserva su login y rol admin antes de llamar al Worker.

## Procedimiento de activación y recuperación

1. Validar código y tests. Crear solo recursos staging dentro de la cuenta correcta; registrar sus IDs reales.
2. Aplicar esquema una sola vez; verificar tablas y cero registros. Desplegar Worker con correo desactivado y sin enlace de landing.
3. Configurar bindings/variables. Ante una confirmación de permisos o nueva credencial, el titular confirma/introduce privadamente. No utilizar la cuenta profesional de otro proyecto.
4. Validar `/health`,403 de origen y401 en rutas administrativas sin clave. Después configurar Turnstile y secretos, sin activar datos públicos.
5. Para comprobar correo, `MAIL_ENABLED=true` solo tras configurar Resend correctamente. Un registro ficticio → una fila/job → aviso; exportación admin → CSV. Verificar Gmail/Spam y contenido, no solo HTTP200 o ID del proveedor. Desactivar si falla la aceptación.
6. La meta `talentra-waitlist-endpoint` de `landing/index.html` solo se rellena con la URL real tras la aceptación. No utilizar `no-cors`, simular éxito o enviar directamente a Resend desde el navegador.
7. Publicar la landing requiere commit/push a main y el workflow de GitHub Pages; la publicación aprobada se comprueba por HTTP y navegador. No se elude el hook corporativo. La rama y los commits quedan en el informe QA.

No trasladar `node_modules` de Linux a macOS: workerd/esbuild incluyen binarios por plataforma. Instalar con el lockfile en cada entorno; dependencias/cache y archivos .env/.dev.vars quedan excluidos de Git.

Resend de pruebas solo permite enviar al correo de su propia cuenta. La cuenta Talentra resuelve la primera prueba a ese buzón, no habilita remitentes Gmail arbitrarios ni otros destinatarios. El estado `sent` significa aceptación de Resend. Reintentos conservan una idempotency key por job y se detienen antes de24h; no existe garantía de entrega exactamente una vez.

## App y rollback

Ver `talentra-app/candidate-portal/docs/waitlist.md`. En modo cloudflare, las lecturas/exportaciones admin acceden a esta lista online; la ruta pública de la app enlaza al formulario canónico. La base local histórica no se importa ni se borra. No hay fallback silencioso de una lista a otra.

Rollback: retirar el endpoint público y desactivar `MAIL_ENABLED` sin borrar D1; volver al Compose base solo de API para consultar la lista local histórica, identificándolo como un cambio de fuente. No mezclar historiales ni reenviar trabajos previos. Una copia ya enviada por correo no se puede retirar desde la aplicación.

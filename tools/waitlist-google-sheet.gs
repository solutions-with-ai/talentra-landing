/**
 * Talentra · Recepción de la lista de espera en Google Sheets.
 *
 * Instalación (5 minutos):
 *  1. Crea una hoja de cálculo nueva en Google Drive (p. ej. "Talentra · Lista de espera").
 *  2. Menú Extensiones › Apps Script. Borra lo que haya y pega este archivo entero. Guarda.
 *  3. Botón Implementar › Nueva implementación › tipo "Aplicación web".
 *       - Ejecutar como: Yo
 *       - Quién tiene acceso: Cualquier usuario
 *     Autoriza los permisos que te pida.
 *  4. Copia la URL que termina en /exec y pégala en WAITLIST_ENDPOINT, en landing/waitlist.js.
 *
 * Cada solicitud se añade como una fila en la pestaña "Lista de espera" (se crea sola).
 * Si cambias este código, vuelve a Implementar › Gestionar implementaciones › editar › Nueva versión.
 */
const SHEET_NAME = "Lista de espera";
const FIELDS = [
  "fecha", "nombre", "email", "empresa", "cargo", "consentimiento",
  "fuente", "pagina", "referrer", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
];

function doPost(e) {
  const p = (e && e.parameter) || {};
  // The form validates this too; reject anything that skipped it
  if (!p.email || !p.nombre || p.consentimiento !== "si") return json({ ok: false, error: "invalid" });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(FIELDS);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow(FIELDS.map((f) => clean(p[f])));
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Keep cells short and stop values like "=HYPERLINK(...)" from running as formulas
function clean(v) {
  const s = String(v == null ? "" : v).slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

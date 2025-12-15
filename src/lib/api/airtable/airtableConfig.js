// src/api/airtable/airtableConfig.js
// Helper per creare un oggetto di configurazione Airtable coerente.
// Centralizza token, base/table IDs, timeout e parametri di retry.

/**
 * @typedef {Object} AirtableConfig
 * @property {string} token
 *  Token Airtable (PAT), obbligatorio.
 * @property {string} [baseId]
 *  ID della base Airtable (opzionale qui, ma spesso richiesto a livello di API).
 * @property {string} [tableIdOrName]
 *  ID o nome tabella Airtable (opzionale qui, ma spesso richiesto a livello di API).
 * @property {number} timeoutMs
 *  Timeout massimo per la richiesta HTTP in millisecondi.
 * @property {string} [userAgent]
 *  User-Agent personalizzato da inviare nelle richieste (opzionale).
 * @property {number} maxRetries
 *  Numero massimo di retry in caso di errori transienti (5xx, network, ecc.).
 * @property {number} baseDelayMs
 *  Delay iniziale (ms) per il backoff esponenziale.
 * @property {number} maxDelayMs
 *  Delay massimo (ms) per il backoff esponenziale.
 */

/**
 * Crea un oggetto di configurazione Airtable normalizzato.
 *
 * - Valida che `token` sia presente (obbligatorio).
 * - Applica valori di default ragionevoli per timeout e retry.
 *
 * @param {Object} params
 * @param {string} params.token
 * @param {string} [params.baseId]
 * @param {string} [params.tableIdOrName]
 * @param {number} [params.timeoutMs=10000]
 * @param {string} [params.userAgent]
 * @param {number} [params.maxRetries=3]
 * @param {number} [params.baseDelayMs=500]
 * @param {number} [params.maxDelayMs=5000]
 *
 * @returns {AirtableConfig}
 */
export function createAirtableConfig({
  token,
  baseId,
  tableIdOrName,
  timeoutMs = 10_000,
  userAgent,
  maxRetries = 3,
  baseDelayMs = 500,
  maxDelayMs = 5_000,
} = {}) {
  if (!token) {
    throw new Error("Airtable token is required to build config.");
  }

  return {
    token,
    baseId,
    tableIdOrName,
    timeoutMs,
    userAgent,
    maxRetries,
    baseDelayMs,
    maxDelayMs,
  };
}

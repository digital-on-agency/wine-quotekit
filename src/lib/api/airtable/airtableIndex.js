// src/api/airtable/airtableIndex.js
// Public surface for Airtable integration: re-exports low-level helpers
// and exposes a simple, env-driven entrypoint for common use cases.

export * from "./airtableApi.js";
export * from "./airtableErrors.js";
export * from "./airtableConfig.js";

import { listRecords } from "./airtableApi.js";
import dotenv from "dotenv";
dotenv.config();

import { logger } from "../../../lib/logger/index.js";

const { AIRTABLE_AUTH_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TAB_ID } = process.env;

/**
 * Fetches **all** records from a default Airtable table, automatically handling
 * Airtable pagination (`offset`) and returning a single aggregated result.
 *
 * This helper is optimized for a “default base/table” setup:
 * - Uses environment-configured values (`AIRTABLE_AUTH_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_TAB_ID`)
 * - Allows overrides via the second argument
 * - Logs progress per page and a final completion summary
 *
 * @param {Record<string, any>} [params={}]  
 * Airtable list/query parameters forwarded to `listRecords`, such as:
 * - `filterByFormula`
 * - `view`
 * - `fields[]`
 * - `sort[]`
 * - `pageSize` (defaults to 100 if not provided)
 *
 * @param {Object} [options={}]  
 * Optional overrides for the default Airtable configuration.
 *
 * @param {string} [options.authToken=AIRTABLE_AUTH_TOKEN]  
 * Airtable Personal Access Token (PAT) used for authentication.
 *
 * @param {string} [options.baseId=AIRTABLE_BASE_ID]  
 * The Airtable Base ID containing the default table.
 *
 * @param {string} [options.tableIdOrName=AIRTABLE_TAB_ID]  
 * The table ID or table name used as the default target.
 *
 * @returns {Promise<{ records: any[] }>}  
 * A promise that resolves to an object containing all fetched records:
 * `{ records: [...] }`.
 *
 * @throws {Error}  
 * Throws an error if any required configuration is missing:
 * - `AIRTABLE_AUTH_TOKEN` (or override)
 * - `AIRTABLE_BASE_ID` (or override)
 * - `AIRTABLE_TAB_ID` (or override)
 *
 * @usage
 * ```ts
 * const { records } = await fetchDefaultTableRecords(
 *   { filterByFormula: "{in_carta_vini}=TRUE()", pageSize: 100 },
 *   { baseId: "appXXXXXXXXXXXXXX", tableIdOrName: "Wines" }
 * );
 * ```
 *
 * @notes
 * - Pagination is handled by repeatedly calling `listRecords` until no `offset` is returned.
 * - Each page fetch is logged with counts and metadata for debugging/monitoring.
 * - The returned structure intentionally mirrors Airtable’s `{ records: [...] }` shape
 *   to remain compatible with existing code.
 */
export async function fetchDefaultTableRecords(
  params = {},
  {
    authToken = AIRTABLE_AUTH_TOKEN,
    baseId = AIRTABLE_BASE_ID,
    tableIdOrName = AIRTABLE_TAB_ID,
  } = {},
) {
  if (!authToken) {
    logger.error("AIRTABLE_AUTH_TOKEN (env or override) is required", {
      error: new Error("AIRTABLE_AUTH_TOKEN (env or override) is required"),
      location: "src/lib/api/airtable/airtableIndex.js:fetchDefaultTableRecords",
    });
    throw new Error("AIRTABLE_AUTH_TOKEN (env or override) is required");
  }
  if (!baseId) {
    logger.error("AIRTABLE_BASE_ID (env or override) is required", {
      error: new Error("AIRTABLE_BASE_ID (env or override) is required"),
      location: "src/lib/api/airtable/airtableIndex.js:fetchDefaultTableRecords",
    });
    throw new Error("AIRTABLE_BASE_ID (env or override) is required");
  }
  if (!tableIdOrName) {
    logger.error("AIRTABLE_TAB_ID (env or override) is required", {
      error: new Error("AIRTABLE_TAB_ID (env or override) is required"),
      location: "src/lib/api/airtable/airtableIndex.js:fetchDefaultTableRecords",
    });
    throw new Error("AIRTABLE_TAB_ID (env or override) is required");
  }

  // Accumula tutti i record attraverso la paginazione
  const allRecords = [];
  let offset = null;
  let pageCount = 0;

  do {
    // Prepara i parametri per questa richiesta
    const requestParams = { ...params };
    if (offset) {
      requestParams.offset = offset;
    }
    // Assicurati che pageSize sia impostato (default 100, max 100)
    if (!requestParams.pageSize) {
      requestParams.pageSize = 100;
    }

    const result = await listRecords({
      token: authToken,
      baseId,
      tableIdOrName,
      params: requestParams,
    });

    // Accumula i record di questa pagina
    allRecords.push(...(result.records || []));
    pageCount++;

    // Controlla se c'è un offset per la prossima pagina
    offset = result.offset || null;

  } while (offset);

  // Costruisci un risultato compatibile con la struttura originale
  const finalResult = {
    records: allRecords,
  };

  return finalResult;
}


// Permetti l'invocazione diretta del file da CLI per lanciare fetchDefaultTableRecords
if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1] === new URL(import.meta.url).href.replace("file://", "")) {
  fetchDefaultTableRecords()
    // .then(result => {
    //   // Mostra i risultati in forma compatta su stdout
    //   console.log(JSON.stringify(result, null, 2));
    //   console.error(`\nTotale record recuperati: ${result.records.length}`);
    // })
    .catch(err => {
      console.error("Errore in fetchDefaultTableRecords:", err);
      process.exit(1);
    });
}

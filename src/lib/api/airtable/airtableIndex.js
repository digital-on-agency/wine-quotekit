// src/api/airtable/airtableIndex.js
// Public surface for Airtable integration: re-exports low-level helpers
// and exposes a simple, env-driven entrypoint for common use cases.

export * from "./airtableApi.js";
export * from "./airtableErrors.js";
export * from "./airtableConfig.js";

import { listRecords, getRecord } from "./airtableApi.js";
import dotenv from "dotenv";
dotenv.config();

import { logger } from "../../../lib/logger/index.js";

const { AIRTABLE_AUTH_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_INV_TAB_ID, AIRTABLE_ENO_TAB_ID } = process.env;

/**
 * Fetches **all** records from a default Airtable table, automatically handling
 * Airtable pagination (`offset`) and returning a single aggregated result.
 *
 * This helper is optimized for a “default base/table” setup:
 * - Uses environment-configured values (`AIRTABLE_AUTH_TOKEN`, `AIRTABLE_BASE_ID`, `AIRTABLE_INV_  TAB_ID`)
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
 * @param {string} [options.tableIdOrName=AIRTABLE_INV_TAB_ID]  
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
 * - `AIRTABLE_INV_TAB_ID` (or override)
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
    tableIdOrName = AIRTABLE_INV_TAB_ID,
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
    logger.error("AIRTABLE_INV_TAB_ID (env or override) is required", {
      error: new Error("AIRTABLE_INV_TAB_ID (env or override) is required"),
      location: "src/lib/api/airtable/airtableIndex.js:fetchDefaultTableRecords",
    });
    throw new Error("AIRTABLE_INV_TAB_ID (env or override) is required");
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

/**
 * Trova il record ID dell'enoteca dalla tabella delle enoteche basandosi sul nome.
 * 
 * @param {string} enotecaName - Il nome dell'enoteca da cercare
 * @param {Object} [options={}]
 * @param {string} [options.authToken=AIRTABLE_AUTH_TOKEN]
 * @param {string} [options.baseId=AIRTABLE_BASE_ID]
 * @param {string} [options.enotecaTableId=AIRTABLE_ENO_TAB_ID]
 * @param {string} [options.nameField="Nome"] - Il nome del campo che contiene il nome dell'enoteca
 * 
 * @returns {Promise<string|null>} - Il record ID dell'enoteca o null se non trovata
 */
export async function findEnotecaRecordId(
  enotecaName,
  {
    authToken = AIRTABLE_AUTH_TOKEN,
    baseId = AIRTABLE_BASE_ID,
    enotecaTableId = AIRTABLE_ENO_TAB_ID,
    nameField = "Nome",
  } = {},
) {
  if (!enotecaName) {
    logger.warning("enotecaName is required for findEnotecaRecordId", {
      location: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
    });
    return null;
  }

  if (!authToken || !baseId || !enotecaTableId) {
    logger.error("Missing required configuration for findEnotecaRecordId", {
      location: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
      hasAuthToken: !!authToken,
      hasBaseId: !!baseId,
      hasEnotecaTableId: !!enotecaTableId,
    });
    throw new Error("Missing required configuration for findEnotecaRecordId");
  }

  try {
    // Cerca l'enoteca per nome usando filterByFormula
    // Escapa il nome per usarlo nella formula Airtable
    const escapedName = enotecaName.replace(/'/g, "''"); // Escape singoli apici per Airtable
    const filterFormula = `{${nameField}} = "${escapedName}"`;
    
    const result = await listRecords({
      token: authToken,
      baseId,
      tableIdOrName: enotecaTableId,
      // params: {
      //   filterByFormula: filterFormula,
      //   // maxRecords: 1, // Ci aspettiamo un solo risultato
      // },
    });

    // logger.info("Temp logging", {
    //   location: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
    //   result_number: result.records.length,
    //   result_record_keys: Object.keys(result.records[0]),
    //   result_id: result.records[0].id,
    //   result_name: result.records[0].fields.Nome,
    //   results: result,
    // })

    const res_list = result.records;
    
    for (const rec of res_list) {
      logger.info("comparing enoteca name to filter", {
        location: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
        currentName: rec.fields.Nome ? rec.fields.Nome : "NULL",
        compName: enotecaName
      });
      if (rec.fields.Nome === enotecaName) {
        return rec.id;
      }
    }

    return;

    if (result.records && result.records.length > 0) {
      const recordId = result.records[0].id;
      logger.info("Enoteca record ID found", {
        location: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
        enotecaName,
        recordId,
      });
      return recordId;
    }

    logger.warning("Enoteca not found", {
      location: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
      enotecaName,
      nameField,
    });
    return null;
  } catch (error) {
    logger.error("Error finding enoteca record ID", {
      location: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
      enotecaName,
      error: error.message,
    });
    throw error;
  }
}


// Permetti l'invocazione diretta del file da CLI per lanciare fetchDefaultTableRecords
if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1] === new URL(import.meta.url).href.replace("file://", "")) {
  fetchDefaultTableRecords()
    .catch(err => {
      console.error("Errore in fetchDefaultTableRecords:", err);
      process.exit(1);
    });
}

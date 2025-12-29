// src/api/airtable/airtableIndex.js
// Public surface for Airtable integration: re-exports low-level helpers
// and exposes a simple, env-driven entrypoint for common use cases.

export * from "./airtableApi.js";
export * from "./airtableErrors.js";
export * from "./airtableConfig.js";

import {
  listRecords,
  getRecord,
  uploadRecordWithAttachment,
} from "./airtableApi.js";
import dotenv from "dotenv";
dotenv.config();

import { logger } from "../../../lib/logger/index.js";

const {
  AIRTABLE_AUTH_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_INV_TAB_ID,
  AIRTABLE_ENO_TAB_ID,
} = process.env;

export async function fetchDefaultTableRecords(
  params = {},
  {
    authToken = AIRTABLE_AUTH_TOKEN,
    baseId = AIRTABLE_BASE_ID,
    tableIdOrName = AIRTABLE_INV_TAB_ID,
  } = {}
) {
  if (!authToken) {
    throw new Error({
      msg: "AIRTABLE_AUTH_TOKEN (env or override) is required",
      source: "src/lib/api/airtable/airtableIndex.js:fetchDefaultTableRecords",
      authToken: authToken,
    });
  }
  if (!baseId) {
    throw new Error({
      msg: "AIRTABLE_BASE_ID (env or override) is required",
      source: "src/lib/api/airtable/airtableIndex.js:fetchDefaultTableRecords",
      baseId: baseId,
    });
  }
  if (!tableIdOrName) {
    throw new Error({
      msg: "AIRTABLE_INV_TAB_ID (env or override) is required",
      source: "src/lib/api/airtable/airtableIndex.js:fetchDefaultTableRecords",
      tableIdOrName: tableIdOrName,
    });
  }

  // Accumula tutti i record attraverso la paginazione
  const allRecords = [];
  let offset = null;
  let pageCount = 0;

  try {
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
  } catch (error) {
    throw new Error({
      msg: "Error fetching default table records",
      source: "src/lib/api/airtable/airtableIndex.js:fetchDefaultTableRecords",
      error: error.message,
      status: error.status,
      statusText: error.statusText,
    });
  }

  // Costruisci un risultato compatibile con la struttura originale
  const finalResult = {
    records: allRecords,
  };

  return finalResult;
}
  
export async function findEnotecaRecordId(
  enotecaName,
  {
    authToken = AIRTABLE_AUTH_TOKEN,
    baseId = AIRTABLE_BASE_ID,
    enotecaTableId = AIRTABLE_ENO_TAB_ID,
    nameField = "Nome",
  } = {}
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

    const res_list = result.records;

    for (const rec of res_list) {
      if (rec.fields.Nome === enotecaName) {
        return rec.id;
      }
    }

    return;
  } catch (error) {
    logger.error("Error finding enoteca record ID", {
      location: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
      enotecaName,
      error: error.message,
    });
    throw error;
  }
}

/** Retrieves a single **Enoteca** record from Airtable by its record ID.
 *
 * This function acts as a thin, safe wrapper around the Airtable `getRecord`
 * API, providing default configuration values and centralized error logging.
 *
 * @param {string} enotecaRecordId
 * The Airtable record ID of the enoteca to retrieve.
 *
 * @param {Object} [options]
 * Optional configuration overrides.
 *
 * @param {string} [options.authToken]
 * Airtable API authentication token. Defaults to `AIRTABLE_AUTH_TOKEN`.
 *
 * @param {string} [options.baseId]
 * Airtable base ID. Defaults to `AIRTABLE_BASE_ID`.
 *
 * @param {string} [options.enotecaTableId]
 * Airtable table ID or name for the enoteca table.
 * Defaults to `AIRTABLE_ENO_TAB_ID`.
 *
 * @returns {Promise<Object>}
 * A promise that resolves to the Airtable record representing the enoteca.
 *
 * @throws {Error}
 * Rethrows any error encountered during the Airtable request after logging it.
 *
 * @notes
 * - Errors are logged with contextual metadata to aid debugging.
 * - This function does not perform data normalization or validation.
 * - Intended for internal data-fetching layers (not UI-facing).
 */
export async function getEnotecaData(
  enotecaRecordId,
  {
    authToken = AIRTABLE_AUTH_TOKEN,
    baseId = AIRTABLE_BASE_ID,
    enotecaTableId = AIRTABLE_ENO_TAB_ID,
  } = {}
) {
  try {
    const enotecaData = await getRecord({
      token: authToken,
      baseId,
      tableIdOrName: enotecaTableId,
      recordId: enotecaRecordId,
    });

    return enotecaData;
  } catch (error) {
    logger.error("Error getting enoteca data", {
      location: "src/lib/api/airtable/airtableIndex.js:getEnotecaData",
      enotecaRecordId,
      error: error.message,
    });
    throw error;
  }
}

/** Retrieves **Enoteca** data from Airtable by its record ID.
 *
 * This function is a thin wrapper around `getRecord` that:
 * - Fetches a single Enoteca record using its Airtable `recordId`
 * - Applies default configuration from environment variables when not provided
 * - Logs and rethrows errors with contextual information
 *
 * @param {string} enotecaId
 * The Airtable record ID of the Enoteca to retrieve.
 *
 * @param {object} [options]
 * Optional configuration overrides.
 *
 * @param {string} [options.authToken=AIRTABLE_AUTH_TOKEN]
 * Airtable Personal Access Token used for authentication.
 *
 * @param {string} [options.baseId=AIRTABLE_BASE_ID]
 * Airtable Base ID containing the Enoteca table.
 *
 * @param {string} [options.enotecaTableId=AIRTABLE_ENO_TAB_ID]
 * Airtable table ID or name for the Enoteca table.
 *
 * @returns {Promise<object>}
 * A promise that resolves to the raw Airtable record object for the Enoteca.
 *
 * @throws {Error}
 * Throws if the Airtable request fails or if required configuration is missing.
 *
 * @usage
 * ```js
 * const enoteca = await getEnotecaDataById("recXXXXXXXXXXXX");
 * ```
 *
 * @notes
 * - This function assumes the caller already knows the Enoteca record ID.
 * - Errors are logged with context (`enotecaId` and source location) before being rethrown.
 */
export async function getEnotecaDataById(
  enotecaId,
  {
    authToken = AIRTABLE_AUTH_TOKEN,
    baseId = AIRTABLE_BASE_ID,
    enotecaTableId = AIRTABLE_ENO_TAB_ID,
  } = {}
) {
  try {
    const enotecaData = await getRecord({
      token: authToken,
      baseId,
      tableIdOrName: enotecaTableId,
      recordId: enotecaId,
    });

    return enotecaData;
  } catch (error) {
    logger.error("Error getting enoteca data by id", {
      location: "src/lib/api/airtable/airtableIndex.js:getEnotecaDataById",
      enotecaId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Creates a **Wine List** record in Airtable and uploads the generated PDF as an attachment.
 *
 * This helper:
 * - Validates all required inputs (token/base/table/enoteca/date/attachment field/pdf path)
 * - Normalizes the provided `data` parameter into a valid date
 * - Builds the Airtable `fields` payload (title, linked Enoteca, ISO date)
 * - Delegates the actual create+upload flow to `uploadRecordWithAttachment`
 * - Logs success/failure with contextual metadata and rethrows on errors
 *
 * @param {string} token
 * Airtable Personal Access Token (PAT) used to authenticate the request.
 *
 * @param {string} baseId
 * Airtable Base ID where the wine list table lives.
 *
 * @param {string} tableIdOrName
 * Airtable table identifier (table ID or table name) where the wine list record is created.
 *
 * @param {string} enoteca_id
 * Airtable record ID of the Enoteca to link (must match Airtable link-field record IDs).
 *
 * @param {Date|string} data
 * The wine list date. Accepts a `Date` instance or a date string parseable by `new Date(...)`.
 * Used both for display (`DD-MM-YYYY`) and for Airtable storage (ISO 8601).
 *
 * @param {string} attachmentFieldIdOrName
 * Target attachment field (ID or name) where the PDF file should be uploaded.
 *
 * @param {string} pdfPath
 * Absolute or resolved filesystem path to the PDF file to upload.
 *
 * @param {string} [filename]
 * Optional filename override for the attachment (useful to enforce a stable naming convention).
 *
 * @returns {Promise<object>}
 * Resolves to the created Airtable record returned by `uploadRecordWithAttachment`
 * (typically including `id`, `fields`, and attachment metadata).
 *
 * @throws {Error}
 * Throws if:
 * - Any required parameter is missing/empty
 * - `data` cannot be parsed into a valid date
 * - The Airtable create/upload request fails
 *
 * @usage
 * ```js
 * const record = await loadWineListToAirtable(
 *   process.env.AIRTABLE_AUTH_TOKEN,
 *   process.env.AIRTABLE_BASE_ID,
 *   "Carta Vini",
 *   "recEnoteca123",
 *   new Date(),
 *   "PDF Carta dei Vini",
 *   "/abs/path/to/output.pdf",
 *   "2025-01-01_Carta-dei-Vini_MyEnoteca.pdf"
 * );
 * ```
 *
 * @notes
 * - The `"Enoteca"` field is treated as a link field and is sent as an array: `[enoteca_id]`.
 * - The `"Carta dei Vini"` title is generated as `"Carta dei Vini DD-MM-YYYY"`.
 * - The `"Data"` field is stored as ISO 8601 when a `Date` is acknowledges; otherwise the string is forwarded as-is.
 * - Attachment upload behavior depends on the implementation of `uploadRecordWithAttachment`.
 */
export async function loadWineListToAirtable(
  token,
  baseId,
  tableIdOrName,
  enoteca_id,
  data,
  attachmentFieldIdOrName,
  pdfPath,
  filename = undefined
) {
  // * 0. validate parameters
  // token
  if (token === undefined || token === null || token === "") {
    logger.error("token (auth token) is required for loadWineListToAirtable", {
      location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      token,
    });
    throw new Error(
      "token (auth token) is required for loadWineListToAirtable"
    );
  }
  // base id
  if (baseId === undefined || baseId === null || baseId === "") {
    logger.error("baseId is required for loadWineListToAirtable", {
      location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      baseId,
    });
    throw new Error("baseId is required for loadWineListToAirtable");
  }
  // table id or name
  if (
    tableIdOrName === undefined ||
    tableIdOrName === null ||
    tableIdOrName === ""
  ) {
    logger.error("tableIdOrName is required for loadWineListToAirtable", {
      location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      tableIdOrName,
    });
    throw new Error("tableIdOrName is required for loadWineListToAirtable");
  }
  // enoteca_id
  if (enoteca_id === undefined || enoteca_id === null || enoteca_id === "") {
    logger.error("enoteca_id is required for loadWineListToAirtable", {
      location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      enoteca_id,
    });
    throw new Error("enoteca_id is required for loadWineListToAirtable");
  }
  // data
  if (data === undefined || data === null || data === "") {
    logger.error("data is required for loadWineListToAirtable", {
      location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      data,
    });
    throw new Error("data is required for loadWineListToAirtable");
  }
  // attachment field id or name
  if (
    attachmentFieldIdOrName === undefined ||
    attachmentFieldIdOrName === null ||
    attachmentFieldIdOrName === ""
  ) {
    logger.error(
      "attachmentFieldIdOrName is required for loadWineListToAirtable",
      {
        location:
          "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
        attachmentFieldIdOrName,
      }
    );
    throw new Error(
      "attachmentFieldIdOrName is required for loadWineListToAirtable"
    );
  }
  // pdf path
  if (pdfPath === undefined || pdfPath === null || pdfPath === "") {
    logger.error("pdfPath is required for loadWineListToAirtable", {
      location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      pdfPath: pdfPath,
    });
    throw new Error("pdfPath is required for loadWineListToAirtable");
  }

  // TODO: remove after testing
  logger.info(
    " ####DEBUG#### loadWineListToAirtable parameters validation - Success",
    {
      location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      token,
      baseId,
      tableIdOrName,
      enoteca_id,
      data,
    }
  );

  // * 1. Prepare the date for "Carta dei Vini" field (DD-MM-YYYY format)
  // Parse the data parameter - it can be a Date object, ISO string, or formatted string
  let dateObj;
  if (data instanceof Date) {
    dateObj = data;
  } else if (typeof data === "string") {
    dateObj = new Date(data);
    if (isNaN(dateObj.getTime())) {
      throw new Error(`Invalid date format: ${data}`);
    }
  } else {
    throw new Error(`Invalid data type for data parameter: ${typeof data}`);
  }

  const day = String(dateObj.getDate()).padStart(2, "0");
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const year = dateObj.getFullYear();
  const dateDDMMYYYY = `${day}-${month}-${year}`;

  // TODO: remove after testing
  logger.info(" ####DEBUG#### dateDDMMYYYY", {
    location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
    dateDDMMYYYY,
  });

  // * 2. Prepare the fields payload
  // Format date for Airtable: use ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ), Airtable accepts ISO 8601 strings for date fields
  const airtableDate =
    data instanceof Date ? data.toISOString() : new Date(data).toISOString();

  // Note: "Carta dei Vini" is a computed/linked field that cannot be set directly, it will be populated automatically by Airtable based on the linked record
  const fields = {
    Enoteca: [enoteca_id], // Airtable link field expects an array of record IDs
    Data: airtableDate, // Use ISO 8601 format for Airtable date field
    // Note: "PDF Carta dei Vini" field will be populated by the attachment upload
    // Note: "Carta dei Vini" is a computed field and should not be included here
  };

  // TODO: remove after testing
  logger.info(" ####DEBUG#### fields || Enter uploadRecordWithAttachment", {
    location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
    fields: JSON.stringify(fields, null, 2),
  });

  // * 3. Call uploadRecordWithAttachment to create the record and upload the PDF

  try {
    const result = await uploadRecordWithAttachment({
      token,
      baseId,
      tableIdOrName,
      fields,
      attachmentFieldIdOrName,
      filePath: pdfPath,
      filename,
    });

    // TODO: remove after testing
    logger.info(" ####DEBUG#### result", {
      location: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      result: JSON.stringify(result, null, 2),
    });

    return result;
  } catch (error) {
    // Preserve the original error and add context
    const enhancedError = new Error(
      `Error uploading wine list to Airtable: ${
        error.message || error.originalMessage || "Unknown error"
      }`
    );
    enhancedError.cause = error;
    enhancedError.location =
      "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable";
    enhancedError.originalLocation = error.location || error.originalLocation;
    enhancedError.originalMessage = error.message || error.originalMessage;
    enhancedError.baseId = baseId;
    enhancedError.tableIdOrName = tableIdOrName;
    enhancedError.enoteca_id = enoteca_id;
    if (error.status) enhancedError.status = error.status;
    if (error.statusText) enhancedError.statusText = error.statusText;
    if (error.airtable) enhancedError.airtable = error.airtable;
    throw enhancedError;
  }
}

// Permetti l'invocazione diretta del file da CLI per lanciare fetchDefaultTableRecords
if (
  process.argv[1] === new URL(import.meta.url).pathname ||
  process.argv[1] === new URL(import.meta.url).href.replace("file://", "")
) {
  fetchDefaultTableRecords().catch((err) => {
    console.error("Errore in fetchDefaultTableRecords:", err);
    process.exit(1);
  });
}

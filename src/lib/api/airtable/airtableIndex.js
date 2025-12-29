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

/** Fetches **all records** from the default Airtable inventory table by iterating
 * through Airtable pagination (`offset`) until completion.
 *
 * This utility is a **high-level wrapper** around `listRecords()` that:
 * - Validates required Airtable configuration (token, baseId, table)
 * - Applies optional Airtable list parameters (e.g. `filterByFormula`, `view`, `sort`)
 * - Automatically paginates by using the `offset` cursor returned by Airtable
 * - Returns a single aggregated result containing all fetched records
 *
 * @param {object} [params={}]
 * Airtable "List records" query parameters to forward to `listRecords()`.
 * Typical keys include:
 * - `view` *(string)*: Airtable view name to query
 * - `filterByFormula` *(string)*: Airtable formula filter
 * - `sort` *(Array<{field: string, direction?: "asc"|"desc"}>)*: sorting rules
 * - `fields` *(string[])*: restrict returned fields
 * - `pageSize` *(number)*: page size (max **100**; defaults to **100** if omitted)
 *
 * @param {object} [overrides={}]
 * Optional configuration overrides to avoid relying on environment defaults.
 *
 * @param {string} [overrides.authToken=AIRTABLE_AUTH_TOKEN]
 * Airtable **Personal Access Token (PAT)** used to authenticate requests.
 *
 * @param {string} [overrides.baseId=AIRTABLE_BASE_ID]
 * Airtable Base ID containing the default table.
 *
 * @param {string} [overrides.tableIdOrName=AIRTABLE_INV_TAB_ID]
 * The Airtable table name or table ID to fetch records from.
 *
 * @returns {Promise<{records: Array<object>}>}
 * A promise that resolves to an object containing a flat `records` array with
 * all records fetched across all pages.
 *
 * @throws {Error}
 * Throws when:
 * - `authToken`, `baseId`, or `tableIdOrName` are missing
 * - Any underlying `listRecords()` call fails during pagination
 *
 * @usage
 * ```js
 * // Fetch everything from the default inventory table
 * const { records } = await fetchDefaultTableRecords();
 *
 * // Fetch filtered records (example: only items with Qty > 0)
 * const { records: inStock } = await fetchDefaultTableRecords({
 *   filterByFormula: "{Qty} > 0",
 *   view: "Grid view",
 * });
 *
 * console.log("Total records fetched:", records.length);
 * ```
 *
 * @notes
 * - The function enforces a default `pageSize` of **100** when not provided,
 *   which is Airtable’s maximum for list pagination.
 * - Pagination continues until Airtable stops returning an `offset` value.
 * - The variable `pageCount` is incremented per page for potential diagnostics,
 *   but it is not returned in the current implementation.
 */
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
    // TODO: remove after testing
    console.log("(fetchDefaultTableRecords) error: ", error);
    throw new Error({
      msg: "Error fetching default table records",
      source: "src/lib/api/airtable/airtableIndex.js:fetchDefaultTableRecords",
      error: error.message.toString(),
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

/** Finds the Airtable **record ID** of an *Enoteca* by matching its name.
 *
 * This function:
 * - Validates required inputs and Airtable configuration
 * - Queries the Enoteca table via `listRecords()`
 * - Searches the returned records for an exact name match
 * - Returns the matching record ID, or `null` when not found
 *
 * @param {string} enotecaName
 * The Enoteca name to match. Expected format: a non-empty *plain string*
 * (exact match, case-sensitive in the current implementation).
 *
 * @param {object} [options={}]
 * Optional configuration overrides.
 *
 * @param {string} [options.authToken=AIRTABLE_AUTH_TOKEN]
 * Airtable **Personal Access Token (PAT)** used for authentication.
 *
 * @param {string} [options.baseId=AIRTABLE_BASE_ID]
 * Airtable Base ID where the Enoteca table lives.
 *
 * @param {string} [options.enotecaTableId=AIRTABLE_ENO_TAB_ID]
 * Airtable table **ID or name** that contains Enoteca records.
 *
 * @param {string} [options.nameField="Nome"]
 * The field name that stores the Enoteca name.
 * *Note:* the current implementation still reads `rec.fields.Nome` directly.
 *
 * @returns {Promise<string|null>}
 * Resolves to:
 * - the Airtable record ID *(string)* if a record with `fields.Nome === enotecaName` is found
 * - `null` if no matching record is found
 *
 * @throws {Error}
 * Throws when:
 * - `enotecaName` is missing/empty
 * - Airtable config is missing (`authToken`, `baseId`, `enotecaTableId`)
 * - The underlying Airtable request fails
 *
 * @usage
 * ```js
 * const enotecaId = await findEnotecaRecordId("Enoteca Centrale");
 *
 * if (!enotecaId) {
 *   console.log("Enoteca not found.");
 * } else {
 *   console.log("Found record ID:", enotecaId);
 * }
 *
 * // With overrides
 * const enotecaId2 = await findEnotecaRecordId("Enoteca Centrale", {
 *   authToken: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   enotecaTableId: "tblYYYYYYYYYYYYYY",
 * });
 * ```
 *
 * @notes
 * - This implementation fetches *all* records and then filters in memory.
 *   For large tables, prefer using Airtable `filterByFormula` on `nameField`.
 * - Matching is currently **exact** and relies on `rec.fields.Nome`.
 *   If you want to honor `nameField`, replace that hardcoded access with
 *   `rec.fields?.[nameField]`.
 */
export async function findEnotecaRecordId(
  enotecaName,
  {
    authToken = AIRTABLE_AUTH_TOKEN,
    baseId = AIRTABLE_BASE_ID,
    enotecaTableId = AIRTABLE_ENO_TAB_ID,
    nameField = "Nome",
  } = {}
) {
  // * 0. validate parameters
  if (!enotecaName) {
    throw new Error({
      msg: "enotecaName is required for findEnotecaRecordId",
      source: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
      enotecaName: enotecaName,
    });
  }
  if (!authToken) {
    throw new Error({
      msg: "authToken is required for findEnotecaRecordId",
      source: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
      authToken: authToken,
    });
  }
  if (!baseId) {
    throw new Error({
      msg: "baseId is required for findEnotecaRecordId",
      source: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
      baseId: baseId,
    });
  }
  if (!enotecaTableId) {
    throw new Error({
      msg: "enotecaTableId is required for findEnotecaRecordId",
      source: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
      enotecaTableId: enotecaTableId,
    });
  }

  try {
    // * 1. search the enoteca by name using filterByFormula
    const result = await listRecords({
      token: authToken,
      baseId,
      tableIdOrName: enotecaTableId,
    });

    const res_list = result.records;

    for (const rec of res_list) {
      if (rec.fields.Nome === enotecaName) {
        return rec.id;
      }
    }

    return null;
  } catch (error) {
    throw new Error({
      msg: "Error finding enoteca record ID",
      source: "src/lib/api/airtable/airtableIndex.js:findEnotecaRecordId",
      enotecaName: enotecaName,
      error: error.message,
      status: error.status,
      statusText: error.statusText,
    });
  }
}

/** Retrieve **Enoteca** data from Airtable by record ID.
 *
 * This function:
 * - Validates all required parameters and Airtable configuration
 * - Fetches a single Enoteca record using its **record ID**
 * - Returns the full Airtable record object as provided by the API
 *
 * Parameters
 * ----------
 * `enotecaRecordId` : string
 *     Airtable **record ID** of the Enoteca to retrieve (e.g. `recXXXXXXXXXXXXXX`).
 *     This must be a valid, existing record ID.
 *
 * `options` : object, optional
 *     Optional configuration overrides.
 *
 * `options.authToken` : string, optional
 *     Airtable **Personal Access Token (PAT)**.
 *     Defaults to `AIRTABLE_AUTH_TOKEN`.
 *
 * `options.baseId` : string, optional
 *     Airtable **Base ID** containing the Enoteca table.
 *     Defaults to `AIRTABLE_BASE_ID`.
 *
 * `options.enotecaTableId` : string, optional
 *     Airtable **table ID or name** for the Enoteca table.
 *     Defaults to `AIRTABLE_ENO_TAB_ID`.
 *
 * Returns
 * -------
 * `object`
 *     The Airtable record object for the requested Enoteca, including:
 *     - `id`
 *     - `fields`
 *     - `createdTime`
 *
 * Raises
 * ------
 * `Error`
 *     If:
 *     - `enotecaRecordId` is missing or empty
 *     - Airtable configuration is missing (`authToken`, `baseId`, `enotecaTableId`)
 *     - The Airtable API request fails
 *
 * Usage
 * -----
 * ```js
 * const enoteca = await getEnotecaData("recABC123456789");
 *
 * console.log(enoteca.id);
 * console.log(enoteca.fields);
 *
 * // With custom configuration
 * const enotecaCustom = await getEnotecaData("recABC123456789", {
 *   authToken: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   enotecaTableId: "tblYYYYYYYYYYYYYY",
 * });
 * ```
 *
 * Notes
 * -----
 * - This function performs a **direct record fetch** (O(1)),
 *   unlike name-based searches that require scanning records.
 * - Prefer using this function when the record ID is already known
 *   (e.g. after `findEnotecaRecordId`).
 */
export async function getEnotecaData(
  enotecaRecordId,
  {
    authToken = AIRTABLE_AUTH_TOKEN,
    baseId = AIRTABLE_BASE_ID,
    enotecaTableId = AIRTABLE_ENO_TAB_ID,
  } = {}
) {
  // * 0. validate parameters
  if (!enotecaRecordId) {
    throw new Error({
      msg: "enotecaRecordId is required for getEnotecaData",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaData",
      enotecaRecordId: enotecaRecordId,
    });
  }
  if (!authToken) {
    throw new Error({
      msg: "authToken is required for getEnotecaData",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaData",
      authToken: authToken,
    });
  }
  if (!baseId) {
    throw new Error({
      msg: "baseId is required for getEnotecaData",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaData",
      baseId: baseId,
    });
  }
  if (!enotecaTableId) {
    throw new Error({
      msg: "enotecaTableId is required for getEnotecaData",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaData",
      enotecaTableId: enotecaTableId,
    });
  }

  // * 1. get the enoteca data by record id
  try {
    const enotecaData = await getRecord({
      token: authToken,
      baseId,
      tableIdOrName: enotecaTableId,
      recordId: enotecaRecordId,
    });

    return enotecaData;
  } catch (error) {
    throw new Error({
      msg: "Error getting enoteca data",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaData",
      enotecaRecordId: enotecaRecordId,
      error: error.message,
      status: error.status,
      statusText: error.statusText,
    });
  }
}

/** Retrieve **Enoteca** data from Airtable using a **record ID**.
 *
 * This function:
 * - Validates all required parameters and Airtable configuration
 * - Fetches a single Enoteca record by its **Airtable record ID**
 * - Returns the full Airtable record object
 *
 * Parameters
 * ----------
 * `enotecaId` : string
 *     The **Airtable record ID** of the Enoteca to retrieve
 *     (e.g. `"recXXXXXXXXXXXXXX"`).
 *
 * `options` : object, optional
 *     Optional configuration overrides.
 *
 * `options.authToken` : string, optional
 *     Airtable **Personal Access Token (PAT)**.
 *     Defaults to `AIRTABLE_AUTH_TOKEN`.
 *
 * `options.baseId` : string, optional
 *     Airtable **Base ID** containing the Enoteca table.
 *     Defaults to `AIRTABLE_BASE_ID`.
 *
 * `options.enotecaTableId` : string, optional
 *     Airtable **table ID or table name** for the Enoteca table.
 *     Defaults to `AIRTABLE_ENO_TAB_ID`.
 *
 * Returns
 * -------
 * `object`
 *     The Airtable record object, including:
 *     - `id` : string
 *     - `fields` : object
 *     - `createdTime` : string (ISO date)
 *
 * Raises
 * ------
 * `Error`
 *     Thrown when:
 *     - `enotecaId` is missing or empty
 *     - Airtable configuration is missing (`authToken`, `baseId`, `enotecaTableId`)
 *     - The Airtable API request fails
 *
 * Usage
 * -----
 * ```js
 * const enoteca = await getEnotecaDataById("recABC123456789");
 *
 * console.log(enoteca.id);
 * console.log(enoteca.fields);
 *
 * // With custom configuration
 * const enotecaCustom = await getEnotecaDataById("recABC123456789", {
 *   authToken: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   enotecaTableId: "tblYYYYYYYYYYYYYY",
 * });
 * ```
 *
 * Notes
 * -----
 * - This function performs a **direct record lookup** (O(1)).
 * - Prefer this method when the record ID is already known
 *   (e.g. after `findEnotecaRecordId`).
 * - No filtering or pagination is involved.
 */
export async function getEnotecaDataById(
  enotecaId,
  {
    authToken = AIRTABLE_AUTH_TOKEN,
    baseId = AIRTABLE_BASE_ID,
    enotecaTableId = AIRTABLE_ENO_TAB_ID,
  } = {}
) {
  // * 0. validate parameters
  if (!enotecaId) {
    throw new Error({
      msg: "enotecaId is required for getEnotecaDataById",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaDataById",
      enotecaId: enotecaId,
    });
  }
  if (!authToken) {
    throw new Error({
      msg: "authToken is required for getEnotecaDataById",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaDataById",
      authToken: authToken,
    });
  }
  if (!baseId) {
    throw new Error({
      msg: "baseId is required for getEnotecaDataById",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaDataById",
      baseId: baseId,
    });
  }
  if (!enotecaTableId) {
    throw new Error({
      msg: "enotecaTableId is required for getEnotecaDataById",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaDataById",
      enotecaTableId: enotecaTableId,
    });
  }

  // * 1. get the enoteca data by id
  try {
    const enotecaData = await getRecord({
      token: authToken,
      baseId,
      tableIdOrName: enotecaTableId,
      recordId: enotecaId,
    });

    return enotecaData;
  } catch (error) {
    throw new Error({
      msg: "Error getting enoteca data by id",
      source: "src/lib/api/airtable/airtableIndex.js:getEnotecaDataById",
      enotecaId: enotecaId,
      error: error.message,
      status: error.status,
      statusText: error.statusText,
    });
  }
}

/** Create a new **Wine List** record in Airtable and upload the generated PDF as an **attachment**.
 *
 * This function:
 * - Performs **strict parameter validation** for Airtable identifiers and inputs
 * - Normalizes the provided date into an **ISO 8601** string for Airtable date fields
 * - Builds the minimal `fields` payload (link to **Enoteca** + **Data**)
 * - Delegates record creation + attachment upload to `uploadRecordWithAttachment`
 *
 * @param {string} token
 * The Airtable **Personal Access Token (PAT)** used for authentication (format: `pat...`).
 *
 * @param {string} baseId
 * The Airtable **Base ID** where the target table is located (format: `app...`).
 *
 * @param {string} tableIdOrName
 * The Airtable **table ID** (format: `tbl...`) or **table name** where the Wine List record will be created.
 *
 * @param {string} enoteca_id
 * The Airtable **record ID** of the linked Enoteca (format: `rec...`).
 * This value is used to populate the linked-record field `Enoteca` as an array: `[enoteca_id]`.
 *
 * @param {Date|string} data
 * The date associated with the Wine List.
 * Expected formats:
 * - a **JavaScript `Date`** instance, or
 * - a date string parseable by `new Date(...)` (e.g. ISO 8601).
 *
 * @param {string} attachmentFieldIdOrName
 * The **attachment field** identifier where the PDF will be uploaded:
 * - recommended: Airtable **field ID** (format: `fld...`), or
 * - field name (string).
 *
 * @param {string} pdfPath
 * Local filesystem path (absolute or relative) or **URL** pointing to the PDF file to upload.
 *
 * @param {string} [filename]
 * Optional filename override for the uploaded attachment.
 * If omitted, it falls back to the basename of `pdfPath` (or URL path).
 *
 * @returns {Promise<object>}
 * A promise that resolves to the **updated Airtable record** after the attachment upload,
 * as returned by `uploadRecordWithAttachment` (typically including `id`, `fields`, and `createdTime`).
 *
 * @throws {Error}
 * Thrown when:
 * - Any required parameter is missing or empty (`token`, `baseId`, `tableIdOrName`, `enoteca_id`, `data`, `attachmentFieldIdOrName`, `pdfPath`)
 * - `data` is not a `Date` and cannot be parsed into a valid date
 * - Record creation or attachment upload fails (Airtable API errors, network errors, validation failures)
 *
 * @usage
 * ```js
 * const res = await loadWineListToAirtable(
 *   process.env.AIRTABLE_TOKEN,
 *   "appXXXXXXXXXXXXXX",
 *   "tblYYYYYYYYYYYYYY",
 *   "recENOTECA1234567",
 *   new Date(),
 *   "fldPDFATTACHMENT01",
 *   "/absolute/path/to/wine-list.pdf",
 *   "CartaVini_Belsit_2025-12-29.pdf"
 * );
 *
 * console.log(res.id);
 * console.log(res.fields);
 * ```
 *
 * @notes
 * - The function intentionally **does not** set `"Carta dei Vini"` because it is described as a **computed/linked** field.
 * - The `Data` field is always sent as **ISO 8601** (`toISOString()`), which Airtable accepts for date fields.
 * - For reliability, prefer passing the **field ID** (`fld...`) rather than a field name for `attachmentFieldIdOrName`.
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
    throw new Error({
      msg: "token (auth token) is required for loadWineListToAirtable",
      source: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      token: token,
    });
  }
  // base id
  if (baseId === undefined || baseId === null || baseId === "") {
    throw new Error({
      msg: "baseId is required for loadWineListToAirtable",
      source: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      baseId: baseId,
    });
  }
  // table id or name
  if (
    tableIdOrName === undefined ||
    tableIdOrName === null ||
    tableIdOrName === ""
  ) {
    throw new Error({
      msg: "tableIdOrName is required for loadWineListToAirtable",
      source: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      tableIdOrName: tableIdOrName,
    });
  }
  // enoteca_id
  if (enoteca_id === undefined || enoteca_id === null || enoteca_id === "") {
    throw new Error({
      msg: "enoteca_id is required for loadWineListToAirtable",
      source: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      enoteca_id: enoteca_id,
    });
  }
  // data
  if (data === undefined || data === null || data === "") {
    throw new Error({
      msg: "data is required for loadWineListToAirtable",
      source: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      data: data,
    });
  }
  // attachment field id or name
  if (
    attachmentFieldIdOrName === undefined ||
    attachmentFieldIdOrName === null ||
    attachmentFieldIdOrName === ""
  ) {
    throw new Error({
      msg: "attachmentFieldIdOrName is required for loadWineListToAirtable",
      source: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      attachmentFieldIdOrName: attachmentFieldIdOrName,
    });
  }
  // pdf path
  if (pdfPath === undefined || pdfPath === null || pdfPath === "") {
    throw new Error({
      msg: "pdfPath is required for loadWineListToAirtable",
      source: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      pdfPath: pdfPath,
    });
  }

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

    return result;
  } catch (error) {
    throw new Error({
      msg: "Error uploading wine list to Airtable",
      source: "src/lib/api/airtable/airtableIndex.js:loadWineListToAirtable",
      error: error.message,
      status: error.status,
      statusText: error.statusText,
      baseId: baseId,
      tableIdOrName: tableIdOrName,
      enoteca_id: enoteca_id,
      data: data,
      attachmentFieldIdOrName: attachmentFieldIdOrName,
      pdfPath: pdfPath,
      filename: filename,
    });
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

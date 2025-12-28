// src/api/airtable/airtableApi.js
// ESM - Node >= 18 (fetch nativo)

// # -------------------------- IMPORT DEPENDENCIES --------------------------

// environment variables
import dotenv from "dotenv";
// filesystem
import fs from "node:fs/promises";
// path
import path from "node:path";
// logger
import { logger } from "../../../lib/logger/index.js";

// # -------------------------- GLOBAL VARIABLES --------------------------

// load environment variables
dotenv.config();

// AIRTABLE_API_BASE: Airtable API base URL
const AIRTABLE_API_BASE = process.env.AIRTABLE_API_BASE || "https://api.airtable.com/v0";

// AIRTABLE_CONTENT_BASE: Airtable Content base URL
const AIRTABLE_CONTENT_BASE =
  process.env.AIRTABLE_CONTENT_BASE || "https://api.airtable.com/v0";

// AIRTABLE_WINE_LIST_TAB_ID: Airtable Wine List table ID (optional, used by other modules)
const AIRTABLE_WINE_LIST_TAB_ID = process.env.AIRTABLE_WINE_LIST_TAB_ID;

// # -------------------------- FUNCTIONS --------------------------

/** Infers the MIME content type based on a file's extension.
 *
 * This utility function extracts the file extension from the provided filename
 * and maps it to a corresponding MIME type using a predefined lookup table.
 * If the extension is not recognized, it falls back to
 * `application/octet-stream`.
 *
 * @param {string} filename
 * The name of the file (or full file path) whose MIME type needs to be inferred.
 * The function relies solely on the file extension, not on file contents.
 *
 * @returns {string}
 * A valid MIME type string corresponding to the file extension.
 * Returns `"application/octet-stream"` when the extension is unknown
 * or unsupported.
 *
 * @usage
 * ```ts
 * const mimeType = guessContentTypeFromFilename("document.pdf");
 * // mimeType === "application/pdf"
 *
 * const fallbackType = guessContentTypeFromFilename("archive.unknown");
 * // fallbackType === "application/octet-stream"
 * ```
 *
 * @notes
 * - Extension matching is case-insensitive.
 * - This function is suitable for upload handlers, HTTP headers,
 *   and API integrations that require a best-effort content type.
 * - It does **not** perform content sniffing or validation.
 */
function guessContentTypeFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/** Builds a fully qualified Airtable API URL by combining a base path with
 * optional query parameters.
 * Supports both scalar values and repeated query parameters (arrays),
 * as required by Airtable (e.g. `fields[]=Name&fields[]=Price`).
 *
 * @param {string} path
 * The API path to append to the Airtable base URL
 * (e.g. `"/appXXXXXXXX/TableName"`).
 *
 * @param {Record<string, string | number | Array<string | number> | null | undefined>} [query]
 * An optional object representing query parameters.
 * - `null` or `undefined` values are ignored
 * - Array values result in repeated query parameters
 *
 * @returns {string}
 * A fully constructed URL string including encoded query parameters.
 *
 * @usage
 * ```ts
 * const url = buildUrl("/app123/Wines", {
 *   filterByFormula: "{in_carta_vini}=TRUE()",
 *   "fields[]": ["Name", "Price"],
 * });
 * ```
 *
 * @notes
 * - Relies on the global `AIRTABLE_API_BASE` constant.
 * - Automatically handles URL encoding via the `URL` API.
 * - Designed as a low-level helper for Airtable fetch utilities.
 */
function buildUrl(path, query) {
  const url = new URL(`${AIRTABLE_API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;

      // Airtable supports repeating params (e.g., fields[]=A, fields[]=B)
      if (Array.isArray(value)) {
        for (const v of value) url.searchParams.append(key, String(v));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

/** Executes a generic HTTP request against the Airtable REST API.
 * This low-level helper centralizes authentication, URL building,
 * request execution, response parsing, and error normalization.
 *
 * It supports all HTTP methods, optional query parameters, and
 * optional JSON request bodies.
 *
 * @param {Object} params
 * @param {"GET" | "POST" | "PATCH" | "PUT" | "DELETE"} params.method  
 * The HTTP method to use for the Airtable request.
 *
 * @param {string} params.token  
 * The Airtable Personal Access Token (PAT) used for authentication.
 *
 * @param {string} params.path  
 * The Airtable API path (e.g. `"/appXXXXXXXX/TableName"` or
 * `"/appXXXXXXXX/TableName/recYYYYYYYY"`).
 *
 * @param {Record<string, any>} [params.query]  
 * Optional query parameters appended to the request URL.
 * Supports arrays for repeated parameters (handled by `buildUrl`).
 *
 * @param {object} [params.body]  
 * Optional request body. When provided, it is JSON-stringified and
 * sent with the appropriate `Content-Type` header.
 *
 * @returns {Promise<any>}  
 * A promise that resolves to the parsed JSON response returned by Airtable.
 *
 * @throws {Error}  
 * Throws a rich error object when:
 * - the API token or path is missing
 * - the HTTP response status is not OK  
 *
 * The thrown error is enriched with:
 * - `status` (HTTP status code)
 * - `statusText` (HTTP status text)
 * - `airtable` (parsed Airtable error payload, if available)
 * - `url` (final request URL)
 *
 * @usage
 * ```ts
 * const result = await airtableRequest({
 *   method: "GET",
 *   token: process.env.AIRTABLE_API_KEY,
 *   path: "/app123/Wines",
 *   query: { filterByFormula: "{in_carta_vini}=TRUE()" },
 * });
 * ```
 *
 * @notes
 * - Airtable returns JSON for both success and error responses;
 *   this function always attempts to parse the response body.
 * - Designed to be wrapped by higher-level Airtable helpers
 *   (e.g. fetchRecord, listRecords).
 */
async function airtableRequest({ method, token, path, query, body }) {
  if (!token) throw new Error("Airtable API token is required (PAT).");
  if (!path) throw new Error("Airtable API path is required.");

  const url = buildUrl(path, query);

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  // Airtable returns JSON for both success and errors
  let json = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // keep raw text if non-json (rare)
      json = { raw: text };
    }
  }

  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `Airtable request failed (${res.status} ${res.statusText})`;

    const err = new Error(msg);
    err.status = res.status;
    err.statusText = res.statusText;
    err.airtable = json;
    err.url = url;
    throw err;
  }

  return json;
}

/** Retrieves a single record from an Airtable base by its record ID.
 * This is a thin wrapper around `airtableRequest` that validates required
 * parameters and builds the correct Airtable API path.
 *
 * @param {Object} params
 * @param {string} params.token  
 * The Airtable Personal Access Token (PAT) used for authentication.
 *
 * @param {string} params.baseId  
 * The Airtable Base ID containing the target table.
 *
 * @param {string} params.tableIdOrName  
 * The table ID or human-readable table name.
 *
 * @param {string} params.recordId  
 * The unique Airtable record ID to fetch.
 *
 * @returns {Promise<any>}  
 * A promise that resolves to the raw Airtable record object returned by the API.
 *
 * @throws {Error}  
 * Throws an error if:
 * - `baseId`, `tableIdOrName`, or `recordId` are missing
 * - the underlying Airtable request fails
 *
 * @usage
 * ```ts
 * const record = await getRecord({
 *   token: process.env.AIRTABLE_API_KEY,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Clients",
 *   recordId: "recYYYYYYYYYYYYYY",
 * });
 *
 * console.log(record.fields);
 * ```
 *
 * @notes
 * - This function performs no data mapping or validation on the returned record.
 * - Intended to be used as a low-level fetch utility in higher-level services.
 */
export async function getRecord({ token, baseId, tableIdOrName, recordId, returnFieldsByFieldId = false }) {
  if (!baseId) throw new Error("baseId is required");
  if (!tableIdOrName) throw new Error("tableIdOrName is required");
  if (!recordId) throw new Error("recordId is required");

  const query = returnFieldsByFieldId ? { returnFieldsByFieldId: "true" } : undefined;


  const result = await airtableRequest({
    method: "GET",
    token,
    path: `/${baseId}/${tableIdOrName}/${recordId}`,
    query,
  });

  return result;
}

/** Retrieves a list of records from an Airtable table.
 * This function wraps `airtableRequest`, validating required parameters
 * and forwarding optional query parameters supported by the Airtable API
 * (filters, views, pagination, etc.).
 *
 * @param {Object} params
 * @param {string} params.token  
 * The Airtable Personal Access Token (PAT) used for authentication.
 *
 * @param {string} params.baseId  
 * The Airtable Base ID containing the target table.
 *
 * @param {string} params.tableIdOrName  
 * The table ID or human-readable table name.
 *
 * @param {Record<string, any>} [params.params={}]  
 * Optional Airtable query parameters, such as:
 * - `filterByFormula`
 * - `view`
 * - `pageSize`
 * - `offset`
 *
 * @returns {Promise<any>}  
 * A promise that resolves to the Airtable API response containing
 * an array of records and pagination metadata (if present).
 *
 * @throws {Error}  
 * Throws an error if:
 * - `baseId` or `tableIdOrName` is missing
 * - the underlying Airtable request fails
 *
 * @usage
 * ```ts
 * const result = await listRecords({
 *   token: process.env.AIRTABLE_API_KEY,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Wines",
 *   params: {
 *     filterByFormula: "{in_carta_vini}=TRUE()",
 *     pageSize: 100,
 *   },
 * });
 *
 * console.log(result.records);
 * ```
 *
 * @notes
 * - Pagination (`offset`) is supported but must be handled by the caller.
 * - No data normalization or mapping is applied to the returned records.
 * - Designed as a low-level utility for higher-level data services.
 */
export async function listRecords({
  token,
  baseId,
  tableIdOrName,
  params = {},
}) {
  if (!baseId) throw new Error("baseId is required");
  if (!tableIdOrName) throw new Error("tableIdOrName is required");

  // params examples:
  // { filterByFormula: "in_carta_vini=TRUE()", view: "Grid view", pageSize: 100, offset: "itr..." }
  return airtableRequest({
    method: "GET",
    token,
    path: `/${baseId}/${tableIdOrName}`,
    query: params,
  });
}

/** Creates one or more records in an Airtable table.
 * This function wraps the Airtable `POST /records` endpoint and enforces
 * schema, size, and parameter validation before issuing the request.
 *
 * Airtable limitations:
 * - A maximum of **10 records per request** is allowed.
 * - Each record must follow the `{ fields: { ... } }` structure.
 *
 * @param {Object} params
 * @param {string} params.token  
 * The Airtable Personal Access Token (PAT) used for authentication.
 *
 * @param {string} params.baseId  
 * The Airtable Base ID where the records will be created.
 *
 * @param {string} params.tableIdOrName  
 * The table ID or human-readable table name.
 *
 * @param {Array<{ fields: Record<string, any> }>} params.records  
 * An array of record objects to create.  
 * Each entry **must** contain a `fields` object matching the Airtable schema.
 * Maximum length: 10 records.
 *
 * @param {boolean} [params.typecast=false]  
 * When `true`, Airtable will attempt to coerce field values into compatible
 * types (e.g. strings to select options).
 *
 * @param {boolean} [params.returnFieldsByFieldId=false]  
 * When `true`, the response will return field values keyed by field ID
 * instead of field name.
 *
 * @returns {Promise<any>}  
 * A promise that resolves to the Airtable API response containing the
 * newly created records.
 *
 * @throws {Error}  
 * Throws an error if:
 * - `baseId` or `tableIdOrName` is missing
 * - `records` is not a non-empty array
 * - more than 10 records are provided
 * - any record does not follow the `{ fields: {...} }` schema
 * - the underlying Airtable request fails
 *
 * @usage
 * ```ts
 * await createRecords({
 *   token: process.env.AIRTABLE_API_KEY,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Clients",
 *   records: [
 *     { fields: { Name: "Mario Rossi", Email: "mario@example.com" } },
 *   ],
 *   typecast: true,
 * });
 * ```
 *
 * @notes
 * - This function performs **no field-level validation** against the Airtable schema.
 * - Pagination is not relevant for create operations.
 * - Intended to be used by higher-level domain services or workflows.
 */
export async function createRecords({
  token,
  baseId,
  tableIdOrName,
  records,
  typecast = false,
  returnFieldsByFieldId = false,
}) {
  if (!baseId) throw new Error("baseId is required");
  if (!tableIdOrName) throw new Error("tableIdOrName is required");
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("records must be a non-empty array");
  }
  if (records.length > 10) {
    throw new Error(
      `Airtable createRecords supports max 10 records per request. Received: ${records.length}`
    );
  }

  // Ensure each element matches Airtable schema: { fields: {...} }
  for (const [i, r] of records.entries()) {
    if (!r || typeof r !== "object") {
      throw new Error(`records[${i}] must be an object`);
    }
    if (!r.fields || typeof r.fields !== "object") {
      throw new Error(`records[${i}].fields must be an object`);
    }
  }

  return airtableRequest({
    method: "POST",
    token,
    path: `/${baseId}/${tableIdOrName}`,
    body: {
      records,
      typecast,
      returnFieldsByFieldId,
    },
  });
}

/** Creates a single record in an Airtable table.
 * This is a convenience wrapper around `createRecords`, abstracting
 * the batch API and returning only the newly created record.
 *
 * @param {Object} params
 * @param {string} params.token  
 * The Airtable Personal Access Token (PAT) used for authentication.
 *
 * @param {string} params.baseId  
 * The Airtable Base ID where the record will be created.
 *
 * @param {string} params.tableIdOrName  
 * The table ID or human-readable table name.
 *
 * @param {Record<string, any>} params.fields  
 * An object containing the field values for the new record.
 *
 * @param {boolean} [params.typecast=false]  
 * When `true`, Airtable will attempt to coerce field values into compatible
 * types (e.g. strings to select options).
 *
 * @param {boolean} [params.returnFieldsByFieldId=false]  
 * When `true`, the response will return field values keyed by field ID
 * instead of field name.
 *
 * @returns {Promise<any>}  
 * A promise that resolves to the newly created Airtable record.
 *
 * @throws {Error}  
 * Throws an error if:
 * - `fields` is missing or not an object
 * - the underlying Airtable request fails
 *
 * @usage
 * ```ts
 * const record = await createRecord({
 *   token: process.env.AIRTABLE_API_KEY,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Orders",
 *   fields: {
 *     Status: "New",
 *     Total: 199.99,
 *   },
 *   typecast: true,
 * });
 *
 * console.log(record.id);
 * ```
 *
 * @notes
 * - Internally uses `createRecords` and respects Airtable's
 *   limit of 10 records per request.
 * - No schema validation is performed on `fields`.
 */
export async function createRecord({
  token,
  baseId,
  tableIdOrName,
  fields,
  typecast = false,
  returnFieldsByFieldId = false,
}) {
  if (!fields || typeof fields !== "object") {
    throw new Error("fields must be an object");
  }

  const res = await createRecords({
    token,
    baseId,
    tableIdOrName,
    records: [{ fields }],
    typecast,
    returnFieldsByFieldId,
  });

  // Airtable responds with { records: [ ... ] }
  return res.records?.[0] ?? res;
}

/** Deletes a single record from an Airtable table by its record ID.
 * This function is a thin wrapper around `airtableRequest` that validates
 * required parameters and issues a DELETE request to the Airtable API.
 *
 * @param {Object} params
 * @param {string} params.token  
 * The Airtable Personal Access Token (PAT) used for authentication.
 *
 * @param {string} params.baseId  
 * The Airtable Base ID containing the target table.
 *
 * @param {string} params.tableIdOrName  
 * The table ID or human-readable table name.
 *
 * @param {string} params.recordId  
 * The unique Airtable record ID to delete.
 *
 * @returns {Promise<any>}  
 * A promise that resolves to the Airtable API response confirming deletion
 * of the record.
 *
 * @throws {Error}  
 * Throws an error if:
 * - `baseId`, `tableIdOrName`, or `recordId` is missing
 * - the underlying Airtable request fails
 *
 * @usage
 * ```ts
 * await deleteRecord({
 *   token: process.env.AIRTABLE_API_KEY,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Clients",
 *   recordId: "recYYYYYYYYYYYYYY",
 * });
 * ```
 *
 * @notes
 * - Deletions are permanent and cannot be undone.
 * - No confirmation or soft-delete mechanism is implemented.
 * - Intended for use in controlled backend or automation contexts.
 */
/** Updates a single record in an Airtable table by its record ID.
 * This function wraps `airtableRequest`, validating required parameters
 * and building the correct Airtable API path for PATCH requests.
 *
 * @param {Object} params
 * @param {string} params.token  
 * The Airtable Personal Access Token (PAT) used for authentication.
 *
 * @param {string} params.baseId  
 * The Airtable Base ID containing the target table.
 *
 * @param {string} params.tableIdOrName  
 * The table ID or human-readable table name.
 *
 * @param {string} params.recordId  
 * The unique Airtable record ID to update.
 *
 * @param {Record<string, any>} params.fields  
 * An object containing the field values to update.
 *
 * @param {boolean} [params.typecast=false]  
 * When `true`, Airtable will attempt to coerce field values into compatible
 * types (e.g. strings to select options).
 *
 * @param {boolean} [params.returnFieldsByFieldId=false]  
 * When `true`, the response will return field values keyed by field ID
 * instead of field name.
 *
 * @returns {Promise<any>}  
 * A promise that resolves to the updated Airtable record.
 *
 * @throws {Error}  
 * Throws an error if:
 * - `baseId`, `tableIdOrName`, `recordId`, or `fields` are missing
 * - the underlying Airtable request fails
 *
 * @usage
 * ```ts
 * const record = await updateRecord({
 *   token: process.env.AIRTABLE_API_KEY,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Clients",
 *   recordId: "recYYYYYYYYYYYYYY",
 *   fields: {
 *     Status: "Active",
 *     Notes: "Updated via API",
 *   },
 * });
 * ```
 *
 * @notes
 * - This function performs no field-level validation against the Airtable schema.
 * - For attachment fields, use the format: `[{ url: "https://...", filename: "..." }]`
 * - Intended to be used by higher-level domain services or workflows.
 */
export async function updateRecord({
  token,
  baseId,
  tableIdOrName,
  recordId,
  fields,
  typecast = false,
  returnFieldsByFieldId = false,
}) {
  if (!baseId) throw new Error("baseId is required");
  if (!tableIdOrName) throw new Error("tableIdOrName is required");
  if (!recordId) throw new Error("recordId is required");
  if (!fields || typeof fields !== "object") {
    throw new Error("fields must be an object");
  }

  return airtableRequest({
    method: "PATCH",
    token,
    path: `/${baseId}/${tableIdOrName}/${recordId}`,
    body: {
      fields,
      typecast,
      returnFieldsByFieldId,
    },
  });
}

export async function deleteRecord({
  token = AIRTABLE_AUTH_TOKEN,
  baseId,
  tableIdOrName,
  recordId,
}) {
  if (!baseId) throw new Error("baseId is required");
  if (!tableIdOrName) throw new Error("tableIdOrName is required");
  if (!recordId) throw new Error("recordId is required");

  return airtableRequest({
    method: "DELETE",
    token,
    path: `/${baseId}/${tableIdOrName}/${recordId}`,
  });
}

/** Finds Airtable record IDs by applying an **equality** match on a single field.
 *
 * This helper builds an Airtable `filterByFormula` expression in the form:
 * `{FieldName} = "value"` and queries the table via `listRecords`.
 * It is meant for cases where a field is expected to uniquely identify a record,
 * but it safely handles **zero**, **one**, or **multiple** matches.
 *
 * @param {object} params
 * A configuration object containing both Airtable credentials and the lookup criteria.
 *
 * @param {string} params.token
 * The Airtable API token used to authenticate requests.
 *
 * @param {string} params.baseId
 * The Airtable *base* identifier where the target table lives.
 *
 * @param {string} params.tableIdOrName
 * The Airtable table identifier or human-readable table name to query.
 *
 * @param {string} params.fieldName
 * The Airtable field name to match against (must be the exact column name).
 *
 * @param {string} params.value
 * The value that must be **equal** to the field value for a record to match.
 * This value is interpolated into an Airtable formula string.
 *
 * @param {string | undefined} [params.view]
 * Optional Airtable view name/ID to scope the query to a specific view.
 * When provided, only records visible in that view are considered.
 *
 * @returns {Promise<string | null | { size: number, records: any[] }>}
 * Resolves to:
 * - a `string` record ID when exactly one match is found,
 * - `null` when no record matches,
 * - an object `{ size, records }` when multiple records match.
 *
 * @throws {Error}
 * Throws when any required parameter is missing or invalid, including:
 * - missing `token`, `baseId`, or `tableIdOrName` (**credentials / target table**)
 * - missing `fieldName` or `value` (**lookup criteria**)
 *
 * @usage
 * ```js
 * const recordId = await findRecordIdByEqualField({
 *   token: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Enoteche",
 *   fieldName: "Nome",
 *   value: "Belsit",
 * });
 *
 * if (recordId) {
 *   console.log("Found:", recordId);
 * }
 * ```
 *
 * @notes
 * - This function assumes **string comparison** in the formula; if you match numbers,
 *   consider removing quotes or coercing types accordingly.
 * - If `value` can contain quotes, newlines, or special characters, it should be
 *   properly **escaped** before being injected into `filterByFormula`.
 * - When `view` is provided, the underlying `listRecords` call should include it
 *   in `params` (e.g. `{ view }`) to ensure correct scoping.
 */
export async function findRecordIdByEqualField({
  token,
  baseId,
  tableIdOrName,
  fieldName,
  value,
  view = undefined,
}) {
  // * 0. validate parameters
  // field name
  if (fieldName === undefined || fieldName === null || fieldName === "") {
    logger.error("fieldName is required for findRecordIdByEqualField", {
      location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      fieldName: fieldName,
    });
    throw new Error("fieldName is required for findRecordIdByEqualField");
  }
  // value
  if (value === undefined || value === null || value === "") {
    logger.error("value is required for findRecordIdByEqualField", {
      location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      value: value,
    });
    throw new Error("value is required for findRecordIdByEqualField");
  }
  // base id
  if (baseId === undefined || baseId === null || baseId === "") {
    logger.error("baseId is required for findRecordIdByEqualField", {
      location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      baseId: baseId,
    });
    throw new Error("baseId is required for findRecordIdByEqualField");
  }
  // table id or name
  if (
    tableIdOrName === undefined ||
    tableIdOrName === null ||
    tableIdOrName === ""
  ) {
    logger.error("tableIdOrName is required for findRecordIdByEqualField", {
      location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      tableIdOrName: tableIdOrName,
    });
    throw new Error("tableIdOrName is required for findRecordIdByEqualField");
  }
  // token
  if (token === undefined || token === null || token === "") {
    logger.error("token is required for findRecordIdByEqualField", {
      location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      token: token,
    });
    throw new Error("token is required for findRecordIdByEqualField");
  }

  // * 1. build the filter formula
  const filterFormula = `{${fieldName}} = "${value}"`;

  // * 2. fetch the record
  const result = await listRecords({
    token,
    baseId,
    tableIdOrName,
    params: { filterByFormula },
  });

  if (result.records.length === 0) {
    // TODO: keeo or not?
    // logger.info("No record found for findRecordIdByEqualField", {
    //   location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
    //   fieldName: fieldName,
    //   value: value,
    //   baseId: baseId,
    //   tableIdOrName: tableIdOrName,
    //   token: token,
    // });
    return null;
  } else if (result.records.length === 1) {
    // TODO: keeo or not?
    // logger.info("Record found for findRecordIdByEqualField", {
    //   location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
    //   fieldName: fieldName,
    //   value: value,
    //   baseId: baseId,
    //   tableIdOrName: tableIdOrName,
    //   token: token,
    // });
    return result.record[0].id;
  } else {
    // TODO: keeo or not?
    // logger.info("Multiple records found for findRecordIdByEqualField", {
    //   location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
    //   fieldName: fieldName,
    //   value: value,
    //   baseId: baseId,
    //   tableIdOrName: tableIdOrName,
    //   token: token,
    //   records: result.records,
    // });
    return {
      size: result.record.length,
      records: result.records,
    };
  }
}

/** Creates a new record in an Airtable table and uploads an attachment file to a specified field.
 * This function combines record creation with file attachment in a single operation.
 *
 * @param {Object} params
 * @param {string} params.token
 * The Airtable Personal Access Token (PAT) used for authentication.
 *
 * @param {string} params.baseId
 * The Airtable Base ID where the record will be created.
 *
 * @param {string} params.tableIdOrName
 * The table ID or human-readable table name.
 *
 * @param {Record<string, any>} params.fields
 * An object containing the field values for the new record.
 * Note: The attachment field should NOT be included in this object,
 * as it will be populated by the file upload.
 *
 * @param {string} params.attachmentFieldIdOrName
 * The field ID or name of the attachment field where the file will be uploaded.
 *
 * @param {string} params.filePath
 * The local file system path to the file to upload.
 *
 * @param {string} [params.filename]
 * Optional custom filename. If not provided, the basename of filePath will be used.
 *
 * @param {string} [params.contentType]
 * Optional MIME content type. If not provided, it will be guessed from the file extension.
 *
 * @param {boolean} [params.typecast=false]
 * When `true`, Airtable will attempt to coerce field values into compatible types.
 *
 * @param {boolean} [params.returnFieldsByFieldId=false]
 * When `true`, the response will return field values keyed by field ID instead of field name.
 *
 * @returns {Promise<any>}
 * A promise that resolves to the newly created Airtable record with the attachment uploaded.
 *
 * @throws {Error}
 * Throws an error if:
 * - required parameters are missing
 * - the file cannot be read or is too large (>5MB)
 * - record creation fails
 * - attachment upload fails
 *
 * @usage
 * ```ts
 * const record = await uploadRecordWithAttachment({
 *   token: process.env.AIRTABLE_API_KEY,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Documents",
 *   fields: {
 *     Name: "My Document",
 *     Description: "A document with an attachment",
 *   },
 *   attachmentFieldIdOrName: "File",
 *   filePath: "/path/to/document.pdf",
 *   filename: "custom-name.pdf",
 * });
 *
 * console.log(record.id);
 * ```
 *
 * @notes
 * - Maximum file size is 5 MB (Airtable limitation).
 * - The record is created first, then the attachment is uploaded to it.
 * - If record creation succeeds but attachment upload fails, the record will still exist in Airtable.
 */
export async function uploadRecordWithAttachment({
  token,
  baseId,
  tableIdOrName,
  fields,
  attachmentFieldIdOrName,
  filePath,
  filename = undefined,
  contentType = undefined,
  typecast = false,
  returnFieldsByFieldId = false,
}) {
  // * 0. Parameter validation
  // token
  if (token === undefined || token === null || token === "") {
    logger.error("token is required for uploadRecordWithAttachment", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      token: token,
    });
    throw new Error("token is required for uploadRecordWithAttachment");
  }
  // base id
  if (baseId === undefined || baseId === null || baseId === "") {
    logger.error("baseId is required for uploadRecordWithAttachment", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      baseId: baseId,
    });
    throw new Error("baseId is required for uploadRecordWithAttachment");
  }
  // table id or name
  if (
    tableIdOrName === undefined ||
    tableIdOrName === null ||
    tableIdOrName === ""
  ) {
    logger.error("tableIdOrName is required for uploadRecordWithAttachment", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      tableIdOrName: tableIdOrName,
    });
    throw new Error("tableIdOrName is required for uploadRecordWithAttachment");
  }
  // fields
  if (fields === undefined || fields === null || typeof fields !== "object") {
    logger.error("fields is required for uploadRecordWithAttachment", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      fields: fields,
    });
    throw new Error("fields is required for uploadRecordWithAttachment");
  }
  // attachment field id or name
  if (
    attachmentFieldIdOrName === undefined ||
    attachmentFieldIdOrName === null ||
    attachmentFieldIdOrName === ""
  ) {
    logger.error(
      "attachmentFieldIdOrName is required for uploadRecordWithAttachment",
      {
        location:
          "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
        attachmentFieldIdOrName: attachmentFieldIdOrName,
      }
    );
    throw new Error(
      "attachmentFieldIdOrName is required for uploadRecordWithAttachment"
    );
  }
  // file path
  if (filePath === undefined || filePath === null || filePath === "") {
    logger.error("filePath is required for uploadRecordWithAttachment", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      filePath: filePath,
    });
    throw new Error("filePath is required for uploadRecordWithAttachment");
  }

  // TODO: remove after testing
  logger.info(" ####DEBUG#### uploadRecordWithAttachment parameters validation - Success", {
    location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
    token,
    baseId,
    tableIdOrName,
    fields,
    attachmentFieldIdOrName,
  });

  // * 1. Read the file (from filesystem or download from URL)
  // Check if filePath is already a URL (starts with http:// or https://)
  const isUrl = filePath.startsWith("http://") || filePath.startsWith("https://");
  
  let fileBuf;
  let finalFilename;
  
  if (isUrl) { // If it's a URL, download it first
    
    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(`Failed to download file from URL: ${response.status} ${response.statusText}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    fileBuf = Buffer.from(arrayBuffer);
    
    // Extract filename from URL or use provided filename
    finalFilename = filename || path.basename(new URL(filePath).pathname) || "attachment";
  } else { // If it's not a URL, read the file from the filesystem
    // Read the file from the filesystem
    fileBuf = await fs.readFile(filePath);
    
    // Final filename:
    // - use provided filename, or
    // - fallback to basename of the path
    finalFilename = filename || path.basename(filePath);
  }

  // File size in bytes
  const sizeBytes = fileBuf.byteLength;

  // Maximum allowed size for the uploadAttachment endpoint
  const MAX = 5 * 1024 * 1024; // 5 MB

  if (sizeBytes > MAX) {
    throw new Error(
      `File too large for uploadAttachment endpoint: ${sizeBytes} bytes. Max is ${MAX} bytes (5 MB).`
    );
  }

  // Final MIME type:
  // - use provided contentType, or
  // - guess from file extension
  const finalContentType =
    contentType || guessContentTypeFromFilename(finalFilename);

  // TODO: remove after testing
  logger.info(" ####DEBUG#### finalContentType", {
    location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
    finalContentType,
  });

  // * 2. Create the record first (without the attachment field)
  // Remove attachment field from fields if present to avoid conflicts
  const fieldsWithoutAttachment = { ...fields };
  delete fieldsWithoutAttachment[attachmentFieldIdOrName];
  
  let newRecord;
  try { // This try block attempts to create the record in Airtable. If it fails, it logs detailed error information and stops the process to prevent further execution.
    newRecord = await createRecord({
      token,
      baseId,
      tableIdOrName,
      fields: fieldsWithoutAttachment,
      typecast: true, // Enable typecast to help Airtable convert field types automatically
      returnFieldsByFieldId,
    });
  } catch (error) { // This catch block handles the situation where creating the record in Airtable fails, logging detailed error information and stopping the process to prevent further execution.
    logger.error("Error creating record for uploadRecordWithAttachment", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      error: error.message,
      baseId,
      tableIdOrName,
      fields: JSON.stringify(fields, null, 2),
      originalError: error,
      status: error.status,
      statusText: error.statusText,
      airtableError: error.airtable,
    });

    // Provide helpful error message based on status code
    let errorMessage = `Error creating record for uploadRecordWithAttachment: ${error.message}`;
    if (error.status === 403) {
      errorMessage += `\n\nPossible causes:
- The token does not have write permissions for table "${tableIdOrName}" in base "${baseId}"
- The table "${tableIdOrName}" does not exist in base "${baseId}"
- Field names in the payload do not match the table schema
- The token is invalid or expired

Please verify:
1. Token permissions in Airtable (Account > Personal access tokens)
2. Table ID/name is correct: "${tableIdOrName}"
3. Base ID is correct: "${baseId}"
4. Field names match exactly: ${Object.keys(fields).join(", ")}`;
    }

    // Preserve the original error and add context
    const enhancedError = new Error(errorMessage);
    enhancedError.cause = error;
    enhancedError.location =
      "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment";
    enhancedError.baseId = baseId;
    enhancedError.tableIdOrName = tableIdOrName;
    enhancedError.originalMessage = error.message;
    enhancedError.fields = fields;
    if (error.status) enhancedError.status = error.status;
    if (error.statusText) enhancedError.statusText = error.statusText;
    if (error.airtable) enhancedError.airtable = error.airtable;
    throw enhancedError;
  }

  // Extract the record ID from the created record
  const recordId = newRecord.id;
  if (!recordId) {
    throw new Error("Failed to create record: no record ID returned");
  }

  // Small delay to ensure record is fully propagated in Airtable. This helps avoid 404 errors when trying to upload attachment immediately after creation
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Verify that the record exists before attempting to upload attachment
  // IMPORTANT: We need to fetch the record with BOTH field names and IDs to properly verify
  // because Airtable's uploadAttachment endpoint accepts both, but we need to check which one works
  const useFieldId = attachmentFieldIdOrName.startsWith("fld");
  let verifyRecord = null;
  
  try { // This try block attempts to fetch the just-created record from Airtable to ensure it exists and is accessible before proceeding with the attachment upload.
    // Fetch with field IDs to see all fields
    verifyRecord = await getRecord({
      token,
      baseId,
      tableIdOrName,
      recordId,
      returnFieldsByFieldId: true, // Always use field IDs to get complete field list
    });
    
    // TODO: remove after testing
    logger.info(" ####DEBUG#### verifyRecord AFTER getRecord", {
      location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      verifyRecord,
      hasFields: !!verifyRecord?.fields,
      fieldKeys: verifyRecord?.fields ? Object.keys(verifyRecord.fields) : [],
      recordId,
      attachmentFieldIdOrName,
      isFieldId: useFieldId,
      note: "Fields are returned by ID. Empty fields (like attachment) won't appear in response.",
    });
  } catch (verifyError) { // This catch block handles the situation where verifying the existence of the newly created Airtable record fails, logging detailed error information and stopping the process to prevent attachment upload to a non-existent record.
    // TODO: remove after testing
    logger.error(" ####DEBUG#### verifyError in catch", {
      location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      verifyError: verifyError,
      errorMessage: verifyError.message,
      errorStack: verifyError.stack,
      status: verifyError.status,
      statusText: verifyError.statusText,
      recordId,
    });
    
    logger.error("Failed to verify record existence", {
      location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      recordId,
      error: verifyError.message,
      status: verifyError.status,
      statusText: verifyError.statusText,
    });
    throw new Error(
      `Cannot proceed with attachment upload: Record ${recordId} does not exist or cannot be accessed. Error: ${verifyError.message}`
    );
  }

  // Diagnostic: Check if the attachment field exists in the record
  if (verifyRecord && verifyRecord.fields) {
    const fieldExists = attachmentFieldIdOrName in verifyRecord.fields;

    if (!fieldExists) {
      logger.warning("Attachment field not found in record", {
        location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
        attachmentFieldIdOrName,
        availableFields: Object.keys(verifyRecord.fields),
        note: "The field might be referenced by name but we're using ID, or vice versa",
      });
    }
  }

  // TODO: remove after testing
  logger.info(" ####DEBUG#### verifyRecord.fields", {
    location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
    verifyRecordFields: verifyRecord.fields,
  });

  // * 3. Upload attachment using Airtable's uploadAttachment endpoint
  // According to Airtable API documentation:
  // POST /v0/{baseId}/{recordId}/{attachmentFieldIdOrName}/uploadAttachment
  // Body: { contentType: string, file: string (base64), filename: string }
  // 
  // NOTE: attachmentFieldIdOrName can be either:
  // - Field ID (e.g., "fldzJAZ8ffCr4NMLO") - recommended
  // - Field name (e.g., "pdf") - may work but ID is more reliable
  
  // Convert file buffer to base64 string
  const fileBase64 = fileBuf.toString("base64");
  
  // Build the upload URL
  const uploadUrl = `${AIRTABLE_CONTENT_BASE}/${baseId}/${recordId}/${attachmentFieldIdOrName}/uploadAttachment`;
  
  // TODO: remove after testing
  logger.info(" ####DEBUG#### About to upload attachment", {
    location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
    uploadUrl,
    recordId,
    attachmentFieldIdOrName,
    isFieldId: attachmentFieldIdOrName.startsWith("fld"),
    baseId,
    tableIdOrName,
    fileSize: fileBuf.byteLength,
    filename: finalFilename,
    contentType: finalContentType,
  });
  
  try {
    // Make the POST request to uploadAttachment endpoint
    const uploadResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentType: finalContentType,
        file: fileBase64,
        filename: finalFilename,
      }),
    });

    // TODO: remove after testing
    logger.info(" ####DEBUG#### uploadResponse", {
      location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      uploadResponseStatus: uploadResponse.status,
      uploadResponseStatusText: uploadResponse.statusText,
      uploadResponseOk: uploadResponse.ok,
      uploadResponseHeaders: Object.fromEntries(uploadResponse.headers.entries()),
    });

    if (!uploadResponse.ok) {
      const responseText = await uploadResponse.text();
      let responseJson;
      try {
        responseJson = JSON.parse(responseText);
      } catch (e) {
        responseJson = { error: responseText };
      }

      logger.error("Airtable uploadAttachment response", {
        location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        url: uploadUrl,
        responseText,
        responseJson,
        attachmentFieldIdOrName,
        isFieldId: attachmentFieldIdOrName.startsWith("fld"),
      });

      // Provide helpful error message for 404 errors
      let errorMessage = `Airtable uploadAttachment failed: ${uploadResponse.status} ${uploadResponse.statusText}. ${JSON.stringify(responseJson)}`;
      
      if (uploadResponse.status === 404 && !attachmentFieldIdOrName.startsWith("fld")) {
        errorMessage += `\n\nIMPORTANT: The uploadAttachment endpoint may require the field ID instead of the field name.\n` +
          `You provided: "${attachmentFieldIdOrName}" (field name)\n` +
          `Try using the field ID instead (starts with "fld", e.g., "fldzJAZ8ffCr4NMLO").\n` +
          `You can find the field ID in Airtable's API documentation or by inspecting the table schema.`;
      } else if (uploadResponse.status === 404) {
        errorMessage += `\n\nPossible causes:\n` +
          `- The field ID "${attachmentFieldIdOrName}" does not exist in table "${tableIdOrName}"\n` +
          `- The field is not an attachment field\n` +
          `- The record "${recordId}" does not exist or is not accessible\n` +
          `- The base "${baseId}" or table "${tableIdOrName}" is incorrect`;
      }

      throw new Error(errorMessage);
    }

    const uploadResult = await uploadResponse.json();

    // TODO: remove after testing
    logger.info(" ####DEBUG#### uploadResult", {
      location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      uploadResult,
    });
    
    // TODO: keeo or not?
    // logger.info("Attachment uploaded successfully via uploadAttachment endpoint", {
    //   location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
    //   recordId,
    //   attachmentFieldIdOrName,
    //   filename: finalFilename,
    //   uploadResult,
    // });

    // * 4. Verify the attachment was added
    // Small delay to ensure attachment is fully propagated in Airtable
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    const verifyRecord = await getRecord({
      token,
      baseId,
      tableIdOrName,
      recordId,
      returnFieldsByFieldId: useFieldId,
    });

    const attachmentField = verifyRecord.fields?.[attachmentFieldIdOrName];
    const hasAttachment = Array.isArray(attachmentField) && attachmentField.length > 0;

    if (!hasAttachment) {
      const fieldStatus = attachmentField === undefined
        ? `Field "${attachmentFieldIdOrName}" is empty (Airtable doesn't return empty fields in API responses)`
        : Array.isArray(attachmentField) && attachmentField.length === 0
        ? `Field "${attachmentFieldIdOrName}" exists but is empty`
        : `Field "${attachmentFieldIdOrName}" has unexpected type: ${typeof attachmentField}`;

      const errorMsg = `Attachment verification failed: The file "${finalFilename}" was not found in field "${attachmentFieldIdOrName}" after uploadAttachment. ${fieldStatus}`;
      
      logger.error("Attachment verification failed", {
        location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
        recordId,
        attachmentFieldIdOrName,
        filename: finalFilename,
        attachmentFieldValue: attachmentField,
        availableFields: Object.keys(verifyRecord.fields || {}),
        fieldStatus,
      });

      const err = new Error(errorMsg);
      err.status = 500;
      err.recordId = recordId;
      err.attachmentFieldIdOrName = attachmentFieldIdOrName;
      err.filename = finalFilename;
      err.attachmentFieldValue = attachmentField;
      err.availableFields = Object.keys(verifyRecord.fields || {});
      throw err;
    }

    // TODO: keeo or not?
    // logger.info("Attachment verified successfully", {
    //   location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
    //   recordId,
    //   attachmentFieldIdOrName,
    //   attachmentCount: attachmentField.length,
    //   attachmentFiles: attachmentField.map((f) => f.filename || f.url),
    // });

    return verifyRecord;
  } catch (error) {
    logger.error("Error updating record with attachment", {
      location: "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      recordId,
      attachmentFieldIdOrName,
      filename: finalFilename,
      error: error.message,
      status: error.status,
      statusText: error.statusText,
      airtableError: error.airtable,
    });

    // Preserve the original error and add context
    const enhancedError = new Error(
      `Error updating record with attachment: ${error.message || "Unknown error"}`
    );
    enhancedError.cause = error;
    enhancedError.location = "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment";
    enhancedError.recordId = recordId;
    enhancedError.attachmentFieldIdOrName = attachmentFieldIdOrName;
    enhancedError.filename = finalFilename;
    if (error.status) enhancedError.status = error.status;
    if (error.statusText) enhancedError.statusText = error.statusText;
    if (error.airtable) enhancedError.airtable = error.airtable;
    throw enhancedError;
  }
}

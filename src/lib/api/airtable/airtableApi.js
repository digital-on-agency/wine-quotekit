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
const AIRTABLE_API_BASE =
  process.env.AIRTABLE_API_BASE || "https://api.airtable.com/v0";

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
  // use URL API to build the URL
  const url = new URL(`${AIRTABLE_API_BASE}${path}`);
  // add query parameters
  if (query) {
    // iterate over the query parameters
    for (const [key, value] of Object.entries(query)) {
      // skip undefined or null values
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

/** Executes a single Airtable Web API HTTP request using `fetch`, returning the parsed JSON response.
 *
 * This helper:
 * - Validates required inputs (**token** and **path**)
 * - Builds the final request URL via `buildUrl(path, query)`
 * - Sends an authenticated request using a **Bearer PAT**
 * - Parses the response body (JSON when possible, otherwise returns `{ raw: string }`)
 * - Throws a structured `Error` object when the request fails
 *
 * @param {object} params
 * The request configuration object.
 *
 * @param {string} params.method
 * The HTTP method to use (e.g. `"GET"`, `"POST"`, `"PATCH"`, `"DELETE"`).
 *
 * @param {string} params.token
 * The Airtable **Personal Access Token** (*PAT*) used for authentication.
 * It is sent as `Authorization: Bearer <token>`.
 *
 * @param {string} params.path
 * The Airtable API path (e.g. `"/v0/{baseId}/{tableIdOrName}"`).
 * This is passed into `buildUrl()` together with `query`.
 *
 * @param {Record<string, string | number | boolean | undefined> | undefined} params.query
 * Optional querystring parameters to be encoded into the URL (e.g. `{ maxRecords: 50 }`).
 *
 * @param {unknown} params.body
 * Optional JSON payload for methods that send data (e.g. `"POST"`, `"PATCH"`).
 * When provided, it is serialized with `JSON.stringify()` and the request includes
 * `Content-Type: application/json`.
 *
 * @returns {Promise<unknown>}
 * The parsed response body:
 * - If the body is valid JSON, returns that parsed JSON object.
 * - If the body is not JSON (rare), returns `{ raw: string }`.
 * - If the body is empty, returns `null`.
 *
 * @throws {Error}
 * Throws an `Error` containing a structured object payload when:
 * - **token** is missing
 * - **path** is missing
 * - Airtable returns a non-2xx status (`res.ok === false`)
 * - The request fails at the network/runtime level
 *
 * @usage
 * ```js
 * const data = await airtableRequest({
 *   method: "GET",
 *   token: process.env.AIRTABLE_TOKEN,
 *   path: `/v0/${baseId}/${tableName}`,
 *   query: { maxRecords: 10 },
 * });
 *
 * const created = await airtableRequest({
 *   method: "POST",
 *   token: process.env.AIRTABLE_TOKEN,
 *   path: `/v0/${baseId}/${tableName}`,
 *   body: { records: [{ fields: { Name: "Test" } }] },
 * });
 * ```
 *
 * @notes
 * - This function assumes Airtable returns JSON for both success and error responses, but it safely
 *   falls back to `{ raw: string }` when parsing fails.
 * - The thrown errors are **structured** (object payload inside `Error`), which is useful for logging,
 *   but you should ensure your error handling expects this style.
 * - If you want to avoid leaking secrets, never log the full `token` value.
 */
async function airtableRequest({ method, token, path, query, body }) {
  // * 0. validate parameters
  if (!token)
    throw new Error({
      msg: "Airtable API token is required (PAT).",
      source: "src/lib/api/airtable/airtableApi.js:airtableRequest",
      token: token,
    });
  if (!path)
    throw new Error({
      msg: "Airtable API path is required.",
      source: "src/lib/api/airtable/airtableApi.js:airtableRequest",
      path: path,
    });

  // * 1. build the URL
  const url = buildUrl(path, query);

  try {
    // * 2. make the request
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // * 3. check the response

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

    // if the response is not ok, throw an error
    if (!res.ok) {
      throw new Error({
        msg: "Airtable request failed (non-ok status)",
        source: "src/lib/api/airtable/airtableApi.js:airtableRequest",
        status: res.status,
        statusText: res.statusText,
        response: json,
        url: url,
        cause: "Airtable request failed",
      });
    }

    return json;
  } catch (error) {
    throw new Error({
      msg: "Airtable request failed (error)",
      source: "src/lib/api/airtable/airtableApi.js:airtableRequest",
      status: res.status,
      statusText: res.statusText,
      response: json,
      url: url,
      cause: error,
    });
  }
}

/** Retrieves a single record from an Airtable table by its record ID.
 *
 * This function:
 * - Validates all required identifiers (**baseId**, **tableIdOrName**, **recordId**)
 * - Optionally requests fields keyed by **field IDs** instead of field names
 * - Performs a `GET` request to the Airtable Records API
 * - Returns the raw Airtable record payload on success
 * - Throws a structured error object on failure
 *
 * @param {object} params
 * The configuration object used to fetch the record.
 *
 * @param {string} params.token
 * The Airtable **Personal Access Token** (*PAT*) used for authentication.
 *
 * @param {string} params.baseId
 * The Airtable Base ID containing the target table.
 *
 * @param {string} params.tableIdOrName
 * The table identifier or table name from which to retrieve the record.
 *
 * @param {string} params.recordId
 * The unique Airtable record ID (e.g. `"recXXXXXXXXXXXXXX"`).
 *
 * @param {boolean} [params.returnFieldsByFieldId=false]
 * When set to `true`, Airtable will return fields keyed by **field ID**
 * instead of human-readable field names.
 *
 * @returns {Promise<unknown>}
 * A promise that resolves to the Airtable record object, including:
 * - `id`
 * - `fields`
 * - `createdTime`
 *
 * @throws {Error}
 * Throws a structured `Error` when:
 * - Any required parameter is missing
 * - The Airtable request fails
 * - The record does not exist or is inaccessible
 *
 * @usage
 * ```js
 * const record = await getRecord({
 *   token: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Clients",
 *   recordId: "recXXXXXXXXXXXXXX",
 * });
 *
 * const recordByFieldId = await getRecord({
 *   token: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Clients",
 *   recordId: "recXXXXXXXXXXXXXX",
 *   returnFieldsByFieldId: true,
 * });
 * ```
 *
 * @notes
 * - This function is a **thin wrapper** around `airtableRequest`.
 * - Errors are wrapped with contextual metadata (`source`, `recordId`) to
 *   simplify debugging and centralized logging.
 * - No transformation is applied to the returned record payload.
 */
export async function getRecord({
  token,
  baseId,
  tableIdOrName,
  recordId,
  returnFieldsByFieldId = false,
}) {
  // * 0. validate parameters
  if (!baseId)
    throw new Error({
      msg: "baseId is required",
      source: "src/lib/api/airtable/airtableApi.js:getRecord",
      baseId: baseId,
    });
  if (!tableIdOrName)
    throw new Error({
      msg: "tableIdOrName is required",
      source: "src/lib/api/airtable/airtableApi.js:getRecord",
      tableIdOrName: tableIdOrName,
    });
  if (!recordId)
    throw new Error({
      msg: "recordId is required",
      source: "src/lib/api/airtable/airtableApi.js:getRecord",
      recordId: recordId,
    });

  // * 1. build the query
  const query = returnFieldsByFieldId
    ? { returnFieldsByFieldId: "true" }
    : undefined;

  // * 2. make the request
  try {
    const result = await airtableRequest({
      method: "GET",
      token,
      path: `/${baseId}/${tableIdOrName}/${recordId}`,
      query,
    });

    return result;
  } catch (error) {
    throw new Error({
      msg: "Error getting record",
      source: "src/lib/api/airtable/airtableApi.js:getRecord",
      recordId: recordId,
      cause: error,
    });
  }
}

/** Retrieves a list of records from an Airtable table.
 *
 * This function:
 * - Validates required identifiers (**baseId**, **tableIdOrName**)
 * - Executes a `GET` request to the Airtable List Records API
 * - Supports optional query parameters (e.g. `filterByFormula`, `view`, `maxRecords`)
 * - Returns the raw Airtable response payload on success
 * - Wraps and rethrows errors with contextual metadata
 *
 * @param {object} params
 * The configuration object used to list records.
 *
 * @param {string} params.token
 * The Airtable **Personal Access Token** (*PAT*) used for authentication.
 *
 * @param {string} params.baseId
 * The Airtable Base ID containing the target table.
 *
 * @param {string} params.tableIdOrName
 * The table identifier or table name from which to list records.
 *
 * @param {object} [params.params={}]
 * Optional query parameters supported by the Airtable API, such as:
 * - `filterByFormula`
 * - `view`
 * - `maxRecords`
 * - `pageSize`
 * - `sort`
 *
 * @returns {Promise<unknown>}
 * A promise that resolves to the Airtable list response object, typically
 * containing:
 * - `records` (array of record objects)
 * - `offset` (for pagination, if present)
 *
 * @throws {Error}
 * Throws a structured `Error` when:
 * - Required parameters are missing
 * - The Airtable request fails
 * - The API returns a non-successful response
 *
 * @usage
 * ```js
 * const result = await listRecords({
 *   token: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Orders",
 *   params: {
 *     filterByFormula: "{Status} = 'Active'",
 *     maxRecords: 50,
 *   },
 * });
 *
 * const records = result.records;
 * ```
 *
 * @notes
 * - Pagination is **not automatically handled**; if `offset` is returned,
 *   the caller is responsible for subsequent requests.
 * - The function returns the **raw Airtable response** without transformation.
 * - Designed as a low-level utility to be composed by higher-level data access functions.
 */
export async function listRecords({
  token,
  baseId,
  tableIdOrName,
  params = {},
}) {
  // * 0. validate parameters
  if (!baseId)
    throw new Error({
      msg: "baseId is required",
      source: "src/lib/api/airtable/airtableApi.js:listRecords",
      baseId: baseId,
    });
  if (!tableIdOrName)
    throw new Error({
      msg: "tableIdOrName is required",
      source: "src/lib/api/airtable/airtableApi.js:listRecords",
      tableIdOrName: tableIdOrName,
    });

  // * 1. make the request
  try {
    const result = await airtableRequest({
      method: "GET",
      token,
      path: `/${baseId}/${tableIdOrName}`,
      query: params,
    });

    return result;
  } catch (error) {
    throw new Error({
      msg: "Error listing records",
      source: "src/lib/api/airtable/airtableApi.js:listRecords",
      cause: error,
    });
  }
}

/** Creates up to **10** new records in an Airtable table using the *Create records* endpoint.
 *
 * This function:
 * - Validates required identifiers (**baseId**, **tableIdOrName**) and the `records` payload
 * - Enforces Airtable's per-request limit (**max 10 records**)
 * - Ensures each record matches the Airtable schema shape: `{ fields: { ... } }`
 * - Sends a `POST` request through the shared `airtableRequest` helper
 * - Returns the raw Airtable response, including created record IDs and fields
 * - Wraps and rethrows errors with contextual metadata for debugging
 *
 * @param {object} params
 * The configuration object for the create operation.
 *
 * @param {string} params.token
 * The Airtable **Personal Access Token** (*PAT*) used for authentication.
 *
 * @param {string} params.baseId
 * The Airtable Base ID containing the target table.
 *
 * @param {string} params.tableIdOrName
 * The table identifier or table name in which records will be created.
 *
 * @param {Array<{fields: Record<string, unknown>}>} params.records
 * An array of records to create. Each item **must** be an object with a `fields`
 * property containing the field payload expected by Airtable.
 * Airtable accepts **at most 10 records** per request.
 *
 * @param {boolean} [params.typecast=false]
 * When `true`, Airtable will attempt to coerce field values into compatible
 * types (e.g., string → select option) where possible.
 *
 * @param {boolean} [params.returnFieldsByFieldId=false]
 * When `true`, Airtable returns fields keyed by **field ID** instead of field name.
 *
 * @returns {Promise<unknown>}
 * A promise that resolves to the Airtable *Create records* response payload,
 * typically containing a `records` array with the created record objects.
 *
 * @throws {Error}
 * Throws a structured `Error` when:
 * - **baseId** or **tableIdOrName** is missing
 * - `records` is not a non-empty array
 * - `records.length` exceeds **10**
 * - any record is malformed (missing `fields` or invalid object shape)
 * - the Airtable request fails or returns a non-successful response
 *
 * @usage
 * ```js
 * const result = await createRecords({
 *   token: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Invoices",
 *   typecast: true,
 *   records: [
 *     { fields: { Name: "Invoice #1", Amount: 120 } },
 *     { fields: { Name: "Invoice #2", Amount: 80 } },
 *   ],
 * });
 *
 * const created = result.records;
 * console.log(created.map((r) => r.id));
 * ```
 *
 * @notes
 * - Airtable enforces a **hard limit of 10 records** per create request.
 *   Batch large inserts by chunking the input.
 * - The function returns the **raw Airtable response** without transformations.
 * - Use `typecast=true` cautiously: it may silently coerce values in ways that
 *   are convenient but not always desirable.
 */
export async function createRecords({
  token,
  baseId,
  tableIdOrName,
  records,
  typecast = false,
  returnFieldsByFieldId = false,
}) {
  // * 0. validate parameters
  if (!baseId) {
    throw new Error({
      msg: "baseId is required",
      source: "src/lib/api/airtable/airtableApi.js:createRecords",
      baseId: baseId,
    });
  }
  if (!tableIdOrName) {
    throw new Error({
      msg: "tableIdOrName is required",
      source: "src/lib/api/airtable/airtableApi.js:createRecords",
      tableIdOrName: tableIdOrName,
    });
  }
  if (!Array.isArray(records) || records.length === 0) {
    // if records is not an array or is empty, throw an error
    throw new Error({
      msg: "records must be a non-empty array",
      source: "src/lib/api/airtable/airtableApi.js:createRecords",
      records: records,
    });
  }
  if (records.length > 10) {
    // if records is more than 10, throw an error
    throw new Error({
      msg: `Airtable createRecords supports max 10 records per request. Received: ${records.length}`,
      source: "src/lib/api/airtable/airtableApi.js:createRecords",
      records: records,
    });
  }

  // Ensure each element matches Airtable schema: { fields: {...} }
  for (const [i, r] of records.entries()) {
    if (!r || typeof r !== "object") {
      // if r is not an object, throw an error
      throw new Error({
        msg: `records[${i}] must be an object`,
        source: "src/lib/api/airtable/airtableApi.js:createRecords",
        records: records,
      });
    }
    if (!r.fields || typeof r.fields !== "object") {
      // if r.fields is not an object, throw an error
      throw new Error({
        msg: `records[${i}].fields must be an object`,
        source: "src/lib/api/airtable/airtableApi.js:createRecords",
        records: records,
      });
    }
  }

  // * 1. make the request
  try {
    const result = await airtableRequest({
      method: "POST",
      token,
      path: `/${baseId}/${tableIdOrName}`,
      body: {
        records,
        typecast,
        returnFieldsByFieldId,
      },
    });

    return result;
  } catch (error) {
    throw new Error({
      msg: "Error creating records",
      source: "src/lib/api/airtable/airtableApi.js:createRecords",
      cause: error,
    });
  }
}

/** Creates a **single record** in an Airtable table.
 *
 * This function is a thin convenience wrapper around `createRecords` and is
 * intended for the common case where only **one record** needs to be created.
 * It:
 * - Validates all required parameters
 * - Wraps the provided `fields` object into Airtable’s `{ records: [{ fields }] }` format
 * - Delegates the request to `createRecords`
 * - Returns the created record directly instead of an array
 *
 * @param {object} params
 * The configuration object for the create operation.
 *
 * @param {string} params.token
 * The Airtable **Personal Access Token (PAT)** used to authenticate the request.
 *
 * @param {string} params.baseId
 * The Airtable Base ID where the target table resides.
 *
 * @param {string} params.tableIdOrName
 * The table name or table ID in which the record will be created.
 *
 * @param {Record<string, unknown>} params.fields
 * An object representing the fields of the record to create.
 * Keys must match Airtable field names (or field IDs if
 * `returnFieldsByFieldId` is enabled).
 *
 * @param {boolean} [params.typecast=false]
 * When set to `true`, Airtable will attempt to coerce provided values
 * into compatible field types (e.g. strings to select options).
 *
 * @param {boolean} [params.returnFieldsByFieldId=false]
 * When `true`, Airtable returns fields keyed by **field ID**
 * instead of field name.
 *
 * @returns {Promise<unknown>}
 * A promise that resolves to the **created record object** as returned
 * by Airtable (including `id`, `createdTime`, and `fields`).
 *
 * @throws {Error}
 * Throws an error when:
 * - Any required parameter is missing or invalid
 * - The Airtable API request fails
 * - The underlying `createRecords` call throws
 *
 * @usage
 * ```js
 * const record = await createRecord({
 *   token: process.env.AIRTABLE_TOKEN,
 *   baseId: "appXXXXXXXXXXXXXX",
 *   tableIdOrName: "Clients",
 *   fields: {
 *     Name: "ACME Corp",
 *     Country: "Italy",
 *   },
 *   typecast: true,
 * });
 *
 * console.log(record.id);
 * ```
 *
 * @notes
 * - Internally uses `createRecords` with a single-element array.
 * - If Airtable changes its response shape, this function safely
 *   falls back to returning the raw response.
 * - Prefer this helper over `createRecords` when inserting only one record
 *   to keep calling code simpler and more expressive.
 */
export async function createRecord({
  token,
  baseId,
  tableIdOrName,
  fields,
  typecast = false,
  returnFieldsByFieldId = false,
}) {
  // * 0. validate parameters
  if (!token) {
    throw new Error({
      msg: "token is required",
      source: "src/lib/api/airtable/airtableApi.js:createRecord",
      token: token,
    });
  }
  if (!baseId) {
    throw new Error({
      msg: "baseId is required",
      source: "src/lib/api/airtable/airtableApi.js:createRecord",
      baseId: baseId,
    });
  }
  if (!tableIdOrName) {
    throw new Error({
      msg: "tableIdOrName is required",
      source: "src/lib/api/airtable/airtableApi.js:createRecord",
      tableIdOrName: tableIdOrName,
    });
  }
  if (!fields || typeof fields !== "object") {
    throw new Error({
      msg: "fields must be an object",
      source: "src/lib/api/airtable/airtableApi.js:createRecord",
      fields: fields,
    });
  }

  // * 1. make the request
  try {
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
  } catch (error) {
    throw new Error({
      msg: "Error creating record",
      source: "src/lib/api/airtable/airtableApi.js:createRecord",
      cause: error,
    });
  }
}

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
  // * 0. validate parameters
  if (!baseId) {
    throw new Error({
      msg: "baseId is required",
      source: "src/lib/api/airtable/airtableApi.js:deleteRecord",
      baseId: baseId,
    });
  }
  if (!tableIdOrName) {
    throw new Error({
      msg: "tableIdOrName is required",
      source: "src/lib/api/airtable/airtableApi.js:deleteRecord",
      tableIdOrName: tableIdOrName,
    });
  }
  if (!recordId) {
    throw new Error({
      msg: "recordId is required",
      source: "src/lib/api/airtable/airtableApi.js:deleteRecord",
      recordId: recordId,
    });
  }

  // * 1. delete the record
  try {
    const res = await airtableRequest({
      method: "DELETE",
      token,
      path: `/${baseId}/${tableIdOrName}/${recordId}`,
    });

    if (res.deleted) {
      // record deleted successfully
      return {
        success: true,
        message: "Record deleted successfully",
        deleted: true,
        recordId: recordId,
      };
    } else {
      // record not deleted
      return {
        success: false,
        message: "Record not deleted",
        deleted: false,
        recordId: recordId,
        result: res,
      };
    }
  } catch (error) {
    // error deleting the record
    throw new Error({
      msg: "Error deleting record",
      source: "src/lib/api/airtable/airtableApi.js:deleteRecord",
      recordId: recordId,
      cause: error,
    });
  }
}

/** Finds Airtable record(s) whose `fieldName` is **exactly equal** to the provided `value`,
 * using `filterByFormula`, and returns a normalized result describing whether matches exist.
 *
 * This function:
 * - Validates required Airtable parameters (**token**, **baseId**, **tableIdOrName**, **fieldName**, **value**)
 * - Builds an Airtable **formula** in the form `{Field} = "Value"`
 * - Calls `listRecords()` with `filterByFormula` to retrieve matching rows
 * - Normalizes the response into `{ found, size, records }`
 *
 * @param {object} params
 * A parameter object containing Airtable lookup details.
 *
 * @param {string} params.token
 * The Airtable **personal access token** used for authentication (Bearer token).
 *
 * @param {string} params.baseId
 * The Airtable **Base ID** where the target table lives (e.g. `appXXXXXXXXXXXXXX`).
 *
 * @param {string} params.tableIdOrName
 * The Airtable **table ID** (e.g. `tblXXXXXXXXXXXXXX`) or the **table name** as shown in the base UI.
 *
 * @param {string} params.fieldName
 * The Airtable field name to match against (must exist in the table schema).
 *
 * @param {string} params.value
 * The exact value to match in the specified field.
 * This is inserted into the Airtable formula as a **double-quoted string**.
 *
 * @param {string|undefined} [params.view]
 * An optional Airtable view name/id intended to scope the query.
 * *Note:* in the current implementation this is accepted but **not used** in the request.
 *
 * @returns {Promise<{
 *   found: boolean,
 *   size: number,
 *   records: Array<unknown>
 * }>}
 * A normalized match result:
 * - `found`: `true` if at least one record matches, otherwise `false`
 * - `size`: number of matched records (`0`, `1`, or more)
 * - `records`: the array of matched Airtable record objects (empty when not found)
 *
 * @throws {Error}
 * Throws an `Error` when any required parameter is missing.
 * The thrown `Error` contains an object payload with:
 * - `msg`: a human-readable message
 * - `source`: the function source identifier
 * - the invalid/missing parameter value
 *
 * @usage
 * ```js
 * const res = await findRecordIdByEqualField({
 *   token: process.env.AIRTABLE_TOKEN,
 *   baseId: "app123",
 *   tableIdOrName: "tbl456",
 *   fieldName: "Nome",
 *   value: "Belsit",
 * });
 *
 * if (res.found && res.size === 1) {
 *   const record = res.records[0];
 *   console.log("Found record id:", record.id);
 * }
 * ```
 *
 * @notes
 * - **Escaping:** if `value` can contain double quotes or special characters, you should escape it
 *   before building the formula to avoid breaking the Airtable expression.
 * - **Field types:** this formula is string-based. If you match numeric/boolean fields, you may need
 *   a different formula format (e.g., without quotes for numbers).
 * - **View support:** `view` is currently unused; if you want it enforced, pass it to `listRecords`
 *   via `params: { view, filterByFormula: ... }`.
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
    throw new Error({
      msg: "fieldName is required for findRecordIdByEqualField",
      source: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      fieldName: fieldName,
    });
  }
  // value
  if (value === undefined || value === null || value === "") {
    throw new Error({
      msg: "value is required for findRecordIdByEqualField",
      source: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      value: value,
    });
  }
  // base id
  if (baseId === undefined || baseId === null || baseId === "") {
    throw new Error({
      msg: "baseId is required for findRecordIdByEqualField",
      source: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
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
      msg: "tableIdOrName is required for findRecordIdByEqualField",
      source: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      tableIdOrName: tableIdOrName,
    });
  }
  // token
  if (token === undefined || token === null || token === "") {
    throw new Error({
      msg: "token is required for findRecordIdByEqualField",
      source: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      token: token,
    });
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

  let found = false,
    size = 0,
    records = [];

  if (result.records.length === 1) {
    found = true;
    size = 1;
    records.push(result.records[0]);
  } else if (result.records.length > 1) {
    found = true;
    size = result.records.length;
    records = result.records;
  }

  return {
    found: found,
    size: size,
    records: records,
  };
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
  logger.info(
    " ####DEBUG#### uploadRecordWithAttachment parameters validation - Success",
    {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      token,
      baseId,
      tableIdOrName,
      fields,
      attachmentFieldIdOrName,
    }
  );

  // * 1. Read the file (from filesystem or download from URL)
  // Check if filePath is already a URL (starts with http:// or https://)
  const isUrl =
    filePath.startsWith("http://") || filePath.startsWith("https://");

  let fileBuf;
  let finalFilename;

  if (isUrl) {
    // If it's a URL, download it first

    const response = await fetch(filePath);
    if (!response.ok) {
      throw new Error(
        `Failed to download file from URL: ${response.status} ${response.statusText}`
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    fileBuf = Buffer.from(arrayBuffer);

    // Extract filename from URL or use provided filename
    finalFilename =
      filename || path.basename(new URL(filePath).pathname) || "attachment";
  } else {
    // If it's not a URL, read the file from the filesystem
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
  try {
    // This try block attempts to create the record in Airtable. If it fails, it logs detailed error information and stops the process to prevent further execution.
    newRecord = await createRecord({
      token,
      baseId,
      tableIdOrName,
      fields: fieldsWithoutAttachment,
      typecast: true, // Enable typecast to help Airtable convert field types automatically
      returnFieldsByFieldId,
    });
  } catch (error) {
    // This catch block handles the situation where creating the record in Airtable fails, logging detailed error information and stopping the process to prevent further execution.
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

  try {
    // This try block attempts to fetch the just-created record from Airtable to ensure it exists and is accessible before proceeding with the attachment upload.
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
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      verifyRecord,
      hasFields: !!verifyRecord?.fields,
      fieldKeys: verifyRecord?.fields ? Object.keys(verifyRecord.fields) : [],
      recordId,
      attachmentFieldIdOrName,
      isFieldId: useFieldId,
      note: "Fields are returned by ID. Empty fields (like attachment) won't appear in response.",
    });
  } catch (verifyError) {
    // This catch block handles the situation where verifying the existence of the newly created Airtable record fails, logging detailed error information and stopping the process to prevent attachment upload to a non-existent record.
    // TODO: remove after testing
    logger.error(" ####DEBUG#### verifyError in catch", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      verifyError: verifyError,
      errorMessage: verifyError.message,
      errorStack: verifyError.stack,
      status: verifyError.status,
      statusText: verifyError.statusText,
      recordId,
    });

    logger.error("Failed to verify record existence", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
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
        location:
          "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
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
        Authorization: `Bearer ${token}`,
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
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      uploadResponseStatus: uploadResponse.status,
      uploadResponseStatusText: uploadResponse.statusText,
      uploadResponseOk: uploadResponse.ok,
      uploadResponseHeaders: Object.fromEntries(
        uploadResponse.headers.entries()
      ),
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
        location:
          "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        url: uploadUrl,
        responseText,
        responseJson,
        attachmentFieldIdOrName,
        isFieldId: attachmentFieldIdOrName.startsWith("fld"),
      });

      // Provide helpful error message for 404 errors
      let errorMessage = `Airtable uploadAttachment failed: ${
        uploadResponse.status
      } ${uploadResponse.statusText}. ${JSON.stringify(responseJson)}`;

      if (
        uploadResponse.status === 404 &&
        !attachmentFieldIdOrName.startsWith("fld")
      ) {
        errorMessage +=
          `\n\nIMPORTANT: The uploadAttachment endpoint may require the field ID instead of the field name.\n` +
          `You provided: "${attachmentFieldIdOrName}" (field name)\n` +
          `Try using the field ID instead (starts with "fld", e.g., "fldzJAZ8ffCr4NMLO").\n` +
          `You can find the field ID in Airtable's API documentation or by inspecting the table schema.`;
      } else if (uploadResponse.status === 404) {
        errorMessage +=
          `\n\nPossible causes:\n` +
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
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
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
    const hasAttachment =
      Array.isArray(attachmentField) && attachmentField.length > 0;

    if (!hasAttachment) {
      const fieldStatus =
        attachmentField === undefined
          ? `Field "${attachmentFieldIdOrName}" is empty (Airtable doesn't return empty fields in API responses)`
          : Array.isArray(attachmentField) && attachmentField.length === 0
          ? `Field "${attachmentFieldIdOrName}" exists but is empty`
          : `Field "${attachmentFieldIdOrName}" has unexpected type: ${typeof attachmentField}`;

      const errorMsg = `Attachment verification failed: The file "${finalFilename}" was not found in field "${attachmentFieldIdOrName}" after uploadAttachment. ${fieldStatus}`;

      logger.error("Attachment verification failed", {
        location:
          "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
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
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
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
      `Error updating record with attachment: ${
        error.message || "Unknown error"
      }`
    );
    enhancedError.cause = error;
    enhancedError.location =
      "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment";
    enhancedError.recordId = recordId;
    enhancedError.attachmentFieldIdOrName = attachmentFieldIdOrName;
    enhancedError.filename = finalFilename;
    if (error.status) enhancedError.status = error.status;
    if (error.statusText) enhancedError.statusText = error.statusText;
    if (error.airtable) enhancedError.airtable = error.airtable;
    throw enhancedError;
  }
}

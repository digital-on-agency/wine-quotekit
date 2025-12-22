// src/api/airtable/airtableApi.js
// ESM - Node >= 18 (fetch nativo)

import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../../../lib/logger/index.js";

dotenv.config();

const AIRTABLE_API_BASE = process.env.AIRTABLE_API_BASE;
if (!AIRTABLE_API_BASE) {
  throw new Error("AIRTABLE_API_BASE is not defined");
}

const AIRTABLE_CONTENT_BASE =
  process.env.AIRTABLE_CONTENT_BASE || "https://api.airtable.com/v0";

/**
 * Guesses the MIME content type from a filename based on its extension.
 *
 * @param {string} filename - The filename to analyze
 * @returns {string} - The guessed MIME type, defaults to "application/octet-stream"
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

/**
 * Builds a fully qualified Airtable API URL by combining a base path with
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

/**
 * Executes a generic HTTP request against the Airtable REST API.
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

/**
 * Retrieves a single record from an Airtable base by its record ID.
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
export async function getRecord({ token, baseId, tableIdOrName, recordId }) {
  if (!baseId) throw new Error("baseId is required");
  if (!tableIdOrName) throw new Error("tableIdOrName is required");
  if (!recordId) throw new Error("recordId is required");

  return airtableRequest({
    method: "GET",
    token,
    path: `/${baseId}/${tableIdOrName}/${recordId}`,
  });
}

/**
 * Retrieves a list of records from an Airtable table.
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

/**
 * Creates one or more records in an Airtable table.
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

/**
 * Creates a single record in an Airtable table.
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

/**
 * Deletes a single record from an Airtable table by its record ID.
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
    logger.info("No record found for findRecordIdByEqualField", {
      location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      fieldName: fieldName,
      value: value,
      baseId: baseId,
      tableIdOrName: tableIdOrName,
      token: token,
    });
    return null;
  } else if (result.records.length === 1) {
    logger.info("Record found for findRecordIdByEqualField", {
      location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      fieldName: fieldName,
      value: value,
      baseId: baseId,
      tableIdOrName: tableIdOrName,
      token: token,
    });
    return result.record[0].id;
  } else {
    logger.info("Multiple records found for findRecordIdByEqualField", {
      location: "src/lib/api/airtable/airtableApi.js:findRecordIdByEqualField",
      fieldName: fieldName,
      value: value,
      baseId: baseId,
      tableIdOrName: tableIdOrName,
      token: token,
      records: result.records,
    });
    return {
      size: result.record.length,
      records: result.records,
    };
  }
}

/**
 * Creates a new record in an Airtable table and uploads an attachment file to a specified field.
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

  // * 1. Read the file from the filesystem
  const fileBuf = await fs.readFile(filePath);

  // File size in bytes
  const sizeBytes = fileBuf.byteLength;

  // Maximum allowed size for the uploadAttachment endpoint
  const MAX = 5 * 1024 * 1024; // 5 MB

  if (sizeBytes > MAX) {
    throw new Error(
      `File too large for uploadAttachment endpoint: ${sizeBytes} bytes. Max is ${MAX} bytes (5 MB).`
    );
  }

  // Final filename:
  // - use provided filename, or
  // - fallback to basename of the path
  const finalFilename = filename || path.basename(filePath);

  // Final MIME type:
  // - use provided contentType, or
  // - guess from file extension
  const finalContentType =
    contentType || guessContentTypeFromFilename(finalFilename);

  // * 2. Create the record first (without the attachment field)
  let newRecord;
  try {
    newRecord = await createRecord({
      token,
      baseId,
      tableIdOrName,
      fields,
      typecast,
      returnFieldsByFieldId,
    });
  } catch (error) {
    logger.error("Error creating record for uploadRecordWithAttachment", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      error: error.message,
      baseId,
      tableIdOrName,
      originalError: error,
    });
    // Preserve the original error and add context
    const enhancedError = new Error(
      `Error creating record for uploadRecordWithAttachment: ${error.message}`
    );
    enhancedError.cause = error;
    enhancedError.location = "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment";
    enhancedError.baseId = baseId;
    enhancedError.tableIdOrName = tableIdOrName;
    enhancedError.originalMessage = error.message;
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

  // * 3. Convert file to Base64 (required by Airtable)
  const fileBase64 = fileBuf.toString("base64");

  // * 4. Build the upload endpoint URL
  const url = `${AIRTABLE_CONTENT_BASE}/${baseId}/${recordId}/${encodeURIComponent(
    attachmentFieldIdOrName
  )}/uploadAttachment`;

  // * 5. HTTP POST to Airtable to upload the attachment
  try {
    const res = await fetch(url, {
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
  } catch (error) {
    logger.error("Error uploading attachment for uploadRecordWithAttachment", {
      location:
        "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment",
      error: error.message,
      recordId,
      attachmentFieldIdOrName,
      originalError: error,
    });
    // Preserve the original error and add context
    const enhancedError = new Error(
      `Error uploading attachment for uploadRecordWithAttachment: ${error.message}`
    );
    enhancedError.cause = error;
    enhancedError.location = "src/lib/api/airtable/airtableApi.js:uploadRecordWithAttachment";
    enhancedError.recordId = recordId;
    enhancedError.attachmentFieldIdOrName = attachmentFieldIdOrName;
    enhancedError.originalMessage = error.message;
    if (error.status) enhancedError.status = error.status;
    if (error.statusText) enhancedError.statusText = error.statusText;
    if (error.airtable) enhancedError.airtable = error.airtable;
    throw enhancedError;
  }

  // Airtable always returns text (either JSON or error)
  const text = await res.text();
  let json = null;

  // Attempt to parse JSON
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      // Fallback if response is not valid JSON
      json = { raw: text };
    }
  }

  // If response is not OK → throw structured error
  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `Airtable uploadAttachment failed (${res.status} ${res.statusText})`;

    const err = new Error(msg);
    err.status = res.status;
    err.statusText = res.statusText;
    err.airtable = json;
    err.url = url;
    throw err;
  }

  // * 6. Return the Airtable response (record with attachment)
  return json;
}

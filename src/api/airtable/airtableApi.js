// src/api/airtable/airtableApi.js
// ESM - Node >= 18 (fetch nativo)

const AIRTABLE_API_BASE = "https://api.airtable.com/v0";

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
export async function deleteRecord({ token, baseId, tableIdOrName, recordId }) {
  if (!baseId) throw new Error("baseId is required");
  if (!tableIdOrName) throw new Error("tableIdOrName is required");
  if (!recordId) throw new Error("recordId is required");

  return airtableRequest({
    method: "DELETE",
    token,
    path: `/${baseId}/${tableIdOrName}/${recordId}`,
  });
}

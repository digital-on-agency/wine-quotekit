// # -------------------------- IMPORT DEPENDENCIES --------------------------
// logger
import { logger } from "./logger/index.js";
// environment variables
import dotenv from "dotenv";
dotenv.config();
const { AIRTABLE_AUTH_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_ZONE_TAB_ID } =
  process.env;
// yaml: library for YAML serialization
import yaml from "js-yaml";
// airtable api
import {
  fetchDefaultTableRecords,
  getEnotecaDataById,
} from "./api/airtable/airtableIndex.js";

// # -------------------------- FUNCTIONS --------------------------

/** Cleans and normalizes raw Airtable wine list records by stripping out
 * all unnecessary fields and keeping only a predefined whitelist.
 *
 * This function is typically used as a **data sanitation step**
 * before transforming Airtable records into a structured format
 * suitable for downstream processing (e.g. building a wine list
 * context for PDF generation).
 *
 * @param {Object} data
 * The raw response object returned by Airtable list endpoints.
 * Expected to contain a `records` array.
 *
 * @param {Array<Object>} data.records
 * Array of Airtable record objects, each containing `id`,
 * `createdTime`, and `fields`.
 *
 * @returns {Array<Object>}
 * An array of cleaned record objects with the following shape:
 * - `id`: Airtable record ID
 * - `createdTime`: record creation timestamp
 * - `fields`: object containing only the whitelisted fields
 *
 * @usage
 * ```ts
 * const cleaned = wineDataCleaner(airtableResponse);
 * // → [{ id, createdTime, fields: { "Vino + Annata": "...", ... } }]
 * ```
 *
 * @notes
 * - The list of preserved fields is defined by the internal `KEEP_FIELDS` array.
 * - Missing or malformed records are safely ignored.
 * - This function does **not** mutate the original input data.
 * - Designed to be paired with higher-level mappers that group wines
 *   by category, region, and zone.
 */
export function wineDataCleaner(data) {
  /** list of fields to keep in datas after cleaning */
  const KEEP_FIELDS = [
    "Vino + Annata",
    "Carta dei Vini",
    "Vino (from Wine Catalog)",
    "Lista Vitigni AI",
    "Produttore",
    "Alcolicità AI",
    "Affinamento AI",
    "Regione",
    "Zona",
    "Luogo di Produzione",
    "Tipologia",
    "Priorità Zona",
    "Prezzo In Carta Testo",
  ];

  // get records from data
  const records = Array.isArray(data?.records) ? data.records : [];

  const cleanedRecords = records.map((record) => {
    // get fields from record
    const fields =
      record?.fields && typeof record.fields === "object" ? record.fields : {};
    const cleanedFields = {};

    // keep only fields in KEEP_FIELDS
    for (const key of KEEP_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(fields, key)) {
        cleanedFields[key] = fields[key];
      }
    }

    // return cleaned record
    return {
      id: record.id,
      createdTime: record.createdTime,
      fields: cleanedFields,
    };
  });

  // return cleaned records
  return cleanedRecords;
}

/** Build a **Zone Mapping dictionary** from the Airtable *Zones* table.
 *
 * This function:
 * - Fetches all zone records from Airtable using `fetchDefaultTableRecords`
 * - Normalizes heterogeneous field names coming from Airtable
 * - Builds a **lookup object keyed by record ID**
 * - Safely skips malformed or incomplete records while logging warnings
 *
 * The resulting structure is optimized for fast access when generating
 * wine lists or performing zone-based grouping/sorting logic.
 *
 * @returns {Promise<Object<string, {
 *   id: string,
 *   name: string|null,
 *   region: string|null,
 *   country: string|null,
 *   priority: number|null
 * }>>}
 * A promise resolving to an object where:
 * - **keys** are Airtable record IDs (`rec...`)
 * - **values** are normalized zone descriptors
 *
 * @throws {Error}
 * Thrown when:
 * - The Airtable fetch fails
 * - An unexpected error occurs while processing records
 *
 * @usage
 * ```js
 * const zoneMap = await getZoneMapping();
 *
 * const piemonte = zoneMap["recXXXXXXXXXXXX"];
 * console.log(piemonte.name);     // "Langhe"
 * console.log(piemonte.region);   // "Piemonte"
 * console.log(piemonte.country);  // "Italia"
 * console.log(piemonte.priority); // 1
 * ```
 *
 * @notes
 * - Field names are normalized defensively to support schema variations:
 *   - `name`: `"Nome Zona"` → `"Zona"` → `"Nome"`
 *   - `priority`: `"Priorità Zone"` → `"Priorità Zona"`
 * - Records without a valid Airtable `id` are skipped and logged.
 * - Missing fields are returned as `null` (never `undefined`).
 * - The function is **read-only** and does not mutate Airtable data.
 */
export async function getZoneMapping() {
  // Fetch zones data from Airtable
  try {
    const zonesData = await fetchDefaultTableRecords(
      {},
      {
        authToken: AIRTABLE_AUTH_TOKEN,
        baseId: AIRTABLE_BASE_ID,
        tableIdOrName: AIRTABLE_ZONE_TAB_ID,
      }
    );

    // get records from zones data
    const records = Array.isArray(zonesData?.records) ? zonesData.records : [];

    const zoneMapping = {};
    // build zone mapping
    for (const rec of records) {
      // get id from record
      const id = rec?.id;
      // if id is not present, continue
      if (!id) {
        logger.warning("Zone ID not found when building zone mapping", {
          location: "src/lib/wineList.js:getZoneMapping",
          record: rec,
        });
        continue;
      }

      // get fields from record
      const fields =
        rec?.fields && typeof rec.fields === "object" ? rec.fields : {};

      // get name, region, country, priority from fields
      const name =
        fields["Nome Zona"] ?? fields["Zona"] ?? fields["Nome"] ?? null;
      const region = fields["Regione"] ?? null;
      const country = fields["Nazione"] ?? null;
      const priority =
        fields["Priorità Zone"] ?? fields["Priorità Zona"] ?? null;

      // add zone mapping to zoneMapping
      zoneMapping[id] = {
        id,
        name,
        region,
        country,
        priority,
      };
    }

    return zoneMapping;
  } catch (error) {
    throw new Error({
      msg: "Error getting zone mapping",
      source: "src/lib/wineList.js:getZoneMapping",
      error: error.message,
      status: error.status,
      statusText: error.statusText,
    });
  }
}

/** Sorts an array of Airtable wine records into a deterministic, menu-friendly order.
 *
 * The sorting logic is designed for wine-list rendering and supports both
 * **pure alphabetical sorting** and **priority-based zone ordering** when a
 * `zoneMapping` is provided.
 *
 * Sorting precedence:
 * 1. **Tipologia** (type)
 * 2. **Regione** (region)
 * 3. **Zona** (zone)
 *    - If `zoneMapping` is available: sort by **priority** (ascending), then by zone name
 *    - Otherwise: sort alphabetically by `"Zona"`
 * 4. **Produttore** (producer)
 * 5. Tie-breaker: **Vino + Annata** (wine name) or record `id` for stability
 *
 * All comparisons use Italian locale (`"it"`) with base sensitivity and numeric ordering.
 *
 * @param {Array<any>} data
 * Array of Airtable records (or cleaned records) to sort. Each record is expected
 * to expose a `fields` object containing the relevant wine attributes.
 *
 * @param {Record<string, { name?: string; priority?: number }> | undefined} [zoneMapping=undefined]
 * Optional mapping from zone record ID to zone metadata (e.g. `{ name, priority }`).
 * When provided, zones with a numeric `priority` are sorted before zones without one.
 *
 * @returns {Array<any>}
 * A new sorted array of records. Returns an empty array if `data` is not an array
 * or is empty.
 *
 * @usage
 * ```ts
 * const sorted = wineDataSorter(records);
 *
 * const sortedWithPriority = wineDataSorter(records, {
 *   recZone1: { name: "Langhe", priority: 1 },
 *   recZone2: { name: "Roero", priority: 2 },
 * });
 * ```
 *
 * @notes
 * - The function does not mutate the input array: it sorts a shallow copy (`[...data]`).
 * - Airtable fields may come in heterogeneous shapes (arrays, objects, primitives);
 *   internal normalization ensures consistent string comparisons.
 * - Includes a stable tie-breaker to prevent non-deterministic ordering across renders.
 */
export function wineDataSorter(data, zoneMapping = undefined) {
  if (!Array.isArray(data) || data.length === 0) return [];

  /** Normalizes heterogeneous Airtable field values into a comparable string.
   *
   * This helper handles the various data shapes returned by Airtable
   * (primitives, arrays, and wrapped objects) and converts them into
   * a trimmed string suitable for sorting or comparison.
   *
   * @param {unknown} v
   * A raw value returned by Airtable (string, number, boolean, array, or object).
   *
   * @returns {string}
   * A normalized string representation of the value, or an empty string
   * if the value is null, undefined, or not sortable.
   *
   * @notes
   * - Arrays are normalized by taking their first element.
   * - Objects are normalized using their `value` property when present.
   * - Designed specifically for stable, locale-based sorting.
   */
  const normalizeSortValue = (v) => {
    // Airtable can return:
    // - string/number/boolean
    // - arrays (linked records, multi-select, lookups)
    // - objects like { state: "generated", value: "..." }
    if (v === null || v === undefined) return ""; // if value is null or undefined, return empty string
    if (Array.isArray(v)) return normalizeSortValue(v[0]); // if value is an array, return the first element
    if (typeof v === "object") {
      if ("value" in v) return normalizeSortValue(v.value); // if value is an object with a value property, return the value
      return ""; // if value is an object without a value property, return empty string
    }
    return String(v).trim(); // if value is a string, return the trimmed string
  };

  /** Safely extracts and normalizes a field value from an Airtable record.
   *
   * @param {Object} record
   * An Airtable record object containing a `fields` map.
   *
   * @param {string} key
   * The field name to extract from the record.
   *
   * @returns {string}
   * A normalized string value suitable for sorting or comparison.
   *
   * @notes
   * - Uses optional chaining to avoid runtime errors.
   * - Delegates normalization to `normalizeSortValue`.
   */
  const getField = (record, key) => normalizeSortValue(record?.fields?.[key]);

  /** Safely extracts the zone identifier from an Airtable record.
   *
   * This helper safely reads the `"Zona"` field and normalizes it to a single
   * zone ID, handling the different shapes Airtable may return.
   *
   * @param {Object} record
   * An Airtable record object containing a `fields` map.
   *
   * @returns {string | null}
   * The zone ID if available, otherwise `null`.
   *
   * @notes
   * - If the field is an array (e.g. linked records), the first element is used.
   * - If the field is already a string, it is returned as-is.
   * - Returns `null` when the field is missing or not in a supported format.
   */
  const getZoneId = (record) => {
    const zoneField = record?.fields?.["Zona"];
    if (!zoneField) return null;
    // if field is an array (linked record), use the first element
    if (Array.isArray(zoneField) && zoneField.length > 0) {
      return zoneField[0];
    }
    // if field is already a string (id), use it directly
    if (typeof zoneField === "string") {
      return zoneField;
    }
    return null;
  };

  /** Comparator function for sorting wine records in a deterministic, menu-friendly order.
   *
   * Sorting precedence:
   * 1. **Tipologia** (type)
   * 2. **Regione** (region)
   * 3. **Zona** (zone)
   *    - If `zoneMapping` is available: sort by **priority** (ascending), then by zone name (alphabetical)
   *    - Otherwise (or as fallback): sort alphabetically by the `"Zona"` field
   * 4. **Produttore** (producer)
   * 5. Tie-breaker: **Vino + Annata** (wine name) or record `id` for stability
   *
   * All string comparisons use Italian locale (`"it"`) with base sensitivity and numeric ordering.
   *
   * @param {Object} a
   * First Airtable wine record to compare.
   *
   * @param {Object} b
   * Second Airtable wine record to compare.
   *
   * @returns {number}
   * A negative value if `a` should come before `b`, a positive value if `a` should come after `b`,
   * or `0` if they are considered equivalent.
   *
   * @notes
   * - Relies on `getField` for safe field extraction and normalization.
   * - Uses `getZoneId` + `zoneMapping` (if provided) to apply zone priority sorting.
   * - Includes a stable tie-breaker to prevent non-deterministic ordering across renders.
   */
  const compare = (a, b) => {
    // Type
    const aTipologia = getField(a, "Tipologia");
    const bTipologia = getField(b, "Tipologia");
    const tipologiaCompare = aTipologia.localeCompare(bTipologia, "it", {
      sensitivity: "base",
      numeric: true,
    });
    if (tipologiaCompare !== 0) return tipologiaCompare;

    // Region
    const aRegione = getField(a, "Regione");
    const bRegione = getField(b, "Regione");
    const regioneCompare = aRegione.localeCompare(bRegione, "it", {
      sensitivity: "base",
      numeric: true,
    });
    if (regioneCompare !== 0) return regioneCompare;

    // Zone: if zoneMapping is present, sort by priority then alphabetically; otherwise only alphabetically
    if (zoneMapping && typeof zoneMapping === "object") {
      const aZoneId = getZoneId(a);
      const bZoneId = getZoneId(b);
      const aZone = aZoneId ? zoneMapping[aZoneId] : null;
      const bZone = bZoneId ? zoneMapping[bZoneId] : null;

      // if both zones have priority, sort by priority (numerical, increasing)
      if (aZone?.priority != null && bZone?.priority != null) {
        const priorityCompare =
          (aZone.priority || 999) - (bZone.priority || 999);
        if (priorityCompare !== 0) return priorityCompare;
        // if priority is equal, sort alphabetically by zone name
        const aZoneName = aZone.name || "";
        const bZoneName = bZone.name || "";
        const nameCompare = aZoneName.localeCompare(bZoneName, "it", {
          sensitivity: "base",
          numeric: true,
        });
        if (nameCompare !== 0) return nameCompare;
      } else if (aZone?.priority != null) {
        // a has priority, b no → a comes first
        return -1;
      } else if (bZone?.priority != null) {
        // b has priority, a no → b comes first
        return 1;
      }
      // if neither has priority (or zoneMapping does not contain the zone), fallback alphabetically
    }

    // Fallback: sort alphabetically by zone name
    const aZona = getField(a, "Zona");
    const bZona = getField(b, "Zona");
    const zonaCompare = aZona.localeCompare(bZona, "it", {
      sensitivity: "base",
      numeric: true,
    });
    if (zonaCompare !== 0) return zonaCompare;

    // Producer
    const aProduttore = getField(a, "Produttore");
    const bProduttore = getField(b, "Produttore");
    const produttoreCompare = aProduttore.localeCompare(bProduttore, "it", {
      sensitivity: "base",
      numeric: true,
    });
    if (produttoreCompare !== 0) return produttoreCompare;

    // Tie-breaker for stability: wine name if present, otherwise id
    const an = getField(a, "Vino + Annata") || String(a?.id || "");
    const bn = getField(b, "Vino + Annata") || String(b?.id || "");
    return an.localeCompare(bn, "it", { sensitivity: "base", numeric: true });
  };

  // sort data by type - region - zone - producer
  const sortedData = [...data].sort(compare);

  return sortedData;
}

/** Validate and normalize raw **Airtable wine records** into a predictable structure,
 * splitting results into **valid**, **warning**, and **invalid** groups.
 *
 * The function:
 * - Iterates records **sequentially** to support async lookups (e.g. producer name resolution)
 * - Enforces **required** fields (missing required fields mark a record as *invalid*)
 * - Extracts values from Airtable “AI fields” that may be returned as **strings**, **arrays**, or **objects**
 * - Converts and normalizes the **price** into a numeric `price_eur` with **2 decimals**
 * - Resolves the **zone name** using the provided `zoneMapping`
 * - Collects a de-duplicated list of encountered **categories**
 *
 * @param {Array<object>} data
 * Raw Airtable record list (expected shape: each item has at least `{ id: string, fields: object }`),
 * typically returned from Airtable *List records* endpoints.
 *
 * @param {Record<string, { id: string, name: string, region?: string, country?: string, priority?: number }>} zoneMapping
 * A mapping object keyed by Airtable **Zone record ID** that resolves zone metadata (at minimum `name`).
 * Used to convert `record.fields["Zona"]` into a human-readable zone label.
 *
 * @returns {{
 *   validRecords: Array<{
 *     name: string,
 *     producer: string,
 *     zone: string,
 *     price_eur: number,
 *     category: string,
 *     region: string,
 *     grapes?: string,
 *     production_location?: string,
 *     aging?: string,
 *     abv?: string
 *   }>,
 *   warningRecords: Array<{ id: string, warningFields: Array<string> }>,
 *   invalidRecords: Array<{ id: string, invalidFields: Array<string> }>,
 *   categories: Array<string>
 * }}
 * An object containing:
 * - `validRecords`: normalized records ready for downstream processing (e.g. YAML/PDF generation)
 * - `warningRecords`: record IDs with missing optional fields
 * - `invalidRecords`: record IDs missing required fields (or failing critical conversions)
 * - `categories`: unique set of categories found across processed records
 *
 * @throws {Error}
 * Thrown when an unexpected runtime error occurs during iteration/normalization.
 * The thrown error includes diagnostic context such as partial outputs and inputs.
 *
 * @usage
 * ```js
 * const zoneMapping = await getZoneMapping();
 * const { validRecords, warningRecords, invalidRecords, categories } =
 *   await wineDataValidationAndNormalization(airtableRows, zoneMapping);
 *
 * if (invalidRecords.length) {
 *   console.log("Some records are invalid:", invalidRecords);
 * }
 *
 * // Use validRecords for YAML/PDF generation
 * buildWineListYaml(validRecords, categories);
 * ```
 *
 * @notes
 * - **Required fields** (record becomes *invalid* if missing):
 *   - `"Vino + Annata"`, `"Produttore"`, `"Zona"`, `"Prezzo In Carta Testo"`, `"Tipologia"`, `"Regione"`
 * - **Optional fields** (missing fields generate a *warning*):
 *   - `"Lista Vitigni AI"`, `"Luogo di Produzione"`, `"Affinamento AI"`, `"Alcolicità AI"`
 * - Producer resolution uses an async lookup (`getEnotecaDataById`) and extracts `producerData.fields["Nome"]`.
 * - Price parsing:
 *   - Accepts strings with comma decimals (e.g. `"12,50 €"`) and strips non-numeric characters.
 *   - Produces `price_eur` as a `number` with **two decimals**.
 * - The function does not mutate input `data` or `zoneMapping`.
 */
export async function wineDataValidationAndNormalization(data, zoneMapping) {
  // Helper function to extract value from Airtable AI fields
  // Handles both simple strings and objects with { state, value, isStale }
  const extractValue = (field) => {
    if (!field) return null;
    if (typeof field === "string") return field;
    if (typeof field === "object" && field !== null) {
      // Handle array case (e.g., production_location can be an array)
      if (Array.isArray(field)) {
        // If array contains objects with value, extract values
        return field
          .map((item) => {
            if (typeof item === "object" && item !== null && item.value) {
              return item.value;
            }
            return item;
          })
          .join(", ");
      }
      // Handle object with value property
      if (field.value !== undefined) {
        return field.value;
      }
    }
    return field;
  };

  /** Resolve the **human-readable zone name** from a given zone ID.
   *
   * This utility function:
   * - Validates the presence of a zone ID
   * - Safely accesses the global/local `zoneMapping` object
   * - Falls back gracefully when the mapping is unavailable or incomplete
   *
   * It is designed to be used during **wine list generation and YAML building**
   * where zone IDs must be converted into displayable labels.
   *
   * @param {string} zoneId
   * The Airtable **Zone record ID** to resolve.
   *
   * @returns {string}
   * The resolved **zone name** if available, otherwise the original `zoneId`.
   *
   * @throws {Error}
   * Thrown when `zoneId` is missing or falsy.
   *
   * @usage
   * ```js
   * const zoneName = getZoneName("recA1B2C3");
   * console.log(zoneName); // "Langhe"
   * ```
   *
   * @notes
   * - If `zoneMapping` is not defined or not an object, the function logs a warning
   *   and returns the raw `zoneId`.
   * - If the zone exists but has no `name`, the `zoneId` is returned as fallback.
   * - This function does **not** mutate `zoneMapping`.
   */
  const getZoneName = (zoneId) => {
    if (!zoneId) {
      throw new Error({
        msg: "Zone ID not found",
        source: "src/lib/wineList.js:wineDataYamlBuilder",
        zone_id: zoneId,
      });
    }
    // Safety check: if zoneMapping is not provided, return the zoneId as-is
    if (!zoneMapping || typeof zoneMapping !== "object") {
      logger.warning("Zone mapping not available, using zone ID as-is", {
        location: "src/lib/wineList.js:wineDataYamlBuilder",
        zone_id: zoneId,
      });
      return zoneId;
    }
    return zoneMapping[zoneId]?.name || zoneId;
  };

  const categories = [];

  const validRecords = [];
  const warningRecords = [];
  const invalidRecords = [];

  // Process records sequentially to handle async producer lookup
  try {
    for (let i = 0; i < data.length; i++) {
      const record = data[i];
      let currentRecord = {};
      let invalidFields = [];
      let warningFields = [];

      // name - REQUIRED, if missing SKIP
      if (
        !record.fields["Vino + Annata"] ||
        record.fields["Vino + Annata"] === ""
      ) {
        invalidFields.push("Vino + Annata");
      } else {
        currentRecord.name = record.fields["Vino + Annata"];
      }

      // producer - REQUIRED, if missing SKIP
      if (!record.fields["Produttore"] || record.fields["Produttore"] === "") {
        invalidFields.push("Produttore");
      } else {
        // currentRecord.producer = record.fields["Produttore"];
        try {
          const producerData = await getEnotecaDataById(
            record.fields["Produttore"]
          );
          currentRecord.producer = producerData.fields["Nome"];
        } catch (error) {
          invalidFields.push("Produttore");
          logger.warning({
            msg: "Error getting producer data by id",
            source: "src/lib/wineList.js:wineDataValidationAndNormalization",
            location: "src/lib/wineList.js:wineDataValidationAndNormalization",
            producerId: record.fields["Produttore"],
            error: error.message,
          });
        }
      }

      // grapes (lista vitigni ai) - OPTIONAL, if missing IGNORE FIELD
      const grapesValue = extractValue(record.fields["Lista Vitigni AI"]);
      if (!grapesValue || grapesValue === "") {
        warningFields.push("Lista Vitigni AI");
      } else {
        currentRecord.grapes = grapesValue;
      }

      // production_location (luogo di produzione) - OPTIONAL, if missing IGNORE FIELD
      const productionLocationValue = extractValue(
        record.fields["Luogo di Produzione"]
      );
      if (!productionLocationValue || productionLocationValue === "") {
        warningFields.push("Luogo di Produzione");
      } else {
        currentRecord.production_location = productionLocationValue;
      }

      // zone - REQUIRED, if missing SKIP
      if (!record.fields["Zona"] || record.fields["Zona"] === "") {
        invalidFields.push("Zona");
      } else {
        currentRecord.zone = getZoneName(record.fields["Zona"]);
      }

      // aging (affinamento ai) - OPTIONAL, if missing IGNORE FIELD
      const agingValue = extractValue(record.fields["Affinamento AI"]);
      if (!agingValue || agingValue === "") {
        warningFields.push("Affinamento AI");
      } else {
        currentRecord.aging = agingValue;
      }

      // price_eur (Prezzo In Carta Testo) - REQUIRED, if missing SKIP
      if (
        !record.fields["Prezzo In Carta Testo"] ||
        record.fields["Prezzo In Carta Testo"] === ""
      ) {
        invalidFields.push("Prezzo In Carta Testo");
      } else {
        // convert price to float with two decimal places, if possible
        const rawPrice = record.fields["Prezzo In Carta Testo"];
        let floatPrice = null;

        // try to convert price to float with two decimal places
        try {
          // replace comma with dot and remove non-numeric/display characters
          if (typeof rawPrice === "string") {
            floatPrice = parseFloat(
              rawPrice.replace(",", ".").replace(/[^\d.]/g, "")
            );
          } else {
            floatPrice = parseFloat(rawPrice);
          }

          if (isNaN(floatPrice)) {
            throw new Error(`Conversion error: value is NaN after parsing`);
          }

          currentRecord.price_eur = parseFloat(floatPrice.toFixed(2));
        } catch (err) {
          // log error and mark record as invalid for price_eur
          invalidFields.push("price_eur");
          logger.warning({
            msg: "Error converting price 'Prezzo In Carta Testo' to float",
            source: "src/lib/wineList.js:wineDataValidationAndNormalization",
            location: "src/lib/wineList.js:wineDataValidationAndNormalization",
            prezzo_grezzo: rawPrice,
            record_id: record.id,
            error: err.message,
          });
          currentRecord.price_eur = null;
        }
      }

      // abv (alcolicità ai) - OPTIONAL, if missing IGNORE FIELD
      const abvValue = extractValue(record.fields["Alcolicità AI"]);
      if (!abvValue || abvValue === "") {
        warningFields.push("Alcolicità AI");
      } else {
        // utilizza il valore originale di "Alcolicità AI" senza standardizzare
        currentRecord.abv = abvValue;
      }

      // category - REQUIRED, if missing SKIP
      if (!record.fields["Tipologia"] || record.fields["Tipologia"] === "") {
        invalidFields.push("Tipologia");
      } else {
        currentRecord.category = record.fields["Tipologia"];
      }

      // region - REQUIRED, if missing SKIP
      if (!record.fields["Regione"] || record.fields["Regione"] === "") {
        invalidFields.push("Regione");
      } else {
        currentRecord.region = record.fields["Regione"];
      }

      // add category to categories array (only if category exists and is a string)
      if (
        currentRecord.category &&
        typeof currentRecord.category === "string" &&
        !categories.includes(currentRecord.category)
      ) {
        categories.push(currentRecord.category);
      }

      if (invalidFields.length > 0) {
        invalidRecords.push({
          id: record.id,
          invalidFields: invalidFields,
        });
      } else if (warningFields.length > 0) {
        warningRecords.push({
          id: record.id,
          warningFields: warningFields,
        });
      } else {
        validRecords.push(currentRecord);
      }
    }
  } catch (error) {
    throw new Error({
      msg: "Error validating and normalizing wine data",
      source: "src/lib/wineList.js:wineDataValidationAndNormalization",
      error: error.message,
      status: error.status,
      statusText: error.statusText,
      data: data,
      zoneMapping: zoneMapping,
      validRecords: validRecords,
      warningRecords: warningRecords,
      invalidRecords: invalidRecords,
      categories: categories,
    });
  }

  return {
    validRecords: validRecords,
    warningRecords: warningRecords,
    invalidRecords: invalidRecords,
    categories: categories,
  };
}

/** Builds the metadata structure used to generate the YAML header
 * for a wine list / digital wine menu.
 *
 * This function aggregates **venue information**, **generation date**,
 * and **category definitions** into a normalized object suitable for:
 * - YAML serialization
 * - PDF generation
 * - Digital menu rendering
 *
 * @param {Object} enoteca
 * The venue (wine shop / restaurant) metadata object.
 *
 * @param {string[]} simple_categories
 * A list of category names (e.g. wine types) in simple string form.
 *
 * @returns {Object}
 * A structured metadata object containing:
 * - `meta`: document identifiers and references
 * - `main_cover`: cover page information (titles, images, QR, descriptions)
 * - `categories`: enriched category definitions with IDs and subtitles
 *
 * @notes
 * - Category IDs are automatically slugified from their names.
 * - The document ID and reference are date-based to ensure uniqueness.
 * - Default descriptions are injected when missing from the venue data.
 * - The output is designed to be YAML-serializable without further processing.
 */
export function metaDataYamlBuilder(enoteca, simple_categories) {
  const tod = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // Filter and validate categories: only keep non-empty strings
  const validCategories = (simple_categories || []).filter(
    (name) => name && typeof name === "string" && name.trim() !== ""
  );

  const elaborate_categories = validCategories.map((name) => ({
    id: name.toLowerCase().replace(/ /g, "-"),
    name: name,
    subtitle: `La nostra selezione di ${name}`,
    note: "Disponibilità dei vini soggetta a variazioni.",
  }));

  const metaData = {
    meta: {
      id: `${tod}-${enoteca.id}`,
      date: tod,
      ref: `${tod}-${enoteca.id}`,
    },
    main_cover: {
      title: "CARTA DEI VINI",
      venue_name: enoteca.name,
      description:
        !enoteca.description || enoteca.description === ""
          ? "Una selezione curata con passione, dai grandi classici ai piccoli produttori artigianali."
          : enoteca.description,
      logo_image: enoteca.logo_url,
      logo_alt: `Logo della ${enoteca.name}`,
      qr_image: enoteca.qr_image_url,
      qr_alt: `QR code per consultare la carta dei vini completa. URL: ${enoteca.digital_menu_url}`,
      qr_caption:
        "Scansiona il QR per visualizzare il menù completo e gli abbinamenti consigliati.",
      footer_note: `Lista aggiornata al ${tod}.`,
    },
    categories: elaborate_categories,
  };

  const yamlOptions = {
    indent: 2, // 2 spaces per indent
    lineWidth: -1, // No line width limit
    noRefs: true, // Disable YAML references
    sortKeys: false, // Preserve key order
  };

  const yamlString = yaml.dump(metaData, yamlOptions);

  return yamlString;
}

/** Retrieves a value from a map by key, or creates and stores it if missing.
 *
 * This utility implements a simple **get-or-create** (lazy initialization)
 * pattern, commonly used to group or accumulate values without repeated
 * existence checks.
 *
 * @param {Map<any, any>} map
 * The map used to store and retrieve values.
 *
 * @param {any} key
 * The key associated with the desired value.
 *
 * @param {() => any} factory
 * A factory function invoked to create the value if it does not already exist.
 *
 * @returns {any}
 * The existing value associated with the key, or the newly created one.
 *
 * @usage
 * ```ts
 * const groups = new Map();
 * const list = getOrCreate(groups, "red-wines", () => []);
 * list.push(wine);
 * ```
 *
 * @notes
 * - The factory function is called **only if** the key is not present.
 * - The newly created value is immediately stored in the map.
 */
export function wineDataYamlBuilder(data) {
  // # 1. Grouping step: category → region → zone → items
  // Build nested maps to group records by category, then region, then zone
  // Structure: Map<category, Map<region, Map<zone, Array<item>>>>
  /** Retrieves a value from a map by key, or creates and stores it if missing.
   *
   * This utility implements a simple **get-or-create** (lazy initialization)
   * pattern, commonly used to group or accumulate values without repeated
   * existence checks.
   *
   * @param {Map<any, any>} map
   * The map used to store and retrieve values.
   *
   * @param {any} key
   * The key associated with the desired value.
   *
   * @param {() => any} factory
   * A factory function invoked to create the value if it does not already exist.
   *
   * @returns {any}
   * The existing value associated with the key, or the newly created one.
   *
   * @usage
   * ```ts
   * const groups = new Map();
   * const list = getOrCreate(groups, "red-wines", () => []);
   * list.push(wine);
   * ```
   *
   * @notes
   * - The factory function is called **only if** the key is not present.
   * - The newly created value is immediately stored in the map.
   */
  const getOrCreate = (map, key, factory) => {
    let v = map.get(key);
    if (!v) {
      v = factory();
      map.set(key, v);
    }
    return v;
  };

  const groupedYamlPayload = new Map();
  // For each valid record, group by category → region → zone
  for (const record of data) {
    const categoryMap = getOrCreate(
      groupedYamlPayload,
      record.category,
      () => new Map()
    );
    const regionMap = getOrCreate(categoryMap, record.region, () => new Map());
    const zoneItems = getOrCreate(regionMap, record.zone, () => []);

    // Extract category, region, and zone from record (they're at section level, not item level)
    const { category, region, zone, ...itemData } = record;
    zoneItems.push(itemData);
  }

  // # 2. Shaping step: convert nested maps to YAML contract structure
  // Transform grouped structure into final contract: array of sections with items
  // Structure: [{ category, region, zone, items: [...] }, ...]
  const winesArray = [];
  // for each category, region, zone, add the items to the winesArray
  for (const [category, regionMap] of groupedYamlPayload) {
    for (const [region, zoneMap] of regionMap) {
      for (const [zone, items] of zoneMap) {
        winesArray.push({
          category,
          region,
          zone,
          items,
        });
      }
    }
  }

  // # 3. Serialization step: shape final contract object and serialize to YAML
  // Final contract: { wines: [{ category, region, zone, items: [...] }, ...] }
  const yamlContract = { wines: winesArray };

  // Serialize final contract object to YAML string
  const yamlOptions = {
    indent: 2, // 2 spaces per indent
    lineWidth: -1, // No line width limit
    noRefs: true, // Disable YAML references
    sortKeys: false, // Preserve key order
  };
  const yamlString = yaml.dump(yamlContract, yamlOptions);

  return yamlString;
}

/** Generates the complete YAML representation of a wine list for a given enoteca.
 *
 * This function orchestrates the full data-processing pipeline required to
 * transform raw Airtable wine records into a structured YAML document,
 * suitable for PDF generation or digital menu consumption.
 *
 * Processing steps:
 * 1. **Data cleaning** – removes unused fields and keeps only relevant columns.
 * 2. **Zone mapping retrieval** – resolves zone IDs to metadata (name, priority).
 * 3. **Data sorting** – orders wines by type, region, zone, and producer.
 * 4. **Validation & normalization** – enforces data contracts and normalizes values.
 * 5. **YAML building** – generates metadata and wine sections and merges them.
 *
 * @param {Object} data
 * Raw Airtable response object containing wine records.
 *
 * @param {Object} enoteca
 * The enoteca domain object used to generate metadata
 * (name, description, logo, QR code, identifiers, etc.).
 *
 * @returns {Promise<string>}
 * A promise that resolves to the full YAML string representing
 * the enoteca wine list (metadata + wines).
 *
 * @throws {Error}
 * Propagates any error thrown during data fetching, validation,
 * sorting, or YAML generation.
 *
 * @notes
 * - Invalid records are excluded from the final YAML output.
 * - Records with warnings are tracked but still processed if valid.
 * - Zone mapping is fetched asynchronously and used both for sorting
 *   and for resolving human-readable zone names.
 * - This function does not perform I/O operations (file writing).
 */
export default async function generateWineListYamlString(data, enoteca) {
  // # 0. Data Cleaning
  // clean data from unused columns and filter by 'Carta dei vini' and 'Enoteca'
  const cleanedData = wineDataCleaner(data);

  // # 1. Get Zone mapping (to sort and to get the name from id for payload)
  // NB: getZoneMapping è async
  // eslint-disable-next-line no-unused-vars
  const zoneMapping = await getZoneMapping();

  // # 2. Data Sorting: sort by type - region - zone - producer
  const sortedData = wineDataSorter(cleanedData, zoneMapping);

  // # 3. Data validation (contract) and normalization
  const { validRecords, warningRecords, invalidRecords, categories } =
    await wineDataValidationAndNormalization(sortedData, zoneMapping);

  // # 4. YAML Builder: build yaml payload
  const metaDataYamlString = metaDataYamlBuilder(enoteca, categories);
  const winesYamlString = wineDataYamlBuilder(validRecords);

  const fullYamlString = `${metaDataYamlString}\n\n${winesYamlString}`;

  return {
    fullYamlString: fullYamlString,
    validRecords: validRecords,
    warningRecords: warningRecords,
    invalidRecords: invalidRecords,
  };
}

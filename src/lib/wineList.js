import { logger } from "./logger/index.js";
import { getRecord } from "../lib/api/airtable/airtableApi.js";
import { fetchDefaultTableRecords } from "./api/airtable/airtableIndex.js";
import dotenv from "dotenv";
dotenv.config();

const { AIRTABLE_AUTH_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_ZONE_TAB_ID } = process.env;

/**
 * Cleans and normalizes raw Airtable wine records by stripping out
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
    const fields = record?.fields && typeof record.fields === "object" ? record.fields : {};
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

export async function getZoneMapping() {
  // Crea un mapping facile da usare: lookup per recordId (zoneId) -> metadati zona
  // Shape:
  // {
  //   [zoneId]: { id, name, region, country, priority }
  // }
  const zonesData = await fetchDefaultTableRecords({}, {
    authToken: AIRTABLE_AUTH_TOKEN,
    baseId: AIRTABLE_BASE_ID,
    tableIdOrName: AIRTABLE_ZONE_TAB_ID,
  });

  const records = Array.isArray(zonesData?.records) ? zonesData.records : [];

  const zoneMapping = {};
  for (const rec of records) {
    const id = rec?.id;
    if (!id) continue;

    const fields = rec?.fields && typeof rec.fields === "object" ? rec.fields : {};

    // Dai log: "Nome Zona", "Regione", "Nazione", "Priorità Zone"
    const name = fields["Nome Zona"] ?? fields["Zona"] ?? fields["Nome"] ?? null;
    const region = fields["Regione"] ?? null;
    const country = fields["Nazione"] ?? null;
    const priority = fields["Priorità Zone"] ?? fields["Priorità Zona"] ?? null;

    zoneMapping[id] = {
      id,
      name,
      region,
      country,
      priority,
    };
  }

  // TODO: log zones datas - REMOVE AFTER TESTING
  logger.info("Zone mapping built", {
    location: "src/lib/wineList.js:getZoneMapping",
    zones_total: records.length,
    mapping_total: Object.keys(zoneMapping).length,
    sample_zone_id: Object.keys(zoneMapping)[0],
    sample_zone: zoneMapping[Object.keys(zoneMapping)[0]],
    zone_mapping: zoneMapping
  });

  // TODO: capire come funziona il fatto delle priorità visto che sono da 1 a 3 e ovviamente duplicate

  return zoneMapping;
}

/**
 * Sorts cleaned wine records according to a deterministic, human-friendly order
 * suitable for building a wine list or wine menu.
 *
 * The sorting priority is:
 * 1. **Tipologia**
 * 2. **Regione**
 * 3. **Zona**
 * 4. **Produttore**
 * 5. Fallback tie-breaker: **Vino + Annata** (or record ID)
 *
 * The function is resilient to Airtable field formats, including:
 * - primitive values (string, number, boolean)
 * - arrays (linked records, multi-selects, lookups)
 * - objects with `{ value }` wrappers
 *
 * @param {Array<Object>} data  
 * An array of cleaned Airtable wine records.
 * Each record is expected to have a `fields` object.
 *
 * @returns {Array<Object>}  
 * A new array containing the sorted records.
 * Returns an empty array if input is empty or invalid.
 *
 * @usage
 * ```ts
 * const sortedWines = wineDataSorter(cleanedWineRecords);
 * ```
 *
 * @notes
 * - Sorting uses `localeCompare` with Italian locale (`"it"`),
 *   base sensitivity, and numeric ordering enabled.
 * - The original input array is **not mutated**.
 * - Normalization ensures consistent sorting even with heterogeneous
 *   Airtable field structures.
 * - Intended to be executed **after** `wineDataCleaner`.
 */
export function wineDataSorter(data) {
  if (!Array.isArray(data) || data.length === 0) return [];

  // TODO: prendere come parametro anche il mapping delle zone e ordinare anche per priorità zona

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

  const getField = (record, key) => normalizeSortValue(record?.fields?.[key]); // get the value of a field from a record

  // compare two records by type - region - zone - producer
  const compare = (a, b) => {
    const keys = ["Tipologia", "Regione", "Zona", "Produttore"];
    for (const k of keys) {
      const av = getField(a, k);
      const bv = getField(b, k);
      const c = av.localeCompare(bv, "it", { sensitivity: "base", numeric: true });
      if (c !== 0) return c;
    }
    // Tie-breaker per stabilità: nome vino se presente, altrimenti id
    const an = getField(a, "Vino + Annata") || String(a?.id || "");
    const bn = getField(b, "Vino + Annata") || String(b?.id || "");
    return an.localeCompare(bn, "it", { sensitivity: "base", numeric: true });
  };

  // sort data by type - region - zone - producer
  const sortedData = [...data].sort(compare);

  return sortedData;
}

export function wineDataYamlBuilder(data) {
  // TODO: log data to write in yaml - REMOVE AFTER TESTING
  logger.info("Data to convert to yaml", {
    location: "src/lib/wineList.js:wineDataYamlBuilder",
    data: data
  })

  // TODO: # 1. Data validation (contract)
  // name, producer, grapes (lista vitigni ai), production_location (luogo di produzione), zone, aging (affinamento ai), price_eur (Prezzo In Carta Testo), abv (alcolicità ai)
  // TODO: # 2. Data normalization
  // TODO: # 3. YAML formatting strategy
  // TODO: # 4. Serialization (object → YAML string)
  // TODO: # 5. File write (atomic & safe)
}

export default function saveYamlWineList(data) {
  // # 0. Data Cleaning
  // clean data from unused columns and filter by 'Carta dei vini' and 'Enoteca'
  const cleanedData = wineDataCleaner(data);

  // # 1. Get Zone mapping (to sort and to get the name from id for payload)
  // NB: getZoneMapping è async
  // eslint-disable-next-line no-unused-vars
  const zoneMappingPromise = getZoneMapping();

  // # 2. Data Sorting: sort by type - region - zone - producer
  const sortedData = wineDataSorter(cleanedData);

  // TODO: # 2. YAML Builder: build yaml payload
  const yamlPayload = wineDataYamlBuilder(sortedData);
}

// *  "Vino + Annata",
// !  "Prezzo Vendita Bottiglia (in Carta)",
// #  (il seguente deve essere true, se è false va tolto il record)
// *  "Carta dei Vini",
// !  "Dimensione Bottiglia",
// !  "IVA d'Acquisto",
// !  "Ricarico Percentuale",
// !  "Movimento Vini",
// !  "Fascia Alcolica",
// !  "Fascia di Prezzo",
// !  "IVA di Vendita",
// !  "Prezzo Vendita Bottiglia - IVA",
// !  "IVA di Vendita in Euro",
// !  "Affinamento ENG",
// TODO: wine catalog contiene il riferimento al record, da capire se fare un check da qui (male) o farli arrivare già filtrati
// ?  "Wine Catalog",
// # il seguente è un altro filtro, il suo valore deve essere uguale al valore enoteca dato come parametro all'inizio dello script
// TODO: enoteca contiene il riferimento al record, da capire se fare un check da qui (male) o farli arrivare già filtrati
// ?  "Enoteca",
// !  "Totale Caricati",
// !  "Totale Scaricati",
// !  "Giacenza",
// *  "Vino (from Wine Catalog)",
// *  "Lista Vitigni AI",
// *  "Produttore",
// *  "Alcolicità AI",
// *  "Affinamento AI",
// *  "Regione",
// *  "Zona",
// *  "Luogo di Produzione",
// *  "Tipologia",
// TODO: devo ordinare per questo? chiedere a sone
// *  "Priorità Zona",
// !  "Immagine Vino",
// *  "Prezzo In Carta Testo",
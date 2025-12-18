import { logger } from "./logger/index.js";
import { getRecord } from "../lib/api/airtable/airtableApi.js";

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

export function wineDataSorter(data) {
  if (!Array.isArray(data) || data.length === 0) return [];

  const normalizeSortValue = (v) => {
    // Airtable can return:
    // - string/number/boolean
    // - arrays (linked records, multi-select, lookups)
    // - objects like { state: "generated", value: "..." }
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return normalizeSortValue(v[0]);
    if (typeof v === "object") {
      if ("value" in v) return normalizeSortValue(v.value);
      return "";
    }
    return String(v).trim();
  };

  const getField = (record, key) => normalizeSortValue(record?.fields?.[key]);

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

  // TODO: log data - REMOVE AFTER TESTING
  logger.info("data before sorting", {
    location: "src/lib/wineList.js:wineDataSorter",
    data_type: typeof data,
    data_keys: Object.keys(data[0]),
    data_field_keys: Object.keys(data[0].fields),
  });

  const sorted = [...data].sort(compare);

  // TODO: log data - REMOVE AFTER TESTING
  logger.info("data after sorting", {
    location: "src/lib/wineList.js:wineDataSorter",
    first_sort_keys: {
      Tipologia: getField(sorted[0], "Tipologia"),
      Regione: getField(sorted[0], "Regione"),
      Zona: getField(sorted[0], "Zona"),
      Produttore: getField(sorted[0], "Produttore"),
    },
  });

  return sorted;
}

export default function saveYamlWineList(data) {
  // # 0. Data Cleaning
  // clean data from unused columns and filter by 'Carta dei vini' and 'Enoteca'
  const cleanedData = wineDataCleaner(data);

  // TODO: log cleaned data - REMOVE AFTER TESTING
  logger.info("Cleaned data", {
    location: "src/lib/wineList.js:saveYamlWineList",
    // cleaned_data: cleanedData,
    cleaned_data_number: cleanedData.length,
    cleaned_data_record_type: typeof cleanedData[0],
    cleaned_data_record_keys_number: Object.keys(cleanedData[0]).length,
    cleaned_data_record_keys: Object.keys(cleanedData[0]),
    cleaned_data_record_field_keys: Object.keys(cleanedData[0].fields)
  });

  // # 1. Data Sorting: sort by type - region - zone - producer
  const sortedData = wineDataSorter(cleanedData);

  // TODO: log sorted data - REMOVE AFTER TESTING
  logger.info("Sorted data", {
    location: "src/lib/wineList.js:saveYamlWineList",
    sorted_data_number: sortedData.length,
    sorted_data_record_type: typeof sortedData[0],
    sorted_data_record_keys_number: Object.keys(sortedData[0]).length,
    sorted_data_record_keys: Object.keys(sortedData[0]),
    sorted_data_record_field_keys: Object.keys(sortedData[0].fields)
  });

  // # 2. YAML Builder
  // yaml builder
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
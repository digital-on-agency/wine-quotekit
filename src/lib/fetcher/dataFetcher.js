import dotenv from "dotenv";
dotenv.config();

// src/data/fetchData.js
/** Fetches a **master record** and its **related records** from a configured data source,
 * returning a standardized payload for downstream processing (e.g., context building, YAML/PDF generation).
 *
 * This function:
 * - Reads the data-source configuration for the given `table`
 * - Fetches the master record (currently supports **Airtable**)
 * - Fetches all configured relations by executing their `filterByFormula` templates
 * - Returns a consistent structure containing `master`, `relations`, and `sourceMeta`
 *
 * @param {object} params
 * A parameter object used to identify which configured source to load.
 *
 * @param {string} params.table
 * The logical table key used to lookup a configuration entry inside `dataSourcesConfig`.
 * This is **not** necessarily the physical table name in the underlying data source.
 *
 * @returns {Promise<{
*   master: unknown,
*   relations: Record<string, unknown>,
*   sourceMeta: {
*     documentType: unknown,
*     baseId: string,
*     masterTable: string
*   }
* }>}
* A standardized object containing:
* - `master`: the fetched master record (source-dependent shape)
* - `relations`: a map where each key is `rel.name` and each value is the fetched rows array
* - `sourceMeta`: metadata about the source used to build the document
*
* @throws {Error}
* Throws when:
* - no configuration is found for the provided `table`
* - the underlying fetch operations fail (e.g., network/auth errors)
* - required external variables used in the function scope (e.g. `recordId`, `documentType`)
*   are missing or invalid at runtime
*
* @usage
* ```js
* const payload = await fetchData({ table: "wine_list" });
*
* // payload.master -> main record
* // payload.relations -> related datasets keyed by relation name
* // payload.sourceMeta -> info for builders/logging
* ```
*
* @notes
* - This implementation currently branches on `cfg.type === "airtable"`.
*   Additional source types can be supported by adding new branches that
*   populate `master` and `relations` while preserving the same output shape.
* - Relation formulas are treated as *templates* where `{recordId}` is replaced
*   with the runtime `recordId`. Ensure `recordId` is defined in scope.
* - `sourceMeta.documentType` is returned from the `documentType` variable in scope;
*   ensure it is set consistently for correct downstream routing.
*/
export async function fetchData({ table }) {
  // * 1. leggere config sorgente
  const cfg = dataSourcesConfig[table];
  if (!cfg) {
    throw new Error(`No data source config for table=${table}`, {
      location: "src/lib/fetcher/dataFetcher.js:fetchData",
      source: "src/lib/fetcher/dataFetcher.js:fetchData",
      table: table,
    });
  }

  // * 2. fetch del record master
  let master;
  if (cfg.type === "airtable") {
    master = await fetchAirtableRecord({
      baseId: cfg.baseId,
      table: cfg.masterTable,
      recordId,
    });
  }

  // * 3. fetch relazioni
  const relations = {};

  if (cfg.relations?.length) {
    for (const rel of cfg.relations) {
      if (cfg.type === "airtable") {
        const rows = await fetchAirtableRecords({
          baseId: cfg.baseId,
          table: rel.table,
          filterByFormula: rel.filterByFormula.replace("{recordId}", recordId),
        });
        relations[rel.name] = rows;
      }
      // altro tipo sorgente: stesso nome rel.name, altra implementazione
    }
  }

  // * 4. return struttura standard
  return {
    master,
    relations,
    sourceMeta: {
      documentType,
      baseId: cfg.baseId,
      masterTable: cfg.masterTable,
    },
  }
}

export const dataSourcesConfig = {
  // * 1. carta_vini
  carta_vini: {
    type: "airtable",
    baseId: process.env.AIRTABLE_BASE_ID_VINI,
    masterTable: process.env.AIRTABLE_TABLE_ID_VINI,
    relations: [
      {
        name: "vini",
        table: "Vini",
        linkField: "carta_vini_id", // ad esempio
        filterByFormula: 'carta_vini_id = "{recordId}"',
      },
    ],
  },
};

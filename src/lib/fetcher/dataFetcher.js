import { logger } from "../logger/index.js";

// src/data/fetchData.js
export async function fetchData({ table }) {
  // TODO: 1. leggere config sorgente
  const cfg = dataSourcesConfig[table];
  if (!cfg) {
    logger.error(`No data source config for table=${table}`, {
      source: "dataFetcher.js/fetchData",
      table: table,
    });
    throw new Error(`No data source config for table=${table}`);
  }

  // TODO: 2. fetch del record master
  let master;
  if (cfg.type === "airtable") {
    master = await fetchAirtableRecord({
      baseId: cfg.baseId,
      table: cfg.masterTable,
      recordId,
    });
  }

  // TODO: 3. fetch relazioni
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

  // TODO: 4. return struttura standard
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
  // TODO: capire come gestire il link con airtable, quali dati chiedere e soprattutto come
  carta_vini: {
    type: "airtable",
    baseId: "", // TODO: process.env.AIRTABLE_BASE_ID_VINI,
    masterTable: "",
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

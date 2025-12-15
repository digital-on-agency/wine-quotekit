import dotenv from "dotenv";
import { logger } from "./lib/logger/index.js";
import { fetchDefaultTableRecords } from "./lib/api/airtable/airtableIndex.js";
import saveYamlWineList from "./lib/wineList.js";

dotenv.config();

export default async function startGeneration({
    enoteca = "Porgi l'Altra Pancia",
    access_token = process.env.AIRTABLE_API_KEY,
    base_id = process.env.AIRTABLE_BASE_ID,
    table_id = process.env.AIRTABLE_TAB_ID,
    out_tab_id,
    out_record_id
}) {
    if (!enoteca) {
        logger.error("Enoteca is required", {
            location: "startGeneration",
            enoteca: enoteca,
        });
        
        // TODO: reactivate throw error and delete the default value
        // const enoteca = "Porgi l'Altra Pancia"
        // throw new Error("PARAM_ERROR: enoteca is required");
    }
    if (!access_token) {
        logger.warning("Missing access token, using default from environment variables", {
            location: "startGeneration",
            access_token: access_token,
        });
        access_token = process.env.AIRTABLE_API_KEY;
    }
    if (!base_id) {
        logger.warning("Missing base id, using default from environment variables", {
            location: "startGeneration",
            base_id: base_id,
        });
        base_id = process.env.AIRTABLE_BASE_ID;
    }
    if (!table_id) {
        logger.warning("Missing table id, using default from environment variables", {
            location: "startGeneration",
            table_id: table_id,
        });
        table_id = process.env.AIRTABLE_TAB_ID;
    }
    if (!out_tab_id) {
        logger.error("Missing out tab id, it is required", {
            location: "startGeneration",
            out_tab_id: out_tab_id,
        });
        // TODO: reactivate throw error
        // throw new Error("PARAM_ERROR: out tab id is required");
    }
    if (!out_record_id) {
        logger.error("Missing out record id, it is required", {
            location: "startGeneration",
            out_record_id: out_record_id,
        });
        // TODO: reactivate throw error
        // throw new Error("PARAM_ERROR: out record id is required");
    }

    // # 1. fetch data from Airtable
    let data;
    try{
        // try to fetch data from Airtable
        data = await fetchDefaultTableRecords({}, {
            authToken: access_token,
            baseId: base_id,
            tableIdOrName: table_id,
        });
    } catch (error) {
        // if error, log and throw
        logger.error("Error fetching data from Airtable", {
            location: "startGeneration",
            error: error,
        });
        throw new Error("ERROR: Error fetching data from Airtable");
    }

    // TODO: log data fetched from Airtable - REMOVE THIS AFTER TESTING
    logger.info("Data fetched from Airtable", {
        location: "startGeneration",
        // results: data.records,
        results_number: data.records.length,
    });

    // TODO: 2. build payload with middleware (handlebars)
    saveYamlWineList(data);

    // TODO: 3. generate document
    // TODO: 4. save document
}

// Permetti l'invocazione diretta del file da CLI per lanciare startGeneration
if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1] === new URL(import.meta.url).href.replace("file://", "")) {
    startGeneration({})
      // .then(result => {
      //   // Mostra i risultati in forma compatta su stdout
      //   console.log(JSON.stringify(result, null, 2));
      //   console.error(`\nTotale record recuperati: ${result.records.length}`);
      // })
      .catch(err => {
        console.error("Errore in startGeneration:", err);
        process.exit(1);
      });
  }

// Parametri accettati da startGeneration:
/*
{
    // 'opt' : 'wine_list_generation',
    // 'enoteca' : 'value',
    // 'access_token' : 'value',
    // 'base_id' : 'value',
    // 'table_id' : 'value',
    // 'out_tab_id' : 'value',
    // 'out_record_id' : 'value'
}
*/
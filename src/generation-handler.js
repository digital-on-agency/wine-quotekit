import dotenv from "dotenv";
import { logger } from "./lib/logger/index.js";
import { fetchDefaultTableRecords, findEnotecaRecordId } from "./lib/api/airtable/airtableIndex.js";
import saveYamlWineList from "./lib/wineList.js";

dotenv.config();

export default async function startGeneration({
    enoteca = "Porgi l'Altra Pancia",
    access_token = process.env.AIRTABLE_API_KEY,
    base_id = process.env.AIRTABLE_BASE_ID,
    table_id = process.env.AIRTABLE_INV_TAB_ID,
    out_tab_id,
    out_record_id
}) {
    // # 0. Param Validation
    
    if (!enoteca) {
        logger.error("Enoteca is required", {
            location: "src/generation-handler.js:startGeneration",
            enoteca: enoteca,
        });
        
        // TODO: reactivate throw error and delete the default value
        // const enoteca = "Porgi l'Altra Pancia"
        // throw new Error("PARAM_ERROR: enoteca is required");
    }
    if (!access_token) {
        logger.warning("Missing access token, using default from environment variables", {
            location: "src/generation-handler.js:startGeneration",
            access_token: access_token,
        });
        access_token = process.env.AIRTABLE_API_KEY;
    }
    if (!base_id) {
        logger.warning("Missing base id, using default from environment variables", {
            location: "src/generation-handler.js:startGeneration",
            base_id: base_id,
        });
        base_id = process.env.AIRTABLE_BASE_ID;
    }
    if (!table_id) {
        logger.warning("Missing table id, using default from environment variables", {
            location: "src/generation-handler.js:startGeneration",
            table_id: table_id,
        });
        table_id = process.env.AIRTABLE_INV_TAB_ID;
    }
    if (!out_tab_id) {
        logger.error("Missing out tab id, it is required", {
            location: "src/generation-handler.js:startGeneration",
            out_tab_id: out_tab_id,
        });
        // TODO: reactivate throw error
        // throw new Error("PARAM_ERROR: out tab id is required");
    }
    if (!out_record_id) {
        logger.error("Missing out record id, it is required", {
            location: "src/generation-handler.js:startGeneration",
            out_record_id: out_record_id,
        });
        // TODO: reactivate throw error
        // throw new Error("PARAM_ERROR: out record id is required");
    }

    // # 1. Trova il record ID dell'enoteca

    let enotecaRecordId = null;
    if (enoteca) {
        try {
            // Fetch the enoteca record ID from Airtable
            enotecaRecordId = await findEnotecaRecordId(enoteca, {
                authToken: access_token,
                baseId: base_id,
            });
            
            // If the enoteca record ID is not found, log an error 
            if (!enotecaRecordId) {
                logger.error("Enoteca not found, filtering by name will be skipped - Error finding enoteca record ID", {
                    location: "src/generation-handler.js:startGeneration",
                    enoteca: enoteca,
                    error: "Enoteca not found",
                });
                throw new Error("ERROR: Enoteca not found, filtering by name will be skipped - Error finding enoteca record ID");
            }
        } catch (error) { // If an error occurs, log an error and throw an error
            logger.error("Error finding enoteca record ID", {
                location: "src/generation-handler.js:startGeneration",
                enoteca: enoteca,
                error: error,
            });
            throw new Error("ERROR: Error finding enoteca record ID");
        }
    }
    
    // TODO: deubg logging - REMOVE AFTER TESTING
    logger.info("STEP 1 - Obtained enoteca record ID - Success", {
        location: "src/generation-handler.js:startGeneration",
        enotecaRecordId: enotecaRecordId,
    });

    // # 2. Costruisci il filterByFormula con le condizioni
    // Nota: in Airtable un checkbox può essere testato anche come boolean diretto: `{Campo}`
    // (equivalente a `{Campo}=TRUE()` ma più robusto)
    let filterFormula = "{Carta dei Vini}";
    
    if (enotecaRecordId) {
        // Aggiungi il filtro per Enoteca.
        // Importante: a seconda della base, `{Enoteca}` può essere:
        // - linked record field -> contiene record IDs
        // - lookup/text field   -> contiene nomi
        // Per evitare 0 record “misteriosi”, accettiamo entrambe le forme.
        //
        // Se `{Enoteca}` è linked: ARRAYJOIN({Enoteca}) produce una stringa di recordId.
        // Se `{Enoteca}` è lookup: ARRAYJOIN({Enoteca}) produce una stringa di nomi.
        const enotecaMatchFormula = `OR(` +
          `FIND("${enotecaRecordId}", ARRAYJOIN({Enoteca}, ",")) > 0, ` +
          `FIND("${String(enoteca).replace(/"/g, '\\"')}", ARRAYJOIN({Enoteca}, ",")) > 0` +
        `)`;

        filterFormula = `AND({Carta dei Vini}, ${enotecaMatchFormula})`;
    }

    logger.info("STEP 2 - Fetching data from Airtable with filter - Success", {
        location: "generation-handler.js:startGeneration",
        filterFormula: filterFormula,
        enoteca: enoteca,
        enotecaRecordId: enotecaRecordId,
    });

    // # 3. fetch data from Airtable with filter
    let data;
    try{
        // try to fetch data from Airtable
        data = await fetchDefaultTableRecords({
            filterByFormula: filterFormula,
        }, {
            authToken: access_token,
            baseId: base_id,
            tableIdOrName: table_id,
        });
    } catch (error) {
        // if error, log and throw
        logger.error("Error fetching data from Airtable", {
            location: "src/generation-handler.js:startGeneration",
            error: error,
        });
        throw new Error("ERROR: Error fetching data from Airtable");
    }

    logger.info("STEP 3 - Data fetched from Airtable with filter - Success", {
        location: "src/generation-handler.js:startGeneration",
        // data: data,
        data_number: data.records.length,
    });

    // TODO: # 4. build payload with middleware (handlebars)
    saveYamlWineList(data);

    // TODO: # 5. generate document
    // TODO: # 6. save document
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
import { logger } from "./logger/index.js";

export function wineDataCleaner(data) {
  // TODO: remove debug logs
  logger.info({
    location: "src/lib/wineList.js:wineDataCleaner",
    data_type: typeof data,
    data_keys_number: Object.keys(data).length,
    data_keys: Object.keys(data),
    data_records_number: data.records.length,
    data_record_type: typeof data.records[0],
    data_record_keys_number: Object.keys(data.records[0]).length,
    data_record_keys: Object.keys(data.records[0]),
    data_record_fields_type: typeof data.records[0].fields,
    data_record_fields_keys_number: Object.keys(data.records[0].fields).length,
    data_record_fields_keys: Object.keys(data.records[0].fields),
    data_record_fields_example: data.records[1].fields,
  });
}

export default function saveYamlWineList(data) {
  // clean data from unused columns and filter by 'Carta dei vini' and 'Enoteca'
  const cleanedData = wineDataCleaner(data);
  // sort by type - region - zone - producer
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
// ?  "Priorità Zona",
// !  "Immagine Vino",
// *  "Prezzo In Carta Testo",


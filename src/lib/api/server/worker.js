import { logger } from "../../logger/index.js";
import dotenv from "dotenv";
import startGeneration from "../../../generation-handler.js";

export async function wineListController(
    req,
    res
){
    // * 0. param validation

    let paramError = {};

    if (!req.enotecaId) {
        paramError["enotecaId"] = "Missing `enotecaId` parameter";
    } else if (!/^rec[a-zA-Z0-9]{14}$/.test(enotecaId)) {
        paramError["enotecaId"] = "Invalid `enotecaId` parameter: must match /^rec[a-zA-Z0-9]{14}$/ (`rec` + 14 alphanumeric char)";
    }

    if (!req.access_token) {
        paramError["access_token"] = "Missing `access_token` parameter";
    } else if (!/^patm[a-zA-Z0-9]{8,32}\.[a-f0-9]{40,80}$/.test(access_token)) {
        paramError["access_token"] = "Invalid `access_token` parameter: must match /^patm[a-zA-Z0-9]{8,32}\.[a-f0-9]{40,80}$/";
    }

    if (!req.base_id) {
        paramError["base_id"] = "Missing `base_id` parameter";
    } else if (!/^app[a-zA-Z0-9]{14}$/.test(base_id)) {
        paramError["base_id"] = "Invalid `base_id` parameter: must match /^app[a-zA-Z0-9]{14}$/ (`app` + 14 alphanumeric char)";
    }

    if (!req.table_id) {
        paramError["table_id"] = "Missing `table_id` parameter";
    } else if (!/^tbl[a-zA-Z0-9]{14}$/.test(table_id)) {
        paramError["table_id"] = "Invalid `table_id` parameter: must match /^tbl[a-zA-Z0-9]{14}$/ (`tbl` + 14 alphanumeric char)";
    }

    if (!req.wine_list_tab_id) {
        paramError["wine_list_tab_id"] = "Missing `wine_list_tab_id` parameter";
    } else if (!/^tbl[a-zA-Z0-9]{14}$/.test(wine_list_tab_id)) {
        paramError["wine_list_tab_id"] = "Invalid `wine_list_tab_id` parameter: must match /^tbl[a-zA-Z0-9]{14}$/ (`tbl` + 14 alphanumeric char)";
    }

    if (!req.enoteca_table_id) {
        paramError["enoteca_table_id"] = "Missing `enoteca_table_id` parameter";
    } else if (!/^tbl[a-zA-Z0-9]{14}$/.test(enoteca_table_id)) {
        paramError["enoteca_table_id"] = "Invalid `enoteca_table_id` parameter: must match /^tbl[a-zA-Z0-9]{14}$/ (`tbl` + 14 alphanumeric char)";
    }
    
    if (!req.out_tab_id) {
        paramError["out_tab_id"] = "Missing `out_tab_id` parameter";
    } else if (!/^tbl[a-zA-Z0-9]{14}$/.test(out_tab_id)) {
        paramError["out_tab_id"] = "Invalid `out_tab_id` parameter: must match /^tbl[a-zA-Z0-9]{14}$/ (`tbl` + 14 alphanumeric char)";
    }

    if (!req.out_field_id) {
        paramError["out_field_id"] = "Missing `out_field_id` parameter";
    } else if (!/^fld[a-zA-Z0-9]+$/.test(out_field_id)) {
        paramError["out_field_id"] = "Invalid `out_field_id` parameter: must start with `fld` and be followed by alphanumeric characters (ex: /^fld[a-zA-Z0-9]+$/)";
    }

    // if there are any parameters errors, log and return error response
    if (Object.keys(paramError).length > 0) {
        logger.error("Invalid parameters", {
            // TODO: logger parameters
        });
        // TODO: return error response
    }

    try {
        // * 1. worker call
        await wineListWorker(
            req.enotecaId,
            req.access_token,
            req.base_id,
            req.table_id,
            req.wine_list_tab_id,
            req.enoteca_table_id,
            req.out_tab_id,
            req.out_field_id
        );

        return res.status(200).json({
            success: true,
            // TODO: need to send other infos
            message: "PDF generation started",
        });
    } catch (error) {
        logger.error("Error during PDF generation", {
            error: error,
            location: "src/lib/api/server/worker.js:wineListController",
            source: error.source,
        });
        return res.status(500).json({
            success: false, 
            message: "Error during PDF generation",
            error: error.message,
            location: "src/lib/api/server/worker.js:wineListController",
            source: error.source,
        })
    }


}

async function wineListWorker(
  enotecaId,
  access_token,
  base_id,
  table_id,
  wine_list_tab_id,
  enoteca_table_id,
  out_tab_id,
  out_field_id
) {
  try {
    await startGeneration({
      enoteca: enotecaId,
      access_token: access_token,
      base_id: base_id,
      table_id: table_id,
      wine_list_tab_id: wine_list_tab_id,
      enoteca_table_id: enoteca_table_id,
      out_tab_id: out_tab_id,
      out_field_id: out_field_id,
    });
  } catch (error) {
    throw new Error("ERROR: Error during PDF generation", {
      location: "src/lib/api/server/worker.js:wineListWorker",
      source: error.source,
      error: error,
    });
  }
}

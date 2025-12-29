import { logger } from "../../logger/index.js";
import dotenv from "dotenv";
import startGeneration from "../../../generation-handler.js";

export async function wineListController(req, res) {
  // * 0. param validation

  const params = req.body;
  
  // Log received parameters for debugging
  logger.info("wineListController received request", {
    location: "src/lib/api/server/worker.js:wineListController",
    bodyKeys: Object.keys(params),
    hasEnotecaId: !!params.enotecaId,
    hasBaseId: !!params.base_id,
    hasTableId: !!params.table_id,
    enotecaId: params.enotecaId,
    base_id: params.base_id,
    table_id: params.table_id,
  });
  
  let paramError = {};

  if (!params.enotecaId) {
    paramError["enotecaId"] = "Missing `enotecaId` parameter";
  } else if (!/^rec[a-zA-Z0-9]{14}$/.test(params.enotecaId)) {
    paramError["enotecaId"] =
      "Invalid `enotecaId` parameter: must match /^rec[a-zA-Z0-9]{14}$/ (`rec` + 14 alphanumeric char)";
  }

  if (!params.access_token) {
    paramError["access_token"] = "Missing `access_token` parameter";
  } 
//   else if (
//     !/^patm[a-zA-Z0-9]{8,32}\.[a-f0-9]{40,80}$/.test(params.access_token)
//   ) {
//     paramError["access_token"] =
//       "Invalid `access_token` parameter: must match /^patm[a-zA-Z0-9]{8,32}.[a-f0-9]{40,80}$/";
//   }

  if (!params.base_id) {
    paramError["base_id"] = "Missing `base_id` parameter";
  } else if (!/^app[a-zA-Z0-9]{14}$/.test(params.base_id)) {
    paramError["base_id"] =
      "Invalid `base_id` parameter: must match /^app[a-zA-Z0-9]{14}$/ (`app` + 14 alphanumeric char)";
  }

  if (!params.table_id) {
    paramError["table_id"] = "Missing `table_id` parameter";
  } else if (!/^tbl[a-zA-Z0-9]{14}$/.test(params.table_id)) {
    paramError["table_id"] =
      "Invalid `table_id` parameter: must match /^tbl[a-zA-Z0-9]{14}$/ (`tbl` + 14 alphanumeric char)";
  }

  if (!params.wine_list_tab_id) {
    paramError["wine_list_tab_id"] = "Missing `wine_list_tab_id` parameter";
  } else if (!/^tbl[a-zA-Z0-9]{14}$/.test(params.wine_list_tab_id)) {
    paramError["wine_list_tab_id"] =
      "Invalid `wine_list_tab_id` parameter: must match /^tbl[a-zA-Z0-9]{14}$/ (`tbl` + 14 alphanumeric char)";
  }

  if (!params.enoteca_table_id) {
    paramError["enoteca_table_id"] = "Missing `enoteca_table_id` parameter";
  } else if (!/^tbl[a-zA-Z0-9]{14}$/.test(params.enoteca_table_id)) {
    paramError["enoteca_table_id"] =
      "Invalid `enoteca_table_id` parameter: must match /^tbl[a-zA-Z0-9]{14}$/ (`tbl` + 14 alphanumeric char)";
  }

  if (!params.out_tab_id) {
    paramError["out_tab_id"] = "Missing `out_tab_id` parameter";
  } else if (!/^tbl[a-zA-Z0-9]{14}$/.test(params.out_tab_id)) {
    paramError["out_tab_id"] =
      "Invalid `out_tab_id` parameter: must match /^tbl[a-zA-Z0-9]{14}$/ (`tbl` + 14 alphanumeric char)";
  }

  if (!params.out_field_id) {
    paramError["out_field_id"] = "Missing `out_field_id` parameter";
  } else if (!/^fld[a-zA-Z0-9]+$/.test(params.out_field_id)) {
    paramError["out_field_id"] =
      "Invalid `out_field_id` parameter: must start with `fld` and be followed by alphanumeric characters (ex: /^fld[a-zA-Z0-9]+$/)";
  }

  // if there are any parameters errors, log and return error response
  if (Object.keys(paramError).length > 0) {
    logger.error("Invalid parameters", {
      location: "src/lib/api/server/worker.js:wineListController",
      paramError: paramError,
      req: req,
    });
    return res.status(400).json({
      success: false,
      message: "Invalid parameters",
      paramError: paramError,
      location: "src/lib/api/server/worker.js:wineListController",
    });
  }

  try {
    // * 1. worker call
    await wineListWorker(
      params.enotecaId,
      params.access_token,
      params.base_id,
      params.table_id,
      params.wine_list_tab_id,
      params.enoteca_table_id,
      params.out_tab_id,
      params.out_field_id
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
    });
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
    // Log parameters for debugging
    logger.info("wineListWorker called with parameters", {
      location: "src/lib/api/server/worker.js:wineListWorker",
      enotecaId,
      base_id,
      table_id,
      hasAccessToken: !!access_token,
    });
    
    await startGeneration({
      enotecaId: enotecaId,
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

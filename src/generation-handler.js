// # -------------------------- IMPORT DEPENDENCIES --------------------------
// environment variables
import dotenv from "dotenv";
// filesystem
import fs from "node:fs/promises";
import { constants } from "node:fs";
import crypto from "node:crypto";
// path
import path from "node:path";
import { fileURLToPath } from "node:url";
// logger
import { logger } from "./lib/logger/index.js";
// airtable
import {
  fetchDefaultTableRecords,
  findEnotecaRecordId,
  getEnotecaData,
  loadWineListToAirtable,
} from "./lib/api/airtable/airtableIndex.js";
// wine list utils functions
import generateWineListYamlString from "./lib/wineList.js";
// build function for PDF generation
import { build } from "./build.js";

// # -------------------------- GLOBAL VARIABLES --------------------------

dotenv.config();

// Setup working directories and template/output paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// project root (src → ..)
const PROJECT_ROOT = path.resolve(__dirname, "..");

// Output directory for menu YAML data files
const MENU_DATA_DIR = path.join(PROJECT_ROOT, "data", "menu");

// Output directory for PDF files
const PDF_OUTPUT_DIR = path.join(PROJECT_ROOT, "out");

// # -------------------------- FUNCTIONS --------------------------

/** Writes data to disk using an atomic, path-traversal-safe strategy.
 *
 * The function:
 * - Validates inputs (`baseDir` must be absolute, `relativePath` must be relative)
 * - Sanitizes and resolves the target path to prevent directory escape
 * - Writes to a uniquely named temporary file in the target directory
 * - `fsync`s the temp file, then atomically renames it to the final target
 * - Optionally enforces *no-overwrite* semantics
 * - Performs best-effort directory `fsync` for improved durability
 * - Cleans up temporary files on failure
 *
 * @param {Object} params
 * Function parameters.
 *
 * @param {string} params.baseDir
 * Absolute base directory under which the write is allowed.
 *
 * @param {string} params.relativePath
 * Relative path (within `baseDir`) of the target file to write.
 *
 * @param {string | Buffer | Uint8Array} params.data
 * The content to write to disk.
 *
 * @param {boolean} [params.overwrite=true]
 * Whether to overwrite the target if it already exists.
 *
 * @param {number} [params.mode=0o600]
 * File permission mode to apply to the written file (when applicable).
 *
 * @returns {Promise<{ absPath: string; bytes: number }>}
 * Resolves with the absolute written path and the number of bytes written.
 *
 * @throws {Error}
 * Throws when:
 * - `baseDir` is missing/invalid or not an absolute path
 * - `relativePath` is invalid or resolves outside `baseDir`
 * - the target directory is missing or not writable
 * - `data` is not a `string`, `Buffer`, or `Uint8Array`
 * - `overwrite` is false and the target already exists
 * - any filesystem operation fails (write/sync/rename/unlink)
 *
 * @usage
 * ```ts
 * const { absPath, bytes } = await writeFileAtomicSafe({
 *   baseDir: "/var/app/out",
 *   relativePath: "exports/menu.yaml",
 *   data: yamlString,
 * });
 * ```
 *
 * @notes
 * - Atomicity is achieved by `rename()` from a temp file in the same directory.
 * - This function is intended for Node.js environments (uses `fs/promises` and `path`).
 * - The `mode` parameter is accepted for future/extended behavior; ensure permissions
 *   are applied if your implementation requires it.
 */
export async function writeFileAtomicSafe({
  baseDir,
  relativePath,
  data,
  overwrite = true,
  mode = 0o600,
}) {
  // * Input validation & invariants
  // Ensure baseDir is provided and is an absolute path
  if (!baseDir || typeof baseDir !== "string" || !path.isAbsolute(baseDir)) {
    throw new Error("Invalid baseDir: must be a valid absolute path", {
      location: "src/generation-handler.js:writeFileAtomicSafe",
    });
  }

  // Ensure relativePath is provided and is NOT an absolute path
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("Invalid relativePath: must be a valid string", {
      location: "src/generation-handler.js:writeFileAtomicSafe",
      relativePath: relativePath,
    });
  }

  // * Path normalization & security
  // Normalize the relative path to remove ".." and redundant separators and sanitize the path to prevent path traversal attacks
  const safeRel = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");

  // Resolve baseDir to an absolute canonical path
  const absBase = path.resolve(baseDir);

  // Resolve the final target path from baseDir + sanitized relative path
  const absTarget = path.resolve(absBase, safeRel);

  // Verify that the resolved target path is strictly inside baseDir
  if (!absTarget.startsWith(absBase)) {
    throw new Error("Invalid relativePath: target path escapes baseDir", {
      location: "src/generation-handler.js:writeFileAtomicSafe",
      absTarget: absTarget,
      absBase: absBase,
    });
  }

  // * Target directory preparation
  // Extract the directory from the final target path
  const dir = path.dirname(absTarget);

  // Ensure directory exists and is writable, if not throw an error
  try {
    // Create directory if it doesn't exist (recursively)
    await fs.mkdir(dir, { recursive: true });

    // Verify that the path is actually a directory
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      throw new Error("Invalid baseDir: must be a directory", {
        location: "src/generation-handler.js:writeFileAtomicSafe",
        absTarget: absTarget,
        absBase: absBase,
        dir: dir,
        error: error,
      });
    }

    // Check if directory is writable
    await fs.access(dir, constants.W_OK);
  } catch (error) {
    logger.error(
      "Error checking directory, dir is not a directory or is not writable",
      {
        location: "src/generation-handler.js:writeFileAtomicSafe",
        baseDir: baseDir,
        relativePath: relativePath,
        dir: dir,
        error: error,
      }
    );
    throw new Error(
      "Error checking directory, dir is not a directory or is not writable: " +
        error.message,
      {
        location: "src/generation-handler.js:writeFileAtomicSafe",
        baseDir: baseDir,
        relativePath: relativePath,
        dir: dir,
        error: error,
      }
    );
  }

  // * Temporary file generation
  // Generate a unique temporary filename in the same directory as the target
  const tmpName =
    "." + path.basename(absTarget) + ".tmp-" + crypto.randomUUID?.() ??
    crypto.randomBytes(16).toString("hex");

  const tmpPath = path.resolve(dir, tmpName);

  // * Atomic write to temporary file
  let fh;
  try {
    fh = await fs.open(tmpPath, "wx");
    // check if data is a string, Uint8Array, or Buffer
    if (
      typeof data === "string" ||
      data instanceof Uint8Array ||
      Buffer.isBuffer(data)
    ) {
      // if data is a string, Uint8Array, or Buffer, write it to the temporary file
      await fh.write(data);
    } else {
      // if data is not a string, Uint8Array, or Buffer, throw an error
      throw new Error("data must be string, Buffer, or Uint8Array.", {
        location: "src/generation-handler.js:writeFileAtomicSafe",
        baseDir: baseDir,
        relativePath: relativePath,
        tmpPath: tmpPath,
        data: data,
        error: "data must be string, Buffer, or Uint8Array.",
      });
    }

    // Force content to disk
    await fh.sync();
    await fh.close();
    fh = undefined;

    // Atomic replace/commit: if overwrite is false, throw an error if the target file already exists
    if (!overwrite) {
      // If you want strict no-overwrite semantics, you can fail if exists right now:
      try {
        await fs.access(absTarget);
        throw new Error("Target already exists (overwrite=false).", {
          location: "src/generation-handler.js:writeFileAtomicSafe",
          absTarget: absTarget,
          overwrite: overwrite,
        });
      } catch {}
    }

    // Atomic rename: rename the temporary file to the final target filename
    await fs.rename(tmpPath, absTarget);

    // Best-effort: fsync directory (improves durability on some filesystems): ignore failures safely.
    try {
      const d = await fs.open(dir, "r");
      await d.sync();
      await d.close();
    } catch (error) {
      logger.error("Error fsyncing directory", {
        location: "src/generation-handler.js:writeFileAtomicSafe",
        baseDir: baseDir,
        relativePath: relativePath,
        dir: dir,
        error: error,
      });
      throw new Error("Error fsyncing directory: " + error.message, {
        location: "src/generation-handler.js:writeFileAtomicSafe",
        baseDir: baseDir,
        relativePath: relativePath,
        dir: dir,
        error: error,
      });
    }

    // Safety cleanup: ensure temporary file is removed if it still exists
    // (shouldn't happen after successful rename, but just in case)
    try {
      await fs.access(tmpPath);
      // If we reach here, the temp file still exists (rename might have failed silently)
      logger.warn("Temporary file still exists after rename, removing it", {
        location: "src/generation-handler.js:writeFileAtomicSafe",
        tmpPath: tmpPath,
        absTarget: absTarget,
      });
      await fs.unlink(tmpPath);
    } catch (error) {
      // File doesn't exist (expected after successful rename) or unlink failed
      // This is fine, we can ignore it
    }

    // Compute the written byte size
    const bytes =
      typeof data === "string"
        ? Buffer.byteLength(data)
        : Buffer.byteLength(Buffer.from(data));

    // Return the absolute path of the written file and the number of bytes written
    return { absPath: absTarget, bytes };
  } catch (error) {
    // Cleanup temp
    try {
      // safely close the file handle
      if (fh) await fh.close();
    } catch (closeError) {
      logger.error("Error closing file handle", {
        location: "src/generation-handler.js:writeFileAtomicSafe",
        baseDir: baseDir,
        relativePath: relativePath,
        tmpPath: tmpPath,
        error: closeError,
      });
    }

    // * Error handling & cleanup
    // safely remove the temporary file
    try {
      await fs.unlink(tmpPath);
    } catch (unlinkError) {
      logger.error("Error unlinking temporary file", {
        location: "src/generation-handler.js:writeFileAtomicSafe",
        baseDir: baseDir,
        relativePath: relativePath,
        tmpPath: tmpPath,
        error: unlinkError,
      });
    }

    // Log the original error and rethrow it
    logger.error("Error writing file", {
      location: "src/generation-handler.js:writeFileAtomicSafe",
      baseDir: baseDir,
      relativePath: relativePath,
      tmpPath: tmpPath,
      error: error,
    });

    // Rethrow the original error
    throw error;
  }
}

export default async function startGeneration({
  // TODO: cambiare enoteca dal nome al record id
  enoteca = "Porgi l'Altra Pancia",
  access_token = process.env.AIRTABLE_API_KEY,
  base_id = process.env.AIRTABLE_BASE_ID,
  table_id = process.env.AIRTABLE_INV_TAB_ID,
  wine_list_tab_id = process.env.AIRTABLE_WINE_LIST_TAB_ID,
  enoteca_table_id = process.env.AIRTABLE_ENO_TAB_ID,
  out_tab_id,
  out_record_id,
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
    logger.warning(
      "Missing access token, trying to use default from environment variables",
      {
        location: "src/generation-handler.js:startGeneration",
        access_token: access_token,
      }
    );
    // Try both possible environment variable names
    access_token = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_AUTH_TOKEN;
    if (!access_token) {
      logger.error("No access token found in environment variables (AIRTABLE_API_KEY or AIRTABLE_AUTH_TOKEN)", {
        location: "src/generation-handler.js:startGeneration",
      });
      throw new Error("ERROR: access_token is required. Please set AIRTABLE_API_KEY or AIRTABLE_AUTH_TOKEN environment variable");
    }
  }
  if (!base_id) {
    logger.warning(
      "Missing base id, using default from environment variables",
      {
        location: "src/generation-handler.js:startGeneration",
        base_id: base_id,
      }
    );
    base_id = process.env.AIRTABLE_BASE_ID;
  }
  if (!table_id) {
    logger.warning(
      "Missing table id, using default from environment variables",
      {
        location: "src/generation-handler.js:startGeneration",
        table_id: table_id,
      }
    );
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
        logger.error(
          "Enoteca not found, filtering by name will be skipped - Error finding enoteca record ID",
          {
            location: "src/generation-handler.js:startGeneration",
            enoteca: enoteca,
            error: "Enoteca not found",
          }
        );
        throw new Error(
          "ERROR: Enoteca not found, filtering by name will be skipped - Error finding enoteca record ID",
          {
            location: "src/generation-handler.js:startGeneration",
            enoteca: enoteca,
            error: "Enoteca not found",
          }
        );
      }
    } catch (error) {
      // If an error occurs, log an error and throw an error
      logger.error("Error finding enoteca record ID", {
        location: "src/generation-handler.js:startGeneration",
        enoteca: enoteca,
        error: error,
      });
      throw new Error("ERROR: Error finding enoteca record ID", {
        location: "src/generation-handler.js:startGeneration",
        enoteca: enoteca,
        error: error,
      });
    }
  }

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
    const enotecaMatchFormula =
      `OR(` +
      `FIND("${enotecaRecordId}", ARRAYJOIN({Enoteca}, ",")) > 0, ` +
      `FIND("${String(enoteca).replace(
        /"/g,
        '\\"'
      )}", ARRAYJOIN({Enoteca}, ",")) > 0` +
      `)`;

    filterFormula = `AND({Carta dei Vini}, ${enotecaMatchFormula})`;
  }

  // # 3. fetch data from Airtable with filter
  let data;
  try {
    // try to fetch data from Airtable
    data = await fetchDefaultTableRecords(
      {
        filterByFormula: filterFormula,
      },
      {
        authToken: access_token,
        baseId: base_id,
        tableIdOrName: table_id,
      }
    );
  } catch (error) {
    // if error, log and throw
    logger.error("Error fetching data from Airtable", {
      location: "src/generation-handler.js:startGeneration",
      error: error,
    });
    throw new Error("ERROR: Error fetching data from Airtable", {
      location: "src/generation-handler.js:startGeneration",
      error: error,
    });
  }

  // # 4. build payload with middleware (handlebars)
  // get enoteca data (name, logo_url, qr_image_url, digital_menu_url)
  const rawEnotecaData = await getEnotecaData(enotecaRecordId, {
    authToken: access_token,
    baseId: base_id,
    enotecaTableId: enoteca_table_id,
  });

  // build enoteca data
  const enotecaData = {
    id: rawEnotecaData.fields["Nome"].toLowerCase().replace(/ /g, "-"),
    name: rawEnotecaData.fields["Nome"],
    description: rawEnotecaData.fields["Introduzione"],
    logo_url: rawEnotecaData.fields["Logo"][0].url,
    qr_image_url: rawEnotecaData.fields["QR Code"][0].url,
    digital_menu_url: rawEnotecaData.fields["URL Menu Digitale"],
  };

  const today = new Date();
  const dateString = today.toISOString().slice(0, 10); // YYYY-MM-DD
  const fileName = `${dateString} - Carta dei Vini - ${enotecaData.id}.yaml`;

  // Get YAML string for wine list, restaurant and meta data
  const yamlString = await generateWineListYamlString(data, enotecaData);

  // Save YAML string to file
  const yamlFileRealtivePath = path.join(enotecaData.id, fileName);

  const { absPath, bytes } = await writeFileAtomicSafe({
    baseDir: MENU_DATA_DIR,
    relativePath: yamlFileRealtivePath,
    data: yamlString,
    overwrite: true,
    mode: 0o644,
  });

  // Log the YAML file saved
  logger.info("YAML file saved", {
    location: "src/generation-handler.js:startGeneration",
    absPath: absPath,
    bytes: bytes,
    yamlFileRealtivePath: yamlFileRealtivePath,
  });

  // # 5. generate and save the document
  // Generate PDF document from YAML file
  try {
    await build(absPath, { outputDir: PDF_OUTPUT_DIR });

    // Log the PDF generation completed successfully
    logger.info("PDF generation completed successfully", {
      location: "src/generation-handler.js:startGeneration",
      yamlPath: absPath,
    });
  } catch (error) {
    logger.error("Error generating PDF", {
      location: "src/generation-handler.js:startGeneration",
      yamlPath: absPath,
      error: error,
    });
    throw error;
  }

  // # 6. save the document to Airtable
  // Validate required parameters before calling loadWineListToAirtable
  // Final check: try to get access_token from environment if still missing
  if (!access_token) {
    access_token = process.env.AIRTABLE_API_KEY || process.env.AIRTABLE_AUTH_TOKEN;
    if (!access_token) {
      logger.error("access_token is required to save document to Airtable", {
        location: "src/generation-handler.js:startGeneration",
        access_token: access_token,
        hasAIRTABLE_API_KEY: !!process.env.AIRTABLE_API_KEY,
        hasAIRTABLE_AUTH_TOKEN: !!process.env.AIRTABLE_AUTH_TOKEN,
      });
      throw new Error("ERROR: access_token is required to save document to Airtable. Please set AIRTABLE_API_KEY or AIRTABLE_AUTH_TOKEN environment variable");
    }
  }
  if (!wine_list_tab_id) {
    // Try to get from environment as fallback
    wine_list_tab_id = process.env.AIRTABLE_WINE_LIST_TAB_ID;
    if (!wine_list_tab_id) {
      logger.error("wine_list_tab_id is required to save document to Airtable", {
        location: "src/generation-handler.js:startGeneration",
        wine_list_tab_id: wine_list_tab_id,
      });
      throw new Error("ERROR: wine_list_tab_id is required to save document to Airtable. Please set AIRTABLE_WINE_LIST_TAB_ID environment variable or pass it as parameter");
    }
  }
  if (!enotecaRecordId) {
    logger.error("enotecaRecordId is required to save document to Airtable", {
      location: "src/generation-handler.js:startGeneration",
      enotecaRecordId: enotecaRecordId,
    });
    throw new Error("ERROR: enotecaRecordId is required to save document to Airtable");
  }

  try {
    // Convert dateString (YYYY-MM-DD) to Date object for loadWineListToAirtable
    const dateObj = new Date(dateString);
    if (isNaN(dateObj.getTime())) {
      throw new Error(`Invalid date format: ${dateString}`);
    }

    // Log parameters before calling loadWineListToAirtable for debugging
    logger.info("Calling loadWineListToAirtable with parameters", {
      location: "src/generation-handler.js:startGeneration",
      hasAccessToken: !!access_token,
      base_id,
      wine_list_tab_id,
      enotecaRecordId,
      dateString,
      pdfPath: absPath,
    });

    const result = await loadWineListToAirtable(
      access_token,
      base_id,
      wine_list_tab_id,
      enotecaRecordId,
      dateObj, // Pass Date object instead of string
      "PDF Carta dei Vini",
      absPath
    );
    logger.info("Document saved to Airtable successfully", {
      location: "src/generation-handler.js:startGeneration",
      result: result,
    });
  } catch (error) {
    // Extract original error information
    const originalLocation = error.location || error.originalLocation || "unknown";
    const originalMessage = error.message || error.originalMessage || "Unknown error";
    
    logger.error("Error saving document to Airtable", {
      location: "src/generation-handler.js:startGeneration",
      error: error,
      originalLocation,
      originalMessage,
      errorDetails: {
        message: error.message,
        status: error.status,
        statusText: error.statusText,
        airtable: error.airtable,
      },
    });
    
    // Create enhanced error with original location and message
    const enhancedError = new Error(
      `ERROR: Error saving document to Airtable. Original error from ${originalLocation}: ${originalMessage}`
    );
    enhancedError.cause = error;
    enhancedError.location = "src/generation-handler.js:startGeneration";
    enhancedError.originalLocation = originalLocation;
    enhancedError.originalMessage = originalMessage;
    if (error.status) enhancedError.status = error.status;
    if (error.statusText) enhancedError.statusText = error.statusText;
    if (error.airtable) enhancedError.airtable = error.airtable;
    if (error.baseId) enhancedError.baseId = error.baseId;
    if (error.tableIdOrName) enhancedError.tableIdOrName = error.tableIdOrName;
    throw enhancedError;
  }
}

// Permetti l'invocazione diretta del file da CLI per lanciare startGeneration
if (
  process.argv[1] === new URL(import.meta.url).pathname ||
  process.argv[1] === new URL(import.meta.url).href.replace("file://", "")
) {
  startGeneration({})
    // .then(result => {
    //   // Mostra i risultati in forma compatta su stdout
    //   console.log(JSON.stringify(result, null, 2));
    //   console.error(`\nTotale record recuperati: ${result.records.length}`);
    // })
    .catch((err) => {
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

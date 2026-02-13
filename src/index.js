// ######## DEPENDENCIES ########
// --- Node.js built-ins ---
import fs from "fs"; // file system module: provides a way to read and write files
import path from "path"; // path module: provides a way to work with file and directory paths
import { fileURLToPath } from "url"; // url module: provides a way to work with URLs
// --- Third-party libraries ---
import puppeteer from "puppeteer"; // puppeteer module: provides a way to control a headless browser
import Handlebars from "handlebars"; // handlebars module: provides a way to handlebars templates
// --- Project domain/schema utilities ---
import {
    DetailedError, // DetailedError class (custom): provides a way to create detailed errors
    validateMainParams // validateMainParams function (custom): validates the main parameters
} from "./domain/schema.js";
// --- Airtable client and queries ---
import { newATClient } from "./airtable/client.js"; // newATClient function (custom): creates a new Airtable client
import {
    getEnotecaById, // getEnotecaById function (custom): gets the enoteca by id
    getWineList, // getWineList function (custom): gets the wine list
    uploadRecordWithAttachment, // uploadRecordWithAttachment function (custom): uploads the record with attachment
    createNewListRecord // createNewListRecord function (custom): creates a new list record
} from "./airtable/queries.js";
// --- Environment variables ---
import dotenv from "dotenv"; // dotenv module: loads environment variables from a .env file

// ######## CONFIGURATION ########
// loads environment variables from a .env file
dotenv.config();
// gets the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ########### HELPER FUNCTIONS ###########

/**
 * @name formatDate
 * @kind Utility
 * @summary Handlebars helper: formats a value as Italian locale date string.
 *
 * @description
 * Converts value to Date and returns toLocaleDateString("it-IT"). Used in NDT Handlebars templates for date display.
 * Synchronous; no side effects beyond Handlebars rendering.
 *
 * @category API
 * @since Not specified
 * @version Not specified
 *
 * @requirements
 * @requiresRuntime Node.js
 * @requiresPermissions Not specified
 * @requiresEnv Not specified
 * @requiresNetwork Not required
 *
 * @dependencies
 * @requires Handlebars (handlebars) Registered as helper "formatDate".
 *
 * @performance
 * @complexity O(1); lightweight.
 * @latency Negligible
 * @memory Negligible
 * @rateLimit Not specified
 * @notes Not specified
 *
 * @security
 * @inputSanitization value is passed to new Date(); invalid values yield Invalid Date string.
 * @secretsHandling None
 * @pii value may be a date; no PII exposure beyond template output.
 *
 * @compatibility
 * @supported Node.js
 * @notSupported Not specified
 *
 * @param {string|number|Date} value - Date value (ISO string, timestamp, or Date); used in new Date(value).
 *
 * @returns {string} Formatted date string (it-IT locale) or "Invalid Date" if value is invalid.
 *
 * @example
 * {{formatDate someDateField}}
 *
 * @remarks
 * Invalid or missing value yields "Invalid Date" from toLocaleDateString. Handlebars may pass undefined; new Date(undefined) is Invalid Date.
 *
 * @see imageBase64
 */
Handlebars.registerHelper("formatDate", (value) => {
    return new Date(value).toLocaleDateString("it-IT");
});

/** 
 * @name imageBase64
 * @kind Utility
 * @summary Handlebars helper: reads an image from disk and returns a data URI (base64).
 *
 * @description
 * Resolves imagePath with path.resolve, reads file synchronously if it exists, encodes as base64, infers MIME from extension (png, jpg, jpeg; default image/png), returns data:...;base64,... or "" if file missing.
 * Used in NDT Handlebars templates for inline images. Synchronous; blocks on fs.readFileSync.
 *
 * @category API
 * @since Not specified
 * @version Not specified
 *
 * @requirements
 * @requiresRuntime Node.js (fs, path)
 * @requiresPermissions Not specified
 * @requiresEnv Not specified
 * @requiresNetwork Not required
 *
 * @dependencies
 * @requires fs (node:fs) For existsSync and readFileSync.
 * @requires path (node:path) For resolve and extname.
 * @requires Handlebars (handlebars) Registered as helper "imageBase64".
 *
 * @performance
 * @complexity O(file size); synchronous read and base64 encode; blocks event loop.
 * @latency Depends on file size and disk I/O.
 * @memory Holds full file buffer and base64 string in memory; avoid for very large images.
 * @rateLimit Not specified
 * @notes Path is resolved from CWD if imagePath is relative; path traversal risk if imagePath is user-controlled.
 *
 * @security
 * @inputSanitization imagePath is passed to path.resolve; no validation—path traversal possible if imagePath is user-controlled (e.g. ../../../etc/passwd).
 * @secretsHandling None
 * @pii Image content may contain PII; embedded in template output (data URI).
 *
 * @compatibility
 * @supported Node.js
 * @notSupported Not specified
 *
 * @param {string} imagePath - File path (relative or absolute); resolved with path.resolve; must point to image file (png, jpg, jpeg).
 *
 * @returns {string} data URI string (data:image/...;base64,...) or "" if file does not exist.
 *
 * @example
 * {{imageBase64 "./assets/logo.png"}}
 *
 * @remarks
 * Only png, jpg, jpeg get correct MIME; other extensions default to image/png. Returns "" when file is missing (no error thrown).
 *
 * @see formatDate
 */
Handlebars.registerHelper("imageBase64", (imagePath) => {
    const fullPath = path.resolve(imagePath);
    if (fs.existsSync(fullPath)) {
        const imageBuffer = fs.readFileSync(fullPath);
        const base64 = imageBuffer.toString("base64");
        const ext = path.extname(fullPath).slice(1).toLowerCase();
        const mimeType = ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
        return `data:${mimeType};base64,${base64}`;
    }
    return "";
});

/**
 * Handlebars helper: returns the keys of an object as an array (for use in {{#each}}).
 * @param {Object} obj - Plain object; if null/undefined, returns [].
 * @returns {string[]} Array of own enumerable keys.
 */
Handlebars.registerHelper("objectKeys", (obj) => {
    if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
        return [];
    }
    return Object.keys(obj);
});

// ########### FUNCTIONS ###########

/**
 * Loads a template file from disk as a UTF-8 string (synchronous).
 * Used for Handlebars layout and partials under `templates/`.
 *
 * @param {string} filePath - Absolute or relative path to the template file.
 * @returns {string} File contents as a string.
 * @throws {Error} When the file is missing or not readable (e.g. ENOENT).
 */
function loadTemplate(filePath) {
    return fs.readFileSync(filePath, "utf-8");
}

/**
 * Loads enoteca and wine list data required to build the wine list document.
 *
 * Executes two steps in order: 
 * 1) fetch enoteca by record ID and require a successful
 * response; 
 * 2) fetch wine list by enoteca name and require a successful, non-empty result.
 * 
 * All failures are surfaced as {@link DetailedError} with appropriate message, cause,
 * source, and details. If the caught error already has `source` or `details`, they are
 * preserved when rethrowing.
 *
 * @param {object} client - Airtable client instance (base-scoped), e.g. from {@link newATClient}.
 * @param {string} enotecaId - Airtable record ID of the enoteca (format `rec` + 14 alphanumeric chars).
 * @returns {Promise<{ ok: true, enotecaData: object, wineListData: object }>} Combined payload with
 *   normalized enoteca data and wine list data. Never resolves with `ok: false`; validation or
 *   API failures throw instead.
 * @throws {DetailedError} When enoteca fetch returns `ok: false` (details: `enotecaId`).
 * @throws {DetailedError} When wine list fetch returns `ok: false` (details: `enotecaName`, `enotecaId`).
 * @throws {DetailedError} When wine list is empty (`length === 0`) (details: `enotecaName`, `enotecaId`).
 * @throws {DetailedError} On any other failure (e.g. network, upstream API), preserving cause and
 *   existing `error.source` / `error.details` when present.
 */
async function getDatas(client, enotecaId) {
    try {
        // 1. Get enoteca datas
        const enotecaData = await getEnotecaById(client, enotecaId)

        if (!enotecaData.ok) {
            throw new DetailedError("Error getting enoteca by id", {
                cause: enotecaData.error,
                source: "src/index.js:getDatas",
                details: {
                    enotecaId: enotecaId,
                }
            })
        }

        // 2. Get wine list datas
        const wineListData = await getWineList(client, enotecaData.name)

        if (!wineListData.ok) {
            throw new DetailedError("Error getting wine list", {
                cause: wineListData.error,
                source: "src/index.js:getDatas",
                details: {
                    enotecaName: enotecaData.name,
                    enotecaId: enotecaId,
                }
            })
        } else if (wineListData.length === 0) {
            throw new DetailedError("No wine list found for the given enoteca", {
                cause: new Error("No wine list found for the given enoteca"),
                source: "src/index.js:getDatas",
                details: {
                    enotecaName: enotecaData.name,
                    enotecaId: enotecaId,
                }
            })
        }

        return {
            ok: true,
            enotecaData: enotecaData,
            wineListData: wineListData,
        }
    } catch (error) {
        throw new DetailedError("Error getting datas", {
            cause: error,
            source: error.source,
            details: error.details ? error.details : {
                enotecaId: enotecaId,
            },
        })
    }
}

/**
 * Builds the wine list PDF document from normalized enoteca and wine list data.
 *
 * Registers Handlebars partials from `templates/partials`, compiles `templates/layout.hbs`
 * with cover and listing payloads, launches a Puppeteer browser (headless in production,
 * local Chrome in development), renders the HTML and prints to PDF. The file is written
 * to `out/{enotecaName}.pdf` (slashes in name replaced with hyphens). The browser is
 * always closed in a `finally` block. Any failure during template compilation, browser
 * launch, or PDF generation is wrapped in a {@link DetailedError} with full payload in details.
 *
 * @param {object} enotecaData - Normalized enoteca payload (e.g. from {@link getEnotecaById}):
 *   must include `name`, `logo`, `introduction`, `qrCode`; optional `qr_caption`.
 * @param {object} wineListData - Normalized wine list payload (e.g. from {@link getWineList}):
 *   must include `wines_listing` for the layout template.
 * @returns {Promise<{ ok: true, pdfPath: string }>} Success result with absolute path to the generated PDF.
 * @throws {DetailedError} On template read/compile, Puppeteer launch, page render, or PDF write failure;
 *   details include `enotecaData` and `wineListData` for debugging.
 */
async function buildDoc(enotecaData, wineListData) {
    // 1. Get partials templates
    const projectRoot = path.join(__dirname, "..");
    const partialsDir = path.join(projectRoot, "templates", "partials");
    const tempDir = path.join(projectRoot, "temp");
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }
    for (const file of fs.readdirSync(partialsDir)) { // read all the files in the partials directory
        if (!file.endsWith(".hbs")) continue;
        const name = file.replace(".hbs", "");
        Handlebars.registerPartial(name, loadTemplate(path.join(partialsDir, file)));
    }

    // 2. Compile template
    const mainTpl = loadTemplate(path.join(projectRoot, "templates", "layout.hbs"));
    const compile = Handlebars.compile(mainTpl);
    const html = compile({
        param_main_cover: {
            logo_image: enotecaData.logo,
            logo_alt: `${enotecaData.name}-logo`,
            venue_name: enotecaData.name,
            description: enotecaData.introduction || "Una selezione curata con passione, dai grandi classici ai piccoli produttori artigianali.", // TODO: add default description
            qr_image: enotecaData.qrCode,
            qr_caption: enotecaData.qr_caption || "Scansiona il QR per visualizzare il menù completo e gli abbinamenti consigliati.", // TODO: add default qr caption
        },
        param_listing: wineListData.wines_listing,
    });

    // 3. Generate PDF
    const isProd = process.env.NODE_ENV === "production";

    // 4. Launch the browser (headless or not)
    const browser = await puppeteer.launch({
        headless: "new",
        ...(isProd
            ? { args: ["--no-sandbox", "--disable-setuid-sandbox"] }
            : {
                executablePath:
                    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            }),
    });

    try {
        // 5. Create a new page
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        const safeCode = enotecaData.name.replace(/\//g, "-");
        const file_name = `${safeCode}.pdf`;
        const pdfPath = path.join(tempDir, file_name);

        // const outDir = path.dirname(pdfPath);

        // if (!fs.existsSync(outDir)) {
        //     throw new DetailedError("Output directory does not exist", {
        //         cause: "ENOENT",
        //         source: "src/index.js:buildDoc",
        //         details: {
        //             pdfPath,
        //             outDir,
        //             outDirExists: false,
        //         },
        //     });
        // }

        // 6. Generate PDF
        await page.pdf({
            path: pdfPath,
            format: "A4",
            printBackground: true,
            margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
        });

        return {
            ok: true,
            pdfPath: pdfPath,
        }
    } catch (error) {
        throw new DetailedError("Error building document", {
            cause: error,
            source: "src/index.js:buildDoc",
            details: {
                enotecaData: enotecaData,
                wineListData: wineListData,
            }
        })
    } finally {
        await browser.close();
    }
}

/**
 * Main entry point: runs the full wine list pipeline from credentials to PDF uploaded on Airtable.
 *
 * Executes six steps in order. Each step validates or uses the previous result; any failure
 * is wrapped in a {@link DetailedError} with appropriate message, cause, source, and details.
 *
 * 1. **Validate parameters** — Calls {@link validateMainParams}(enotecaId, baseId, authToken).
 *    If `!validationResult.ok`, throws with cause `validationResult.errors` and details containing
 *    the three inputs.
 *
 * 2. **Create Airtable client** — Calls {@link newATClient}(baseId, authToken). On failure,
 *    rethrows as DetailedError, preserving `error.source` and `error.details` when present.
 *
 * 3. **Load data** — Calls {@link getDatas}(client, enotecaId). Expects `getDatasResult.ok === true`
 *    and enoteca + wine list payloads; otherwise throws with enotecaId in details.
 *
 * 4. **Build document** — Calls {@link buildDoc}(enotecaData, wineListData). Writes the PDF to
 *    `out/{enotecaName}.pdf`. If `!buildDocResult.ok`, throws with enotecaId in details.
 *
 * 5. **Create list record** — Calls {@link createNewListRecord}(client, enotecaName, enotecaId)
 *    to create a new record in the wine list history table.
 *
 * 6. **Upload PDF** — Calls {@link uploadRecordWithAttachment} to attach the generated PDF to
 *    that record (table "Storico Carte dei Vini", field from `AIRTABLE_WINE_LIST_PDF_FIELD_ID`).
 *    On failure, throws with enotecaId in details.
 *
 * A `finally` block removes the local PDF file at `buildDocResult.pdfPath` after the try/catch
 * (whether or not upload succeeded), so the process does not leave temporary PDFs on disk.
 *
 * @param {string} enotecaId - Airtable record ID of the enoteca (format `rec` + 14 alphanumeric).
 * @param {string} baseId - Airtable base ID (format `app` + alphanumeric).
 * @param {string} authToken - Airtable personal access token for API and attachment upload.
 * @returns {Promise<{ ok: true, updatedRecord: object }>} Success result with the updated Airtable
 *   record info returned by the upload. Does not resolve with `ok: false`; failures throw.
 * @throws {DetailedError} When validation fails (step 1); details include enotecaId, baseId, authToken.
 * @throws {DetailedError} When client creation fails (step 2); details include baseId, authToken or from cause.
 * @throws {DetailedError} When getDatas fails or returns not ok (step 3); details include enotecaId.
 * @throws {DetailedError} When buildDoc fails or returns not ok (step 4); details include enotecaId.
 * @throws {DetailedError} When createNewListRecord or upload fails (steps 5–6); details include enotecaId.
 */
export default async function main(
    enotecaId,
    baseId,
    authToken,
) {
    let step_time = [];
    const start = performance.now();
    let last = start;

    // 1. Validate main parameters
    const validationResult = validateMainParams(
        enotecaId,
        baseId,
        authToken,
    )

    if (!validationResult.ok) {
        throw new DetailedError("Invalid parameters", {
            cause: validationResult.errors,
            source: "src/index.js:main",
            details: {
                enotecaId: enotecaId,
                baseId: baseId,
                authToken: authToken,
            }
        })
    }

    step_time.push({
        step: "step 1: Parameters validation",
        time: ((performance.now() - last) / 1000).toFixed(2),
    });

    last = performance.now();

    // 2. Create Airtable client
    let client = null;
    try {
        client = newATClient(baseId, authToken);
    } catch (error) {
        throw new DetailedError("Error creating Airtable client", {
            cause: error,
            source: error.source,
            details: error.details ? error.details : {
                baseId: baseId,
                authToken: authToken,
            }
        })
    }

    // 3. Get datas
    const getDatasResult = await getDatas(client, enotecaId)

    if (!getDatasResult.ok) {
        throw new DetailedError("Error getting datas", {
            cause: getDatasResult.error,
            source: "src/index.js:getDatas",
            details: {
                enotecaId: enotecaId,
            }
        })
    }

    step_time.push({
        step: "step 2: Airtable client creation and get datas",
        time: ((performance.now() - last) / 1000).toFixed(2),
    });

    last = performance.now();

    // 4. Build document
    try {
        const buildDocResult = await buildDoc(getDatasResult.enotecaData, getDatasResult.wineListData)

        if (!buildDocResult.ok) {
            throw new DetailedError("Error building document", {
                cause: buildDocResult.error,
                source: "src/index.js:buildDoc",
                details: {
                    enotecaId: enotecaId,
                }
            })
        }
    } catch (error) {
        throw new DetailedError("Error building document", {
            cause: error,
            source: "src/index.js:buildDoc",
            details: error.details,
        })
    }

    step_time.push({
        step: "step 3: Build document",
        time: ((performance.now() - last) / 1000).toFixed(2),
    });

    try {
        // 5. Create new list record
        const newRecord = await createNewListRecord(client, getDatasResult.enotecaData.name, enotecaId)

        // 6. Upload PDF to Airtable
        const uploadPDFResult = await uploadRecordWithAttachment({
            client: client,
            tableIdOrName: "Storico Carte dei Vini",
            recordId: newRecord.id,
            filePath: buildDocResult.pdfPath,
        })

        if (!uploadPDFResult.ok) {
            throw new DetailedError("Error uploading PDF to Airtable", {
                cause: uploadPDFResult.error,
                source: "src/index.js:uploadPDF",
                details: {
                    enotecaId: enotecaId,
                }
            })
        }

        step_time.push({
            step: "step 4: Create new list record and upload PDF to Airtable",
            time: ((performance.now() - last) / 1000).toFixed(2),
        },
            {
                step: "Total time",
                time: ((performance.now() - start) / 1000).toFixed(2),
            }
        );



        return {
            ok: true,
            updatedRecord: uploadPDFResult.updated,
            step_time: step_time,
        }
    } catch (error) {
        throw new DetailedError("Error uploading PDF to Airtable", {
            cause: error,
            source: "src/index.js:uploadPDF",
            details: {
                enotecaId: enotecaId,
            }
        })
    } finally {
        await fs.unlinkSync(buildDocResult.pdfPath);
    }
}
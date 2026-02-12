// # API: buildWineList({inputPath, outDir, format})
// Entry point “library”: orchestra il flusso end-to-end (fetch Airtable → map → normalize → render HTML/PDF → write su out/). Espone una funzione tipo buildWineList(options) usabile da CLI e da altri script.

import { fileURLToPath } from "url";
import puppeteer from "puppeteer";
import Handlebars from "handlebars";
import fs from "fs";
import path from "path";
import { DetailedError, validateMainParams } from "./domain/schema.js";
import os from "os";
import { newATClient } from "./airtable/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { getEnotecaById, getWineList, uploadRecordWithAttachment } from "./airtable/queries.js";


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

function loadTemplate(filePath) {
    return fs.readFileSync(filePath, "utf-8");
}

async function getDatas(client, enotecaId) {
    try {// 1. Get enoteca datas
        const enotecaData = await getEnotecaById(client, enotecaId)

        if (!enotecaData.ok) {
            throw new Error(enotecaData.error)
        }

        // 2. Get wine list datas
        const wineListData = await getWineList(client, enotecaData.name)

        if (!wineListData.ok) {
            throw new Error(wineListData.error)
        } else if (wineListData.length === 0) {
            throw new Error({
                code: 404,
                message: "No wine list found for the given enoteca",
                data: {
                    enotecaName: enotecaData.name,
                },
                source: "src/index.js:main"
            })
        }

        return {
            ok: true,
            enotecaData: enotecaData,
            wineListData: wineListData,
        }
    } catch (error) {
        // TODO: handle error
        console.error(`Error getting datas: ${error}`)
        throw error
    }
}

async function buildDoc(enotecaData, wineListData) {
    // 4. Get partials templates
    const projectRoot = path.join(__dirname, "..");
    const partialsDir = path.join(projectRoot, "templates", "partials");
    for (const file of fs.readdirSync(partialsDir)) { // read all the files in the partials directory
        if (!file.endsWith(".hbs")) continue;
        const name = file.replace(".hbs", "");
        Handlebars.registerPartial(name, loadTemplate(path.join(partialsDir, file)));
    }

    // 5. Compile template
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
        // param_categories: wineListData.list,
        // param_category_cover: wineListData.list[1],
        // param_listing: wineListData.list[2],
    });

    // 6. Generate PDF
    const isProd = process.env.NODE_ENV === "production";

    // launch the browser (headless or not)
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
        // create a new page
        const page = await browser.newPage();
        // set the content of the page
        await page.setContent(html, { waitUntil: "load" });

        // No slashes in filename (e.g. "006/2025" → "006-2025") so path stays a single file
        const safeCode = enotecaData.name.replace(/\//g, "-");
        const file_name = `${safeCode}.pdf`;
        const pdfPath = path.join(projectRoot, "out", file_name);
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
        // TODO: handle error
        console.error(`Error building document: ${error}`)
        throw error
    } finally {
        await browser.close();
    }
}


export default async function main(
    enotecaId,
    baseId,
    authToken,
) {
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

    // 2. Create Airtable client
    let client = null;
    try {
        client = newATClient(baseId, authToken)
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

    const tempFilePath = os.homedir() + '/Desktop/temp.json';

    // # START ########## GET DATAS ###########

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

    // # END ########## GET DATAS ##########

    // # START ########## COPY PDF TO DESKTOP ###########

    // // Salva il risultato PDF sulla scrivania dell'utente, come copia (best effort)
    // try {
    //     try {
    //         const jsonPath = tempFilePath.replace(/\.pdf$/, ".json");
    //         fs.writeFileSync(jsonPath, JSON.stringify(getDatasResult, null, 2), "utf-8");
    //         console.log(`Dati salvati su: ${jsonPath}`);
    //     } catch (err) {
    //         console.warn("Errore nel salvataggio del file JSON sulla Scrivania:", err);
    //     }

    //     console.log(`PDF copiato sulla Scrivania: ${tempFilePath}`)
    // } catch (err) {
    //     console.warn("Errore nella copia del PDF sulla Scrivania:", err)
    // }


    // # END ########## COPY PDF TO DESKTOP ###########

    // # START ########## GET DATAS FROM FILE ###########

    // // Carica dati da file JSON specificato invece che da getDatas()
    // const dataPath = "/Users/niccolofulgaro/Desktop/temp.json";
    // const fileContent = fs.readFileSync(tempFilePath, "utf-8");
    // const parsed = JSON.parse(fileContent);

    // // Sostituisci getDatasResult con dati dal file
    // const getDatasResult = {
    //     enotecaData: parsed.enotecaData,
    //     wineListData: parsed.wineListData,
    //     ok: true,
    // };
    // # END ########## GET DATAS FROM FILE ###########

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

    // # START ########## UPLOAD PDF TO AIRTABLE ###########
    const uploadPDFResult = await uploadRecordWithAttachment({
        client: client,
        token: authToken,
        baseId: baseId,
        tableIdOrName: "Storico Carte dei Vini",
        recordId: getDatasResult.wineListData.id,
        fieldId: process.env.AIRTABLE_WINE_LIST_PDF_FIELD_ID,
        filePath: buildDocResult.pdfPath,
        filename: `Carta dei Vini.pdf`,
    })

    if (!uploadPDFResult.ok) {
        throw new DetailedError("Error uploading PDF to Airtable", {
            cause: uploadPDFResult.error,
            source: "src/index.js:uploadPDF",
        })
    }

    return buildDocResult.pdfPath
}


// main("recoBeLAxlhrj7jvw")
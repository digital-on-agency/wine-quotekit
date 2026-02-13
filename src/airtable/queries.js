// ######## DEPENDENCIES ########
import {
    listAllRecords,
    addAttachmentToRecord
} from "./client.js" // imports the client from the client.js file
import { DetailedError } from "../domain/schema.js" // imports the DetailedError from the schema.js file

// ######## FUNCTIONS ########

/**
 * Fetches a single enoteca (wine shop) record from Airtable by record ID and returns a normalized shape.
 * Uses the table identified by `AIRTABLE_ENO_TAB_ID`. Maps raw fields to `name`, `introduction`, `logo`, `qrCode`, `urlMenuDigital`.
 *
 * @param {string} id - Airtable record ID (e.g. `recXXXXXXXXXXXXXX`). Required non-empty string.
 * @returns {Promise<{ ok: true, name: string, introduction: string, logo: string, qrCode: string, urlMenuDigital: string }>} Normalized enoteca data.
 * @throws {Error} If `id` is missing, not a string, or empty (code 400, with `data.id`, `data.expectedFormat`, `source`).
 * @throws Rethrows any error from the Airtable client (e.g. not found, network).
 */
export async function getEnotecaById(client, id) {
    // 1. Validate parameters
    if (!id || typeof id !== "string") {
        throw new Error("Invalid Enoteca ID", {
            code: 400,
            message: "Invalid Enoteca ID",
            data: {
                id: id,
                expectedFormat: "recXXXXXXXXXXXXXX",
            },
            source: "src/airtable/queries.js:getEnotecaById",
        });
    }

    try {
        // 2. Fetch enoteca data
        const enotecaData = await client.getRecord(process.env.AIRTABLE_ENO_TAB_ID, id)

        // 3. Return mapped enoteca data
        return {
            ok: true,
            name: enotecaData.fields["Nome"],
            introduction: enotecaData.fields["Introduzione"],
            logo: enotecaData.fields["Logo"][0].url,
            qrCode: enotecaData.fields["QR Code"][0].url,
            urlMenuDigital: enotecaData.fields["URL Menu Digitale"],
        }
    } catch (error) {
        throw new DetailedError("Error getting enoteca by id", {
            cause: error,
            source: "src/airtable/queries.js:getEnotecaById",
            details: {
                enotecaId: id,
                expectedFormat: "recXXXXXXXXXXXXXX",
            }
        })
    }
}

/**
 * Builds the full wine-list payload for an enoteca, grouped and ordered for rendering.
 * The function validates input, loads inventory records for the given enoteca name, resolves
 * related metadata (tipologie, zones, producers), normalizes selected AI-generated fields,
 * groups wines by tipologia/regione/zona, and returns the final structured listing.
 *
 * @param {string} enoName - Enoteca name used in the Airtable formula filter (required non-empty string).
 * @returns {Promise<{ ok: true, length: number, wines_listing: Array<{ tipologia: { name: string, icon_url: string | null, subtitle: string, paragraph: string }, list: Array<{ regione: string, value: Object<string, Array<Object>> }> }> }>} Render-ready wine list grouped by tipologia and regione.
 * @throws {Error} If `enoName` is missing or not a string (code 400, includes `data.enoName` and `source`).
 * @throws Rethrows Airtable/client errors raised while loading records or linked data.
 */
export async function getWineList(client, enoName) {
    // 1. Validate parameters
    if (!enoName || typeof enoName !== "string") {
        throw new Error("Enoteca ID is required", {
            code: 400,
            message: "Enoteca ID is required",
            data: {
                enoName,
            },
            source: "src/airtable/queries.js:getWineList",
        })
    }

    try {
        // 2. Fetch all matching wine list records (auto-paginated)
        const records = await listAllRecords({
            client,
            tableName: process.env.AIRTABLE_INV_TAB_ID,
            params: {
                filterByFormula: `AND({Carta dei Vini}, FIND("${enoName}", ARRAYJOIN({Enoteca}, ",")) > 0)`,
            },
        })

        await new Promise(resolve => setTimeout(resolve, 1000));

        const zoneTabId = process.env.AIRTABLE_ZONE_TAB_ID

        // 3. Fetch tipologie vini
        const tipologieRes = await client.listRecords("Tipologie Vini")

        await new Promise(resolve => setTimeout(resolve, 1000));

        // 4. Map tipologie vini
        const tipologie_mapping = Object.fromEntries(
            tipologieRes.records.map((rec) => [
                String(rec.fields.Nome),
                rec.fields.Priority,
            ])
        )

        // 5. Map tipologie vini info
        const tipologia_info = Object.fromEntries(
            tipologieRes.records.map((rec) => {
                const name = String(rec.fields.Nome ?? "")
                const icon = rec.fields.icon?.[0]
                const icon_url = icon?.url ?? null
                const subtitle = rec.fields.subtitle ?? ""
                const paragraph = rec.fields.paragraph ?? ""
                return [
                    name,
                    { name, icon_url, subtitle, paragraph },
                ]
            })
        )

        // 6. Fetch zones
        const uniqueZonaIds = new Set()
        for (let i = 0; i < records.length; i++) {
            const z = records[i].fields?.Zona?.[0]
            if (z) uniqueZonaIds.add(z)
        }

        // 7. Map zones and produttori
        const zones_mapping = {}
        await Promise.all(
            Array.from(uniqueZonaIds, async (zonaId) => {
                const rec = await client.getRecord(zoneTabId, zonaId)
                zones_mapping[zonaId] = rec.fields?.["Nome Zona"] ?? "N/A"
            })
        )

        const producers_mapping = {}
        const produttoriTableId = process.env.AIRTABLE_PRODUTTORI_TAB_ID || "Produttori"
        const produttoriRecords = await listAllRecords({
            client,
            tableName: produttoriTableId,
        })

        for (const producer of produttoriRecords) {
            producers_mapping[producer.id] = producer.fields?.Nome ?? "N/A"
        }

        // 8. Build listing
        const listing = {}
        for (let i = 0; i < records.length; i++) {
            const record = records[i]
            const fields = record.fields || {}

            // check if the record has the required fields
            const hasTipologia = Array.isArray(fields.Tipologia) && fields.Tipologia[0]
            const hasRegione = Array.isArray(fields.Regione) && fields.Regione[0]
            const hasZona = Array.isArray(fields.Zona) && fields.Zona[0]

            // if the record does not have the required fields, HANDLE ERROR HERE
            if (!hasTipologia || !hasRegione || !hasZona) {
                throw new DetailedError("Error getting wine list", {
                    cause: error,
                    source: "src/airtable/queries.js:getWineList",
                    details: {
                        enoName: enoName,
                    }
                })
            }

            // get the tipologia, regione, zona and produttore name
            const tipologia = hasTipologia ? fields.Tipologia[0] : "N/A"
            const regione = hasRegione ? fields.Regione[0] : "N/A"
            const zonaId = hasZona ? fields.Zona[0] : "N/A"
            const zona = zonaId in zones_mapping ? zones_mapping[zonaId] : "N/A"
            const produttoreId = fields.Produttore?.[0]
            let produttoreNome;

            // get the produttore name, if the produttore id is not in the producers_mapping, set the produttore name to "N/A"
            if (produttoreId) {
                if (produttoreId in producers_mapping) {
                    produttoreNome = producers_mapping[produttoreId]
                } else {
                    produttoreNome = "N/A"
                }
            } else {
                produttoreNome = "N/A"
            }

            // Check if "Lista Vitigni AI" exists and if it is in an error state
            if (
                fields["Lista Vitigni AI"] &&
                fields["Lista Vitigni AI"].state &&
                fields["Lista Vitigni AI"].state === "generated"
            ) {
                fields["Lista Vitigni AI"] = fields["Lista Vitigni AI"].value;
            } else {
                fields["Lista Vitigni AI"] = null;
            }

            // Check if "Affinamento AI" exists and if it is in an error state
            if (
                fields["Affinamento AI"] &&
                fields["Affinamento AI"].state &&
                fields["Affinamento AI"].state === "generated"
            ) {
                fields["Affinamento AI"] = fields["Affinamento AI"].value;
            } else {
                fields["Affinamento AI"] = null;
            }

            // Check if "Alcolicità AI" exists and if it is in an error state
            if (
                fields["Alcolicità AI"] &&
                fields["Alcolicità AI"].state &&
                fields["Alcolicità AI"].state === "generated"
            ) {
                fields["Alcolicità AI"] = fields["Alcolicità AI"].value;
            } else {
                fields["Alcolicità AI"] = null;
            }

            // Check if "Luogo di Produzione" exists and if it is in an error state
            if (
                fields["Luogo di Produzione"]['0'] &&
                fields["Luogo di Produzione"]['0'].state &&
                fields["Luogo di Produzione"]['0'].state === "generated"
            ) {
                fields["Luogo di Produzione"] = fields["Luogo di Produzione"]['0'].value;
            } else {
                fields["Luogo di Produzione"] = null;
            }

            // build the wine view
            const wineView = { ...fields, ProduttoreNome: produttoreNome }

            // add the wine view to the listing
            let t = listing[tipologia]
            if (!t) t = listing[tipologia] = {}
            let r = t[regione]
            if (!r) r = t[regione] = {}
            let z = r[zona]
            if (!z) z = r[zona] = []
            z.push(wineView)
        }

        // 9. Sort listing by produttore (by resolved name from mapping)
        const cmpProd = (a, b) => {
            const nameA = a.ProduttoreNome ?? ""
            const nameB = b.ProduttoreNome ?? ""
            return String(nameA).localeCompare(String(nameB))
        }

        // 10. Sort listing by tipologia
        for (const tipologia of Object.keys(listing)) {
            const regioni = listing[tipologia]
            for (const regione of Object.keys(regioni)) {
                for (const zonaName of Object.keys(regioni[regione])) {
                    regioni[regione][zonaName].sort(cmpProd)
                }
            }
        }

        // 11. Sort listing by regione
        const TOSCANA = "Toscana"
        const tipologieOrdered = Object.keys(listing).sort(
            (a, b) =>
                (tipologie_mapping[a] ?? Infinity) -
                (tipologie_mapping[b] ?? Infinity)
        )

        // 12. Build wines listing (list = array of { regione, value })
        const wines_listing = []
        for (let i = 0; i < tipologieOrdered.length; i++) {
            const tipologiaName = tipologieOrdered[i]
            const regioni = listing[tipologiaName]
            const list = []
            if (regioni[TOSCANA]) list.push({ regione: TOSCANA, value: regioni[TOSCANA] })
            for (const r of Object.keys(regioni)) {
                if (r !== TOSCANA) list.push({ regione: r, value: regioni[r] })
            }
            const tipologia = tipologia_info[tipologiaName] ?? {
                name: tipologiaName,
                icon_url: null,
                subtitle: "",
                paragraph: "",
            }
            wines_listing.push({ tipologia, list })
        }

        return {
            ok: true,
            length: records.length,
            wines_listing,
        }
    } catch (error) {
        throw new DetailedError("Error getting wine list", {
            cause: error,
            source: "src/airtable/queries.js:getWineList",
            details: {
                enoName: enoName,
            }
        })
    }
}

/**
 * Creates a new record in the "Storico Carte dei Vini" table for the given enoteca and today's date.
 * Sets field "Enoteca" to the enoteca record ID and "Data" to the current date in `YYYY-MM-DD` format
 * (derived from Italian locale). Used to register a new wine list history entry before attaching the PDF.
 *
 * @param {object} client - Airtable client instance (base-scoped).
 * @param {string} enoName - Enoteca name (used only in error details for debugging).
 * @param {string} enoId - Airtable record ID of the enoteca, written into the "Enoteca" link field.
 * @returns {Promise<object>} The newly created Airtable record (including `id` and `fields`).
 * @throws {DetailedError} When createRecord fails; details include enoName and enoId.
 */
export async function createNewListRecord(client, enoName, enoId) {
    const now = new Date();
    const date = now.toLocaleDateString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');

    try {
        const newRecord = await client.createRecord("Storico Carte dei Vini", {
            "Enoteca": [enoId],
            "Data": date,
        });

        return newRecord;
    } catch (error) {
        throw new DetailedError("Error creating new list record", {
            cause: error,
            source: "src/airtable/queries.js:createNewListRecord",
            details: {
                enoName: enoName,
                enoId: enoId,
            }
        })
    }
}

/**
 * @name uploadRecordWithAttachment
 * @kind AsyncFunction
 * @summary Verifies an Airtable record exists via getRecord, then uploads a file as an attachment to the given field via addAttachmentToRecord.
 *
 * @description
 * Fetches the record via getRecord (REST API with supplied token and baseId) to ensure it exists. If verification fails, logs and rethrows.
 * Then delegates to addAttachmentToRecord (module-level client) to perform the upload. Returns the updated record. Used when attaching generated files (e.g. PDFs) to Airtable records.
 * Verification uses supplied token and baseId; the actual upload uses the module-level client (env-based).
 *
 * @category Data
 * @since Not specified
 * @version Not specified
 *
 * @requirements
 * @requiresRuntime Node.js (fetch available)
 * @requiresPermissions Not specified
 * @requiresEnv AIRTABLE_TOKEN, AIRTABLE_BASE_ID (used by module-level client for addAttachmentToRecord)
 * @requiresNetwork Internet required
 *
 * @dependencies
 * @requires getRecord (internal) To verify record existence before upload.
 * @requires addAttachmentToRecord (@te3sk/airtable-core/server) To perform the file upload to the attachment field.
 *
 * @performance
 * @complexity Two network calls: one GET (getRecord), one upload (addAttachmentToRecord). Network-bound.
 * @latency Network-bound; depends on Airtable API and file size.
 * @memory Lightweight; file is streamed by the underlying client.
 * @rateLimit Subject to Airtable API rate limits; not specified in code.
 * @notes Verification adds one extra round-trip before each upload.
 *
 * @security
 * @inputSanitization tableIdOrName and recordId used in URL (getRecord encodes tableIdOrName); filePath passed to addAttachmentToRecord—path traversal not validated here.
 * @secretsHandling token passed to getRecord only; do not log token or response bodies; console.log(updated) may expose record data.
 * @pii Record and field data may contain PII; treat as sensitive.
 *
 * @compatibility
 * @supported Node.js with fetch (e.g. Node 18+)
 * @notSupported Not specified
 *
 * @param {Object} options - Options bag for upload.
 * @param {string} options.token - Airtable API token; used only for the verification GET request.
 * @param {string} options.baseId - Airtable base ID; used only for the verification GET request.
 * @param {string} options.tableIdOrName - Table ID or name; used in verification and in addAttachmentToRecord.
 * @param {string} options.recordId - Record ID (e.g. rec...); must exist.
 * @param {string} options.fieldId - Field ID (e.g. fld...) of the attachment field.
 * @param {string} options.filePath - Local filesystem path to the file to upload.
 * @param {string} [options.filename] - Optional filename for the attachment.
 * @param {string} [options.contentType] - Optional MIME type.
 * @param {boolean} [options.returnFieldsByFieldId=false] - Passed to getRecord when verifying.
 *
 * @returns {Promise<Object>} The updated record returned by addAttachmentToRecord.
 *
 * @throws {Error} When getRecord fails or addAttachmentToRecord fails; rethrows after logging on verify failure.
 *
 * @example
 * const updated = await uploadRecordWithAttachment({ token, baseId, tableIdOrName, recordId, fieldId, filePath, filename: "report.pdf", contentType: "application/pdf" });
 *
 * @remarks
 * Verification uses provided token and baseId; upload uses module-level client (AIRTABLE_TOKEN, AIRTABLE_BASE_ID). console.log("updated:", updated) may expose record data in logs.
 *
 * @see getRecord
 * @see addAttachmentToRecord
 */
export async function uploadRecordWithAttachment({
    client,
    tableIdOrName,
    recordId,
    filePath,
    contentType = undefined,
}) {
    // 1. Verify the record exists and check if the field is accessible
    try {
        const verifyRecord = await client.getRecord(tableIdOrName, recordId);
    } catch (verifyError) {
        throw new DetailedError("Error verifying record before upload", {
            cause: verifyError,
            source: "src/airtable/queries.js:uploadRecordWithAttachment",
            details: {
                recordId: recordId,
                tableIdOrName: tableIdOrName,
            }
        });
    }

    // 2. Build the filename
    const now = new Date();

    const date = now.toLocaleDateString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
    const hour = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const filename = `${date} - ${hour} - Carta dei Vini.pdf`;

    // 3. Upload the PDF to the Airtable record
    const updated = await addAttachmentToRecord({
        client,
        tableName: tableIdOrName,
        recordId,
        fieldName: "pdf",
        filePath,
        filename,
        contentType
    })

    return {
        ok: true,
        updated: updated
    };
}
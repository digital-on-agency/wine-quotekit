/**
 * Checks if a string matches Airtable record ID format: `rec` + 14 alphanumeric characters.
 * @param {string} id - Value to test.
 * @returns {boolean} True if `id` matches `/^rec[a-zA-Z0-9]{14}$/`.
 * @internal
 */
export function isValidAirtableRecordId(id) {
    return /^rec[a-zA-Z0-9]{14}$/.test(id);
}

/**
 * Checks if a string matches Airtable base ID format: `app` + alphanumeric sequence.
 * @param {string} id - Value to test.
 * @returns {boolean} True if `id` matches `/^app[a-zA-Z0-9]+$/`.
 * @internal
 */
export function isValidAirtableBaseId(id) {
    return /^app[a-zA-Z0-9]+$/.test(id);
}

/**
 * Validates the minimum runtime parameters required by the main flow.
 * Checks Airtable base ID, auth token, and enoteca record ID format, then
 * returns a structured validation result without throwing.
 *
 * @param {string} enotecaId - Airtable record ID (`rec...`).
 * @param {string} base_id - Airtable base ID (`app...`).
 * @param {string} auth_token - Airtable personal access token.
 * @returns {{ ok: true } | { ok: false, errors: string }} Validation outcome with aggregated errors when invalid.
 */
export function validateMainParams(enotecaId, base_id, auth_token,) {

    let errors = [];

    if (!base_id || !isValidAirtableBaseId(base_id)) {
        errors.push("\t- base id is missing or invalid. Expected format: appXXXXXXXXXXXXXX");
    }

    if (!auth_token) {
        errors.push("\t- auth token is missing or invalid");
    }

    if (!enotecaId || !isValidAirtableRecordId(enotecaId)) {
        errors.push("\t- enoteca id is missing or invalid. Expected format: recXXXXXXXXXXXXXX");
    }

    if (errors.length > 0) {
        return {
            ok: false,
            errors: "Invalid parameters:\n" + errors.join("\n"),
        }
    }

    return {
        ok: true
    }
}

/**
 * Domain error with custom metadata fields.
 * Use this as a base error shape across the project.
 * @param {string} message
 * @param {object} [options]
 * @param {string} [options.code]
 * @param {number} [options.status]
 * @param {string} [options.source]
 * @param {object} [options.details]
 * @param {Error} [options.cause]
 */
export class DetailedError extends Error {
    constructor(message, options = {}) {
        super(message, { cause: options.cause });
        this.name = "DetailedError";

        this.code = options.code ?? "DETAILED_ERROR";
        this.status = options.status ?? 500;
        this.source = options.source ?? "src/domain/schema.js";
        this.details = options.details ?? {};
    }
}
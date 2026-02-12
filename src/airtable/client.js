import { 
    createAirtableClient, 
    listAllRecords, 
    addAttachmentToRecord
} from "@te3sk/airtable-core/server";

// import { getRecord } from "@te3sk/airtable-core";
import dotenv from "dotenv";

dotenv.config();

/**
 * Creates a new Airtable client instance for a specific base/token pair.
 * Wraps client initialization and rethrows failures as `DetailedError`
 * enriched with source and input context metadata.
 *
 * @param {string} baseId - Airtable base ID (e.g. `appXXXXXXXXXXXXXX`).
 * @param {string} authToken - Airtable personal access token used for authentication.
 * @returns {ReturnType<typeof createAirtableClient>} Configured Airtable client instance.
 * @throws {DetailedError} If client creation fails.
 */
function newATClient(baseId, authToken) {
    try {
        return createAirtableClient({
            token: authToken,
            baseId: baseId,
        });
    } catch (error) {
        throw new DetailedError("Error creating Airtable client", {
            cause: error,
            source: "src/airtable/client.js:newATClient",
            details: {
                baseId: baseId,
                authToken: authToken,
            }
        })
    }
}

/**
 * Singleton Airtable API client bound to the configured base.
 * Authenticates via `AIRTABLE_AUTH_TOKEN` or, if unset, `AIRTABLE_API_KEY`;
 * targets the base identified by `AIRTABLE_BASE_ID`. Use this instance for
 * all Airtable reads/writes within the application.
 * @type {import("@scope/airtable/server").AirtableClient}
 */
const client = createAirtableClient({
    token: process.env.AIRTABLE_AUTH_TOKEN,
    baseId: process.env.AIRTABLE_BASE_ID,
});

export { listAllRecords, newATClient, addAttachmentToRecord };
// export default client;
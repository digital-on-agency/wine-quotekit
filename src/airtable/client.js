// ######## DEPENDENCIES ########
// airtable-core: provides a client for the Airtable API
import { 
    createAirtableClient, 
    listAllRecords, 
    addAttachmentToRecord
} from "@te3sk/airtable-core/server";
// loads environment variables from a .env file
import dotenv from "dotenv";

// ######## CONFIGURATION ########

dotenv.config();

// ######## FUNCTIONS ######## 

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
            timeoutMs: 600000,
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

export { listAllRecords, newATClient, addAttachmentToRecord };
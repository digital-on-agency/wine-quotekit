// src/data/fetchers/airtable.js
import axios from 'axios'

export async function fetchAirtableRecord({ baseId, table, recordId }) {
  try {
    const url = `https://api.airtable.com/v0/${baseId}/${table}/${recordId}`
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
    })
    return res.data // o res.data.fields se ti serve solo quello
  } catch (err) {
    // log, wrapping, messaggio chiaro
    throw new Error(`Airtable record fetch failed for ${table}/${recordId}: ${err.message}`)
  }
}

/**
 * Fetches a list of records from an Airtable base/table, optionally filtered by a formula.
 *
 * This is a thin wrapper around the Airtable REST API:
 *   GET https://api.airtable.com/v0/{baseId}/{table}?filterByFormula=...
 *
 * Authentication is handled via the `AIRTABLE_API_KEY` environment variable, passed
 * as a Bearer token in the `Authorization` header.
 *
 * @async
 * @function fetchAirtableRecords
 * @param {Object} params - Configuration object for the request.
 * @param {string} params.baseId - Airtable base ID where the table is located.
 * @param {string} params.table - Name or ID of the Airtable table to query.
 * @param {string} [params.filterByFormula] - Optional Airtable formula to filter
 *   records server‑side (e.g. `{Active} = 1`). If omitted, all records are returned
 *   (subject to Airtable's default limits/pagination).
 * @returns {Promise<Array<Object>>} Resolves to the array of record objects returned
 *   by Airtable (`res.data.records`).
 * @throws {Error} If the HTTP request fails or Airtable responds with an error,
 *   the error is wrapped and rethrown with additional context containing the table name.
 */
export async function fetchAirtableRecords({ baseId, table, filterByFormula }) {
  try {
    const url = `https://api.airtable.com/v0/${baseId}/${table}`
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
      params: { filterByFormula },
    })
    return res.data.records
  } catch (err) {
    throw new Error(`Airtable list fetch failed for ${table}: ${err.message}`)
  }
}

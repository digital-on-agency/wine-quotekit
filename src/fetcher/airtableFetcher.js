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

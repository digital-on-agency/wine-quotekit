// # -------------------------- IMPORT DEPENDENCIES --------------------------
// Load environment variables FIRST, before any other imports
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import main from './index.js'

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env from project root (go up from src/lib/api/server to project root)
const projectRoot = path.resolve(__dirname, '../../../../')
dotenv.config({ path: path.join(projectRoot, '.env') })

import express from 'express'

// # -------------------------- GLOBAL VARIABLES --------------------------

// create the express app
const app = express()
// define the port
const port = 3000

// # -------------------------- MIDDLEWARES --------------------------
app.use(express.json())

// # -------------------------- ROUTES --------------------------

// TODO: remove after testing
app.use((req, res, next) => {
    console.log(`[REQ] ${req.method} ${req.url}`);
    next();
  });  

// health check 
app.get('/', (req, res) => {
    res.json({success: true, status: 'ok', message: 'QuoteKit API is running'})
})

const help_message = `
QuoteKit API – rotte disponibili

  GET /
      Health check. Risposta: { success, status: 'ok', message: 'QuoteKit API is running' }

  GET /help
      Questo messaggio: elenco rotte e descrizioni.

  POST /wine-list
      Genera la wine list per un’enoteca ed esegue il pipeline completo (dati Airtable → PDF → upload su Airtable).
      Body: nessun parametro richiesto; la configurazione (enotecaId, base_id, token) è attualmente gestita dalla CLI.
      Risposta: JSON con l’esito del pipeline (es. { ok, step_time } o errore).
`

// help route
app.get('/help', (req, res) => {
    res.json({success: true, status: 'ok', message: help_message})
})

app.post('/wine-list', (req, res) => wineListWorker(req, res).catch((err) => {
    console.error('[wine-list]', err?.message ?? err);
    if (!res.headersSent) {
        const status = err?.status ?? 500;
        res.status(status).json({
            ok: false,
            error: err?.message ?? 'Internal server error',
            code: err?.code,
            details: err?.details,
            cause: err?.cause?.message ?? err?.cause,
        });
    }
}));

// # -------------------------- START THE SERVER --------------------------

// start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`)
})

// # -------------------------- WORKER FUNCTION --------------------------

const ENOTECA_ID = process.env.ENOTECA_ID ?? 'recoBeLAxlhrj7jvw'
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID ?? 'appFXNhUnafY4yRM5'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN ?? 'patm1It1CgNgk7QGY.a5f27767877a843a0b9e04b4f9964571f6cab00bc0be51552bcfebf967f120c9'

export default async function wineListWorker(req, res) {
    try {
        const result = await main(ENOTECA_ID, AIRTABLE_BASE_ID, AIRTABLE_TOKEN);
        if (!result.ok) {
            res.status(500).json({ ok: false, error: result.error, step_time: result.step_time });
            return;
        }
        res.status(200).json(result);
    } catch (err) {
        const status = err?.status ?? 500;
        res.status(status).json({
            ok: false,
            error: err?.message ?? 'Internal server error',
            code: err?.code,
            details: err?.details,
            cause: err?.cause?.message ?? err?.cause,
        });
    }
}
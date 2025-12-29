// # -------------------------- IMPORT DEPENDENCIES --------------------------
// Load environment variables FIRST, before any other imports
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// Get the directory of the current file
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env from project root (go up from src/lib/api/server to project root)
const projectRoot = path.resolve(__dirname, '../../../../')
dotenv.config({ path: path.join(projectRoot, '.env') })

import express from 'express'
import { wineListController } from './worker.js'

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
    Available routes:
    / (GET)
        - Health check: returns a JSON object with success: true, status: 'ok', message: 'QuoteKit API is running'
    /help (GET)
        - Help: returns the available routes and their descriptions
    /api/wine-list (POST)
        - Wine list generator: generates a wine list for a given enoteca
        - Parameters:
            - enotecaId: the ID of the enoteca to generate the wine list for
            - access_token: the access token to use to access the Airtable API
            - base_id: the base ID to use to access the Airtable API
            - table_id: the table ID to use to access the Airtable API
            - wine_list_tab_id: the table ID to use to access the Airtable API
            - enoteca_table_id: the table ID to use to access the Airtable API
            - out_tab_id: the table ID to use to access the Airtable API
            - out_field_id: the field ID to use to access the Airtable API
`

// help route
app.get('/help', (req, res) => {
    res.json({success: true, status: 'ok', message: help_message})
})

app.post('/wine-list', wineListController)

// # -------------------------- START THE SERVER --------------------------

// start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`)
})

// # -------------------------- IMPORT DEPENDENCIES --------------------------
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

// health check 
app.get('/', (req, res) => {
    res.json({success: true, status: 'ok', message: 'QuoteKit API is running'})
})

// Define router
// todo: the router components should be imported from the routes folder
const router = express.Router()

// wine list generator route
router.post('/wine-list', wineListController)

// use the router
app.use('/api', router)

// # -------------------------- START THE SERVER --------------------------

// start the server
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`)
})

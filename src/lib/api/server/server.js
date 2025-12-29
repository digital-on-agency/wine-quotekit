import express from 'express'
import { controller as workerController } from './worker.js'
const app = express()
const port = 3000

app.get('/', (req, res) => {
    workerController(req, res)
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

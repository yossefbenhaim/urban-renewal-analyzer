import express from 'express'
import { evaluateHandler } from './routes/evaluate.js'
import { citiesHandler, streetsHandler } from './routes/address.js'
import { validateAddressHandler } from './routes/validate.js'

const app = express()
app.use(express.json({ limit: '64kb' }))

// CORS: in production the web SPA is served from the same origin via nginx,
// so we don't strictly need CORS — but adding it makes local dev (Vite on
// :5173 hitting the api on :3001) painless.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

app.get('/api/cities', citiesHandler)
app.get('/api/streets', streetsHandler)
app.get('/api/validate-address', validateAddressHandler)
app.post('/api/evaluate', evaluateHandler)

const port = Number(process.env.PORT ?? 3001)
app.listen(port, () => {
  console.log(`[feasibility] api listening on :${port}`)
})

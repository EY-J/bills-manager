import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const swBuildId = String(Date.now())
const appVersion = String(process.env.VITE_APP_VERSION || process.env.npm_package_version || '0.0.0')
const LOCAL_API_ROUTES = new Map([
  ['/api/account-auth', 'api/account-auth.js'],
  ['/api/account-sync', 'api/account-sync.js'],
  ['/api/runtime-errors', 'api/runtime-errors.js'],
])

const LOCAL_API_ERROR_MESSAGE_BY_ROUTE = new Map([
  ['/api/account-auth', 'Account service is unavailable. Please try again.'],
  ['/api/account-sync', 'Account service is unavailable. Please try again.'],
  ['/api/runtime-errors', 'Runtime monitor service is unavailable. Please try again.'],
])

function attachApiResponseHelpers(res) {
  if (typeof res.status !== 'function') {
    res.status = (code) => {
      res.statusCode = Number(code)
      return res
    }
  }

  if (typeof res.json !== 'function') {
    res.json = (payload) => {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
      }
      res.end(JSON.stringify(payload))
      return res
    }
  }

  return res
}

async function readRequestBody(req, maxBytes = 2 * 1024 * 1024) {
  const chunks = []
  let total = 0

  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += piece.length
    if (total > maxBytes) {
      throw new Error('Payload too large')
    }
    chunks.push(piece)
  }

  if (chunks.length === 0) return ''
  return Buffer.concat(chunks).toString('utf8')
}

function localApiPlugin() {
  return {
    name: 'local-api-routes',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = String(req.url || '').split('?')[0]
        const routeFile = LOCAL_API_ROUTES.get(pathname)
        if (!routeFile) return next()

        try {
          attachApiResponseHelpers(res)
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            req.body = await readRequestBody(req)
          }

          const handlerUrl = `${pathToFileURL(resolve(process.cwd(), routeFile)).href}?t=${Date.now()}`
          const mod = await import(handlerUrl)
          const handler = mod?.default

          if (typeof handler !== 'function') {
            throw new Error(`Invalid API handler for ${pathname}`)
          }

          await handler(req, res)
          if (!res.writableEnded) {
            res.end()
          }
        } catch (error) {
          if (res.writableEnded) return
          if (!res.headersSent) {
            const isPayloadTooLarge = error instanceof Error && error.message === 'Payload too large'
            res.statusCode = isPayloadTooLarge ? 413 : 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
          }
          console.error(
            `[local-api-routes] ${pathname} failed:`,
            error instanceof Error ? error.message : String(error)
          )
          const routeMessage = LOCAL_API_ERROR_MESSAGE_BY_ROUTE.get(pathname) || 'Request failed.'
          const message =
            error instanceof Error && error.message === 'Payload too large'
              ? 'Payload too large'
              : routeMessage
          res.end(JSON.stringify({ ok: false, error: message }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localApiPlugin()],
  define: {
    'import.meta.env.VITE_SW_BUILD_ID': JSON.stringify(swBuildId),
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
})

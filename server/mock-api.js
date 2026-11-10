import { getMockTopology, jitterTopology, SCENES } from '../src/mock/data.js'

const VALID_SCENES = new Set(SCENES.map((scene) => scene.key))

function sendPayload(payload) {
  payload.meta = { ...(payload.meta || {}), generatedAt: new Date().toISOString(), version: Date.now() }
  return payload
}

/**
 * 开发期 Mock 接口：
 *   GET /api/topology?scene=network&live=1
 *   GET /api/topology/stream?scene=network&interval=5000   (SSE)
 * 生产环境请把 VITE_API_BASE / VITE_REALTIME_URL 指向真实后端。
 */
export function mockApiPlugin() {
  return {
    name: 'topology-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/topology')) return next()

        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Cache-Control', 'no-store')

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.end()
          return
        }
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'Method Not Allowed' }))
          return
        }

        const scene = url.searchParams.get('scene') || 'network'
        if (!VALID_SCENES.has(scene)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: `Unknown scene: ${scene}` }))
          return
        }

        // SSE 实时通道
        if (url.pathname === '/api/topology/stream') {
          const interval = Math.max(1000, Number(url.searchParams.get('interval')) || 5000)
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          res.write('retry: 3000\n\n')

          const push = () => {
            const payload = sendPayload(jitterTopology(getMockTopology(scene)))
            res.write(`event: topology\ndata: ${JSON.stringify(payload)}\n\n`)
          }

          push()
          const timer = setInterval(push, interval)
          const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)

          const close = () => {
            clearInterval(timer)
            clearInterval(heartbeat)
            res.end()
          }
          req.on('close', close)
          req.on('aborted', close)
          return
        }

        // 普通 REST
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        let payload = getMockTopology(scene)
        if (url.searchParams.get('live') === '1') payload = jitterTopology(payload)
        sendPayload(payload)

        const body = JSON.stringify(payload)
        setTimeout(() => {
          res.statusCode = 200
          res.end(body)
        }, 90)
      })
    },
  }
}

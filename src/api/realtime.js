/**
 * 实时数据通道：SSE / WebSocket + 指数退避重连 + 版本去重。
 *
 * 开发环境默认使用 `/api/topology/stream`（SSE），
 * 生产环境可通过 `VITE_REALTIME_URL` / `VITE_REALTIME_PROTOCOL` 指定。
 */

const DEFAULT_PROTOCOL = 'sse'
const MAX_BACKOFF = 30000

export const REALTIME_PROTOCOL = String(import.meta.env.VITE_REALTIME_PROTOCOL || DEFAULT_PROTOCOL)
export const REALTIME_ENABLED = String(import.meta.env.VITE_REALTIME || 'on').toLowerCase() !== 'off'

export function realtimeUrl(scene, protocol = REALTIME_PROTOCOL) {
  const custom = import.meta.env.VITE_REALTIME_URL
  if (custom) {
    if (protocol === 'ws' && custom.startsWith('http')) {
      return custom.replace(/^http/, 'ws')
    }
    return custom
  }
  const base = (import.meta.env.VITE_API_BASE || '/api').replace(/\/+$/, '')
  const path = protocol === 'ws' ? '/topology/ws' : '/topology/stream'
  return `${base}${path}?scene=${encodeURIComponent(scene)}`
}

function payloadSignature(payload) {
  if (!payload) return ''
  return String(
    payload.meta?.version ??
      payload.meta?.generatedAt ??
      [
        payload.nodes?.length || 0,
        payload.links?.length || 0,
        payload.summary?.warn || 0,
        payload.summary?.error || 0,
      ].join(':'),
  )
}

function parseMessage(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(String(raw))
  } catch {
    return null
  }
}

/**
 * @param {object} options
 * @param {string} options.scene
 * @param {(payload:object)=>void} options.onData
 * @param {(status:string, detail?:object)=>void} [options.onStatus]
 * @param {(error:Error)=>void} [options.onError]
 * @param {'sse'|'ws'} [options.protocol]
 * @param {string} [options.url]
 */
export function createRealtimeClient(options = {}) {
  const protocol =
    options.protocol === 'ws' || options.protocol === 'websocket' ? 'ws' : 'sse'
  const url = options.url || realtimeUrl(options.scene || 'network', protocol)
  const onData = options.onData || (() => {})
  const onStatus = options.onStatus || (() => {})
  const onError = options.onError || (() => {})

  let source = null
  let socket = null
  let reconnectTimer = null
  let heartbeatTimer = null
  let attempts = 0
  let closed = false
  let lastSignature = ''
  let currentStatus = 'idle'

  function setStatus(status, detail) {
    if (currentStatus === status) return
    currentStatus = status
    onStatus(status, detail)
  }

  function handlePayload(raw) {
    const payload = parseMessage(raw)
    if (!payload || typeof payload !== 'object') return
    const data = payload.data && typeof payload.data === 'object' ? payload.data : payload
    const signature = payloadSignature(data)
    if (signature && signature === lastSignature) return
    lastSignature = signature
    onData(data)
  }

  function scheduleReconnect() {
    if (closed) return
    attempts += 1
    const delay = Math.min(MAX_BACKOFF, 800 * 2 ** Math.min(attempts - 1, 6))
    const jitter = Math.round(delay * (0.15 + Math.random() * 0.2))
    setStatus('reconnecting', { attempt: attempts, delay: delay + jitter })
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, delay + jitter)
  }

  function connectSse() {
    source = new EventSource(url)
    source.onopen = () => {
      attempts = 0
      setStatus('connected', { protocol: 'sse', url })
    }
    source.addEventListener('topology', (event) => handlePayload(event.data))
    source.onmessage = (event) => handlePayload(event.data)
    source.onerror = () => {
      source?.close()
      source = null
      if (closed) return
      onError(new Error('SSE 连接中断'))
      scheduleReconnect()
    }
  }

  function connectWs() {
    socket = new WebSocket(url)
    socket.onopen = () => {
      attempts = 0
      setStatus('connected', { protocol: 'ws', url })
      heartbeatTimer = setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'ping', at: Date.now() }))
        }
      }, 20000)
    }
    socket.onmessage = (event) => handlePayload(event.data)
    socket.onerror = () => {
      onError(new Error('WebSocket 连接错误'))
    }
    socket.onclose = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
      }
      socket = null
      if (closed) return
      scheduleReconnect()
    }
  }

  function connect() {
    if (closed) return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    setStatus('connecting', { protocol, url })
    try {
      if (protocol === 'ws') connectWs()
      else connectSse()
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)))
      scheduleReconnect()
    }
  }

  function close() {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    reconnectTimer = null
    heartbeatTimer = null
    source?.close()
    source = null
    if (socket) {
      socket.onclose = null
      socket.close()
      socket = null
    }
    setStatus('closed')
  }

  return {
    url,
    protocol,
    connect,
    close,
    get status() {
      return currentStatus
    },
    get attempts() {
      return attempts
    },
  }
}

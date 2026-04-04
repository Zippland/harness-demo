/**
 * 极简反向代理：删除后端不支持的字段（如 user）后转发请求。
 * 位于 LiteLLM 和后端模型服务之间。
 *
 * LiteLLM → strip-proxy → 火山方舟/其他后端
 */

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'http'
import { request as httpsRequest } from 'https'
import { URL } from 'url'

const STRIP_FIELDS = ['user']  // 要删除的字段

/** 火山方舟 Responses API 要求 input 数组里每个 item 带 status 字段 */
function patchInput(body: any): void {
  if (Array.isArray(body?.input)) {
    for (const item of body.input) {
      if (item && typeof item === 'object' && !item.status) {
        item.status = 'completed'
      }
    }
  }
}

export function startStripProxy(targetUrl: string, port: number): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      for await (const chunk of req) body += chunk

      // 解析并删除不支持的字段
      let parsedBody: any
      try {
        parsedBody = JSON.parse(body)
        for (const field of STRIP_FIELDS) delete parsedBody[field]
        patchInput(parsedBody)
        body = JSON.stringify(parsedBody)
      } catch { /* 不是 JSON，原样转发 */ }

      // 构建目标 URL（保留 targetUrl 的路径前缀）
      const targetBase = new URL(targetUrl)
      const incomingPath = (req.url ?? '/').replace(/^\/v1/, '')  // 去掉 LiteLLM 加的 /v1
      const fullPath = targetBase.pathname.replace(/\/$/, '') + incomingPath
      const target = new URL(fullPath, targetUrl)

      const isHttps = target.protocol === 'https:'
      const doRequest = isHttps ? httpsRequest : httpRequest

      const proxyReq = doRequest({
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method,
        headers: {
          ...req.headers,
          host: target.host,
          'content-length': Buffer.byteLength(body).toString(),
        },
      }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers)
        proxyRes.pipe(res)
      })

      proxyReq.on('error', (err) => {
        res.writeHead(502)
        res.end(JSON.stringify({ error: err.message }))
      })

      proxyReq.write(body)
      proxyReq.end()
    })

    server.listen(port, '127.0.0.1', () => {
      resolve()
    })
  })
}

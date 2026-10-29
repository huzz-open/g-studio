import { test } from 'node:test'
import assert from 'node:assert/strict'
import { endpoint, GenerationClient } from '../src/shared/generation/client.ts'
import { installCommand } from '../src/shared/generation/deployment.ts'

test('direct APIs allow private HTTP addresses without allowing public HTTP or credentials in URLs', () => {
  for (const host of ['localhost', '127.0.0.1', '127.0.0.2', '10.1.2.3', '172.16.0.1', '172.31.255.254', '192.168.1.20', '[::1]', '[fd12::1]', '[fe80::1]']) {
    assert.equal(endpoint(`http://${host}:8765/`), `http://${host}:8765`)
  }
  for (const host of ['172.15.1.1', '172.32.0.1', '192.169.1.1', '8.8.8.8', '0.0.0.0', 'example.com', '192.168.1.1.example.com', 'localhost.evil.test']) {
    assert.throws(() => endpoint(`http://${host}:8765`), /HTTPS/)
  }
  assert.equal(endpoint('https://api.example.com/generation'), 'https://api.example.com/generation')
  for (const value of ['ftp://localhost', 'https://user:pass@example.com', 'http://localhost?a=b', 'http://localhost/#test']) assert.throws(() => endpoint(value))
  assert.throws(() => endpoint('http://192.168.1.20:8787', 'relay'), /HTTPS/)
})

test('a private-network client sends its token to the configured direct endpoint', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(url, 'http://192.168.1.20:8765/v1/info?providerId=hunyuan-mini')
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer direct-token')
    return new Response(JSON.stringify({ deviceType: 'cpu' }), { headers: { 'Content-Type': 'application/json' } })
  })
  const client = new GenerationClient({ mode: 'direct', baseUrl: 'http://192.168.1.20:8765', token: 'direct-token', relayUrl: '', relayToken: '', deviceId: '', providerId: 'hunyuan-mini', targetFaces: 12000, seed: 1, parametersByProvider: {} })
  assert.deepEqual(await client.info(), { deviceType: 'cpu' })
  assert.equal(fetch.mock.callCount(), 1)
})

test('install commands use literal site URLs on one line and preserve the deployment subpath', () => {
  const command = installCommand('https://custom.example.com/studio/', true)
  assert.equal(command, "curl -fsSL 'https://custom.example.com/studio/install-generation.sh' | bash -s -- --site 'https://custom.example.com/studio/' --host 0.0.0.0")
  assert.doesNotMatch(command, /\n|G_STUDIO_SITE/)
  assert.equal(installCommand('http://localhost:5173/studio'), "curl -fsSL 'http://localhost:5173/studio/install-generation.sh' | bash -s -- --site 'http://localhost:5173/studio/'")
  assert.ok(!installCommand('http://localhost:5173/').includes('--host'))
  assert.throws(() => installCommand('https://user:password@example.com/'))
})

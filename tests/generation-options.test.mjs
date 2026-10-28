import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureNetwork } from '../scripts/generation/options.mjs';

test('network options preserve loopback by default and support LAN listeners and exact origins', () => {
  const local = {};
  assert.equal(configureNetwork([], local), 'http://127.0.0.1:8765');
  assert.equal(local.GEN_HOST, '127.0.0.1');
  const remote = {};
  assert.equal(configureNetwork(['--host', '0.0.0.0', '--port', '9876', '--origin', 'https://site.example'], remote), 'http://127.0.0.1:9876');
  assert.equal(remote.GEN_HOST, '0.0.0.0');
  assert.equal(remote.GEN_ORIGINS, 'http://localhost:5173,http://127.0.0.1:5173,https://site.example');
  assert.equal(configureNetwork(['--host', '192.168.1.20'], {}), 'http://192.168.1.20:8765');
  assert.equal(configureNetwork(['--host', '::'], {}), 'http://[::1]:8765');
  for (const flags of [['--host'], ['--port'], ['--host', 'evil.test'], ['--port', '0'], ['--port', '65536'], ['--origin', '*'], ['--origin', 'https://site.example/path']]) assert.throws(() => configureNetwork(flags, {}));
  assert.throws(() => configureNetwork([], { GEN_ORIGINS: '*' }));
  assert.throws(() => configureNetwork([], { GEN_ORIGINS: 'http://*' }));
});

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Configuration from './Configuration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dirPath = path.resolve(__dirname, 'test_config');

describe('Configuration', () => {
  let config;

  it('Constructor', () => {
    config = new Configuration(dirPath);
    assert.equal(config.environment, 'development');
    assert.equal(config.port, undefined);
    assert.equal(config.host, undefined);
    assert.equal(config.log, undefined);
  });

  it('Reading all config files in right order', async () => {
    await config.init();
    assert.equal(config.port, 3000);
    assert.equal(config.host, 'localhost');
    assert.equal(config.log.level, 'info');
    assert.equal(config.email.testMode, true);
  });
});

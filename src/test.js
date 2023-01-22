import { default as test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Application } from '../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, 'test_app');
let app;

after(async () => {
  await app.models.Product.collection.deleteMany({});
  await app.destroy();
});

test('Application', async () => {
  app = new Application(appDir);
  await app.init();
  assert.equal(app.config.port, 3000);
  assert.equal(app.config.host, 'localhost');
  assert.equal(app.config.log.level, 'error');
  assert.equal(app.config.email.testMode, true);
  assert.equal(app.name, 'test');
  await app.destroy();
});

test('Mongodb', async () => {
  app = new Application(appDir);
  await app.init();
  let product;
  let id = 'aaaabbbbccccddddeeeeffff';
  const title = 'Box 10x15';

  product = await app.models.Product.findById(id);
  assert.equal(product, null);

  product = await app.models.Product.create({ title });
  assert.equal(product.title, title);
  assert.equal(product.price, 0);
  id = product.id;

  product = await app.models.Product.findById(id);
  assert.equal(product.title, title);
  assert.equal(product.price, 0);

  await product.delete();
  product = await app.models.Product.findById(id);
  assert.equal(product, null);

  await app.destroy();
});

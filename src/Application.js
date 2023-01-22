/* eslint-disable no-await-in-loop */

import EventEmitter from 'node:events';
import path from 'node:path';
import fs from 'node:fs';

import pino from 'pino';
import fastify from 'fastify';
import cors from '@fastify/cors';
import serveStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import { MongoClient } from 'mongodb';
import cron from 'node-cron';

import Configuration from './Configuration.js';
import socketIoApi from './socketIoApi.js';
import APIErrorSchema from './schemas/APIError.js';
import ObjectIdSchema from './schemas/ObjectId.js';

export default class Application extends EventEmitter {
  name;

  metadata;

  /** @type {Configuration} */
  config = null;

  /**
   * Глобальный логгер для всех модулей
   * @type {pino.BaseLogger}
   */
  logger = null;

  /**
   * {@link https://github.com/mongodb/node-mongodb-native/blob/main/src/db.ts#L127}
   * @type {Db}
   */
  mongo = null;

  /**
   * Веб-сервер
   *
   * Доступен, когда приложение запущено в режиме web
   * @type {?FastifyInstance}
   */
  server = null;

  /**
   * Диспетчер крон-задач
   *
   * Доступен, когда приложение запущено в режиме cron
   * @type {Object}
   */
  cron = null;

  /** @type {Object} */
  models = {};

  /** @type {Object} */
  services = {};

  /**
   * Логгер только уровня приложения
   * @type {pino.BaseLogger}
   */
  appLogger = null;

  /* @type {string} */
  status = 'created';

  /**
   * {@link https://github.com/mongodb/node-mongodb-native/blob/main/src/mongo_client.ts#L101}
   * @type {MongoClient}
   */
  #mongoClient;

  /**
   * @type {Object}
   * @private
   */
  #moduleStructure = {};

  #swaggerConfig;

  /**
   * @param {string} dirPath
   * @param {Object} runtimeConfig
   */
  constructor(dirPath, runtimeConfig = {}) {
    super();
    this.dirPath = dirPath;

    const packagePath = path.resolve(this.dirPath, './package.json');
    this.metadata = JSON.parse(fs.readFileSync(packagePath, { encoding: 'utf8' }));
    this.name = this.metadata.name;

    this.config = new Configuration(path.resolve(this.dirPath, 'config'), {
      appName: this.name,
      mode: 'web',
      ...runtimeConfig,
    });

    this.#swaggerConfig = {
      routePrefix: '/docs',
      exposeRoute: true,
      hideUntagged: true,
      swagger: {
        swagger: '2.0',
        info: {
          title: 'Kupec API',
          version: this.metadata.version,
        },
        schemes: ['https', 'http'],
        consumes: ['application/json'],
        produces: ['application/json'],
        securityDefinitions: {
          APIKeyInHeader: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
        },
      },
      refResolver: {
        buildLocalReference(json, baseUri, fragment, i) {
          return json.$id || `def-${i}`;
        },
      },
    };
  }

  async init() {
    if (this.status !== 'created' && this.status !== 'stopped') {
      this.appLogger.error('Попытка запустить уже запущенное приложение');
      return;
    }

    this.status = 'launching';

    await this.config.init();
    this.#initLogger();
    if (this.config.mongo) {
      await this.#initMongo();
    }
    await this.initDependencies();
    await this.#loadModels();
    await this.#loadServices();

    // ---- graceful exit ----
    process.on('SIGINT', () => {
      this.destroy()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });

    await this.#patchData();

    // ---- mode specific behaviour ----
    switch (this.config.mode) {
      case 'internal':
        break;
      case 'cron':
        await this.#runScheduledTasks();
        break;
      case 'web':
      default:
        await this.#runWebServer();
    }

    this.appLogger.always(
      `Приложение ${this.name} запущено в режиме ${this.config.mode} в окружении ${this.config.environment}`,
    );

    this.status = 'active';
  }

  async destroy() {
    if (this.status === 'created' || this.status === 'stopped') {
      return;
    }

    if (this.cron) {
      this.cron.getTasks().forEach((task) => task.stop());
    }

    if (this.server) {
      // Закрываем вручную все соединения, иначе this.server.close намертво зависает.
      this.server.io.disconnectSockets(true);
      await this.server.close();
      this.server.io.close();
    }

    if (this.#mongoClient) {
      await this.#mongoClient.close();
    }

    await this.destroyDependencies();

    this.appLogger.always('Приложение остановлено');
  }

  /* eslint-disable class-methods-use-this, no-empty-function */
  async initDependencies() {
  }

  async destroyDependencies() {
  }
  /* eslint-enable class-methods-use-this, no-empty-function */

  static dirPath = '';

  #initLogger() {
    this.logger = pino({
      level: this.config.log.level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label /* , number */) {
          return { level: label };
        },
      },
      customLevels: {
        always: 100,
      },
    });
    this.appLogger = this.logger.child({ scope: 'app' });
  }

  async #initMongo() {
    const {
      host, port,
      user, password, database,
    } = this.config.mongo;
    const url = `mongodb://${user}:${password}@${host}:${port}/${database}`;

    this.#mongoClient = new MongoClient(url);
    await this.#mongoClient.connect();
    this.mongo = this.#mongoClient.db(this.config.mongo.database);

    this.appLogger.always(`База данных подключена по адресу mongodb://${user}:***@${host}:${port}/${database}`);
  }

  async #loadModels() {
    const dirPath = path.resolve(this.dirPath, './api/models');
    const items = fs.readdirSync(dirPath, { encoding: 'utf8', withFileTypes: true });
    const fileNames = items.filter((item) => item.isFile() && item.name.endsWith('.js')).map((item) => item.name);

    for (const fileName of fileNames) {
      const filePath = path.join(dirPath, fileName);
      const { name } = path.parse(filePath);
      const model = (await import(`file://${filePath}`)).default;
      this.models[name] = model;
    }

    for (const model of Object.values(this.models)) {
      model.init(this);
    }
  }

  async #loadServices() {
    const modules = {};
    const dirPath = path.resolve(this.dirPath, './api/modules');
    const dirs = fs.readdirSync(dirPath, { encoding: 'utf8', withFileTypes: true });
    const dirNames = dirs.filter((dir) => dir.isDirectory()).map((dir) => dir.name);

    for (const dirName of dirNames) {
      modules[dirName] = {};
      const modulePath = path.resolve(dirPath, dirName);
      const files = fs.readdirSync(modulePath, { encoding: 'utf8', withFileTypes: true });
      const fileNames = files.filter((item) => item.isFile() && item.name.endsWith('.js')).map((item) => item.name);
      fileNames.forEach((fileName) => {
        const { name } = path.parse(fileName);
        modules[dirName][name] = path.resolve(modulePath, fileName);
      });
    }

    this.#moduleStructure = modules;

    for (const [moduleName, files] of Object.entries(this.#moduleStructure)) {
      if (files.service) {
        const service = (await import(`file://${files.service}`)).default;
        this.services[moduleName] = service;
      }
    }

    for (const [serviceName, service] of Object.entries(this.services)) {
      await service.init(this);
      this.appLogger.debug(`Сервис ${serviceName} готов`);
    }
  }

  async #loadRouters() {
    for (const [moduleName, files] of Object.entries(this.#moduleStructure)) {
      if (files.router) {
        const router = (await import(`file://${files.router}`)).default;
        await this.server.register(router(this));
        this.appLogger.debug(`Роутер ${moduleName} готов`);
      }
    }
  }

  async #patchData() {
    const dirPath = path.resolve(this.dirPath, './api/patches');
    let files = fs.readdirSync(dirPath, { encoding: 'utf8', withFileTypes: true });
    files = files.filter((item) => item.isFile() && item.name.endsWith('.js'));

    let patchScripts = [];
    files.forEach((item) => {
      const fileName = item.name;
      patchScripts.push({
        id: Number.parseInt(path.parse(fileName).name, 10),
        path: path.resolve(dirPath, fileName),
      });
    });
    patchScripts.sort((a, b) => (a.version < b.version ? -1 : 1));
    if (patchScripts.length === 0) {
      return;
    }

    const [latestPatch] = await this.db.collection('Patch')
      .find({})
      .sort({ _id: -1 })
      .limit(1)
      .toArray();

    const maxId = latestPatch ? latestPatch._id : 0;
    patchScripts = patchScripts.filter((script) => script.id > maxId);

    for (const script of patchScripts) {
      const patch = (await import(`file://${script.path}`)).default;
      try {
        await this.db.collection('Patch').insertOne({
          _id: script.id,
          startedAt: new Date(),
          status: 'pending',
        });
      } catch (e) {
        // Значит другой процесс уже выполняет миграцию, так что можно спокойно закругляться
        return;
      }
      try {
        const logger = this.logger.child({ scope: 'patch', script: script.id });
        await patch(this, logger);
        await this.db.collection('Patch').updateOne({ _id: script.id }, {
          $set: {
            completedAt: new Date(),
            status: 'completed',
          },
        });
      } catch (e) {
        // А вот это уже плохо
        this.appLogger.error(e);
        await this.destroy();
      }
    }
  }

  async #runWebServer() {
    this.server = fastify({
      logger: {
        level: 'error',
        base: undefined,
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level(label /* , number */) {
            return { level: label };
          },
        },
      },
      disableRequestLogging: true,
      forceCloseConnections: true,
    });

    await this.server.register(cors, { origin: true });
    await this.server.register(serveStatic, { root: path.join(this.dirPath, './public') });
    await this.server.register(swagger, this.#swaggerConfig);
    await this.server.register(socketIoApi(this));

    this.server.addSchema(APIErrorSchema);
    this.server.addSchema(ObjectIdSchema);
    this.server.get('/', {
      schema: {
        summary: 'Кратко о приложении',
        tags: ['Общее'],
      },
    }, () => ({
      name: this.metadata.name,
      version: this.metadata.version,
      description: this.metadata.description,
    }));

    // Бизнес-логика
    await this.#loadRouters();

    await this.server.ready();
    this.server.swagger();

    await this.server.listen({
      port: this.config.port,
      host: this.config.host,
    });
    this.appLogger.always(`Веб-сервер запущен на ${this.config.host}:${this.config.port}`);
  }

  // Запускает периодические фоновые задачи
  async #runScheduledTasks() {
    this.cron = cron;

    for (const [moduleName, files] of Object.entries(this.#moduleStructure)) {
      if (files.scheduler) {
        const scheduler = (await import(`file://${files.scheduler}`)).default;
        scheduler(this); // Запускаем запланированные задачи модуля
        this.appLogger.debug(`Периодические задачи модуля ${moduleName} запущены`);
      }
    }

    this.cron.getTasks().forEach((task) => {
      if (task.options.scheduled === false) {
        // если true, то таймер запускается при создании задачи
        // если false, то таймер надо запускать вручную
        task.start();
      }
    });
    this.appLogger.always('Периодические задачи запланированы');
  }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import rc from 'rc';

const importFile = async (filePath) => {
  if (filePath.endsWith('.json')) {
    return JSON.parse(await fs.readFile(filePath, { encoding: 'utf8' }));
    // Не будем провоцировать линтер экспериментальными конструкциями
    // return (await import(filePath, { assert: { type: 'json' } })).default;
  } if (filePath.endsWith('.js')) {
    return (await import(`file://${filePath}`)).default;
  }
  throw new TypeError('Неподдерживаемый тип файла');
};

/**
 * @param {Object} a
 * @param {Object} b
 */
const deepMerge = (a, b) => {
  if (a == null) {
    throw new TypeError('Первый аргумент должен быть объектом');
  }

  if (b == null) {
    return;
  }

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.forEach((key) => {
    if (!(key in a)) {
      a[key] = b[key];
      return;
    }
    if (!(key in b)) {
      return;
    }
    const aProp = a[key];
    const bProp = b[key];
    if (aProp == null || bProp == null) {
      a[key] = b[key];
      return;
    }
    if (Array.isArray(aProp) && Array.isArray(bProp)) {
      aProp.concat(bProp);
      return;
    }
    if (typeof aProp === 'object' && typeof bProp === 'object') {
      deepMerge(aProp, bProp);
      return;
    }
    a[key] = b[key];
  });
};

export default class Configuration {
  #dirPath = '';

  #appName = '';

  #runtimeConfig = null;

  constructor(dirPath, { appName = 'app', ...runtimeConfig } = {}) {
    this.#dirPath = dirPath;
    this.#appName = appName;
    this.#runtimeConfig = runtimeConfig;
    this.environment = process.env.NODE_ENV || 'development';
  }

  async init() {
    // Настройки из разных источников в порядке повышения приоритета
    await this.#addModuleConfig();
    await this.#addEnvConfig();
    this.#addRcConfig();
    this.#addRuntimeConfig(this.#runtimeConfig);
    this.#addSpecialEnvVars();
  }

  /**
   * Подключает настройки отдельных модулей приложения
   *
   * Для каждого модуля можно создать свой файл с настройками в общей папке настроек.
   * Главное условие - имя файла без расширения должно полностью совпадать с именем модуля.
   */
  async #addModuleConfig() {
    const items = await fs.readdir(this.#dirPath, { encoding: 'utf8', withFileTypes: true });
    const fileNames = items.filter((item) => item.isFile()).map((item) => item.name);
    for (const fileName of fileNames) {
      const filePath = path.join(this.#dirPath, fileName);
      const { name } = path.parse(filePath);
      this[name] = await importFile(filePath); // eslint-disable-line no-await-in-loop
    }
  }

  /**
   * Подключает настройки из папки env
   *
   * Это включает два файла в порядке уменьшения приоритета:
   * - env/<environment>.js
   * - env/default.js
   */
  async #addEnvConfig() {
    const dirPath = path.join(this.#dirPath, 'env');
    const fileList = await fs.readdir(dirPath);

    const defaultFileName = fileList.find((fileName) => fileName.startsWith('default.js'));
    if (defaultFileName) {
      deepMerge(this, await importFile(path.join(dirPath, defaultFileName)));
    }

    const filePrefix = `${this.environment}.js`;
    const envFileName = fileList.find((fileName) => fileName.startsWith(filePrefix));
    if (envFileName) {
      deepMerge(this, await importFile(path.join(dirPath, envFileName)));
    }
  }

  /**
   * Добавляет конфиг, собранный библиотекой rc
   *
   * Это включает три источника конфигов в порядке уменьшения приоритета:
   * - cmd (командная строка)
   * - ENV (переменные окружения)
   * - .apprc (файл в папке проекта)
   * Подробнее тут: {@link https://www.npmjs.com/package/rc}
   */
  #addRcConfig() {
    deepMerge(this, rc(this.#appName));
  }

  /**
   * Добавляет конфиг, переданный напрямую при создании объекта конфига
   *
   * Такое может быть удобно в нескольких редких случаях.
   * @param {Object} obj
   */
  #addRuntimeConfig(obj) {
    deepMerge(this, obj);
  }

  /**
   * Особые переменные окружения
   *
   * Большинство настроек передавать через переменные окружения неудобно,
   * так как используются длинные названия с префиксами.
   * Но есть несколько переменных с короткими именами, которые используют сервисы типа Heroku.
   */
  #addSpecialEnvVars() {
    if (process.env.HOST) {
      this.host = Number(process.env.HOST);
    }
    if (process.env.PORT) {
      this.port = Number(process.env.PORT);
    }
  }
}

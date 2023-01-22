export default class APIError extends Error {
  /** @type {string} */
  code;

  /** @type {string} */
  detail;

  /**
   * @param {string} code
   * @param {*} [detail]
   */
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }

  toJSON() {
    return {
      code: this.code,
      detail: this.detail,
    };
  }
}

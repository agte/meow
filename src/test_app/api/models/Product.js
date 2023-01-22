import { MongoModel } from '../../../../index.js';

export default class Product extends MongoModel {
  title;

  price;

  constructor(data) {
    super(data);
    Object.assign(this, data);
  }

  static async create({ title, price = 0 }) {
    return super.create({ title, price });
  }
}

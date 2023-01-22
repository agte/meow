import { ObjectID as ObjectId } from 'mongodb';

/**
 * @typedef {(ObjectId|string)} ObjectIdLike
 */

export default class SimpleMongoModel {
  id;

  set _id(value) {
    this.id = value;
  }

  toJSON() {
    return { id: this.id?.toString() };
  }

  /**
   * @returns {this.constructor}
   */
  clone() {
    const doc = Object.fromEntries(Object.entries(this).map(([key, value]) => {
      if (Array.isArray(value)) {
        return [key, [...value]];
      }
      if (typeof value === 'object' && value !== null && !(value instanceof ObjectId)) {
        return [key, { ...value }];
      }
      return [key, value];
    }));
    return new this.constructor(doc);
  }

  async reload() {
    const doc = await this.constructor.collection.findOne({ _id: this.id });
    Object.assign(this, doc);
  }

  /**
   * @param {Object} changes
   * @returns {Promise<boolean>} Было ли проведено изменение в БД
   */
  async update(changes) {
    const { modifiedCount } = await this.constructor.collection.updateOne({ _id: this.id }, { $set: changes });
    Object.assign(this, changes);
    return modifiedCount === 1;
  }

  /**
   * Используется для конкурентного обновления
   * @param {Object} filter
   * @param {Object} changes
   * @returns {Promise<boolean>} Было ли проведено изменение в БД
   */
  async updateConcurrently(filter, changes) {
    const { modifiedCount } = await this.constructor.collection.updateOne(
      { ...filter, _id: this.id },
      { $set: changes },
    );
    if (modifiedCount === 1) {
      Object.assign(this, changes);
      return true;
    }
    return false;
  }

  /**
   * @returns {Promise<boolean>} Было ли проведено удаление в БД
   */
  async delete() {
    const { deletedCount } = await this.constructor.collection.deleteOne({ _id: this.id });
    return deletedCount === 1;
  }

  static collection = null;

  /**
   * @param {Object} dependencies
   * @param {mongodb.Database} dependencies.mongo
   */
  static async init({ mongo }) {
    this.collection = mongo.collection(this.name);
  }

  /**
   * @param {Object} doc
   * @returns {Promise<this>}
   */
  static async create(doc) {
    const { insertedId } = await this.collection.insertOne(doc);
    return this.findById(insertedId);
  }

  /**
   * @param {ObjectIdLike} id
   * @returns {Promise<?this>}
   */
  static async findById(id) {
    const doc = await this.collection.findOne({ _id: ObjectId(id) });
    return doc ? new this(doc) : null;
  }

  /**
   * @param {Object[]} docs
   * @returns {this[]}
   */
  static from(docs) {
    return docs.map((doc) => new this(doc));
  }

  /**
   * @param {SimpleMongoModel[]} entities
   * @returns {ObjectId[]}
   */
  static toIds(entities) {
    return entities.map((entity) => entity.id);
  }

  /**
   * @param {SimpleMongoModel[]} entities
   * @returns {Map<string, SimpleMongoModel>}
   */
  static toMap(entities) {
    return new Map(entities.map((entity) => [entity.id.toString(), entity]));
  }

  /**
   * @param {ObjectIdLike[]} ids
   * @returns {ObjectId[]}
   */
  static normalizeIds(ids) {
    return ids.map(ObjectId);
  }
}

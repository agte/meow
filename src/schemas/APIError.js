export default {
  $id: 'APIError',
  type: 'object',
  properties: {
    code: { type: 'string' },
  },
  required: ['code'],
};

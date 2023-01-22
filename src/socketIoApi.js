import { Server } from 'socket.io';
import fastifyPlugin from 'fastify-plugin';

export default (app) => fastifyPlugin((fastify, opts, done) => {
  const logger = app.logger.child({ scope: 'web sockets' });

  const io = new Server(fastify.server, { transports: ['websocket'] });

  fastify.decorate('io', io);

  fastify.decorateRequest('joinRoom', function joinRoom(roomId) {
    const socket = fastify.io.sockets.sockets.get(this.headers.wsid);
    if (!socket) {
      return;
    }
    socket.join(roomId);
  });

  fastify.decorateRequest('leaveRoom', function leaveRoom(roomId) {
    const socket = fastify.io.sockets.sockets.get(this.headers.wsid);
    if (!socket) {
      return;
    }
    socket.leave(roomId);
  });

  const serializerMap = new Map();

  fastify.decorate('emitToRoom', function emitToRoom(roomId, event, data, schema = null) {
    let serializer = JSON.stringify;
    if (schema && this.serializerCompiler) {
      serializer = serializerMap.get(schema);
      if (!serializer) {
        serializer = this.serializerCompiler({ schema });
        serializerMap.set(schema, serializer);
      }
    }

    // Эта сериализация нам нужна - тут идёт отсев лишних полей и приведение типов в соответствии с JSON-схемой.
    const serializedData = serializer(data);

    // Парсим сериализованный объект, потому что внутри socket.io в любом случае вызовется сериализация.
    // Конечно, это лишние телодвижения, но пока иначе не сделать.
    this.io.to(roomId).emit(event, JSON.parse(serializedData));
  });

  fastify.io.on('connect', (socket) => {
    socket.on('request', async (message, reply) => {
      const {
        method,
        url,
        query,
        body: payload,
      } = message;
      try {
        // Имитация HTTP-запроса для веб-сервера
        // Немного лишних телодвижений,
        // но это самый простой способ получить поведение REST API через веб-сокеты.
        const response = await fastify.inject({
          method,
          url,
          query,
          payload,
          headers: { wsid: socket.id },
        });
        const { statusCode, body } = response;
        // Парсим сериализованный объект, потому что внутри socket.io в любом случае вызовется сериализация.
        let jsonBody;
        if (body) {
          try {
            jsonBody = JSON.parse(body);
          } catch (e) {
            jsonBody = body;
          }
        }
        reply({ status: statusCode, body: jsonBody });
      } catch (e) {
        logger.error('Кривое сообщение от веб-сокета');
      }
    });
  });

  done();
});

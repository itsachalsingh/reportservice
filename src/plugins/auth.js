// ESM version
import fp from 'fastify-plugin';
import { verifyTokenRPC } from '../utils/rpcClient.js';

export default fp(async function authPlugin(fastify) {
  fastify.decorate('authenticate', async function (req, reply) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing token' });
    }

    const token = auth.split(' ')[1];

    try {
      const result = await verifyTokenRPC(token);
      if (!result?.valid) {
        return reply.code(401).send({ error: 'Invalid token' });
      }
      req.user = result.payload;
    } catch (err) {
      return reply.code(500).send({ error: 'Auth failed' });
    }
  });
});

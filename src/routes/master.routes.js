import Transaction from "../routes/payment.route.js"

async function masterRoutes(fastify, opts) {

  const authRoute = (schema = {}, tag = "Reports", isPublic = false) => {
    const baseSchema = {
      ...schema,
      tags: schema?.tags || [tag],
    };

    if (isPublic) {
      return { schema: baseSchema };
    }

    return {
      preHandler: [fastify.authenticate],
      schema: { ...baseSchema, security: [{ bearerAuth: [] }] },
    };
  };

  await fastify.register(Transaction, { authRoute });
}

export default masterRoutes;

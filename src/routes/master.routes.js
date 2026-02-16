import Transaction from "../routes/payment.route.js"
import ConsumerConnectionCategoryReport from "../routes/consumerConnectionCategory.route.js"
import ConsumerConnectionCountReport from "../routes/consumerConnectionCount.route.js"
import DivisionLegacyArrearReport from "../routes/divisionArrearLegacy.route.js"

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
  await fastify.register(ConsumerConnectionCategoryReport, { authRoute });
  await fastify.register(ConsumerConnectionCountReport, { authRoute });
  await fastify.register(DivisionLegacyArrearReport, { authRoute });
}

export default masterRoutes;

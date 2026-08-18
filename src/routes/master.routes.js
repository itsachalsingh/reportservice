import Transaction from "../routes/payment.route.js"
import ConsumerConnectionCategoryReport from "../routes/consumerConnectionCategory.route.js"
import ConsumerConnectionCountReport from "../routes/consumerConnectionCount.route.js"
import DivisionLegacyArrearReport from "../routes/divisionArrearLegacy.route.js"
import BillCollectionSummaryReport from "../routes/billCollectionSummary.route.js"
import BillAmountBreakupSummaryReport from "../routes/billAmountBreakupSummary.route.js"
import BillChargeSummaryReport from "../routes/billChargeSummary.route.js"
import DisconnectionRequestReport from "../routes/disconnectionRequestReport.route.js"

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
  await fastify.register(BillCollectionSummaryReport, { authRoute });
  await fastify.register(BillAmountBreakupSummaryReport, { authRoute });
  await fastify.register(BillChargeSummaryReport, { authRoute });
  await fastify.register(DisconnectionRequestReport, { authRoute });
}

export default masterRoutes;

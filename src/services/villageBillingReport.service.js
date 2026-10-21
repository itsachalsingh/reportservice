import { getVillageBillingConnections } from "../utils/grpc/connectionClient.js";
import { fetchLatestVillageBillingRows } from "../utils/grpc/billCollectionSummaryClient.js";

const DEFAULT_BATCH_SIZE = Number(process.env.VILLAGE_REPORT_BILLING_BATCH_SIZE || 2000);
const consumerCode = row => String(row?.new_consumer_code || "").trim();
const emptyCounts = () => ({ total_registered_consumers: 0, active_consumers: 0,
  disconnected_consumers: 0, billed_active_consumers: 0, pending_active_consumers: 0,
  total_billed_consumers: 0, total_unbilled_consumers: 0 });

function count(target, row, billed) {
  target.total_registered_consumers++;
  target[billed ? "total_billed_consumers" : "total_unbilled_consumers"]++;
  if (String(row.status).toLowerCase() === "active") {
    target.active_consumers++;
    target[billed ? "billed_active_consumers" : "pending_active_consumers"]++;
  } else if (["inactive", "closed"].includes(String(row.status).toLowerCase())) target.disconnected_consumers++;
}

function mergeBatch(state, connections, billingRows, query) {
  const latestByCode = new Map(billingRows.map(row => [String(row.consumer_code), row]));
  const codesByRoster = new Map();
  for (const row of connections) {
    const code = consumerCode(row);
    if (code) {
      if (!codesByRoster.has(code)) codesByRoster.set(code, []);
      codesByRoster.get(code).push(row);
    }
  }
  const billedCodes = new Set(latestByCode.keys());
  for (const row of connections) {
    const code = consumerCode(row);
    const latest = latestByCode.get(code);
    const billed = Boolean(latest);
    const key = `${row.division_id}:${row.village_id || `urban:${row.ward_id || "unassigned"}`}`;
    if (!state.groups.has(key)) state.groups.set(key, { division_id: row.division_id,
      division_name: row.division_name, village_id: row.village_id, village_name: row.village_name,
      ward_id: row.ward_id || "", ward_name: row.ward_name || "", area_type: row.area_type || "unknown",
      scheme_names: [], scheme_name: "", ...emptyCounts(), status: "unbilled" });
    const group = state.groups.get(key);
    const schemeName = String(row.scheme_name || "").trim() || "Unassigned";
    if (!group.scheme_names.includes(schemeName)) {
      group.scheme_names.push(schemeName); group.scheme_names.sort((a, b) => a.localeCompare(b));
      group.scheme_name = group.scheme_names.join(", ");
    }
    if (billed) group.status = "billed";
    count(group, row, billed);
    count(state.summary, row, billed);
    for (const dimension of ["division", "area", "scheme", "collection_center"]) {
      const id = dimension === "area" ? row.area_type || "unknown" : row[`${dimension}_id`] || "";
      const dimKey = JSON.stringify([row.division_id, id]);
      const map = state.breakdowns[dimension];
      if (!map.has(dimKey)) map.set(dimKey, { division_id: row.division_id, division_name: row.division_name,
        [`${dimension}_id`]: id,
        [`${dimension}_name`]: dimension === "area" ? id : row[`${dimension}_name`] || "Unassigned",
        ...emptyCounts() });
      count(map.get(dimKey), row, billed);
    }
    if (query.include_consumers || query.format === "xlsx") {
      const billingStatus = billed ? "billed" : "unbilled";
      if (!query.billing_status || query.billing_status === "all" || query.billing_status === billingStatus) {
        state.consumers.push({ ...row, billing_status: billingStatus,
          consumer_status: ["inactive", "closed"].includes(String(row.status).toLowerCase()) ? "disconnected" : row.status,
          latest_bill_status: latest?.bill_status || "", latest_bill_date: latest?.bill_date || null,
          latest_bill_start_month: latest?.start_month || "", latest_bill_end_month: latest?.end_month || "" });
      }
    }
  }
  for (const [code, latest] of latestByCode) {
    const key = JSON.stringify([latest.start_month || "", latest.end_month || ""]);
    if (!state.cycles.has(key)) state.cycles.set(key, { start_month: latest.start_month || "",
      end_month: latest.end_month || "", ...emptyCounts() });
    for (const row of codesByRoster.get(code) || []) count(state.cycles.get(key), row, billedCodes.has(code));
  }
}

export async function getVillageBillingReport(query = {}) {
  const state = { groups: new Map(), summary: emptyCounts(),
    breakdowns: Object.fromEntries(["division", "area", "scheme", "collection_center"].map(key => [key, new Map()])),
    cycles: new Map(), consumers: [] };
  let pageToken = "";
  do {
    const page = await getVillageBillingConnections({ department_id: query.department_id,
      division_id: query.division_id || "", scheme_id: query.scheme_id || "",
      collection_center_id: query.collection_center_id || "", area_type: query.area_type || "all",
      consumer_status: query.consumer_status || "all", page_token: pageToken });
    const rows = page.rows || [];
    for (let offset = 0; offset < rows.length; offset += DEFAULT_BATCH_SIZE) {
      const connections = rows.slice(offset, offset + DEFAULT_BATCH_SIZE);
      const codes = [...new Set(connections.map(consumerCode).filter(Boolean))];
      const billing = codes.length ? await fetchLatestVillageBillingRows({ department_id: query.department_id,
        consumer_codes: codes, start_month: query.start_month, end_month: query.end_month }) : { rows: [] };
      mergeBatch(state, connections, billing.rows || [], query);
    }
    if (page.next_page_token && page.next_page_token === pageToken) throw new Error("Connection pagination did not advance");
    pageToken = page.next_page_token || "";
  } while (pageToken);
  if (query.start_month && !state.cycles.size) state.cycles.set("selected", { start_month: query.start_month,
    end_month: query.end_month, ...emptyCounts() });
  const billing_cycle_wise = [...state.cycles.values()].map(row => ({ ...row,
    total_registered_consumers: state.summary.total_registered_consumers,
    active_consumers: state.summary.active_consumers,
    disconnected_consumers: state.summary.disconnected_consumers,
    pending_active_consumers: state.summary.active_consumers - row.billed_active_consumers,
    total_unbilled_consumers: state.summary.total_registered_consumers - row.total_billed_consumers }));
  return { rows: [...state.groups.values()].sort((a, b) => (a.division_name || "").localeCompare(b.division_name || "") ||
      (a.village_name || a.ward_name || "").localeCompare(b.village_name || b.ward_name || "")),
    summary: state.summary,
    ...Object.fromEntries(Object.entries(state.breakdowns).map(([key, map]) => [`${key}_wise`, [...map.values()]])),
    billing_cycle_wise, ...(query.include_consumers || query.format === "xlsx" ? { consumers: state.consumers } : {}) };
}

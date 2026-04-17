/**
 * Derive stage transitions from two CRM snapshot sets.
 *
 * Input: array of customer rows from the prior snapshot (prevRows, can be empty)
 *        and the current snapshot (currRows), plus their month identifiers.
 *
 * Output: array of transition objects ready to insert into fact_stage_transition.
 *
 * The derivation rules are in docs/plans/2026-04-17-customer-journey-analytics-design.md
 * Sections 1–4. Summary:
 *   - Customer in both AND stage unchanged → no row
 *   - Customer in both AND stage changed → one transition row with direction from ladder
 *   - Customer in curr only → first_seen row (no from_stage delta available)
 *   - Customer in prev only → NO row (silent churn policy, see design Section 2)
 */

const STAGE_RANK = {
  UNKNOWN: 0,
  SLIDER: 1,
  ROOKIE: 2,
  REGULAR: 3,
  LOYALIST: 4,
  WHALE: 5,
  CHURNED: -1,
};

function classifyDirection(fromStage, toStage) {
  if (toStage === 'CHURNED') return 'churn';
  if (fromStage === 'CHURNED') return 'reactivate';
  const fr = STAGE_RANK[fromStage] ?? 0;
  const tr = STAGE_RANK[toStage] ?? 0;
  if (tr > fr) return 'up';
  if (tr < fr) return 'down';
  return 'lateral'; // same rank, different stage name (shouldn't happen with current ladder)
}

function midpointISO(fromMonth, toMonth) {
  // Month strings are YYYY-MM. Use 15th of each month as snapshot date proxy.
  if (!fromMonth || !toMonth) return null;
  const fromDate = new Date(fromMonth + '-15T00:00:00Z');
  const toDate = new Date(toMonth + '-15T00:00:00Z');
  const midMs = (fromDate.getTime() + toDate.getTime()) / 2;
  return new Date(midMs).toISOString().slice(0, 10);
}

function normalizeStage(s) {
  if (!s || s === '-' || s === '') return 'UNKNOWN';
  const upper = String(s).toUpperCase();
  return STAGE_RANK[upper] !== undefined ? upper : 'UNKNOWN';
}

/**
 * @param {Array} prevRows - customer rows from previous snapshot (or [] if none)
 * @param {Array} currRows - customer rows from current snapshot
 * @param {string|null} prevMonth - YYYY-MM of previous snapshot (null if first-ever)
 * @param {string} currMonth - YYYY-MM of current snapshot
 * @returns {Array} transition rows
 */
function deriveStageTransitions(prevRows, currRows, prevMonth, currMonth) {
  const prevByCustomer = new Map();
  for (const r of prevRows || []) prevByCustomer.set(r.customer_id, r);

  const transitions = [];

  for (const curr of currRows) {
    const prev = prevByCustomer.get(curr.customer_id);
    const currStage = normalizeStage(curr.journey_stage);

    if (!prev) {
      // first_seen
      transitions.push({
        customer_id: curr.customer_id,
        from_stage: currStage,  // placeholder; direction=first_seen means no "from"
        to_stage: currStage,
        direction: 'first_seen',
        from_snapshot: prevMonth || currMonth,  // acceptable fallback for first-ever
        to_snapshot: currMonth,
        days_in_from_stage: null,
        spend_in_from_stage: null,
        visits_in_from_stage: null,
        from_lifetime_spend: null,
        to_lifetime_spend: Number(curr.lifetime_spend) || 0,
        from_lifetime_visits: null,
        to_lifetime_visits: Number(curr.lifetime_visits) || 0,
        estimated_transition_date: null,
      });
      continue;
    }

    const prevStage = normalizeStage(prev.journey_stage);
    if (prevStage === currStage) continue; // no transition to record

    const direction = classifyDirection(prevStage, currStage);
    const spendDelta = (Number(curr.lifetime_spend) || 0) - (Number(prev.lifetime_spend) || 0);
    const visitsDelta = (Number(curr.lifetime_visits) || 0) - (Number(prev.lifetime_visits) || 0);

    transitions.push({
      customer_id: curr.customer_id,
      from_stage: prevStage,
      to_stage: currStage,
      direction,
      from_snapshot: prevMonth,
      to_snapshot: currMonth,
      days_in_from_stage: null, // populated later by sequential pass if we have full history
      spend_in_from_stage: spendDelta < 0 ? 0 : spendDelta,
      visits_in_from_stage: visitsDelta < 0 ? 0 : visitsDelta,
      from_lifetime_spend: Number(prev.lifetime_spend) || 0,
      to_lifetime_spend: Number(curr.lifetime_spend) || 0,
      from_lifetime_visits: Number(prev.lifetime_visits) || 0,
      to_lifetime_visits: Number(curr.lifetime_visits) || 0,
      estimated_transition_date: midpointISO(prevMonth, currMonth),
    });
  }

  return transitions;
}

module.exports = {
  STAGE_RANK,
  classifyDirection,
  midpointISO,
  normalizeStage,
  deriveStageTransitions,
};

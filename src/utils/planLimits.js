// A company's plan limits: how many users it may have, whether AI is
// on, and how many AI requests it gets a month. Used when a company is
// created and when its limits are edited.
//
// maxUsers / maxAiRequestsPerMonth: blank (or null) means unlimited,
// otherwise a whole number of 0 or more. aiEnabled is on unless it is
// explicitly false. enforceUsageLimits is what turns the limits from
// information into blocking, one company at a time.
function toLimit(value, label) {
  if (value === '' || value == null) return { value: null }
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(n) || n < 0) return { error: `${label} must be a whole number of 0 or more, or blank for unlimited.` }
  return { value: n }
}

function parsePlanLimits(body = {}) {
  const users = toLimit(body.maxUsers, 'Max users')
  if (users.error) return { error: users.error }
  const ai = toLimit(body.maxAiRequestsPerMonth, 'Max AI requests per month')
  if (ai.error) return { error: ai.error }
  return {
    maxUsers: users.value,
    aiEnabled: body.aiEnabled !== false,
    maxAiRequestsPerMonth: ai.value,
    enforceUsageLimits: !!body.enforceUsageLimits
  }
}

module.exports = { parsePlanLimits }

async function simulateRiskEngine(context, instance) {
  const amount = context.amount;
  const attempts =
    instance.externalDependencies?.get('riskEngine')?.attempts ||
    instance.externalDependencies?.riskEngine?.attempts ||
    0;

  await new Promise((resolve) => setTimeout(resolve, 50));

  if (attempts === 0) {
    return { outcome: 'FAILED_TRANSIENT', reason: 'Timeout talking to risk engine' };
  }

  if (amount > 80000) {
    return { outcome: 'FAILED_FATAL', reason: 'High risk application' };
  }

  return { outcome: 'APPROVED', reason: 'Risk score acceptable' };
}

module.exports = {
  simulateRiskEngine
};


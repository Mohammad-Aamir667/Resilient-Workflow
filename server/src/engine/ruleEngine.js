const vm = require('vm');

function evaluateExpression(expression, context) {
  const sandbox = { context, result: null };
  const script = new vm.Script(`result = (${expression});`);
  const ctx = vm.createContext(sandbox);
  script.runInContext(ctx, { timeout: 50 });
  return sandbox.result;
}

function runRule(ruleDef, context, schema) {
  if (ruleDef.type === 'mandatory') {
    const missing = [];
    for (const field of schema.requiredFields || []) {
      if (context[field] === undefined || context[field] === null || context[field] === '') {
        missing.push(field);
      }
    }
    return {
      status: missing.length ? 'FAIL' : 'PASS',
      details: missing.length ? { missing } : {}
    };
  }

  if (ruleDef.type === 'threshold') {
    const value = context[ruleDef.field];
    let ok = true;
    switch (ruleDef.operator) {
      case '<=':
        ok = value <= ruleDef.value;
        break;
      case '<':
        ok = value < ruleDef.value;
        break;
      case '>=':
        ok = value >= ruleDef.value;
        break;
      case '>':
        ok = value > ruleDef.value;
        break;
      case '==':
        ok = value === ruleDef.value;
        break;
      default:
        ok = false;
    }
    return {
      status: ok ? 'PASS' : 'FAIL',
      details: { field: ruleDef.field, value, operator: ruleDef.operator, threshold: ruleDef.value }
    };
  }

  if (ruleDef.type === 'expression') {
    const ok = !!evaluateExpression(ruleDef.expression, context);
    return {
      status: ok ? 'PASS' : 'FAIL',
      details: { expression: ruleDef.expression }
    };
  }

  return {
    status: 'UNKNOWN',
    details: { reason: 'Unsupported rule type', type: ruleDef.type }
  };
}

function runRulesForStage(workflowConfig, stageId, context) {
  const stage = workflowConfig.stages[stageId];
  if (!stage || !stage.onEnter || !stage.onEnter.length) {
    return {};
  }

  const results = {};

  for (const ruleId of stage.onEnter) {
    const def = workflowConfig.rules[ruleId];
    if (!def) {
      results[ruleId] = 'UNKNOWN';
      continue;
    }
    const { status } = runRule(def, context, workflowConfig.schema || {});
    results[ruleId] = status;
  }

  return results;
}

module.exports = {
  runRule,
  runRulesForStage
};


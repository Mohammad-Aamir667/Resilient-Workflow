const fs = require('fs');
const path = require('path');
const WorkflowInstance = require('../models/workflowInstance');
const { runRulesForStage } = require('./ruleEngine');
const { simulateRiskEngine } = require('./externalDependencies');

const WORKFLOW_DIR = path.join(__dirname, '..', 'config', 'workflows');

function loadWorkflowConfig(workflowType) {
  const file = path.join(WORKFLOW_DIR, `${workflowType}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown workflow type: ${workflowType}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

async function callExternalDependency(name, instance) {
  const context = instance.context || {};
  if (name === 'riskEngine') {
    return simulateRiskEngine(context, instance);
  }
  throw new Error(`Unknown external dependency: ${name}`);
}

function evalCondition(cond, { rules, dependencies, manualDecision }) {
  if (!cond || cond === 'true') return true;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('rules', 'dependencies', 'manualDecision', `return (${cond});`);
    return !!fn(rules, dependencies, manualDecision);
  } catch (e) {
    return false;
  }
}

async function advanceInstance(instance, workflowConfig, options = {}) {
  let changed = false;
  const auditEntries = [];
  let safetyCounter = 0;

  while (true) {
    safetyCounter += 1;
    if (safetyCounter > 20) {
      auditEntries.push({
        type: 'ENGINE_ERROR',
        message: 'Exceeded max transitions for single advance call',
        details: {}
      });
      break;
    }

    const stageId = instance.currentStage || workflowConfig.initialStage;
    const stage = workflowConfig.stages[stageId];
    if (!stage) {
      instance.status = 'FAILED';
      auditEntries.push({
        type: 'ENGINE_ERROR',
        message: `Unknown stage ${stageId}`,
        details: {}
      });
      break;
    }

    instance.currentStage = stageId;
    changed = true;

    const ruleResults = runRulesForStage(workflowConfig, stageId, instance.context);

    Object.entries(ruleResults).forEach(([id, status]) => {
      auditEntries.push({
        type: 'RULE_EVALUATED',
        message: `Rule ${id} evaluated with status ${status}`,
        details: { ruleId: id, status }
      });
    });

    const ruleStatus = ruleResults;

    let dependencyOutcome = null;
    let dependencies = {};

    if (stage.externalDependency) {
      const name = stage.externalDependency;

      if (!instance.externalDependencies) {
        instance.externalDependencies = {};
      }

      const dep =
        instance.externalDependencies.get?.(name) ||
        instance.externalDependencies[name] || {
          state: 'IDLE',
          attempts: 0
        };

      dep.state = 'PENDING';
      dep.attempts += 1;

      const res = await callExternalDependency(name, instance);
      dependencyOutcome = res.outcome;
      dep.state = res.outcome === 'APPROVED' ? 'SUCCESS' : 'FAILED';
      dep.lastError = res.reason;
      if (res.outcome === 'FAILED_TRANSIENT') {
        const retryDelayMs = options.retryDelayMs || 1000 * 60;
        dep.nextRetryAt = new Date(Date.now() + retryDelayMs);
      }

      if (instance.externalDependencies.set) {
        instance.externalDependencies.set(name, dep);
      } else {
        instance.externalDependencies[name] = dep;
      }

      dependencies[name] = res.outcome;

      auditEntries.push({
        type: 'EXTERNAL_CALL',
        message: `Called external dependency ${name}`,
        details: { name, outcome: res.outcome, reason: res.reason }
      });
    }

    if (!stage.transitions || !stage.transitions.length || stage.type === 'terminal') {
      if (stageId === 'APPROVED') {
        instance.status = 'APPROVED';
      } else if (stageId === 'REJECTED') {
        instance.status = 'REJECTED';
      } else if (stage.type === 'manual') {
        instance.status = 'MANUAL_REVIEW';
      }
      break;
    }

    const manualDecision = options.manualDecision || null;

    let nextStageId = null;

    for (const t of stage.transitions) {
      const ok = evalCondition(t.condition, {
        rules: ruleStatus,
        dependencies,
        manualDecision
      });
      if (ok) {
        nextStageId = t.to;
        break;
      }
    }

    if (!nextStageId) {
      if (dependencyOutcome === 'FAILED_TRANSIENT') {
        instance.status = 'WAITING_RETRY';
      }
      break;
    }

    auditEntries.push({
      type: 'STAGE_TRANSITION',
      message: `Transition ${stageId} -> ${nextStageId}`,
      details: { from: stageId, to: nextStageId }
    });

    instance.currentStage = nextStageId;

    if (workflowConfig.stages[nextStageId].type === 'manual') {
      instance.status = 'MANUAL_REVIEW';
      break;
    }

    if (workflowConfig.stages[nextStageId].type === 'terminal') {
      if (nextStageId === 'APPROVED') {
        instance.status = 'APPROVED';
      } else if (nextStageId === 'REJECTED') {
        instance.status = 'REJECTED';
      } else {
        instance.status = 'FAILED';
      }
      break;
    }
  }

  instance.history = instance.history || [];
  instance.history.push(...auditEntries);

  return { instance, changed };
}

async function startWorkflow({ workflowType, payload, idempotencyKey }) {
  const workflowConfig = loadWorkflowConfig(workflowType);

  if (idempotencyKey) {
    const existing = await WorkflowInstance.findOne({ workflowType, idempotencyKey });
    if (existing) {
      existing.history.push({
        type: 'IDEMPOTENT_HIT',
        message: 'Returning existing workflow instance for idempotency key',
        details: { idempotencyKey }
      });
      await existing.save();
      return existing;
    }
  }

  const instance = new WorkflowInstance({
    workflowType,
    idempotencyKey,
    status: 'PENDING',
    currentStage: workflowConfig.initialStage,
    context: payload,
    externalDependencies: {}
  });

  instance.history.push({
    type: 'CREATED',
    message: 'Workflow instance created',
    details: { workflowType, idempotencyKey }
  });

  await advanceInstance(instance, workflowConfig);
  await instance.save();
  return instance;
}

async function retryWorkflowInstance(id) {
  const instance = await WorkflowInstance.findById(id);
  if (!instance) {
    throw new Error('Workflow instance not found');
  }

  const workflowConfig = loadWorkflowConfig(instance.workflowType);

  if (instance.status !== 'WAITING_RETRY') {
    instance.history.push({
      type: 'RETRY_SKIPPED',
      message: 'Retry requested but instance is not waiting for retry',
      details: { status: instance.status }
    });
    await instance.save();
    return instance;
  }

  instance.history.push({
    type: 'RETRY_REQUESTED',
    message: 'Retry requested',
    details: {}
  });

  await advanceInstance(instance, workflowConfig);
  await instance.save();
  return instance;
}

async function manualDecision(id, decision) {
  const instance = await WorkflowInstance.findById(id);
  if (!instance) {
    throw new Error('Workflow instance not found');
  }

  const workflowConfig = loadWorkflowConfig(instance.workflowType);
  const stage = workflowConfig.stages[instance.currentStage];

  if (!stage || stage.type !== 'manual') {
    instance.history.push({
      type: 'MANUAL_DECISION_ERROR',
      message: 'Manual decision requested but current stage is not manual',
      details: { stage: instance.currentStage }
    });
    await instance.save();
    return instance;
  }

  instance.history.push({
    type: 'MANUAL_DECISION',
    message: 'Manual decision applied',
    details: { decision }
  });

  await advanceInstance(instance, workflowConfig, { manualDecision: decision });
  await instance.save();
  return instance;
}

module.exports = {
  loadWorkflowConfig,
  startWorkflow,
  retryWorkflowInstance,
  manualDecision,
  advanceInstance
};


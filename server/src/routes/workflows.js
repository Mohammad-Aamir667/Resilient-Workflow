const express = require('express');
const Joi = require('joi');
const { startWorkflow, retryWorkflowInstance, manualDecision, loadWorkflowConfig } = require('../engine/workflowEngine');
const WorkflowInstance = require('../models/workflowInstance');

const router = express.Router();

const intakeSchema = Joi.object({
  payload: Joi.object().required(),
  idempotencyKey: Joi.string().max(128).optional()
});

router.post('/:workflowType/requests', async (req, res) => {
  const { workflowType } = req.params;
  const { error, value } = intakeSchema.validate(req.body);

  if (error) {
    return res.status(400).json({ error: 'INVALID_INPUT', details: error.details });
  }

  const idempotencyKey = value.idempotencyKey || req.header('Idempotency-Key') || null;

  try {
    const instance = await startWorkflow({
      workflowType,
      payload: value.payload,
      idempotencyKey
    });
    return res.status(202).json(instance);
  } catch (e) {
    if (e.message.startsWith('Unknown workflow type')) {
      return res.status(404).json({ error: 'UNKNOWN_WORKFLOW', message: e.message });
    }
    console.error(e);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: e.message });
  }
});

router.get('/:workflowType/instances/:id', async (req, res) => {
  const { id, workflowType } = req.params;
  try {
    const instance = await WorkflowInstance.findOne({ _id: id, workflowType });
    if (!instance) {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    return res.json(instance);
  } catch (e) {
    return res.status(400).json({ error: 'INVALID_ID', message: e.message });
  }
});

router.post('/:workflowType/instances/:id/retry', async (req, res) => {
  const { id } = req.params;
  try {
    const instance = await retryWorkflowInstance(id);
    return res.json(instance);
  } catch (e) {
    if (e.message === 'Workflow instance not found') {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: e.message });
  }
});

router.post('/:workflowType/instances/:id/manual-decision', async (req, res) => {
  const { id } = req.params;
  const { decision } = req.body;
  if (!['APPROVE', 'REJECT'].includes(decision)) {
    return res.status(400).json({ error: 'INVALID_DECISION' });
  }
  try {
    const instance = await manualDecision(id, decision);
    return res.json(instance);
  } catch (e) {
    if (e.message === 'Workflow instance not found') {
      return res.status(404).json({ error: 'NOT_FOUND' });
    }
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: e.message });
  }
});

router.get('/:workflowType/config', (req, res) => {
  const { workflowType } = req.params;
  try {
    const cfg = loadWorkflowConfig(workflowType);
    return res.json(cfg);
  } catch (e) {
    return res.status(404).json({ error: 'UNKNOWN_WORKFLOW', message: e.message });
  }
});

module.exports = { router };


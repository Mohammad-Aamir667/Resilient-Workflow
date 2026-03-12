const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { app } = require('../index');
const WorkflowInstance = require('../models/workflowInstance');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri, { autoIndex: true });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

afterEach(async () => {
  await WorkflowInstance.deleteMany({});
});

describe('Workflow API - application-approval', () => {
  const baseUrl = '/api/workflows/application-approval';

  test('happy path - application approved', async () => {
    const payload = {
      applicantId: 'user-1',
      amount: 10000,
      income: 50000,
      country: 'US'
    };

    const res = await request(app).post(`${baseUrl}/requests`).send({ payload });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('_id');
    expect(res.body).toHaveProperty('status', 'APPROVED');
    expect(res.body).toHaveProperty('history');
    expect(Array.isArray(res.body.history)).toBe(true);
    expect(res.body.history.length).toBeGreaterThan(0);
  });

  test('invalid input - missing payload', async () => {
    const res = await request(app).post(`${baseUrl}/requests`).send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'INVALID_INPUT');
  });

  test('idempotency - duplicate requests return same instance', async () => {
    const payload = {
      applicantId: 'user-2',
      amount: 20000,
      income: 80000,
      country: 'US'
    };

    const idempotencyKey = 'dup-key-1';

    const first = await request(app)
      .post(`${baseUrl}/requests`)
      .send({ payload, idempotencyKey });

    const second = await request(app)
      .post(`${baseUrl}/requests`)
      .send({ payload, idempotencyKey });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body._id).toBe(first.body._id);

    const instance = await WorkflowInstance.findById(first.body._id);
    const idempotentEvents = instance.history.filter((h) => h.type === 'IDEMPOTENT_HIT');
    expect(idempotentEvents.length).toBe(1);
  });

  test('dependency failure - high risk application is rejected', async () => {
    const payload = {
      applicantId: 'user-3',
      amount: 90000,
      income: 300000,
      country: 'US'
    };

    const res = await request(app).post(`${baseUrl}/requests`).send({ payload });

    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('status', 'REJECTED');

    const instance = await WorkflowInstance.findById(res.body._id);
    const externalCalls = instance.history.filter((h) => h.type === 'EXTERNAL_CALL');
    expect(externalCalls.length).toBeGreaterThan(0);
    const lastExternal = externalCalls[externalCalls.length - 1];
    expect(lastExternal.details).toHaveProperty('outcome', 'FAILED_FATAL');
  });
});


const { advanceInstance } = require('../engine/workflowEngine');

describe('Workflow engine - retry flow using configuration', () => {
  test('instance moves to WAITING_RETRY on transient failure and then to APPROVED on retry', async () => {
    const workflowConfig = {
      initialStage: 'RISK_CHECK',
      schema: {},
      rules: {},
      stages: {
        RISK_CHECK: {
          type: 'system',
          externalDependency: 'riskEngine',
          transitions: [
            {
              condition: "dependencies.riskEngine === 'APPROVED'",
              to: 'APPROVED'
            },
            {
              condition: "dependencies.riskEngine === 'FAILED_FATAL'",
              to: 'REJECTED'
            }
          ]
        },
        APPROVED: {
          type: 'terminal'
        },
        REJECTED: {
          type: 'terminal'
        }
      }
    };

    const instance = {
      workflowType: 'retry-demo',
      status: 'PENDING',
      currentStage: workflowConfig.initialStage,
      context: {
        amount: 50000
      },
      externalDependencies: new Map(),
      history: []
    };

    const firstAdvance = await advanceInstance(instance, workflowConfig);

    expect(firstAdvance.instance.status).toBe('WAITING_RETRY');

    const secondAdvance = await advanceInstance(instance, workflowConfig);

    expect(secondAdvance.instance.status).toBe('APPROVED');

    const waitingEvents = instance.history.filter((h) => h.type === 'STAGE_TRANSITION');
    expect(waitingEvents.length).toBeGreaterThan(0);
  });
});


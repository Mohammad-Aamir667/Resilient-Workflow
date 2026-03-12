const { runRulesForStage } = require('../engine/ruleEngine');

describe('Rule engine - rule change via configuration', () => {
  test('changing threshold in config changes outcome without code changes', () => {
    const baseConfig = {
      schema: {
        requiredFields: ['amount']
      },
      rules: {
        amountThreshold: {
          id: 'amountThreshold',
          description: 'Amount must be below limit',
          type: 'threshold',
          field: 'amount',
          operator: '<=',
          value: 100000
        }
      },
      stages: {
        CHECK: {
          type: 'system',
          onEnter: ['amountThreshold']
        }
      }
    };

    const context = {
      amount: 60000
    };

    const initialResults = runRulesForStage(baseConfig, 'CHECK', context);
    expect(initialResults.amountThreshold).toBe('PASS');

    const updatedConfig = {
      ...baseConfig,
      rules: {
        ...baseConfig.rules,
        amountThreshold: {
          ...baseConfig.rules.amountThreshold,
          value: 50000
        }
      }
    };

    const updatedResults = runRulesForStage(updatedConfig, 'CHECK', context);
    expect(updatedResults.amountThreshold).toBe('FAIL');
  });
});


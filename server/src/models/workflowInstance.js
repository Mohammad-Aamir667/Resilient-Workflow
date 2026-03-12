const mongoose = require('mongoose');

const AuditEntrySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    type: { type: String, required: true },
    message: { type: String, required: true },
    details: { type: mongoose.Schema.Types.Mixed }
  },
  { _id: false }
);

const WorkflowInstanceSchema = new mongoose.Schema(
  {
    workflowType: { type: String, required: true, index: true },
    idempotencyKey: { type: String, index: true },
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'WAITING_RETRY', 'REJECTED', 'APPROVED', 'MANUAL_REVIEW', 'FAILED'],
      default: 'PENDING',
      index: true
    },
    currentStage: { type: String },
    context: { type: mongoose.Schema.Types.Mixed, required: true },
    externalDependencies: {
      type: Map,
      of: new mongoose.Schema(
        {
          state: {
            type: String,
            enum: ['IDLE', 'PENDING', 'SUCCESS', 'FAILED'],
            default: 'IDLE'
          },
          lastError: { type: String },
          attempts: { type: Number, default: 0 },
          nextRetryAt: { type: Date }
        },
        { _id: false }
      )
    },
    history: [AuditEntrySchema]
  },
  { timestamps: true }
);

WorkflowInstanceSchema.index({ workflowType: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('WorkflowInstance', WorkflowInstanceSchema);


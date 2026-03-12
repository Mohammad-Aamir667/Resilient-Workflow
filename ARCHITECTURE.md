## Architecture Overview

This document describes the architecture of the **Resilient Workflow Decision System** implemented in this repository.

### High-level goals

- **Configurable workflows**: Add/modify workflows and rules by editing JSON, not core engine code.
- **Resilient decisioning**: Handle transient and fatal failures from dependencies, retries, and manual review.
- **Explainable decisions**: Maintain full audit trail with rule evaluations, transitions, and dependency calls.
- **Idempotent intake**: Safe handling of duplicate submissions.

---

## Components

- **API layer (`src/index.js`, `src/routes/workflows.js`)**
  - Express app exposing REST endpoints under `/api/workflows/:workflowType`.
  - Responsibilities:
    - Request validation (shape via Joi).
    - Mapping HTTP routes to workflow engine operations.
    - Translating engine/domain errors into HTTP responses.

- **Workflow engine (`src/engine/workflowEngine.js`)**
  - Core orchestration layer that:
    - Loads workflow configuration JSON per `workflowType`.
    - Maintains and advances the state machine (`advanceInstance`).
    - Calls the rule engine on stage entry.
    - Invokes external dependencies and reacts to their outcomes.
    - Implements:
      - `startWorkflow`
      - `retryWorkflowInstance`
      - `manualDecision`
  - Uses a generic JSON configuration model:
    - `initialStage`
    - `stages[stageId]` with `type`, `onEnter`, `externalDependency`, `transitions`.
    - `rules` map for rule definitions.
    - `schema` hints for required fields, numeric fields, etc.

- **Rule engine (`src/engine/ruleEngine.js`)**
  - Evaluates rules defined in workflow config:
    - **mandatory**: required fields present.
    - **threshold**: numeric threshold checks with operators like `<`, `<=`, `>`, `>=`, `==`.
    - **expression**: arbitrary boolean expressions evaluated in a sandbox.
  - `runRulesForStage`:
    - Reads `stage.onEnter` list of rule IDs.
    - Evaluates each rule against the instance context and schema.
    - Returns map of `ruleId -> status` (`PASS`/`FAIL`/`UNKNOWN`).
  - The engine logic is **agnostic of business domain**; new rules are added solely in configuration.

- **External dependency simulation (`src/engine/externalDependencies.js`)**
  - `simulateRiskEngine` mimics an external risk-scoring service.
  - Behaviors:
    - First call for a given instance fails with a transient error (`FAILED_TRANSIENT`).
    - Subsequent calls:
      - If `amount > 80000` → `FAILED_FATAL`.
      - Otherwise → `APPROVED`.
  - Integrated via workflow config using `stage.externalDependency = "riskEngine"`.

- **Persistence and state (`src/models/workflowInstance.js`)**
  - MongoDB model for workflow instances.
  - Captures:
    - `workflowType`, `idempotencyKey`, `status`, `currentStage`.
    - `context` (input payload / enriched state).
    - `externalDependencies` (Map keyed by dependency name with state, attempts, nextRetryAt, lastError).
    - `history` audit log.
  - Unique index on `(workflowType, idempotencyKey)` enforces idempotency at the database level.

- **Configuration model (`src/config/workflows/application-approval.json`)**
  - Describes the `application-approval` workflow:
    - **Schema**: required and numeric fields.
    - **Rules**: mandatory fields, amount limit, income/amount ratio.
    - **Stages**:
      - `INTAKE` → mandatory checks, then:
        - Fail → `REJECTED`
        - Pass → `AUTO_RULES`
      - `AUTO_RULES` → amount & ratio rules:
        - Hard failure → `REJECTED`
        - Borderline ratio → `MANUAL_REVIEW`
        - Otherwise → `EXTERNAL_RISK_CHECK`
      - `EXTERNAL_RISK_CHECK` → calls risk engine with transitions for:
        - `FAILED_TRANSIENT` → retry path
        - `FAILED_FATAL` → `REJECTED`
        - `APPROVED` → `APPROVED`
      - `RETRY_WAIT` → loops back to `EXTERNAL_RISK_CHECK` (demonstrates retry flow).
      - `MANUAL_REVIEW` → waits for `manualDecision`.
      - `APPROVED`/`REJECTED` → terminal outcomes.

---

## Data flow

1. **Intake**
   - Client calls `POST /api/workflows/:workflowType/requests` with `{ payload, idempotencyKey? }`.
   - API validates the shape using Joi (`payload` is required).

2. **Idempotency check**
   - `startWorkflow`:
     - Looks up existing instance by `(workflowType, idempotencyKey)` if provided.
     - If found:
       - Appends `IDEMPOTENT_HIT` audit entry.
       - Returns the existing instance unchanged (no new processing).

3. **Instance creation**
   - New `WorkflowInstance` created with:
     - `status: PENDING`
     - `currentStage` from `workflowConfig.initialStage`
     - `context` set to the input payload.
   - Adds `CREATED` audit entry.

4. **Workflow advancement (`advanceInstance`)**
   - Loop:
     - Resolve current stage (`currentStage` or `initialStage`).
     - Run `runRulesForStage` if `onEnter` rules are configured.
       - Append `RULE_EVALUATED` entries to audit trail.
     - If `externalDependency` defined:
       - Call `simulateRiskEngine` (or other dependencies in the future).
       - Update `externalDependencies[...]` with state, attempts, next retry time.
       - Append `EXTERNAL_CALL` entry.
     - Evaluate transitions in order, using conditions expressed over:
       - `rules` result map.
       - `dependencies` outcome map.
       - `manualDecision` (for manual stages).
     - If a transition matches:
       - Append `STAGE_TRANSITION` audit entry.
       - Update `currentStage`.
       - If next stage is `manual` → set `MANUAL_REVIEW` and stop.
       - If next stage is `terminal` → set final status (`APPROVED`/`REJECTED`/`FAILED`) and stop.
     - If no transition matches:
       - If `dependencyOutcome === 'FAILED_TRANSIENT'` → set `WAITING_RETRY` and stop.
       - Otherwise, stop with current status.
   - `safetyCounter` prevents infinite loops by capping the number of transitions per call.

5. **Persistence**
   - After advancement, the instance is saved to MongoDB, including updated history and dependency info.

6. **Retry flow**
   - `POST /api/workflows/:workflowType/instances/:id/retry`:
     - Loads instance by id.
     - If status is not `WAITING_RETRY`, logs `RETRY_SKIPPED` and returns as-is.
     - If `WAITING_RETRY`, appends `RETRY_REQUESTED`, calls `advanceInstance` again, and saves.

7. **Manual review**
   - `POST /api/workflows/:workflowType/instances/:id/manual-decision`:
     - Validates decision (`APPROVE`/`REJECT`).
     - Ensures current stage is of type `manual`; otherwise logs `MANUAL_DECISION_ERROR`.
     - Adds `MANUAL_DECISION` entry and calls `advanceInstance` with `manualDecision` option.

---

## Failure handling and resilience

- **External dependency failures**
  - Transient failures (`FAILED_TRANSIENT`) lead to `WAITING_RETRY` or retry-loop stages, depending on config.
  - Fatal failures (`FAILED_FATAL`) route to `REJECTED`.

- **Partial save failures**
  - The design ensures that all state mutations are funneled through the `WorkflowInstance` model and persisted in a single save operation per advancement.
  - If MongoDB is unavailable, the API surfaces a 500 error and the process exits on startup failure.

- **Duplicate requests**
  - Enforced by:
    - Code-level check in `startWorkflow`.
    - Unique compound index on `(workflowType, idempotencyKey)`.

- **Safety against runaway workflows**
  - `advanceInstance` includes a `safetyCounter` to cap the maximum transitions in a single call, logging an `ENGINE_ERROR` if exceeded.

---

## Configurability and extensibility

- **Adding a new workflow type**
  - Create a new JSON file under `src/config/workflows`, e.g. `claim-processing.json`.
  - Define:
    - `workflowType`, `version`, `description`.
    - `schema` (required/numeric fields).
    - `rules` (mandatory, threshold, expression).
    - `stages` with `type`, `onEnter`, `externalDependency`, `transitions`.
    - `initialStage`.
  - The API can start this workflow via:
    - `POST /api/workflows/claim-processing/requests`.

- **Changing rules**
  - Modify rule definitions in the workflow JSON (e.g. adjust thresholds or expressions).
  - No code changes required; the rule engine simply evaluates the updated config.

- **Adding new rule types**
  - Extend `runRule` in `ruleEngine.js` with new `type` handlers.
  - Use them in configuration by referencing the new `type` in rule definitions.

- **Adding new external dependencies**
  - Implement new simulators/functions in `externalDependencies.js`.
  - Reference them in workflow config via `externalDependency` field in stages.

---

## Explainability and auditability

Each `WorkflowInstance` maintains a detailed `history` array of audit entries, including:

- `CREATED` – instance creation.
- `RULE_EVALUATED` – per rule evaluation results.
- `EXTERNAL_CALL` – calls to external dependencies and their outcomes.
- `STAGE_TRANSITION` – stage-to-stage movements.
- `IDEMPOTENT_HIT` – repeated requests with same idempotency key.
- `RETRY_REQUESTED` / `RETRY_SKIPPED`.
- `MANUAL_DECISION` / `MANUAL_DECISION_ERROR`.
- `ENGINE_ERROR` – unexpected engine conditions (e.g. excessive transitions).

This history provides a complete, explainable trace of how a decision was reached for a given input.

---

## Scaling considerations

- **API layer**
  - Horizontally scalable (stateless) behind a load balancer.
  - Idempotency guarantees guard against duplicate request processing across instances.

- **Database**
  - MongoDB can be scaled using replica sets and sharding if needed.
  - Indexing on `workflowType`, `status`, and `idempotencyKey` supports common query patterns.

- **Workflow execution**
  - For heavy or long-running workflows, advancement can be offloaded to background workers (message queues) rather than executing fully in the request/response cycle.
  - Periodic jobs / workers can process `WAITING_RETRY` instances by calling the retry endpoint or a service-level function.

- **Configuration management**
  - Workflow configs can be versioned (e.g. `version` field in JSON and multiple config files).
  - A feature flag or routing layer can choose workflow version per request or tenant.


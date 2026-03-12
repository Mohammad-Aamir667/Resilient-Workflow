## Resilient Workflow Decision System

This project is a **configurable workflow decision platform** that can execute real-world business workflows (application approval, claims processing, onboarding, etc.) using configuration-driven rules and stages.

This repo currently contains a **Node.js/Express backend** (`server`) that implements:

- **Input intake** with schema validation (`Joi`)
- **Config-driven rules engine** and workflow stages
- **External dependency simulation** (risk engine) with transient and fatal failures
- **Idempotent request handling**
- **Audit trail and history** for each workflow instance
- **Retry and manual-review flows**

### Running the server

- **Install dependencies:**

```bash
cd server
npm install
```

- **Start the API server:**

```bash
npm run dev
```

The server listens on `http://localhost:4000` by default (configurable via `PORT` env var) and connects to MongoDB using `MONGO_URI` (defaults to `mongodb://localhost:27017/resilient_workflow`).

Health check:

- `GET /health` → `{ "status": "ok" }`

### Workflow APIs (application-approval)

Base path:

- `/api/workflows/application-approval`

Endpoints:

- **Start a workflow instance**
  - **POST** `/requests`
  - Body:

```json
{
  "payload": {
    "applicantId": "user-123",
    "amount": 25000,
    "income": 90000,
    "country": "US"
  },
  "idempotencyKey": "optional-unique-key"
}
```

  - Response `202 Accepted` with the created workflow instance document (including `status`, `currentStage`, and `history`).

- **Get workflow instance by id**
  - **GET** `/instances/:id`

- **Retry a workflow instance (for retry-capable workflows)**
  - **POST** `/instances/:id/retry`

- **Submit manual decision at manual-review stage**
  - **POST** `/instances/:id/manual-decision`
  - Body:

```json
{ "decision": "APPROVE" }
```

  - `decision` must be one of `APPROVE` or `REJECT`.

- **Inspect workflow configuration**
  - **GET** `/config`
  - Returns the JSON configuration used to drive this workflow (rules, stages, transitions).

### Tests

The backend includes Jest tests for:

- Happy-path approval
- Invalid input
- Idempotent duplicate requests
- External dependency failure
- Retry flow driven by configuration
- Rule-change scenario driven purely by config

Run tests:

```bash
cd server
npm test
```

### Next steps and extensions

- Add additional workflow configurations (e.g. claims, onboarding) by creating new JSON files under `server/src/config/workflows`.
- Extend the minimal REST API or build a front-end/CLI to visualize workflow instances and audit history.


## Resilient Workflow Decision System

This project is a **configurable workflow decision platform** that can execute real-world business workflows (application approval, claims processing, onboarding, etc.) using configuration-driven rules and stages.

The repo is split into:

- `server`: Node.js/Express + MongoDB **backend** with configurable workflow/rule engine.
- `client`: Vite + React **frontend** that drives the `application-approval` workflow and visualizes decisions and audit trails.

---

### Running the backend (`server`)

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

#### Workflow APIs (application-approval)

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

---

### Running the frontend (`client`)

The React frontend provides a minimal UI to:

- Submit application-approval requests (including optional idempotency key).
- Trigger retries and manual decisions.
- Inspect the current workflow instance (status, stage, context).
- View an **audit trail** of rule evaluations, external calls, transitions, and manual decisions.
- Preview the active workflow configuration JSON.

Steps:

```bash
cd client
npm install
npm run dev
```

By default Vite serves the client on `http://localhost:5173` and proxies `/api` calls to `http://localhost:4000` (configured in `client/vite.config.js`).

Make sure the backend is running before using the UI.

---

### Tests (backend)

The backend includes Jest tests for:

- Happy-path approval.
- Invalid input.
- Idempotent duplicate requests.
- External dependency failure.
- Retry flow driven by configuration.
- Rule-change scenario driven purely by config.

Run tests:

```bash
cd server
npm test
```

---

### Extending the system

- Add additional workflow configurations (e.g. claims, onboarding) by creating new JSON files under `server/src/config/workflows`.
- Extend the REST API or frontend to visualize multiple workflows, filter by status, or show more advanced analytics.


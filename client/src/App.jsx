import { useEffect, useState } from 'react';
import './App.css';

const WORKFLOW_TYPE = 'application-approval';

function App() {
  const [form, setForm] = useState({
    applicantId: '',
    amount: '',
    income: '',
    country: 'US',
    idempotencyKey: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [config, setConfig] = useState(null);
  const [instance, setInstance] = useState(null);
  const [historyView, setHistoryView] = useState('latest');

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch(`/api/workflows/${WORKFLOW_TYPE}/config`);
        if (!res.ok) {
          throw new Error('Failed to load workflow config');
        }
        const data = await res.json();
        setConfig(data);
      } catch (e) {
        setError(e.message);
      }
    }
    fetchConfig();
  }, []);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submitApplication(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInstance(null);

    try {
      const payload = {
        applicantId: form.applicantId,
        amount: Number(form.amount),
        income: Number(form.income),
        country: form.country
      };

      const body = {
        payload
      };

      if (form.idempotencyKey.trim()) {
        body.idempotencyKey = form.idempotencyKey.trim();
      }

      const res = await fetch(`/api/workflows/${WORKFLOW_TYPE}/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Failed to start workflow');
      }

      const data = await res.json();
      setInstance(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshInstance() {
    if (!instance?._id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/workflows/${WORKFLOW_TYPE}/instances/${instance._id}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Failed to load instance');
      }
      const data = await res.json();
      setInstance(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function triggerRetry() {
    if (!instance?._id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/workflows/${WORKFLOW_TYPE}/instances/${instance._id}/retry`, {
        method: 'POST'
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Retry failed');
      }
      const data = await res.json();
      setInstance(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendManualDecision(decision) {
    if (!instance?._id) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/workflows/${WORKFLOW_TYPE}/instances/${instance._id}/manual-decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ decision })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || 'Manual decision failed');
      }
      const data = await res.json();
      setInstance(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const historyEntries = instance?.history || [];
  const displayedHistory =
    historyView === 'latest' ? historyEntries.slice(-5).reverse() : [...historyEntries].reverse();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>Resilient Workflow Demo</h1>
          <p className="subtitle">Application approval workflow with rules, retries, and manual review.</p>
        </div>
        <div className="status-pill">{instance?.status || 'NO INSTANCE'}</div>
      </header>

      <main className="layout">
        <section className="card">
          <h2>Submit Application</h2>
          <form className="form" onSubmit={submitApplication}>
            <div className="field-row">
              <label>Applicant ID</label>
              <input
                type="text"
                value={form.applicantId}
                onChange={(e) => updateField('applicantId', e.target.value)}
                required
              />
            </div>
            <div className="field-grid">
              <div className="field-row">
                <label>Amount</label>
                <input
                  type="number"
                  min="0"
                  value={form.amount}
                  onChange={(e) => updateField('amount', e.target.value)}
                  required
                />
              </div>
              <div className="field-row">
                <label>Income</label>
                <input
                  type="number"
                  min="0"
                  value={form.income}
                  onChange={(e) => updateField('income', e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field-grid">
              <div className="field-row">
                <label>Country</label>
                <input
                  type="text"
                  value={form.country}
                  onChange={(e) => updateField('country', e.target.value)}
                  required
                />
              </div>
              <div className="field-row">
                <label>Idempotency Key (optional)</label>
                <input
                  type="text"
                  placeholder="Use to safely retry same request"
                  value={form.idempotencyKey}
                  onChange={(e) => updateField('idempotencyKey', e.target.value)}
                />
              </div>
            </div>

            <button className="primary-btn" type="submit" disabled={loading}>
              {loading ? 'Submitting…' : 'Submit Application'}
            </button>
          </form>
          {error && <div className="error-banner">{error}</div>}
        </section>

        <section className="card">
          <h2>Current Instance</h2>
          {!instance && <p className="muted">Submit an application to see workflow state.</p>}
          {instance && (
            <>
              <div className="instance-meta">
                <div>
                  <span className="label">ID</span>
                  <span className="value mono">{instance._id}</span>
                </div>
                <div>
                  <span className="label">Stage</span>
                  <span className="value">{instance.currentStage}</span>
                </div>
                <div>
                  <span className="label">Status</span>
                  <span className="value status">{instance.status}</span>
                </div>
              </div>

              <div className="actions-row">
                <button type="button" onClick={refreshInstance} disabled={loading}>
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={triggerRetry}
                  disabled={loading || instance.status !== 'WAITING_RETRY'}
                >
                  Retry External Call
                </button>
                <button
                  type="button"
                  onClick={() => sendManualDecision('APPROVE')}
                  disabled={loading || instance.status !== 'MANUAL_REVIEW'}
                >
                  Approve Manually
                </button>
                <button
                  type="button"
                  onClick={() => sendManualDecision('REJECT')}
                  disabled={loading || instance.status !== 'MANUAL_REVIEW'}
                >
                  Reject Manually
                </button>
              </div>

              <div className="context-panel">
                <h3>Input Context</h3>
                <pre>{JSON.stringify(instance.context, null, 2)}</pre>
              </div>
            </>
          )}
        </section>

        <section className="card full-width">
          <div className="history-header">
            <h2>Audit Trail</h2>
            <div className="history-toggle">
              <button
                type="button"
                className={historyView === 'latest' ? 'chip chip-active' : 'chip'}
                onClick={() => setHistoryView('latest')}
              >
                Latest 5
              </button>
              <button
                type="button"
                className={historyView === 'all' ? 'chip chip-active' : 'chip'}
                onClick={() => setHistoryView('all')}
              >
                All
              </button>
            </div>
          </div>
          {!instance && <p className="muted">No audit events yet.</p>}
          {instance && displayedHistory.length === 0 && <p className="muted">No history entries.</p>}
          {instance && displayedHistory.length > 0 && (
            <ul className="history-list">
              {displayedHistory.map((entry, idx) => (
                <li key={`${entry.at || idx}-${idx}`} className="history-item">
                  <div className="history-main">
                    <span className="tag">{entry.type}</span>
                    <span className="message">{entry.message}</span>
                  </div>
                  <div className="history-meta">
                    <span className="timestamp">
                      {entry.at ? new Date(entry.at).toLocaleString() : '—'}
                    </span>
                    {entry.details && (
                      <details>
                        <summary>Details</summary>
                        <pre>{JSON.stringify(entry.details, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card full-width">
          <h2>Workflow Configuration Snapshot</h2>
          {!config && <p className="muted">Loading configuration…</p>}
          {config && (
            <pre className="config-preview">
              {JSON.stringify(
                {
                  workflowType: config.workflowType,
                  description: config.description,
                  stages: config.stages,
                  rules: config.rules
                },
                null,
                2
              )}
            </pre>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;

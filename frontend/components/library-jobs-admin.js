import { LitElement, html, css, nothing } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './admin-tabs.js';
import {
  cancelWorkflowRun,
  cancelJob,
  deleteJob,
  deleteWorkflowRun,
  enqueueJob,
  enqueueWorkflowRun,
  getJobAttempts,
  getJobs,
  getJobsSummary,
  getTenantJobCatalog,
  getTenantWorkflowCatalog,
  getWorkflowRuns,
  retryJob,
} from '../services/api.js';

const STATUS_OPTIONS = ['', 'queued', 'running', 'succeeded', 'failed', 'canceled', 'dead_letter'];
const SOURCE_OPTIONS = ['', 'manual', 'event', 'schedule', 'system'];
const RETRYABLE_STATUSES = new Set(['failed', 'dead_letter', 'canceled']);

function normalizeTenantId(value) {
  return String(value || '').trim();
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatAgoFromSeconds(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 60) return `${value}s`;
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function parseJsonField(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed;
  } catch (_error) {
    throw new Error(`${fieldName} must be a valid JSON object`);
  }
}

export class LibraryJobsAdmin extends LitElement {
  static properties = {
    tenant: { type: String },
    isSuperAdmin: { type: Boolean },
    activeTab: { type: String },
    loading: { type: Boolean },
    actionLoading: { type: Boolean },
    errorMessage: { type: String },
    successMessage: { type: String },
    summary: { type: Object },
    jobs: { type: Array },
    totalJobs: { type: Number },
    statusFilter: { type: String },
    sourceFilter: { type: String },
    triggers: { type: Array },
    includeDisabledTriggers: { type: Boolean },
    definitions: { type: Array },
    includeInactiveDefinitions: { type: Boolean },
    expandedJobAttempts: { type: Object },
    attemptsByJob: { type: Object },
    attemptsLoadingByJob: { type: Object },
    expandedAttemptLogs: { type: Object },
    enqueuePanelOpen: { type: Boolean },
    enqueueDefinitionKey: { type: String },
    enqueueArgumentValues: { type: Object },
    enqueuePriority: { type: String },
    enqueueMaxAttempts: { type: String },
    enqueueScheduledFor: { type: String },
    workflowDefinitions: { type: Array },
    workflowRuns: { type: Array },
    workflowTotalRuns: { type: Number },
    enqueueTaskKey: { type: String },
    enqueueWorkflowKey: { type: String },
    enqueueWorkflowPriority: { type: String },
    triggerLabel: { type: String },
    triggerType: { type: String },
    triggerEventName: { type: String },
    triggerCronExpr: { type: String },
    triggerTimezone: { type: String },
    triggerDefinitionKey: { type: String },
    triggerPayloadTemplate: { type: String },
    triggerDedupeWindow: { type: String },
    definitionKey: { type: String },
    definitionDescription: { type: String },
    definitionArgSchema: { type: String },
    definitionTimeoutSeconds: { type: String },
    definitionMaxAttempts: { type: String },
    definitionActive: { type: Boolean },
  };

  static styles = [
    tailwind,
    css`
      :host {
        display: block;
      }

      .card {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 14px;
        padding: 18px;
      }

      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
      }

      .row-between {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }

      .title {
        margin: 0;
        color: #111827;
        font-size: 18px;
        font-weight: 700;
      }

      .subtitle {
        margin: 4px 0 0;
        color: #6b7280;
        font-size: 13px;
      }

      .notice {
        margin: 12px 0;
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 13px;
      }

      .notice-error {
        background: #fef2f2;
        border: 1px solid #fecaca;
        color: #991b1b;
      }

      .notice-success {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        color: #166534;
      }

      .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
        gap: 8px;
        margin-top: 12px;
      }

      .summary-chip {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 8px 10px;
        background: #f9fafb;
      }

      .summary-value {
        font-size: 20px;
        line-height: 1.1;
        font-weight: 800;
        color: #0f172a;
      }

      .summary-label {
        margin-top: 2px;
        color: #64748b;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .section {
        margin-top: 16px;
        border: 1px solid #e5e7eb;
        border-radius: 12px;
        padding: 14px;
      }

      .section-title {
        margin: 0 0 10px;
        font-size: 14px;
        color: #111827;
        font-weight: 700;
      }

      .input,
      .select,
      .textarea {
        border: 1px solid #d1d5db;
        border-radius: 8px;
        font-size: 13px;
        padding: 8px 10px;
        color: #111827;
        background: #ffffff;
      }

      .input,
      .select {
        height: 36px;
      }

      .textarea {
        width: 100%;
        min-height: 82px;
        resize: vertical;
      }

      .field {
        flex: 1 1 180px;
        min-width: 140px;
      }

      .field-wide {
        flex: 1 1 100%;
      }

      .arg-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 10px;
      }

      .arg-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .arg-label {
        font-size: 12px;
        font-weight: 600;
        color: #374151;
      }

      .arg-help {
        font-size: 11px;
        color: #6b7280;
      }

      .definition-description {
        margin-top: 8px;
        border: 1px solid #e5e7eb;
        background: #f8fafc;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        color: #334155;
      }

      .btn {
        border: none;
        border-radius: 10px;
        padding: 9px 14px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .btn:disabled {
        opacity: 0.65;
        cursor: not-allowed;
      }

      .btn-primary {
        background: #2563eb;
        color: #ffffff;
      }

      .btn-secondary {
        background: #e5e7eb;
        color: #111827;
      }

      .btn-danger {
        background: #dc2626;
        color: #ffffff;
      }

      .btn-sm {
        padding: 6px 10px;
        border-radius: 8px;
        font-size: 12px;
      }

      .table-wrap {
        overflow-x: auto;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        border-bottom: 1px solid #e5e7eb;
        text-align: left;
        vertical-align: top;
        padding: 8px;
        font-size: 12px;
      }

      th {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        color: #64748b;
      }

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }

      .status-pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 700;
        background: #e5e7eb;
        color: #111827;
      }

      .status-queued { background: #dbeafe; color: #1d4ed8; }
      .status-running { background: #fef3c7; color: #92400e; }
      .status-succeeded { background: #dcfce7; color: #166534; }
      .status-failed { background: #fee2e2; color: #991b1b; }
      .status-canceled { background: #e5e7eb; color: #374151; }
      .status-dead_letter { background: #f5d0fe; color: #6b21a8; }

      .muted {
        color: #6b7280;
        font-size: 12px;
      }

      .attempt-log-cell {
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
      }

      .attempt-log-title {
        margin: 0 0 6px;
        font-size: 11px;
        font-weight: 700;
        color: #334155;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      .attempt-log-block {
        margin: 0 0 10px;
        max-height: 240px;
        overflow: auto;
        background: #0f172a;
        color: #e2e8f0;
        border-radius: 8px;
        padding: 10px;
        font-size: 11px;
        line-height: 1.4;
        white-space: pre-wrap;
        word-break: break-word;
      }
    `,
  ];

  constructor() {
    super();
    this.tenant = '';
    this.isSuperAdmin = false;
    this.activeTab = 'queue';
    this.loading = false;
    this.actionLoading = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.summary = null;
    this.jobs = [];
    this.totalJobs = 0;
    this.statusFilter = '';
    this.sourceFilter = '';
    this.triggers = [];
    this.includeDisabledTriggers = false;
    this.definitions = [];
    this.includeInactiveDefinitions = false;
    this.expandedJobAttempts = {};
    this.attemptsByJob = {};
    this.attemptsLoadingByJob = {};
    this.expandedAttemptLogs = {};
    this.enqueuePanelOpen = false;

    this.enqueueDefinitionKey = '';
    this.enqueueArgumentValues = {};
    this.enqueuePriority = '100';
    this.enqueueMaxAttempts = '';
    this.enqueueScheduledFor = '';
    this.workflowDefinitions = [];
    this.workflowRuns = [];
    this.workflowTotalRuns = 0;
    this.enqueueTaskKey = '';
    this.enqueueWorkflowKey = '';
    this.enqueueWorkflowPriority = '100';

    this.triggerLabel = '';
    this.triggerType = 'event';
    this.triggerEventName = '';
    this.triggerCronExpr = '0 2 * * *';
    this.triggerTimezone = 'America/New_York';
    this.triggerDefinitionKey = '';
    this.triggerPayloadTemplate = '{}';
    this.triggerDedupeWindow = '300';

    this.definitionKey = '';
    this.definitionDescription = '';
    this.definitionArgSchema = '{}';
    this.definitionTimeoutSeconds = '3600';
    this.definitionMaxAttempts = '3';
    this.definitionActive = true;

    this._pollTimer = null;
    this._attemptsPollTimer = null;
    this._attemptsRefreshInFlight = false;
    this._taskSelectionTouched = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._loadAll();
    this._startPolling();
  }

  disconnectedCallback() {
    this._stopPolling();
    super.disconnectedCallback();
  }

  updated(changedProperties) {
    if (changedProperties.has('tenant')) {
      this._loadAll();
    }
  }

  _startPolling() {
    this._stopPolling();
    this._pollTimer = window.setInterval(() => {
      if (this.activeTab === 'queue') {
        this._refreshQueueOnly();
      }
    }, 10000);
    this._attemptsPollTimer = window.setInterval(() => {
      if (this.activeTab === 'queue') {
        this._refreshExpandedAttemptsOnly();
      }
    }, 2000);
  }

  _stopPolling() {
    if (this._pollTimer) {
      window.clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._attemptsPollTimer) {
      window.clearInterval(this._attemptsPollTimer);
      this._attemptsPollTimer = null;
    }
  }

  _setError(message) {
    this.errorMessage = message || '';
    if (this.errorMessage) this.successMessage = '';
  }

  _setSuccess(message) {
    this.successMessage = message || '';
    if (this.successMessage) this.errorMessage = '';
  }

  async _loadAll() {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId) {
      this.jobs = [];
      this.triggers = [];
      this.summary = null;
      this.definitions = [];
      this.workflowDefinitions = [];
      this.workflowRuns = [];
      this.workflowTotalRuns = 0;
      this.enqueueArgumentValues = {};
      this.expandedJobAttempts = {};
      this.attemptsByJob = {};
      this.attemptsLoadingByJob = {};
      this.expandedAttemptLogs = {};
      return;
    }
    this.loading = true;
    this._setError('');
    try {
      await Promise.all([
        this._loadQueue({ keepLoading: true }),
        this._loadCatalog({ keepLoading: true }),
        this._loadWorkflowCatalog({ keepLoading: true }),
        this._loadWorkflowRuns({ keepLoading: true }),
      ]);
      this._syncSelectedTaskDefault();
    } catch (_error) {
      // individual loaders handle errors; no-op here
    } finally {
      this.loading = false;
    }
  }

  async _refreshQueueOnly() {
    if (!normalizeTenantId(this.tenant) || this.loading || this.actionLoading) return;
    try {
      await Promise.all([
        this._loadQueue({ keepLoading: true, silentErrors: true }),
        this._loadWorkflowRuns({ keepLoading: true, silentErrors: true }),
      ]);
    } catch (_error) {
      // no-op during polling
    }
  }

  async _refreshExpandedAttemptsOnly() {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || this._attemptsRefreshInFlight) return;
    const expandedJobIds = Object.entries(this.expandedJobAttempts || {})
      .filter(([, expanded]) => !!expanded)
      .map(([jobId]) => String(jobId || '').trim())
      .filter(Boolean);
    if (!expandedJobIds.length) return;

    this._attemptsRefreshInFlight = true;
    try {
      const updates = await Promise.all(
        expandedJobIds.map(async (jobId) => {
          const result = await getJobAttempts(tenantId, jobId, { limit: 50, offset: 0 });
          return [jobId, Array.isArray(result?.attempts) ? result.attempts : []];
        })
      );
      const nextAttemptsByJob = { ...(this.attemptsByJob || {}) };
      for (const [jobId, attempts] of updates) {
        nextAttemptsByJob[jobId] = attempts;
      }
      this.attemptsByJob = nextAttemptsByJob;
    } catch (_error) {
      // no-op during polling refresh
    } finally {
      this._attemptsRefreshInFlight = false;
    }
  }

  async _loadQueue({ keepLoading = false, silentErrors = false } = {}) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId) return;
    if (!keepLoading) this.loading = true;
    try {
      const [summaryResult, jobsResult] = await Promise.all([
        getJobsSummary(tenantId),
        getJobs(tenantId, {
          status: this.statusFilter || undefined,
          source: this.sourceFilter || undefined,
          limit: 100,
          offset: 0,
        }),
      ]);
      this.summary = summaryResult || null;
      this.jobs = Array.isArray(jobsResult?.jobs) ? jobsResult.jobs : [];
      this.totalJobs = Number(jobsResult?.total || 0);
      if (typeof this._pruneJobDetailState === 'function') {
        this._pruneJobDetailState(this.jobs);
      }
    } catch (error) {
      if (!silentErrors) {
        this._setError(error?.message || 'Failed to load jobs');
      }
      throw error;
    } finally {
      if (!keepLoading) this.loading = false;
    }
  }

  async _loadCatalog({ keepLoading = false } = {}) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId) return;
    if (!keepLoading) this.loading = true;
    try {
      const result = await getTenantJobCatalog(tenantId);
      this.definitions = Array.isArray(result?.definitions) ? result.definitions : [];
      const currentKey = String(this.enqueueDefinitionKey || '').trim();
      const hasCurrent = this.definitions.some((definition) => String(definition?.key || '').trim() === currentKey);
      if (!hasCurrent) {
        this.enqueueDefinitionKey = String(this.definitions[0]?.key || '');
        this._resetEnqueueArgumentValues();
      }
      if (hasCurrent && !Object.keys(this.enqueueArgumentValues || {}).length) {
        this._resetEnqueueArgumentValues();
      }
      this._syncSelectedTaskDefault();
    } catch (error) {
      this._setError(error?.message || 'Failed to load available job definitions');
      throw error;
    } finally {
      if (!keepLoading) this.loading = false;
    }
  }

  async _loadWorkflowCatalog({ keepLoading = false } = {}) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId) return;
    if (!keepLoading) this.loading = true;
    try {
      const result = await getTenantWorkflowCatalog(tenantId);
      this.workflowDefinitions = Array.isArray(result?.workflows) ? result.workflows : [];
      const currentKey = String(this.enqueueWorkflowKey || '').trim();
      const hasCurrent = this.workflowDefinitions.some((workflow) => String(workflow?.key || '').trim() === currentKey);
      if (!hasCurrent) {
        this.enqueueWorkflowKey = String(this.workflowDefinitions[0]?.key || '');
      }
      this._syncSelectedTaskDefault();
    } catch (error) {
      this._setError(error?.message || 'Failed to load workflow catalog');
      throw error;
    } finally {
      if (!keepLoading) this.loading = false;
    }
  }

  async _loadWorkflowRuns({ keepLoading = false, silentErrors = false } = {}) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId) return;
    if (!keepLoading) this.loading = true;
    try {
      const result = await getWorkflowRuns(tenantId, { limit: 20, offset: 0, includeSteps: false });
      this.workflowRuns = Array.isArray(result?.runs) ? result.runs : [];
      this.workflowTotalRuns = Number(result?.total || 0);
    } catch (error) {
      if (!silentErrors) {
        this._setError(error?.message || 'Failed to load workflow runs');
      }
      throw error;
    } finally {
      if (!keepLoading) this.loading = false;
    }
  }

  async _loadTriggers({ keepLoading = false } = {}) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId) return;
    if (!keepLoading) this.loading = true;
    try {
      const result = await getJobTriggers(tenantId, { includeDisabled: this.includeDisabledTriggers });
      this.triggers = Array.isArray(result?.triggers) ? result.triggers : [];
    } catch (error) {
      this._setError(error?.message || 'Failed to load triggers');
      throw error;
    } finally {
      if (!keepLoading) this.loading = false;
    }
  }

  async _loadDefinitions({ keepLoading = false } = {}) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId) return;
    if (!keepLoading) this.loading = true;
    try {
      const result = await getJobDefinitions(tenantId, { includeInactive: this.includeInactiveDefinitions });
      this.definitions = Array.isArray(result?.definitions) ? result.definitions : [];
      if (!this.enqueueDefinitionKey && this.definitions.length) {
        this.enqueueDefinitionKey = String(this.definitions[0]?.key || '');
        this._resetEnqueueArgumentValues();
      }
      if (this.enqueueDefinitionKey && !Object.keys(this.enqueueArgumentValues || {}).length) {
        this._resetEnqueueArgumentValues();
      }
      if (!this.triggerDefinitionKey && this.definitions.length) {
        this.triggerDefinitionKey = String(this.definitions[0]?.key || '');
      }
    } catch (error) {
      if (this.isSuperAdmin) {
        this._setError(error?.message || 'Failed to load definitions');
      } else {
        this.definitions = [];
      }
      throw error;
    } finally {
      if (!keepLoading) this.loading = false;
    }
  }

  _handleTabChanged(event) {
    const next = String(event?.detail?.tabId || '').trim();
    if (!next || next === this.activeTab) return;
    this.activeTab = next;
  }

  _getSelectedDefinition() {
    const selectedKey = String(this.enqueueDefinitionKey || '').trim();
    if (!selectedKey) return null;
    return (this.definitions || []).find((definition) => String(definition?.key || '').trim() === selectedKey) || null;
  }

  _getTaskCatalog() {
    const workflows = (this.workflowDefinitions || []).map((workflow) => ({
      value: `workflow:${workflow.key}`,
      type: 'workflow',
      key: String(workflow?.key || ''),
      description: String(workflow?.description || '').trim(),
    }));
    const jobs = (this.definitions || []).map((definition) => ({
      value: `job:${definition.key}`,
      type: 'job',
      key: String(definition?.key || ''),
      description: String(definition?.description || '').trim(),
    }));
    return [...workflows, ...jobs];
  }

  _getSelectedTask() {
    const selected = String(this.enqueueTaskKey || '').trim();
    if (!selected) return null;
    return this._getTaskCatalog().find((task) => String(task?.value || '') === selected) || null;
  }

  _syncSelectedTaskDefault() {
    const catalog = this._getTaskCatalog();
    const selected = String(this.enqueueTaskKey || '').trim();
    const selectedTask = catalog.find((task) => String(task?.value || '') === selected) || null;
    if (!selectedTask) {
      const first = catalog[0] || null;
      this.enqueueTaskKey = String(first?.value || '');
      if (first?.type === 'job') {
        this.enqueueDefinitionKey = String(first?.key || '');
        this._resetEnqueueArgumentValues();
      } else {
        this.enqueueWorkflowKey = String(first?.key || '');
      }
      return;
    }

    if (!this._taskSelectionTouched && selectedTask.type === 'job' && (this.workflowDefinitions || []).length) {
      const firstWorkflow = (this.workflowDefinitions || [])[0] || null;
      if (firstWorkflow && firstWorkflow.key) {
        this.enqueueTaskKey = `workflow:${firstWorkflow.key}`;
        this.enqueueWorkflowKey = String(firstWorkflow.key || '');
        return;
      }
    }

    if (selectedTask.type === 'job') {
      this.enqueueDefinitionKey = String(selectedTask.key || '');
      if (!Object.keys(this.enqueueArgumentValues || {}).length) {
        this._resetEnqueueArgumentValues();
      }
    } else {
      this.enqueueWorkflowKey = String(selectedTask.key || '');
    }
  }

  _handleTaskSelectionChange(value) {
    const selectedValue = String(value || '').trim();
    this._taskSelectionTouched = true;
    this.enqueueTaskKey = selectedValue;
    const [taskType, taskKey] = selectedValue.split(':', 2);
    if (taskType === 'job') {
      this.enqueueDefinitionKey = String(taskKey || '').trim();
      this._resetEnqueueArgumentValues();
    } else if (taskType === 'workflow') {
      this.enqueueWorkflowKey = String(taskKey || '').trim();
    }
  }

  _getSelectedQueueParams() {
    const selectedDefinition = this._getSelectedDefinition();
    const queueParams = selectedDefinition?.cli_command?.queue_params;
    return Array.isArray(queueParams) ? queueParams : [];
  }

  _defaultValueForQueueParam(param) {
    if (!param || typeof param !== 'object') return '';
    if (param.is_flag) {
      return !!param.default;
    }
    if (param.default === undefined || param.default === null) {
      return '';
    }
    return String(param.default);
  }

  _resetEnqueueArgumentValues() {
    const next = {};
    for (const param of this._getSelectedQueueParams()) {
      const name = String(param?.name || '').trim();
      if (!name) continue;
      next[name] = this._defaultValueForQueueParam(param);
    }
    this.enqueueArgumentValues = next;
  }

  _handleEnqueueDefinitionChange(value) {
    this.enqueueDefinitionKey = String(value || '').trim();
    this._resetEnqueueArgumentValues();
  }

  _setEnqueueArgumentValue(name, value) {
    const key = String(name || '').trim();
    if (!key) return;
    this.enqueueArgumentValues = {
      ...(this.enqueueArgumentValues || {}),
      [key]: value,
    };
  }

  _coerceQueueParamValue(param, rawValue) {
    if (param?.is_flag) {
      return !!rawValue;
    }
    const valueText = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();
    if (!valueText) {
      return null;
    }
    if (param?.input_type === 'integer') {
      const parsed = Number(valueText);
      if (!Number.isInteger(parsed)) {
        throw new Error(`${param.name} must be an integer`);
      }
      return parsed;
    }
    if (param?.input_type === 'number') {
      const parsed = Number(valueText);
      if (!Number.isFinite(parsed)) {
        throw new Error(`${param.name} must be a number`);
      }
      return parsed;
    }
    return valueText;
  }

  _buildEnqueuePayloadFromFields() {
    const payload = {};
    const values = this.enqueueArgumentValues || {};
    for (const param of this._getSelectedQueueParams()) {
      const name = String(param?.name || '').trim();
      if (!name) continue;
      const rawValue = values[name];

      if (param?.is_flag) {
        if (rawValue === undefined || rawValue === null || rawValue === '') {
          payload[name] = !!param?.default;
        } else {
          payload[name] = !!rawValue;
        }
        continue;
      }

      const coerced = this._coerceQueueParamValue(param, rawValue);
      if (coerced === null) {
        if (param?.required) {
          throw new Error(`${name} is required`);
        }
        continue;
      }
      payload[name] = coerced;
    }
    return payload;
  }

  async _handleEnqueue() {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || this.actionLoading) return;
    const selectedTask = this._getSelectedTask();
    if (!selectedTask) {
      this._setError('Task selection is required');
      return;
    }

    this.actionLoading = true;
    this._setError('');
    try {
      if (selectedTask.type === 'workflow') {
        await enqueueWorkflowRun(tenantId, {
          workflow_key: String(selectedTask.key || ''),
          priority: Number(this.enqueuePriority || this.enqueueWorkflowPriority || 100),
        });
        this._setSuccess('Workflow queued');
        await Promise.all([
          this._loadWorkflowRuns({ keepLoading: true }),
          this._loadQueue({ keepLoading: true }),
        ]);
      } else {
        const definitionKey = String(selectedTask.key || '').trim();
        if (!definitionKey) {
          this._setError('Definition key is required');
          return;
        }
        let payload = {};
        try {
          payload = this._buildEnqueuePayloadFromFields();
        } catch (error) {
          this._setError(error?.message || 'Invalid argument value');
          return;
        }

        const requestBody = {
          definition_key: definitionKey,
          payload,
          priority: Number(this.enqueuePriority || 100),
        };
        if (String(this.enqueueMaxAttempts || '').trim()) {
          requestBody.max_attempts = Number(this.enqueueMaxAttempts);
        }
        if (String(this.enqueueScheduledFor || '').trim()) {
          requestBody.scheduled_for = this.enqueueScheduledFor;
        }

        await enqueueJob(tenantId, requestBody);
        this._setSuccess('Job queued');
        await this._loadQueue({ keepLoading: true });
      }
    } catch (error) {
      this._setError(error?.message || 'Failed to queue task');
    } finally {
      this.actionLoading = false;
    }
  }

  async _handleCancel(job) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || !job?.id || this.actionLoading) return;
    this.actionLoading = true;
    this._setError('');
    try {
      await cancelJob(tenantId, job.id, {});
      this._setSuccess(`Canceled job ${job.id}`);
      await this._loadQueue({ keepLoading: true });
    } catch (error) {
      this._setError(error?.message || 'Failed to cancel job');
    } finally {
      this.actionLoading = false;
    }
  }

  async _handleRetry(job) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || !job?.id || this.actionLoading) return;
    this.actionLoading = true;
    this._setError('');
    try {
      await retryJob(tenantId, job.id, {});
      this._setSuccess(`Retried job ${job.id}`);
      await this._loadQueue({ keepLoading: true });
    } catch (error) {
      this._setError(error?.message || 'Failed to retry job');
    } finally {
      this.actionLoading = false;
    }
  }

  async _handleDelete(job) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || !job?.id || this.actionLoading) return;
    if (String(job.status || '').trim().toLowerCase() === 'running') {
      this._setError('Cannot delete a running job. Cancel it first.');
      return;
    }
    const confirmed = window.confirm(`Delete job ${job.id}? This cannot be undone.`);
    if (!confirmed) return;

    this.actionLoading = true;
    this._setError('');
    try {
      await deleteJob(tenantId, job.id);
      const deletedJobId = String(job.id);
      const nextExpanded = { ...(this.expandedJobAttempts || {}) };
      const nextAttemptsByJob = { ...(this.attemptsByJob || {}) };
      const nextAttemptsLoadingByJob = { ...(this.attemptsLoadingByJob || {}) };
      delete nextExpanded[deletedJobId];
      delete nextAttemptsByJob[deletedJobId];
      delete nextAttemptsLoadingByJob[deletedJobId];
      this.expandedJobAttempts = nextExpanded;
      this.attemptsByJob = nextAttemptsByJob;
      this.attemptsLoadingByJob = nextAttemptsLoadingByJob;
      this.expandedAttemptLogs = Object.fromEntries(
        Object.entries(this.expandedAttemptLogs || {}).filter(([key]) => !key.startsWith(`${deletedJobId}:`))
      );
      this._setSuccess(`Deleted job ${job.id}`);
      await this._loadQueue({ keepLoading: true });
    } catch (error) {
      this._setError(error?.message || 'Failed to delete job');
    } finally {
      this.actionLoading = false;
    }
  }

  async _handleDeleteWorkflowRun(run) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || !run?.id || this.actionLoading) return;
    const runStatus = String(run.status || '').trim().toLowerCase();
    if (runStatus === 'running') {
      this._setError('Cannot delete a running workflow run.');
      return;
    }

    const confirmed = window.confirm(`Delete workflow run ${run.id}? This cannot be undone.`);
    if (!confirmed) return;

    this.actionLoading = true;
    this._setError('');
    try {
      await deleteWorkflowRun(tenantId, run.id);
      this._setSuccess(`Deleted workflow run ${run.id}`);
      await Promise.all([
        this._loadWorkflowRuns({ keepLoading: true }),
        this._loadQueue({ keepLoading: true }),
      ]);
    } catch (error) {
      this._setError(error?.message || 'Failed to delete workflow run');
    } finally {
      this.actionLoading = false;
    }
  }

  async _handleCancelWorkflowRun(run) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || !run?.id || this.actionLoading) return;
    const runStatus = String(run.status || '').trim().toLowerCase();
    if (runStatus !== 'running') {
      this._setError('Only running workflow runs can be canceled.');
      return;
    }

    const confirmed = window.confirm(`Cancel workflow run ${run.id}?`);
    if (!confirmed) return;

    this.actionLoading = true;
    this._setError('');
    try {
      await cancelWorkflowRun(tenantId, run.id, {});
      this._setSuccess(`Canceled workflow run ${run.id}`);
      await Promise.all([
        this._loadWorkflowRuns({ keepLoading: true }),
        this._loadQueue({ keepLoading: true }),
      ]);
    } catch (error) {
      this._setError(error?.message || 'Failed to cancel workflow run');
    } finally {
      this.actionLoading = false;
    }
  }

  _pruneJobDetailState(jobs) {
    const validJobIds = new Set((jobs || []).map((job) => String(job?.id || '')).filter(Boolean));

    this.expandedJobAttempts = Object.fromEntries(
      Object.entries(this.expandedJobAttempts || {}).filter(([jobId]) => validJobIds.has(jobId))
    );
    this.attemptsByJob = Object.fromEntries(
      Object.entries(this.attemptsByJob || {}).filter(([jobId]) => validJobIds.has(jobId))
    );
    this.attemptsLoadingByJob = Object.fromEntries(
      Object.entries(this.attemptsLoadingByJob || {}).filter(([jobId]) => validJobIds.has(jobId))
    );
    this.expandedAttemptLogs = Object.fromEntries(
      Object.entries(this.expandedAttemptLogs || {}).filter(([key]) => validJobIds.has(String(key || '').split(':')[0]))
    );
  }

  _isJobAttemptsExpanded(jobId) {
    return !!this.expandedJobAttempts?.[String(jobId || '')];
  }

  _isJobAttemptsLoading(jobId) {
    return !!this.attemptsLoadingByJob?.[String(jobId || '')];
  }

  _getAttemptsForJob(jobId) {
    return Array.isArray(this.attemptsByJob?.[String(jobId || '')]) ? this.attemptsByJob[String(jobId || '')] : [];
  }

  async _loadAttemptsForJob(jobId, { markLoading = false, silentErrors = false } = {}) {
    const tenantId = normalizeTenantId(this.tenant);
    const normalizedJobId = String(jobId || '').trim();
    if (!tenantId || !normalizedJobId) return;
    if (this._isJobAttemptsLoading(normalizedJobId)) return;

    if (markLoading) {
      this.attemptsLoadingByJob = {
        ...(this.attemptsLoadingByJob || {}),
        [normalizedJobId]: true,
      };
    }
    if (!silentErrors) {
      this._setError('');
    }
    try {
      const result = await getJobAttempts(tenantId, normalizedJobId, { limit: 50, offset: 0 });
      this.attemptsByJob = {
        ...(this.attemptsByJob || {}),
        [normalizedJobId]: Array.isArray(result?.attempts) ? result.attempts : [],
      };
    } catch (error) {
      if (!silentErrors) {
        this._setError(error?.message || 'Failed to load attempts');
      }
    } finally {
      if (markLoading) {
        this.attemptsLoadingByJob = {
          ...(this.attemptsLoadingByJob || {}),
          [normalizedJobId]: false,
        };
      }
    }
  }

  async _toggleJobAttempts(job) {
    const jobId = String(job?.id || '').trim();
    if (!jobId) return;
    const isExpanded = this._isJobAttemptsExpanded(jobId);
    if (isExpanded) {
      this.expandedJobAttempts = {
        ...(this.expandedJobAttempts || {}),
        [jobId]: false,
      };
      this.expandedAttemptLogs = Object.fromEntries(
        Object.entries(this.expandedAttemptLogs || {}).filter(([key]) => !key.startsWith(`${jobId}:`))
      );
      return;
    }

    this.expandedJobAttempts = {
      ...(this.expandedJobAttempts || {}),
      [jobId]: true,
    };
    await this._loadAttemptsForJob(jobId, { markLoading: true, silentErrors: false });
  }

  _attemptKey(jobId, attempt) {
    const attemptId = String(attempt?.id || attempt?.attempt_no || '').trim();
    const normalizedJobId = String(jobId || '').trim();
    if (!normalizedJobId || !attemptId) return '';
    return `${normalizedJobId}:${attemptId}`;
  }

  _attemptHasLogs(attempt) {
    return !!String(attempt?.stdout_tail || '').trim() || !!String(attempt?.stderr_tail || '').trim();
  }

  _isAttemptExpanded(jobId, attempt) {
    const key = this._attemptKey(jobId, attempt);
    return !!(key && this.expandedAttemptLogs?.[key]);
  }

  _toggleAttemptLogs(jobId, attempt) {
    const key = this._attemptKey(jobId, attempt);
    if (!key) return;
    this.expandedAttemptLogs = {
      ...(this.expandedAttemptLogs || {}),
      [key]: !this._isAttemptExpanded(jobId, attempt),
    }
  }

  async _handleCreateTrigger() {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || this.actionLoading) return;
    const label = String(this.triggerLabel || '').trim();
    const definitionKey = String(this.triggerDefinitionKey || '').trim();
    if (!label) {
      this._setError('Trigger label is required');
      return;
    }
    if (!definitionKey) {
      this._setError('Definition key is required');
      return;
    }

    let payloadTemplate = {};
    try {
      payloadTemplate = parseJsonField(this.triggerPayloadTemplate, 'Trigger payload template');
    } catch (error) {
      this._setError(error.message);
      return;
    }

    const body = {
      label,
      trigger_type: this.triggerType,
      definition_key: definitionKey,
      payload_template: payloadTemplate,
      dedupe_window_seconds: Number(this.triggerDedupeWindow || 300),
      is_enabled: true,
    };
    if (this.triggerType === 'event') {
      const eventName = String(this.triggerEventName || '').trim();
      if (!eventName) {
        this._setError('event_name is required for event triggers');
        return;
      }
      body.event_name = eventName;
    } else {
      const cronExpr = String(this.triggerCronExpr || '').trim();
      const timezone = String(this.triggerTimezone || '').trim();
      if (!cronExpr || !timezone) {
        this._setError('cron_expr and timezone are required for schedule triggers');
        return;
      }
      body.cron_expr = cronExpr;
      body.timezone = timezone;
    }

    this.actionLoading = true;
    this._setError('');
    try {
      await createJobTrigger(tenantId, body);
      this._setSuccess('Trigger created');
      this.triggerLabel = '';
      this.triggerEventName = '';
      await this._loadTriggers({ keepLoading: true });
    } catch (error) {
      this._setError(error?.message || 'Failed to create trigger');
    } finally {
      this.actionLoading = false;
    }
  }

  async _toggleTrigger(trigger, isEnabled) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || !trigger?.id || this.actionLoading) return;
    this.actionLoading = true;
    this._setError('');
    try {
      await updateJobTrigger(tenantId, trigger.id, { is_enabled: !!isEnabled });
      await this._loadTriggers({ keepLoading: true });
    } catch (error) {
      this._setError(error?.message || 'Failed to update trigger');
    } finally {
      this.actionLoading = false;
    }
  }

  async _deleteTrigger(trigger) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || !trigger?.id || this.actionLoading) return;
    const confirmed = window.confirm(`Delete trigger "${trigger.label}"?`);
    if (!confirmed) return;
    this.actionLoading = true;
    this._setError('');
    try {
      await deleteJobTrigger(tenantId, trigger.id);
      this._setSuccess('Trigger deleted');
      await this._loadTriggers({ keepLoading: true });
    } catch (error) {
      this._setError(error?.message || 'Failed to delete trigger');
    } finally {
      this.actionLoading = false;
    }
  }

  async _handleCreateDefinition() {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || this.actionLoading) return;
    if (!this.isSuperAdmin) {
      this._setError('Super admin required');
      return;
    }
    const key = String(this.definitionKey || '').trim();
    if (!key) {
      this._setError('Definition key is required');
      return;
    }
    let argSchema = {};
    try {
      argSchema = parseJsonField(this.definitionArgSchema, 'Definition arg_schema');
    } catch (error) {
      this._setError(error.message);
      return;
    }

    this.actionLoading = true;
    this._setError('');
    try {
      await createJobDefinition(tenantId, {
        key,
        description: String(this.definitionDescription || '').trim(),
        arg_schema: argSchema,
        timeout_seconds: Number(this.definitionTimeoutSeconds || 3600),
        max_attempts: Number(this.definitionMaxAttempts || 3),
        is_active: !!this.definitionActive,
      });
      this._setSuccess('Definition created');
      this.definitionKey = '';
      this.definitionDescription = '';
      this.definitionArgSchema = '{}';
      await this._loadDefinitions({ keepLoading: true });
    } catch (error) {
      this._setError(error?.message || 'Failed to create definition');
    } finally {
      this.actionLoading = false;
    }
  }

  async _toggleDefinition(definition, isActive) {
    const tenantId = normalizeTenantId(this.tenant);
    if (!tenantId || !definition?.id || this.actionLoading || !this.isSuperAdmin) return;
    this.actionLoading = true;
    this._setError('');
    try {
      await updateJobDefinition(tenantId, definition.id, { is_active: !!isActive });
      await this._loadDefinitions({ keepLoading: true });
    } catch (error) {
      this._setError(error?.message || 'Failed to update definition');
    } finally {
      this.actionLoading = false;
    }
  }

  _renderSummary() {
    const counts = this.summary?.counts || {};
    const chips = [
      { key: 'queued', label: 'Queued' },
      { key: 'running', label: 'Running' },
      { key: 'succeeded', label: 'Succeeded' },
      { key: 'failed', label: 'Failed' },
      { key: 'dead_letter', label: 'Dead Letter' },
      { key: 'canceled', label: 'Canceled' },
    ];
    return html`
      <div class="summary-grid">
        ${chips.map((chip) => html`
          <div class="summary-chip">
            <div class="summary-value">${Number(counts?.[chip.key] || 0)}</div>
            <div class="summary-label">${chip.label}</div>
          </div>
        `)}
        <div class="summary-chip">
          <div class="summary-value">${formatAgoFromSeconds(this.summary?.queued_oldest_age_seconds)}</div>
          <div class="summary-label">Oldest Queued Age</div>
        </div>
      </div>
    `;
  }

  _renderQueueTab() {
    const taskCatalog = this._getTaskCatalog();
    const selectedTask = this._getSelectedTask();
    const selectedTaskType = String(selectedTask?.type || '').trim();
    const selectedTaskDescription = String(selectedTask?.description || '').trim();
    return html`
      <div class="section">
        <div class="muted">
          Global job configuration (definitions and triggers) is managed in
          <strong>System Administration - Jobs</strong>.
          This view shows the queue for the current tenant.
        </div>
      </div>

      <div class="section">
        <div class="row-between" style="margin-bottom: 8px;">
          <h4 class="section-title" style="margin: 0;">Queue Controls</h4>
          <button
            class="btn btn-secondary btn-sm"
            @click=${() => {
              this.enqueuePanelOpen = !this.enqueuePanelOpen;
            }}
          >
            New Job ${this.enqueuePanelOpen ? '▲' : '▼'}
          </button>
        </div>
        ${this.enqueuePanelOpen ? html`
          <div class="row">
            <div class="field">
              <select
                class="select"
                .value=${this.enqueueTaskKey}
                @change=${(event) => {
                  this._handleTaskSelectionChange(event.target.value || '');
                }}
              >
                ${taskCatalog.map((task) => html`
                  <option value=${task.value}>${task.type === 'workflow' ? 'Workflow' : 'Command'}: ${task.key}</option>
                `)}
              </select>
            </div>
            <input
              class="input field"
              type="number"
              min="0"
              placeholder="priority"
              .value=${this.enqueuePriority}
              @input=${(event) => {
                this.enqueuePriority = event.target.value || '';
              }}
            />
            ${selectedTaskType === 'job' ? html`
              <input
                class="input field"
                type="number"
                min="1"
                placeholder="max attempts (optional)"
                .value=${this.enqueueMaxAttempts}
                @input=${(event) => {
                  this.enqueueMaxAttempts = event.target.value || '';
                }}
              />
              <input
                class="input field"
                type="datetime-local"
                .value=${this.enqueueScheduledFor}
                @input=${(event) => {
                  this.enqueueScheduledFor = event.target.value || '';
                }}
              />
            ` : html``}
            <button class="btn btn-primary" ?disabled=${this.actionLoading} @click=${this._handleEnqueue}>
              Queue Job
            </button>
          </div>
          ${selectedTaskDescription ? html`
            <div class="definition-description">
              <strong>${selectedTaskType === 'workflow' ? 'Workflow' : 'Command'}:</strong>
              ${selectedTask?.key || '—'}
              <br />
              <strong>Description:</strong> ${selectedTaskDescription}
            </div>
          ` : html``}
          <div class="row" style="margin-top: 8px;">
            <div class="field-wide">
              ${selectedTaskType === 'job' && this._getSelectedQueueParams().length ? html`
                <div class="arg-grid">
                  ${this._getSelectedQueueParams().map((param) => {
                    const paramName = String(param?.name || '').trim();
                    const value = this.enqueueArgumentValues?.[paramName];
                    const label = `${paramName}${param?.required ? ' *' : ''}`;
                    const helpText = String(param?.help || '').trim();
                    if (param?.is_flag) {
                      return html`
                        <div class="arg-field">
                          <label class="arg-label">
                            <input
                              type="checkbox"
                              .checked=${!!value}
                              @change=${(event) => {
                                this._setEnqueueArgumentValue(paramName, !!event.target.checked);
                              }}
                            />
                            ${label}
                          </label>
                          ${helpText ? html`<div class="arg-help">${helpText}</div>` : html``}
                        </div>
                      `;
                    }

                    if (param?.input_type === 'choice' && Array.isArray(param?.choices)) {
                      return html`
                        <div class="arg-field">
                          <label class="arg-label">${label}</label>
                          <select
                            class="select"
                            .value=${value ?? ''}
                            @change=${(event) => {
                              this._setEnqueueArgumentValue(paramName, event.target.value || '');
                            }}
                          >
                            <option value="">${param?.required ? 'Select...' : 'Default'}</option>
                            ${param.choices.map((choice) => html`<option value=${choice}>${choice}</option>`)}
                          </select>
                          ${helpText ? html`<div class="arg-help">${helpText}</div>` : html``}
                        </div>
                      `;
                    }

                    const inputType = (param?.input_type === 'integer' || param?.input_type === 'number')
                      ? 'number'
                      : (param?.input_type === 'datetime' ? 'datetime-local' : 'text');
                    const stepValue = param?.input_type === 'integer' ? '1' : 'any';
                    return html`
                      <div class="arg-field">
                        <label class="arg-label">${label}</label>
                        <input
                          class="input"
                          type=${inputType}
                          step=${inputType === 'number' ? stepValue : nothing}
                          placeholder=${param?.required ? '' : 'Default'}
                          .value=${value ?? ''}
                          @input=${(event) => {
                            this._setEnqueueArgumentValue(paramName, event.target.value || '');
                          }}
                        />
                        ${helpText ? html`<div class="arg-help">${helpText}</div>` : html``}
                      </div>
                    `;
                  })}
                </div>
              ` : selectedTaskType === 'workflow' ? html`
                <div class="muted">No additional parameters for this workflow run.</div>
              ` : html`
                <div class="muted">This command does not expose additional queue arguments.</div>
              `}
            </div>
          </div>
        ` : html``}
      </div>

      <div class="section">
        <h4 class="section-title" style="margin-bottom: 8px;">Workflow Runs (${this.workflowTotalRuns})</h4>
        <div class="table-wrap" style="margin-top: 10px;">
          <table>
            <thead>
              <tr>
                <th>Queued</th>
                <th>Workflow</th>
                <th>Status</th>
                <th>Policy</th>
                <th>Parallel</th>
                <th>Error</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${(this.workflowRuns || []).map((run) => html`
                <tr>
                  <td>${formatDateTime(run.queued_at)}</td>
                  <td class="mono">${run.workflow_key || run.workflow_definition_id}</td>
                  <td><span class="status-pill status-${run.status}">${run.status}</span></td>
                  <td>${run.failure_policy || 'fail_fast'}</td>
                  <td>${Number(run.max_parallel_steps || 1)}</td>
                  <td>${run.last_error || '—'}</td>
                  <td>
                    ${String(run.status || '').toLowerCase() === 'running' ? html`
                      <button
                        class="btn btn-danger btn-sm"
                        ?disabled=${this.actionLoading}
                        @click=${() => this._handleCancelWorkflowRun(run)}
                      >
                        Cancel
                      </button>
                    ` : html`
                      <button
                        class="btn btn-danger btn-sm"
                        ?disabled=${this.actionLoading}
                        @click=${() => this._handleDeleteWorkflowRun(run)}
                      >
                        Delete
                      </button>
                    `}
                  </td>
                </tr>
              `)}
              ${!(this.workflowRuns || []).length ? html`
                <tr>
                  <td colspan="7" class="muted">No workflow runs yet.</td>
                </tr>
              ` : html``}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <div class="row-between">
          <h4 class="section-title" style="margin-bottom: 0;">Jobs (${this.totalJobs})</h4>
          <div class="row">
            <select
              class="select"
              .value=${this.statusFilter}
              @change=${async (event) => {
                this.statusFilter = event.target.value || '';
                await this._loadQueue({ keepLoading: true });
              }}
            >
              ${STATUS_OPTIONS.map((value) => html`
                <option value=${value}>${value || 'all statuses'}</option>
              `)}
            </select>
            <select
              class="select"
              .value=${this.sourceFilter}
              @change=${async (event) => {
                this.sourceFilter = event.target.value || '';
                await this._loadQueue({ keepLoading: true });
              }}
            >
              ${SOURCE_OPTIONS.map((value) => html`
                <option value=${value}>${value || 'all sources'}</option>
              `)}
            </select>
            <button class="btn btn-secondary btn-sm" @click=${() => this._loadQueue({ keepLoading: true })}>
              Refresh
            </button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Queued</th>
                <th>Definition</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Source</th>
                <th>Worker</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${this.jobs.map((job) => {
                const jobId = String(job?.id || '');
                const attemptsExpanded = this._isJobAttemptsExpanded(jobId);
                const attemptsLoading = this._isJobAttemptsLoading(jobId);
                const attempts = this._getAttemptsForJob(jobId);
                return html`
                  <tr>
                    <td>${formatDateTime(job.queued_at)}</td>
                    <td class="mono">${job.definition_key || job.definition_id}</td>
                    <td>
                      <span class="status-pill status-${job.status}">${job.status}</span>
                    </td>
                    <td>${Number(job.attempt_count || 0)} / ${Number(job.max_attempts || 0)}</td>
                    <td>${job.source || '—'}</td>
                    <td class="mono">${job.claimed_by_worker || '—'}</td>
                    <td>
                      <div class="row">
                        <button class="btn btn-secondary btn-sm" @click=${() => this._toggleJobAttempts(job)}>
                          ${attemptsExpanded ? 'Hide Attempts' : 'Show Attempts'}
                        </button>
                        ${job.status === 'queued' || job.status === 'running' ? html`
                          <button class="btn btn-danger btn-sm" ?disabled=${this.actionLoading} @click=${() => this._handleCancel(job)}>
                            Cancel
                          </button>
                        ` : html``}
                        ${RETRYABLE_STATUSES.has(String(job.status || '')) ? html`
                          <button class="btn btn-primary btn-sm" ?disabled=${this.actionLoading} @click=${() => this._handleRetry(job)}>
                            Retry
                          </button>
                        ` : html``}
                        ${String(job.status || '').toLowerCase() !== 'running' ? html`
                          <button class="btn btn-danger btn-sm" ?disabled=${this.actionLoading} @click=${() => this._handleDelete(job)}>
                            Delete
                          </button>
                        ` : html``}
                      </div>
                    </td>
                  </tr>
                  ${attemptsExpanded ? html`
                    <tr>
                      <td colspan="7" class="attempt-log-cell">
                        ${attemptsLoading ? html`<div class="muted">Loading attempts...</div>` : html`
                          <div class="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>Status</th>
                                  <th>Worker</th>
                                  <th>Started</th>
                                  <th>Finished</th>
                                  <th>Exit</th>
                                  <th>Error</th>
                                  <th>Logs</th>
                                </tr>
                              </thead>
                              <tbody>
                                ${attempts.map((attempt) => html`
                                  <tr>
                                    <td>${attempt.attempt_no}</td>
                                    <td><span class="status-pill status-${attempt.status}">${attempt.status}</span></td>
                                    <td class="mono">${attempt.worker_id || '—'}</td>
                                    <td>${formatDateTime(attempt.started_at)}</td>
                                    <td>${formatDateTime(attempt.finished_at)}</td>
                                    <td>${attempt.exit_code ?? '—'}</td>
                                    <td>${attempt.error_text || '—'}</td>
                                    <td>
                                      ${this._attemptHasLogs(attempt) ? html`
                                        <button class="btn btn-secondary btn-sm" @click=${() => this._toggleAttemptLogs(jobId, attempt)}>
                                          ${this._isAttemptExpanded(jobId, attempt) ? 'Hide Logs' : 'View Logs'}
                                        </button>
                                      ` : html`<span class="muted">—</span>`}
                                    </td>
                                  </tr>
                                  ${this._isAttemptExpanded(jobId, attempt) ? html`
                                    <tr>
                                      <td colspan="8" class="attempt-log-cell">
                                        ${String(attempt.stdout_tail || '').trim() ? html`
                                          <div class="attempt-log-title">stdout</div>
                                          <pre class="attempt-log-block mono">${attempt.stdout_tail}</pre>
                                        ` : html``}
                                        ${String(attempt.stderr_tail || '').trim() ? html`
                                          <div class="attempt-log-title">stderr</div>
                                          <pre class="attempt-log-block mono">${attempt.stderr_tail}</pre>
                                        ` : html``}
                                      </td>
                                    </tr>
                                  ` : html``}
                                `)}
                                ${!attempts.length ? html`
                                  <tr>
                                    <td colspan="8" class="muted">No attempts.</td>
                                  </tr>
                                ` : html``}
                              </tbody>
                            </table>
                          </div>
                        `}
                      </td>
                    </tr>
                  ` : html``}
                `;
              })}
              ${!this.jobs.length ? html`
                <tr>
                  <td colspan="7" class="muted">No jobs found.</td>
                </tr>
              ` : html``}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderTriggersTab() {
    const hasDefinitions = Array.isArray(this.definitions) && this.definitions.length > 0;
    return html`
      <div class="section">
        <h4 class="section-title">Create Trigger</h4>
        <div class="row">
          <input
            class="input field"
            type="text"
            placeholder="Label"
            .value=${this.triggerLabel}
            @input=${(event) => {
              this.triggerLabel = event.target.value || '';
            }}
          />
          <select
            class="select field"
            .value=${this.triggerType}
            @change=${(event) => {
              this.triggerType = event.target.value || 'event';
            }}
          >
            <option value="event">event</option>
            <option value="schedule">schedule</option>
          </select>
          ${hasDefinitions ? html`
            <select
              class="select field"
              .value=${this.triggerDefinitionKey}
              @change=${(event) => {
                this.triggerDefinitionKey = event.target.value || '';
              }}
            >
              ${this.definitions.map((definition) => html`
                <option value=${definition.key}>${definition.key}</option>
              `)}
            </select>
          ` : html`
            <input
              class="input field"
              type="text"
              placeholder="definition_key"
              .value=${this.triggerDefinitionKey}
              @input=${(event) => {
                this.triggerDefinitionKey = event.target.value || '';
              }}
            />
          `}
          <input
            class="input field"
            type="number"
            min="0"
            placeholder="dedupe seconds"
            .value=${this.triggerDedupeWindow}
            @input=${(event) => {
              this.triggerDedupeWindow = event.target.value || '';
            }}
          />
        </div>
        <div class="row" style="margin-top: 8px;">
          ${this.triggerType === 'event' ? html`
            <input
              class="input field"
              type="text"
              placeholder="event_name (e.g. provider.folder.updated)"
              .value=${this.triggerEventName}
              @input=${(event) => {
                this.triggerEventName = event.target.value || '';
              }}
            />
          ` : html`
            <input
              class="input field"
              type="text"
              placeholder="cron_expr"
              .value=${this.triggerCronExpr}
              @input=${(event) => {
                this.triggerCronExpr = event.target.value || '';
              }}
            />
            <input
              class="input field"
              type="text"
              placeholder="timezone"
              .value=${this.triggerTimezone}
              @input=${(event) => {
                this.triggerTimezone = event.target.value || '';
              }}
            />
          `}
          <button class="btn btn-primary" ?disabled=${this.actionLoading} @click=${this._handleCreateTrigger}>
            Create Trigger
          </button>
        </div>
        <div class="row" style="margin-top: 8px;">
          <textarea
            class="textarea field-wide mono"
            placeholder='payload_template JSON, e.g. {"provider_id":"{{event.provider_id}}"}'
            .value=${this.triggerPayloadTemplate}
            @input=${(event) => {
              this.triggerPayloadTemplate = event.target.value || '';
            }}
          ></textarea>
        </div>
      </div>

      <div class="section">
        <div class="row-between">
          <h4 class="section-title" style="margin-bottom: 0;">Triggers (${this.triggers.length})</h4>
          <div class="row">
            <label class="row muted">
              <input
                type="checkbox"
                .checked=${this.includeDisabledTriggers}
                @change=${async (event) => {
                  this.includeDisabledTriggers = !!event.target.checked;
                  await this._loadTriggers({ keepLoading: true });
                }}
              />
              include disabled
            </label>
            <button class="btn btn-secondary btn-sm" @click=${() => this._loadTriggers({ keepLoading: true })}>
              Refresh
            </button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Label</th>
                <th>Type</th>
                <th>Target</th>
                <th>Definition</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${this.triggers.map((trigger) => html`
                <tr>
                  <td>
                    <input
                      type="checkbox"
                      .checked=${!!trigger.is_enabled}
                      ?disabled=${this.actionLoading}
                      @change=${(event) => this._toggleTrigger(trigger, !!event.target.checked)}
                    />
                  </td>
                  <td>${trigger.label}</td>
                  <td>${trigger.trigger_type}</td>
                  <td class="mono">${trigger.trigger_type === 'event' ? trigger.event_name : `${trigger.cron_expr} (${trigger.timezone})`}</td>
                  <td class="mono">${trigger.definition_key || trigger.definition_id}</td>
                  <td>
                    <button class="btn btn-danger btn-sm" ?disabled=${this.actionLoading} @click=${() => this._deleteTrigger(trigger)}>
                      Delete
                    </button>
                  </td>
                </tr>
              `)}
              ${!this.triggers.length ? html`
                <tr>
                  <td colspan="6" class="muted">No triggers configured.</td>
                </tr>
              ` : html``}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderDefinitionsTab() {
    return html`
      ${!this.isSuperAdmin ? html`
        <div class="section">
          <div class="muted">Definitions are only editable by super admins.</div>
        </div>
      ` : html`
        <div class="section">
          <h4 class="section-title">Create Definition</h4>
          <div class="row">
              <input
                class="input field"
                type="text"
                placeholder="key (e.g. sync-dropbox)"
                .value=${this.definitionKey}
                @input=${(event) => {
                  this.definitionKey = event.target.value || '';
                }}
            />
            <input
              class="input field"
              type="text"
              placeholder="description"
              .value=${this.definitionDescription}
              @input=${(event) => {
                this.definitionDescription = event.target.value || '';
              }}
            />
            <input
              class="input field"
              type="number"
              min="1"
              placeholder="timeout seconds"
              .value=${this.definitionTimeoutSeconds}
              @input=${(event) => {
                this.definitionTimeoutSeconds = event.target.value || '';
              }}
            />
            <input
              class="input field"
              type="number"
              min="1"
              placeholder="max attempts"
              .value=${this.definitionMaxAttempts}
              @input=${(event) => {
                this.definitionMaxAttempts = event.target.value || '';
              }}
            />
            <label class="row muted">
              <input
                type="checkbox"
                .checked=${this.definitionActive}
                @change=${(event) => {
                  this.definitionActive = !!event.target.checked;
                }}
              />
              active
            </label>
            <button class="btn btn-primary" ?disabled=${this.actionLoading} @click=${this._handleCreateDefinition}>
              Create Definition
            </button>
          </div>
          <div class="row" style="margin-top: 8px;">
            <textarea
              class="textarea field-wide mono"
              placeholder='arg_schema JSON'
              .value=${this.definitionArgSchema}
              @input=${(event) => {
                this.definitionArgSchema = event.target.value || '';
              }}
            ></textarea>
          </div>
        </div>
      `}

      <div class="section">
        <div class="row-between">
          <h4 class="section-title" style="margin-bottom: 0;">Definitions (${this.definitions.length})</h4>
          <div class="row">
            <label class="row muted">
              <input
                type="checkbox"
                .checked=${this.includeInactiveDefinitions}
                @change=${async (event) => {
                  this.includeInactiveDefinitions = !!event.target.checked;
                  await this._loadDefinitions({ keepLoading: true });
                }}
              />
              include inactive
            </label>
            <button class="btn btn-secondary btn-sm" @click=${() => this._loadDefinitions({ keepLoading: true })}>
              Refresh
            </button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Description</th>
                <th>Timeout</th>
                <th>Max Attempts</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              ${this.definitions.map((definition) => html`
                <tr>
                  <td class="mono">${definition.key}</td>
                  <td>${definition.description || '—'}</td>
                  <td>${definition.timeout_seconds}</td>
                  <td>${definition.max_attempts}</td>
                  <td>
                    <input
                      type="checkbox"
                      .checked=${!!definition.is_active}
                      ?disabled=${this.actionLoading || !this.isSuperAdmin}
                      @change=${(event) => this._toggleDefinition(definition, !!event.target.checked)}
                    />
                  </td>
                </tr>
              `)}
              ${!this.definitions.length ? html`
                <tr>
                  <td colspan="5" class="muted">No definitions found.</td>
                </tr>
              ` : html``}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="card">
        <div class="row-between">
          <div>
            <h3 class="title">Jobs</h3>
            <p class="subtitle">Tenant queue visibility and automation rules.</p>
          </div>
          <button class="btn btn-secondary btn-sm" ?disabled=${this.loading} @click=${this._loadAll}>
            Refresh All
          </button>
        </div>

        ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : ''}
        ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : ''}

        ${this._renderSummary()}

        ${this._renderQueueTab()}
      </div>
    `;
  }
}

customElements.define('library-jobs-admin', LibraryJobsAdmin);

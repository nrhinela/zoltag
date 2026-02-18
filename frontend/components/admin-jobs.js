import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';
import './library-jobs-admin.js';
import {
  createGlobalWorkflowDefinition,
  createGlobalJobDefinition,
  createGlobalJobTrigger,
  deleteGlobalJobDefinition,
  deleteGlobalWorkflowDefinition,
  deleteGlobalJobTrigger,
  getGlobalJobDefinitions,
  getGlobalJobTriggers,
  getGlobalWorkflowDefinitions,
  updateGlobalWorkflowDefinition,
  updateGlobalJobDefinition,
  updateGlobalJobTrigger,
} from '../services/api.js';

function parseJsonObject(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed;
  } catch (_error) {
    throw new Error(`${fieldName} must be valid JSON object`);
  }
}

function formatStepsJson(value) {
  const steps = Array.isArray(value) ? value : [];
  if (!steps.length) return '[]';
  return `[\n  ${steps.map((step) => JSON.stringify(step)).join(',\n  ')}\n]`;
}

export class AdminJobs extends LitElement {
  static properties = {
    tenants: { type: Array },
    selectedTenantId: { type: String },
    loading: { type: Boolean },
    saving: { type: Boolean },
    errorMessage: { type: String },
    successMessage: { type: String },
    definitions: { type: Array },
    triggers: { type: Array },
    workflows: { type: Array },
    includeInactiveDefinitions: { type: Boolean },
    includeDisabledTriggers: { type: Boolean },
    includeInactiveWorkflows: { type: Boolean },
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
    definitionTimeoutSeconds: { type: String },
    definitionMaxAttempts: { type: String },
    definitionActive: { type: Boolean },
    definitionEdits: { type: Object },
    workflowKey: { type: String },
    workflowDescription: { type: String },
    workflowSteps: { type: String },
    workflowMaxParallelSteps: { type: String },
    workflowFailurePolicy: { type: String },
    workflowActive: { type: Boolean },
    workflowEdits: { type: Object },
  };

  static styles = [
    tailwind,
    css`
      :host {
        display: block;
      }

      .panel {
        background: white;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        padding: 20px;
      }

      .title {
        margin: 0;
        color: #111827;
        font-size: 20px;
        font-weight: 700;
      }

      .subtitle {
        margin-top: 6px;
        margin-bottom: 0;
        color: #6b7280;
        font-size: 13px;
      }

      .notice {
        margin: 12px 0;
        border-radius: 8px;
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

      .section {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 14px;
        margin-top: 14px;
      }

      .section-title {
        margin: 0 0 10px;
        color: #111827;
        font-size: 14px;
        font-weight: 700;
      }

      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
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
        flex: 1 1 160px;
      }

      .field-wide {
        flex: 1 1 100%;
      }

      .btn {
        padding: 9px 14px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
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
        color: #64748b;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      }

      .muted {
        color: #6b7280;
        font-size: 12px;
      }

      .row-number-input {
        width: 110px;
      }

      .row-key-input {
        min-width: 220px;
      }

      .row-description-input {
        min-width: 280px;
      }
    `,
  ];

  constructor() {
    super();
    this.tenants = [];
    this.selectedTenantId = '';
    this.loading = false;
    this.saving = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.definitions = [];
    this.triggers = [];
    this.workflows = [];
    this.includeInactiveDefinitions = true;
    this.includeDisabledTriggers = false;
    this.includeInactiveWorkflows = false;

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
    this.definitionTimeoutSeconds = '3600';
    this.definitionMaxAttempts = '3';
    this.definitionActive = true;
    this.definitionEdits = {};

    this.workflowKey = '';
    this.workflowDescription = '';
    this.workflowSteps = `[
  {"step_key":"sync","definition_key":"sync-dropbox","depends_on":[],"payload":{}},
  {"step_key":"train","definition_key":"train-keyword-models","depends_on":["sync"],"payload":{}},
  {"step_key":"recompute-trained","definition_key":"recompute-trained-tags","depends_on":["train"],"payload":{"replace":true}}
]`;
    this.workflowMaxParallelSteps = '2';
    this.workflowFailurePolicy = 'fail_fast';
    this.workflowActive = true;
    this.workflowEdits = {};
  }

  connectedCallback() {
    super.connectedCallback();
    this._syncDefaultTenant();
    this._loadConfig();
  }

  updated(changedProperties) {
    if (changedProperties.has('tenants')) {
      this._syncDefaultTenant();
    }
  }

  _syncDefaultTenant() {
    if (this.selectedTenantId) return;
    const first = Array.isArray(this.tenants) ? this.tenants[0] : null;
    this.selectedTenantId = String(first?.id || '').trim();
  }

  _setError(message) {
    this.errorMessage = message || '';
    if (this.errorMessage) this.successMessage = '';
  }

  _setSuccess(message) {
    this.successMessage = message || '';
    if (this.successMessage) this.errorMessage = '';
  }

  async _loadConfig() {
    this.loading = true;
    this._setError('');
    try {
      const [definitionsResult, triggersResult, workflowsResult] = await Promise.all([
        getGlobalJobDefinitions({ includeInactive: this.includeInactiveDefinitions }),
        getGlobalJobTriggers({ includeDisabled: this.includeDisabledTriggers }),
        getGlobalWorkflowDefinitions({ includeInactive: this.includeInactiveWorkflows }),
      ]);
      this.definitions = Array.isArray(definitionsResult?.definitions) ? definitionsResult.definitions : [];
      this.triggers = Array.isArray(triggersResult?.triggers) ? triggersResult.triggers : [];
      this.workflows = Array.isArray(workflowsResult?.workflows) ? workflowsResult.workflows : [];
      this._syncDefinitionEdits();
      this._syncWorkflowEdits();
      const hasTriggerDefinition = this.definitions.some((definition) => String(definition?.key || '') === String(this.triggerDefinitionKey || ''));
      if (!hasTriggerDefinition && this.definitions.length) {
        this.triggerDefinitionKey = String(this.definitions[0]?.key || '');
      }
      if (!this.triggerDefinitionKey && this.definitions.length) {
        this.triggerDefinitionKey = String(this.definitions[0]?.key || '');
      }
    } catch (error) {
      this._setError(error?.message || 'Failed to load jobs configuration');
    } finally {
      this.loading = false;
    }
  }

  async _createDefinition() {
    const key = String(this.definitionKey || '').trim();
    if (!key) {
      this._setError('Definition key is required');
      return;
    }
    this.saving = true;
    this._setError('');
    try {
      await createGlobalJobDefinition({
        key,
        description: String(this.definitionDescription || '').trim(),
        timeout_seconds: Number(this.definitionTimeoutSeconds || 3600),
        max_attempts: Number(this.definitionMaxAttempts || 3),
        is_active: !!this.definitionActive,
      });
      this._setSuccess('Definition created');
      this.definitionKey = '';
      this.definitionDescription = '';
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to create definition');
    } finally {
      this.saving = false;
    }
  }

  async _toggleDefinition(definition, isActive) {
    if (!definition?.id || this.saving) return;
    if (!isActive && !this.includeInactiveDefinitions) {
      this.includeInactiveDefinitions = true;
    }
    this.saving = true;
    this._setError('');
    try {
      await updateGlobalJobDefinition(definition.id, { is_active: !!isActive });
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to update definition');
    } finally {
      this.saving = false;
    }
  }

  async _deleteDefinition(definition) {
    if (!definition?.id || this.saving) return;
    const label = String(definition?.key || definition?.id || 'definition');
    const confirmed = window.confirm(`Delete definition "${label}"?`);
    if (!confirmed) return;
    this.saving = true;
    this._setError('');
    try {
      await deleteGlobalJobDefinition(definition.id);
      this._setSuccess('Definition deleted');
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to delete definition');
    } finally {
      this.saving = false;
    }
  }

  _syncDefinitionEdits() {
    const next = {};
    for (const definition of this.definitions) {
      const id = String(definition?.id || '').trim();
      if (!id) continue;
      const current = this.definitionEdits?.[id] || {};
      next[id] = {
        key: Object.prototype.hasOwnProperty.call(current, 'key')
          ? String(current.key ?? '')
          : String(definition?.key ?? ''),
        description: Object.prototype.hasOwnProperty.call(current, 'description')
          ? String(current.description ?? '')
          : String(definition?.description ?? ''),
        timeout_seconds: Object.prototype.hasOwnProperty.call(current, 'timeout_seconds')
          ? String(current.timeout_seconds ?? '')
          : String(definition?.timeout_seconds ?? ''),
        max_attempts: Object.prototype.hasOwnProperty.call(current, 'max_attempts')
          ? String(current.max_attempts ?? '')
          : String(definition?.max_attempts ?? ''),
      };
    }
    this.definitionEdits = next;
  }

  _setDefinitionEdit(definitionId, field, value) {
    const id = String(definitionId || '').trim();
    if (!id) return;
    const current = this.definitionEdits || {};
    const row = current[id] || {};
    this.definitionEdits = {
      ...current,
      [id]: {
        ...row,
        [field]: String(value ?? ''),
      },
    };
  }

  _getDefinitionEdit(definition, field) {
    const id = String(definition?.id || '').trim();
    const row = (id && this.definitionEdits && this.definitionEdits[id]) ? this.definitionEdits[id] : null;
    if (row && Object.prototype.hasOwnProperty.call(row, field)) {
      return String(row[field] ?? '');
    }
    return String(definition?.[field] ?? '');
  }

  _hasDefinitionChanged(definition) {
    const keyText = this._getDefinitionEdit(definition, 'key').trim();
    const descriptionText = this._getDefinitionEdit(definition, 'description').trim();
    const timeoutText = this._getDefinitionEdit(definition, 'timeout_seconds').trim();
    const maxAttemptsText = this._getDefinitionEdit(definition, 'max_attempts').trim();
    return (
      keyText !== String(definition?.key ?? '').trim()
      || descriptionText !== String(definition?.description ?? '').trim()
      || timeoutText !== String(definition?.timeout_seconds ?? '').trim()
      || maxAttemptsText !== String(definition?.max_attempts ?? '').trim()
    );
  }

  _parsePositiveInt(value, fieldName, maximum) {
    const text = String(value || '').trim();
    if (!text) {
      throw new Error(`${fieldName} is required`);
    }
    const parsed = Number(text);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
      throw new Error(`${fieldName} must be an integer between 1 and ${maximum}`);
    }
    return parsed;
  }

  async _saveDefinition(definition) {
    if (!definition?.id || this.saving) return;
    const key = String(this._getDefinitionEdit(definition, 'key') || '').trim();
    const description = String(this._getDefinitionEdit(definition, 'description') || '').trim();
    if (!key) {
      this._setError('Definition key is required');
      return;
    }
    let timeoutSeconds;
    let maxAttempts;
    try {
      timeoutSeconds = this._parsePositiveInt(this._getDefinitionEdit(definition, 'timeout_seconds'), 'Timeout seconds', 86400);
      maxAttempts = this._parsePositiveInt(this._getDefinitionEdit(definition, 'max_attempts'), 'Max attempts', 100);
    } catch (error) {
      this._setError(error?.message || 'Invalid values');
      return;
    }

    this.saving = true;
    this._setError('');
    try {
      const updated = await updateGlobalJobDefinition(definition.id, {
        key,
        description,
        timeout_seconds: timeoutSeconds,
        max_attempts: maxAttempts,
      });
      this._setSuccess(`Updated ${updated?.key || key}`);
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to update definition');
    } finally {
      this.saving = false;
    }
  }

  async _createTrigger() {
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
      payloadTemplate = parseJsonObject(this.triggerPayloadTemplate, 'Trigger payload_template');
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

    this.saving = true;
    this._setError('');
    try {
      await createGlobalJobTrigger(body);
      this._setSuccess('Trigger created');
      this.triggerLabel = '';
      this.triggerEventName = '';
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to create trigger');
    } finally {
      this.saving = false;
    }
  }

  async _toggleTrigger(trigger, isEnabled) {
    if (!trigger?.id || this.saving) return;
    this.saving = true;
    this._setError('');
    try {
      await updateGlobalJobTrigger(trigger.id, { is_enabled: !!isEnabled });
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to update trigger');
    } finally {
      this.saving = false;
    }
  }

  async _deleteTrigger(trigger) {
    if (!trigger?.id || this.saving) return;
    const confirmed = window.confirm(`Delete trigger "${trigger.label}"?`);
    if (!confirmed) return;
    this.saving = true;
    this._setError('');
    try {
      await deleteGlobalJobTrigger(trigger.id);
      this._setSuccess('Trigger deleted');
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to delete trigger');
    } finally {
      this.saving = false;
    }
  }

  async _createWorkflow() {
    const key = String(this.workflowKey || '').trim();
    if (!key) {
      this._setError('Workflow key is required');
      return;
    }

    let steps;
    try {
      steps = JSON.parse(String(this.workflowSteps || '[]'));
      if (!Array.isArray(steps)) throw new Error();
    } catch (_error) {
      this._setError('Workflow steps must be valid JSON array');
      return;
    }

    this.saving = true;
    this._setError('');
    try {
      await createGlobalWorkflowDefinition({
        key,
        description: String(this.workflowDescription || '').trim(),
        steps,
        max_parallel_steps: Number(this.workflowMaxParallelSteps || 2),
        failure_policy: String(this.workflowFailurePolicy || 'fail_fast'),
        is_active: !!this.workflowActive,
      });
      this._setSuccess('Workflow created');
      this.workflowKey = '';
      this.workflowDescription = '';
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to create workflow');
    } finally {
      this.saving = false;
    }
  }

  _syncWorkflowEdits() {
    const next = {};
    for (const workflow of this.workflows) {
      const id = String(workflow?.id || '').trim();
      if (!id) continue;
      const current = this.workflowEdits?.[id] || {};
      next[id] = {
        key: Object.prototype.hasOwnProperty.call(current, 'key')
          ? String(current.key ?? '')
          : String(workflow?.key ?? ''),
        description: Object.prototype.hasOwnProperty.call(current, 'description')
          ? String(current.description ?? '')
          : String(workflow?.description ?? ''),
        max_parallel_steps: Object.prototype.hasOwnProperty.call(current, 'max_parallel_steps')
          ? String(current.max_parallel_steps ?? '')
          : String(workflow?.max_parallel_steps ?? ''),
        failure_policy: Object.prototype.hasOwnProperty.call(current, 'failure_policy')
          ? String(current.failure_policy ?? '')
          : String(workflow?.failure_policy ?? 'fail_fast'),
        is_active: Object.prototype.hasOwnProperty.call(current, 'is_active')
          ? !!current.is_active
          : !!workflow?.is_active,
        steps: Object.prototype.hasOwnProperty.call(current, 'steps')
          ? String(current.steps ?? '[]')
          : formatStepsJson(workflow?.steps),
      };
    }
    this.workflowEdits = next;
  }

  _setWorkflowEdit(workflowId, field, value) {
    const id = String(workflowId || '').trim();
    if (!id) return;
    const current = this.workflowEdits || {};
    const row = current[id] || {};
    this.workflowEdits = {
      ...current,
      [id]: {
        ...row,
        [field]: field === 'is_active' ? !!value : String(value ?? ''),
      },
    };
  }

  _getWorkflowEdit(workflow, field) {
    const id = String(workflow?.id || '').trim();
    const row = (id && this.workflowEdits && this.workflowEdits[id]) ? this.workflowEdits[id] : null;
    if (!row) {
      if (field === 'is_active') return !!workflow?.is_active;
      if (field === 'steps') return formatStepsJson(workflow?.steps);
      return String(workflow?.[field] ?? '');
    }
    if (!Object.prototype.hasOwnProperty.call(row, field)) {
      if (field === 'is_active') return !!workflow?.is_active;
      if (field === 'steps') return formatStepsJson(workflow?.steps);
      return String(workflow?.[field] ?? '');
    }
    return field === 'is_active' ? !!row[field] : String(row[field] ?? '');
  }

  _hasWorkflowChanged(workflow) {
    const keyText = String(this._getWorkflowEdit(workflow, 'key') || '').trim();
    const descriptionText = String(this._getWorkflowEdit(workflow, 'description') || '').trim();
    const parallelText = String(this._getWorkflowEdit(workflow, 'max_parallel_steps') || '').trim();
    const policyText = String(this._getWorkflowEdit(workflow, 'failure_policy') || '').trim();
    const activeValue = !!this._getWorkflowEdit(workflow, 'is_active');
    const stepsText = String(this._getWorkflowEdit(workflow, 'steps') || '').trim();

    const canonicalCurrentSteps = JSON.stringify(Array.isArray(workflow?.steps) ? workflow.steps : []);
    let canonicalEditedSteps = '';
    try {
      const parsed = JSON.parse(stepsText || '[]');
      canonicalEditedSteps = JSON.stringify(Array.isArray(parsed) ? parsed : null);
    } catch (_error) {
      canonicalEditedSteps = '__invalid__';
    }

    return (
      keyText !== String(workflow?.key ?? '').trim()
      || descriptionText !== String(workflow?.description ?? '').trim()
      || parallelText !== String(workflow?.max_parallel_steps ?? '').trim()
      || policyText !== String(workflow?.failure_policy ?? '').trim()
      || activeValue !== !!workflow?.is_active
      || canonicalEditedSteps !== canonicalCurrentSteps
    );
  }

  async _saveWorkflow(workflow) {
    if (!workflow?.id || this.saving) return;
    const key = String(this._getWorkflowEdit(workflow, 'key') || '').trim();
    const description = String(this._getWorkflowEdit(workflow, 'description') || '').trim();
    const policy = String(this._getWorkflowEdit(workflow, 'failure_policy') || '').trim() || 'fail_fast';
    const active = !!this._getWorkflowEdit(workflow, 'is_active');
    const parallelText = String(this._getWorkflowEdit(workflow, 'max_parallel_steps') || '').trim();
    const stepsText = String(this._getWorkflowEdit(workflow, 'steps') || '').trim();

    if (!key) {
      this._setError('Workflow key is required');
      return;
    }

    let maxParallelSteps;
    try {
      maxParallelSteps = this._parsePositiveInt(parallelText, 'Workflow max parallel steps', 64);
    } catch (error) {
      this._setError(error?.message || 'Invalid workflow max parallel steps');
      return;
    }

    let steps = [];
    try {
      const parsed = JSON.parse(stepsText || '[]');
      if (!Array.isArray(parsed)) {
        throw new Error();
      }
      steps = parsed;
    } catch (_error) {
      this._setError('Workflow steps must be valid JSON array');
      return;
    }

    if (policy !== 'fail_fast' && policy !== 'continue') {
      this._setError('Workflow failure policy must be fail_fast or continue');
      return;
    }

    this.saving = true;
    this._setError('');
    try {
      const updated = await updateGlobalWorkflowDefinition(workflow.id, {
        key,
        description,
        steps,
        max_parallel_steps: maxParallelSteps,
        failure_policy: policy,
        is_active: active,
      });
      this._setSuccess(`Updated workflow ${updated?.key || key}`);
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to update workflow');
    } finally {
      this.saving = false;
    }
  }

  async _deleteWorkflow(workflow) {
    if (!workflow?.id || this.saving) return;
    const confirmed = window.confirm(`Delete workflow "${workflow.key}"?`);
    if (!confirmed) return;
    this.saving = true;
    this._setError('');
    try {
      await deleteGlobalWorkflowDefinition(workflow.id);
      this._setSuccess('Workflow deleted');
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to delete workflow');
    } finally {
      this.saving = false;
    }
  }

  render() {
    return html`
      <div class="panel">
        <h2 class="title">Jobs</h2>
        <p class="subtitle">Global definitions and triggers, plus tenant queue inspection.</p>

        ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : ''}
        ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : ''}

        <div class="section">
          <h3 class="section-title">Global Definitions</h3>
          <div class="row">
            <input class="input field" type="text" placeholder="key" .value=${this.definitionKey} @input=${(e) => { this.definitionKey = e.target.value || ''; }} />
            <input class="input field" type="number" min="1" placeholder="timeout seconds" .value=${this.definitionTimeoutSeconds} @input=${(e) => { this.definitionTimeoutSeconds = e.target.value || ''; }} />
            <input class="input field" type="number" min="1" placeholder="max attempts" .value=${this.definitionMaxAttempts} @input=${(e) => { this.definitionMaxAttempts = e.target.value || ''; }} />
            <label class="row muted"><input type="checkbox" .checked=${this.definitionActive} @change=${(e) => { this.definitionActive = !!e.target.checked; }} />active</label>
            <button class="btn btn-primary" ?disabled=${this.saving} @click=${this._createDefinition}>Create</button>
          </div>
          <div class="row" style="margin-top:8px;">
            <input class="input field-wide" type="text" placeholder="description" .value=${this.definitionDescription} @input=${(e) => { this.definitionDescription = e.target.value || ''; }} />
          </div>
          <div class="row" style="margin-top:8px;">
            <label class="row muted">
              <input
                type="checkbox"
                .checked=${this.includeInactiveDefinitions}
                @change=${async (e) => {
                  this.includeInactiveDefinitions = !!e.target.checked;
                  await this._loadConfig();
                }}
              />
              include inactive
            </label>
          </div>
          <div class="table-wrap" style="margin-top:10px;">
            <table>
              <thead>
                <tr><th>Key</th><th>Timeout</th><th>Max</th><th>Active</th><th>Actions</th></tr>
              </thead>
              <tbody>
                ${this.definitions.map((definition) => html`
                  <tr>
                    <td>
                      <input
                        class="input mono row-key-input"
                        type="text"
                        .value=${this._getDefinitionEdit(definition, 'key')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setDefinitionEdit(definition.id, 'key', e.target.value || '')}
                      />
                    </td>
                    <td>
                      <input
                        class="input row-number-input"
                        type="number"
                        min="1"
                        max="86400"
                        .value=${this._getDefinitionEdit(definition, 'timeout_seconds')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setDefinitionEdit(definition.id, 'timeout_seconds', e.target.value || '')}
                      />
                    </td>
                    <td>
                      <input
                        class="input row-number-input"
                        type="number"
                        min="1"
                        max="100"
                        .value=${this._getDefinitionEdit(definition, 'max_attempts')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setDefinitionEdit(definition.id, 'max_attempts', e.target.value || '')}
                      />
                    </td>
                    <td><input type="checkbox" .checked=${!!definition.is_active} ?disabled=${this.saving} @change=${(e) => this._toggleDefinition(definition, !!e.target.checked)} /></td>
                    <td>
                      <button
                        class="btn btn-primary btn-sm"
                        ?disabled=${this.saving || !this._hasDefinitionChanged(definition)}
                        @click=${() => this._saveDefinition(definition)}
                      >
                        Save
                      </button>
                      <button
                        class="btn btn-danger btn-sm"
                        style="margin-left:6px;"
                        ?disabled=${this.saving}
                        @click=${() => this._deleteDefinition(definition)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="5">
                      <div class="muted" style="margin-bottom:6px;">description</div>
                      <input
                        class="input field-wide"
                        type="text"
                        .value=${this._getDefinitionEdit(definition, 'description')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setDefinitionEdit(definition.id, 'description', e.target.value || '')}
                      />
                    </td>
                  </tr>
                `)}
                ${!this.definitions.length ? html`<tr><td colspan="5" class="muted">No definitions found.</td></tr>` : html``}
              </tbody>
            </table>
          </div>
        </div>

        <div class="section">
          <h3 class="section-title">Global Triggers</h3>
          <div class="row">
            <input class="input field" type="text" placeholder="label" .value=${this.triggerLabel} @input=${(e) => { this.triggerLabel = e.target.value || ''; }} />
            <select class="select field" .value=${this.triggerType} @change=${(e) => { this.triggerType = e.target.value || 'event'; }}>
              <option value="event">event</option>
              <option value="schedule">schedule</option>
            </select>
            <select class="select field" .value=${this.triggerDefinitionKey} @change=${(e) => { this.triggerDefinitionKey = e.target.value || ''; }}>
              ${this.definitions.map((definition) => html`<option value=${definition.key}>${definition.key}</option>`)}
            </select>
            <input class="input field" type="number" min="0" placeholder="dedupe seconds" .value=${this.triggerDedupeWindow} @input=${(e) => { this.triggerDedupeWindow = e.target.value || ''; }} />
          </div>
          <div class="row" style="margin-top:8px;">
            ${this.triggerType === 'event' ? html`
              <input class="input field" type="text" placeholder="event_name" .value=${this.triggerEventName} @input=${(e) => { this.triggerEventName = e.target.value || ''; }} />
            ` : html`
              <input class="input field" type="text" placeholder="cron_expr" .value=${this.triggerCronExpr} @input=${(e) => { this.triggerCronExpr = e.target.value || ''; }} />
              <input class="input field" type="text" placeholder="timezone" .value=${this.triggerTimezone} @input=${(e) => { this.triggerTimezone = e.target.value || ''; }} />
            `}
            <button class="btn btn-primary" ?disabled=${this.saving} @click=${this._createTrigger}>Create</button>
          </div>
          <div class="row" style="margin-top:8px;">
            <textarea class="textarea field-wide mono" placeholder="payload_template JSON" .value=${this.triggerPayloadTemplate} @input=${(e) => { this.triggerPayloadTemplate = e.target.value || ''; }}></textarea>
          </div>
          <div class="table-wrap" style="margin-top:10px;">
            <div class="row" style="margin-bottom:8px;">
              <label class="row muted">
                <input
                  type="checkbox"
                  .checked=${this.includeDisabledTriggers}
                  @change=${async (e) => {
                    this.includeDisabledTriggers = !!e.target.checked;
                    await this._loadConfig();
                  }}
                />
                include disabled
              </label>
            </div>
            <table>
              <thead>
                <tr><th>Enabled</th><th>Label</th><th>Type</th><th>Target</th><th>Definition</th><th>Actions</th></tr>
              </thead>
              <tbody>
                ${this.triggers.map((trigger) => html`
                  <tr>
                    <td><input type="checkbox" .checked=${!!trigger.is_enabled} ?disabled=${this.saving} @change=${(e) => this._toggleTrigger(trigger, !!e.target.checked)} /></td>
                    <td>${trigger.label}</td>
                    <td>${trigger.trigger_type}</td>
                    <td class="mono">${trigger.trigger_type === 'event' ? trigger.event_name : `${trigger.cron_expr} (${trigger.timezone})`}</td>
                    <td class="mono">${trigger.definition_key || trigger.definition_id}</td>
                    <td><button class="btn btn-danger btn-sm" ?disabled=${this.saving} @click=${() => this._deleteTrigger(trigger)}>Delete</button></td>
                  </tr>
                `)}
                ${!this.triggers.length ? html`<tr><td colspan="6" class="muted">No triggers found.</td></tr>` : html``}
              </tbody>
            </table>
          </div>
        </div>

        <div class="section">
          <h3 class="section-title">Global Workflows</h3>
          <div class="row">
            <input class="input field" type="text" placeholder="workflow key (e.g. daily)" .value=${this.workflowKey} @input=${(e) => { this.workflowKey = e.target.value || ''; }} />
            <input class="input field" type="number" min="1" max="64" placeholder="max parallel steps" .value=${this.workflowMaxParallelSteps} @input=${(e) => { this.workflowMaxParallelSteps = e.target.value || ''; }} />
            <select class="select field" .value=${this.workflowFailurePolicy} @change=${(e) => { this.workflowFailurePolicy = e.target.value || 'fail_fast'; }}>
              <option value="fail_fast">fail_fast</option>
              <option value="continue">continue</option>
            </select>
            <label class="row muted"><input type="checkbox" .checked=${this.workflowActive} @change=${(e) => { this.workflowActive = !!e.target.checked; }} />active</label>
            <button class="btn btn-primary" ?disabled=${this.saving} @click=${this._createWorkflow}>Create</button>
          </div>
          <div class="row" style="margin-top:8px;">
            <input class="input field-wide" type="text" placeholder="description" .value=${this.workflowDescription} @input=${(e) => { this.workflowDescription = e.target.value || ''; }} />
          </div>
          <div class="row" style="margin-top:8px;">
            <textarea class="textarea field-wide mono" placeholder="steps JSON array" .value=${this.workflowSteps} @input=${(e) => { this.workflowSteps = e.target.value || ''; }}></textarea>
          </div>
          <div class="row" style="margin-top:8px;">
            <label class="row muted">
              <input
                type="checkbox"
                .checked=${this.includeInactiveWorkflows}
                @change=${async (e) => {
                  this.includeInactiveWorkflows = !!e.target.checked;
                  await this._loadConfig();
                }}
              />
              include inactive
            </label>
          </div>
          <div class="table-wrap" style="margin-top:10px;">
            <table>
              <thead>
                <tr><th>Key</th><th>Description</th><th>Parallel</th><th>Policy</th><th>Active</th><th>Actions</th></tr>
              </thead>
              <tbody>
                ${this.workflows.map((workflow) => html`
                  <tr>
                    <td>
                      <input
                        class="input mono row-key-input"
                        type="text"
                        .value=${this._getWorkflowEdit(workflow, 'key')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setWorkflowEdit(workflow.id, 'key', e.target.value || '')}
                      />
                    </td>
                    <td>
                      <input
                        class="input row-description-input"
                        type="text"
                        .value=${this._getWorkflowEdit(workflow, 'description')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setWorkflowEdit(workflow.id, 'description', e.target.value || '')}
                      />
                    </td>
                    <td>
                      <input
                        class="input row-number-input"
                        type="number"
                        min="1"
                        max="64"
                        .value=${this._getWorkflowEdit(workflow, 'max_parallel_steps')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setWorkflowEdit(workflow.id, 'max_parallel_steps', e.target.value || '')}
                      />
                    </td>
                    <td>
                      <select
                        class="select"
                        .value=${this._getWorkflowEdit(workflow, 'failure_policy')}
                        ?disabled=${this.saving}
                        @change=${(e) => this._setWorkflowEdit(workflow.id, 'failure_policy', e.target.value || 'fail_fast')}
                      >
                        <option value="fail_fast">fail_fast</option>
                        <option value="continue">continue</option>
                      </select>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        .checked=${!!this._getWorkflowEdit(workflow, 'is_active')}
                        ?disabled=${this.saving}
                        @change=${(e) => this._setWorkflowEdit(workflow.id, 'is_active', !!e.target.checked)}
                      />
                    </td>
                    <td>
                      <div class="row">
                        <button
                          class="btn btn-primary btn-sm"
                          ?disabled=${this.saving || !this._hasWorkflowChanged(workflow)}
                          @click=${() => this._saveWorkflow(workflow)}
                        >
                          Save
                        </button>
                        <button class="btn btn-danger btn-sm" ?disabled=${this.saving} @click=${() => this._deleteWorkflow(workflow)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="6">
                      <div class="muted" style="margin-bottom:6px;">steps</div>
                      <textarea
                        class="textarea mono"
                        style="min-height:110px;"
                        .value=${this._getWorkflowEdit(workflow, 'steps')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setWorkflowEdit(workflow.id, 'steps', e.target.value || '[]')}
                      ></textarea>
                    </td>
                  </tr>
                `)}
                ${!this.workflows.length ? html`<tr><td colspan="6" class="muted">No workflows found.</td></tr>` : html``}
              </tbody>
            </table>
          </div>
        </div>

        <div class="section">
          <h3 class="section-title">Tenant Queue Viewer</h3>
          <div class="row">
            <select class="select field" .value=${this.selectedTenantId} @change=${(e) => { this.selectedTenantId = e.target.value || ''; }}>
              ${this.tenants.map((tenant) => html`<option value=${tenant.id}>${tenant.identifier || tenant.name || tenant.id}</option>`)}
            </select>
            <span class="muted">Choose tenant, then use queue tools below.</span>
          </div>
          ${this.selectedTenantId ? html`
            <div style="margin-top: 10px;">
              <library-jobs-admin .tenant=${this.selectedTenantId} .isSuperAdmin=${true}></library-jobs-admin>
            </div>
          ` : html`
            <div class="muted">No tenant selected.</div>
          `}
        </div>
      </div>
    `;
  }
}

customElements.define('admin-jobs', AdminJobs);

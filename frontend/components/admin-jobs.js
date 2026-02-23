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
  getAllWorkflowRuns,
} from '../services/api.js';

const _TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Helsinki',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
];

function parseJsonObject(value, fieldName) {
  const text = String(value || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
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
    activeTab: { type: String },
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
    // new trigger form
    triggerLabel: { type: String },
    triggerType: { type: String },
    triggerEventName: { type: String },
    triggerCronExpr: { type: String },
    triggerTimezone: { type: String },
    triggerDefinitionKey: { type: String },
    triggerWorkflowKey: { type: String },
    triggerPayloadTemplate: { type: String },
    triggerDedupeWindow: { type: String },
    // trigger inline edits keyed by id
    triggerEdits: { type: Object },
    // add-form visibility
    showAddTrigger: { type: Boolean },
    showAddWorkflow: { type: Boolean },
    showAddDefinition: { type: Boolean },
    // new definition form
    definitionKey: { type: String },
    definitionDescription: { type: String },
    definitionTimeoutSeconds: { type: String },
    definitionMaxAttempts: { type: String },
    definitionActive: { type: Boolean },
    definitionEdits: { type: Object },
    // new workflow form
    workflowKey: { type: String },
    workflowDescription: { type: String },
    workflowSteps: { type: String },
    workflowMaxParallelSteps: { type: String },
    workflowFailurePolicy: { type: String },
    workflowActive: { type: Boolean },
    workflowEdits: { type: Object },
    workflowStepsRows: { type: Array },
    definitionDocsOpen: { type: Object },
    allWorkflowRuns: { type: Array },
    allWorkflowRunsLoading: { type: Boolean },
  };

  static styles = [
    tailwind,
    css`
      :host { display: block; }
      .panel { background: white; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,.1); padding: 20px; }
      .title { margin: 0; color: #111827; font-size: 20px; font-weight: 700; }
      .subtitle { margin-top: 6px; margin-bottom: 0; color: #6b7280; font-size: 13px; }
      .notice { margin: 12px 0; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
      .notice-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
      .notice-success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
      .tabs { display: flex; gap: 4px; margin-top: 16px; border-bottom: 2px solid #e5e7eb; }
      .tab { padding: 8px 16px; font-size: 13px; font-weight: 600; border: none; background: none;
             cursor: pointer; color: #6b7280; border-bottom: 2px solid transparent; margin-bottom: -2px; }
      .tab.active { color: #2563eb; border-bottom-color: #2563eb; }
      .tab-content { margin-top: 16px; }
      .section { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; margin-top: 14px; }
      .section-title { margin: 0 0 10px; color: #111827; font-size: 14px; font-weight: 700; }
      .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
      .input, .select, .textarea { border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px;
                                    padding: 8px 10px; color: #111827; background: #ffffff; }
      .input, .select { height: 36px; }
      .textarea { width: 100%; min-height: 82px; resize: vertical; }
      .field { flex: 1 1 160px; }
      .field-wide { flex: 1 1 100%; }
      .btn { padding: 9px 14px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 700; }
      .btn:disabled { opacity: 0.65; cursor: not-allowed; }
      .btn-primary { background: #2563eb; color: #ffffff; }
      .btn-secondary { background: #e5e7eb; color: #111827; }
      .btn-danger { background: #dc2626; color: #ffffff; }
      .btn-sm { padding: 6px 10px; font-size: 12px; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; padding: 8px; font-size: 12px; }
      th { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .03em; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; }
      .muted { color: #6b7280; font-size: 12px; }
      .add-form { border: 1px solid #d1d5db; border-radius: 8px; background: #f9fafb; padding: 12px; margin-bottom: 14px; }
      .cli-docs { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; font-size: 12px; }
      .cli-docs-help { color: #374151; margin-bottom: 8px; }
      .cli-docs-usage { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; color: #6b7280; margin-bottom: 10px; font-size: 11px; }
      .cli-params-table { width: 100%; border-collapse: collapse; }
      .cli-params-table th { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; text-align: left; }
      .cli-params-table td { padding: 4px 6px; vertical-align: top; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
      .cli-params-table tr:last-child td { border-bottom: none; }
      .param-name { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; color: #1d4ed8; }
      .param-type { color: #6b7280; }
      .param-default { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; color: #059669; }
      .param-required { color: #dc2626; font-weight: 700; font-size: 10px; }
      .btn-docs { background: none; border: 1px solid #d1d5db; border-radius: 6px; padding: 3px 8px; font-size: 11px; color: #6b7280; cursor: pointer; }
      .btn-docs:hover { background: #f3f4f6; color: #374151; }
      .step-builder { width: 100%; border-collapse: collapse; margin-top: 6px; }
      .step-builder th { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; text-align: left; background: #f8fafc; }
      .step-builder td { padding: 4px 6px; vertical-align: top; border-bottom: 1px solid #f1f5f9; }
      .step-builder tr:last-child td { border-bottom: none; }
      .dep-badge { display: inline-flex; align-items: center; gap: 3px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 4px; padding: 1px 6px; font-size: 11px; color: #1d4ed8; margin: 2px 2px 2px 0; cursor: pointer; }
      .dep-badge:hover { background: #dbeafe; }
      .dep-badge-remove { color: #93c5fd; font-size: 10px; }
      .row-number-input { width: 110px; }
      .row-key-input { min-width: 320px; }
      .row-description-input { width: 100%; }
      .trigger-edit-row td { background: #f9fafb; }
    `,
  ];

  constructor() {
    super();
    this.tenants = [];
    this.selectedTenantId = '';
    this.activeTab = 'jobs';
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
    this.triggerType = 'schedule';
    this.triggerEventName = '';
    this.triggerCronExpr = '0 2 * * *';
    this.triggerTimezone = 'UTC';
    this.triggerDefinitionKey = '';
    this.triggerWorkflowKey = '';
    this.triggerPayloadTemplate = '{}';
    this.triggerDedupeWindow = '3600';
    this.triggerEdits = {};
    this.showAddTrigger = false;
    this.showAddWorkflow = false;
    this.showAddDefinition = false;

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
    this.workflowStepsRows = [{ step_key: '', definition_key: '', depends_on: [], payload: {} }];
    this.definitionDocsOpen = {};
    this.allWorkflowRuns = [];
    this.allWorkflowRunsLoading = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._syncDefaultTenant();
    this._loadConfig();
  }

  updated(changedProperties) {
    if (changedProperties.has('tenants')) this._syncDefaultTenant();
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
      this._syncTriggerEdits();
      if (!this.triggerDefinitionKey && this.definitions.length) {
        this.triggerDefinitionKey = String(this.definitions[0]?.key || '');
      }
      if (!this.triggerWorkflowKey && this.workflows.length) {
        this.triggerWorkflowKey = String(this.workflows[0]?.key || '');
      }
    } catch (error) {
      this._setError(error?.message || 'Failed to load jobs configuration');
    } finally {
      this.loading = false;
    }
  }

  // ── Definitions ────────────────────────────────────────────────────────────

  async _createDefinition() {
    const key = String(this.definitionKey || '').trim();
    if (!key) { this._setError('Definition key is required'); return; }
    this.saving = true; this._setError('');
    try {
      await createGlobalJobDefinition({
        key,
        description: String(this.definitionDescription || '').trim(),
        timeout_seconds: Number(this.definitionTimeoutSeconds || 3600),
        max_attempts: Number(this.definitionMaxAttempts || 3),
        is_active: !!this.definitionActive,
      });
      this._setSuccess('Job created');
      this.showAddDefinition = false;
      this.definitionKey = '';
      this.definitionDescription = '';
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to create definition');
    } finally { this.saving = false; }
  }

  _toggleDefinitionDocs(id) {
    this.definitionDocsOpen = { ...this.definitionDocsOpen, [id]: !this.definitionDocsOpen[id] };
  }

  async _toggleDefinition(definition, isActive) {
    if (!definition?.id || this.saving) return;
    if (!isActive && !this.includeInactiveDefinitions) this.includeInactiveDefinitions = true;
    this.saving = true; this._setError('');
    try {
      await updateGlobalJobDefinition(definition.id, { is_active: !!isActive });
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to update definition');
    } finally { this.saving = false; }
  }

  async _deleteDefinition(definition) {
    if (!definition?.id || this.saving) return;
    if (!window.confirm(`Delete definition "${definition?.key || definition?.id}"?`)) return;
    this.saving = true; this._setError('');
    try {
      await deleteGlobalJobDefinition(definition.id);
      this._setSuccess('Definition deleted');
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to delete definition');
    } finally { this.saving = false; }
  }

  _syncDefinitionEdits() {
    const next = {};
    for (const d of this.definitions) {
      const id = String(d?.id || '').trim();
      if (!id) continue;
      const cur = this.definitionEdits?.[id] || {};
      next[id] = {
        key: Object.prototype.hasOwnProperty.call(cur, 'key') ? String(cur.key ?? '') : String(d?.key ?? ''),
        description: Object.prototype.hasOwnProperty.call(cur, 'description') ? String(cur.description ?? '') : String(d?.description ?? ''),
        timeout_seconds: Object.prototype.hasOwnProperty.call(cur, 'timeout_seconds') ? String(cur.timeout_seconds ?? '') : String(d?.timeout_seconds ?? ''),
        max_attempts: Object.prototype.hasOwnProperty.call(cur, 'max_attempts') ? String(cur.max_attempts ?? '') : String(d?.max_attempts ?? ''),
      };
    }
    this.definitionEdits = next;
  }

  _setDefinitionEdit(id, field, value) {
    id = String(id || '').trim();
    if (!id) return;
    this.definitionEdits = { ...this.definitionEdits, [id]: { ...(this.definitionEdits[id] || {}), [field]: String(value ?? '') } };
  }

  _getDefinitionEdit(definition, field) {
    const id = String(definition?.id || '').trim();
    const row = id && this.definitionEdits?.[id];
    if (row && Object.prototype.hasOwnProperty.call(row, field)) return String(row[field] ?? '');
    return String(definition?.[field] ?? '');
  }

  _hasDefinitionChanged(definition) {
    return (
      this._getDefinitionEdit(definition, 'key').trim() !== String(definition?.key ?? '').trim()
      || this._getDefinitionEdit(definition, 'description').trim() !== String(definition?.description ?? '').trim()
      || this._getDefinitionEdit(definition, 'timeout_seconds').trim() !== String(definition?.timeout_seconds ?? '').trim()
      || this._getDefinitionEdit(definition, 'max_attempts').trim() !== String(definition?.max_attempts ?? '').trim()
    );
  }

  _parsePositiveInt(value, fieldName, maximum) {
    const parsed = Number(String(value || '').trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum)
      throw new Error(`${fieldName} must be an integer between 1 and ${maximum}`);
    return parsed;
  }

  async _saveDefinition(definition) {
    if (!definition?.id || this.saving) return;
    const key = this._getDefinitionEdit(definition, 'key').trim();
    if (!key) { this._setError('Definition key is required'); return; }
    let timeoutSeconds, maxAttempts;
    try {
      timeoutSeconds = this._parsePositiveInt(this._getDefinitionEdit(definition, 'timeout_seconds'), 'Timeout seconds', 86400);
      maxAttempts = this._parsePositiveInt(this._getDefinitionEdit(definition, 'max_attempts'), 'Max attempts', 100);
    } catch (error) { this._setError(error?.message || 'Invalid values'); return; }
    this.saving = true; this._setError('');
    try {
      const updated = await updateGlobalJobDefinition(definition.id, {
        key, description: this._getDefinitionEdit(definition, 'description').trim(), timeout_seconds: timeoutSeconds, max_attempts: maxAttempts,
      });
      this._setSuccess(`Updated ${updated?.key || key}`);
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to update definition');
    } finally { this.saving = false; }
  }

  // ── Triggers ───────────────────────────────────────────────────────────────

  _syncTriggerEdits() {
    const next = {};
    for (const t of this.triggers) {
      const id = String(t?.id || '').trim();
      if (!id) continue;
      const cur = this.triggerEdits?.[id] || {};
      next[id] = {
        label: Object.prototype.hasOwnProperty.call(cur, 'label') ? String(cur.label ?? '') : String(t?.label ?? ''),
        cron_expr: Object.prototype.hasOwnProperty.call(cur, 'cron_expr') ? String(cur.cron_expr ?? '') : String(t?.cron_expr ?? ''),
        timezone: Object.prototype.hasOwnProperty.call(cur, 'timezone') ? String(cur.timezone ?? 'UTC') : String(t?.timezone || 'UTC'),
        event_name: Object.prototype.hasOwnProperty.call(cur, 'event_name') ? String(cur.event_name ?? '') : String(t?.event_name ?? ''),
        dedupe_window_seconds: Object.prototype.hasOwnProperty.call(cur, 'dedupe_window_seconds') ? String(cur.dedupe_window_seconds ?? '') : String(t?.dedupe_window_seconds ?? ''),
        payload_template: Object.prototype.hasOwnProperty.call(cur, 'payload_template') ? String(cur.payload_template ?? '{}') : JSON.stringify(t?.payload_template ?? {}, null, 2),
      };
    }
    this.triggerEdits = next;
  }

  _setTriggerEdit(id, field, value) {
    id = String(id || '').trim();
    if (!id) return;
    this.triggerEdits = { ...this.triggerEdits, [id]: { ...(this.triggerEdits[id] || {}), [field]: String(value ?? '') } };
  }

  _getTriggerEdit(trigger, field) {
    const id = String(trigger?.id || '').trim();
    const row = id && this.triggerEdits?.[id];
    if (row && Object.prototype.hasOwnProperty.call(row, field)) return String(row[field] ?? '');
    if (field === 'payload_template') return JSON.stringify(trigger?.payload_template ?? {}, null, 2);
    if (field === 'timezone') return String(trigger?.timezone || 'UTC');
    return String(trigger?.[field] ?? '');
  }

  _hasTriggerChanged(trigger) {
    return (
      this._getTriggerEdit(trigger, 'label').trim() !== String(trigger?.label ?? '').trim()
      || this._getTriggerEdit(trigger, 'cron_expr').trim() !== String(trigger?.cron_expr ?? '').trim()
      || this._getTriggerEdit(trigger, 'timezone').trim() !== String(trigger?.timezone || 'UTC').trim()
      || this._getTriggerEdit(trigger, 'event_name').trim() !== String(trigger?.event_name ?? '').trim()
      || this._getTriggerEdit(trigger, 'dedupe_window_seconds').trim() !== String(trigger?.dedupe_window_seconds ?? '').trim()
      || this._getTriggerEdit(trigger, 'payload_template').trim() !== JSON.stringify(trigger?.payload_template ?? {}, null, 2).trim()
    );
  }

  async _saveTrigger(trigger) {
    if (!trigger?.id || this.saving) return;
    const label = this._getTriggerEdit(trigger, 'label').trim();
    if (!label) { this._setError('Label is required'); return; }
    let payloadTemplate;
    try { payloadTemplate = parseJsonObject(this._getTriggerEdit(trigger, 'payload_template'), 'Payload template'); }
    catch (error) { this._setError(error.message); return; }
    const body = {
      label,
      dedupe_window_seconds: Number(this._getTriggerEdit(trigger, 'dedupe_window_seconds') || 300),
      payload_template: payloadTemplate,
    };
    if (trigger.trigger_type === 'schedule') {
      body.cron_expr = this._getTriggerEdit(trigger, 'cron_expr').trim();
      body.timezone = this._getTriggerEdit(trigger, 'timezone').trim();
    } else {
      body.event_name = this._getTriggerEdit(trigger, 'event_name').trim();
    }
    this.saving = true; this._setError('');
    try {
      await updateGlobalJobTrigger(trigger.id, body);
      this._setSuccess(`Updated trigger "${label}"`);
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to update trigger');
    } finally { this.saving = false; }
  }

  async _createTrigger() {
    const label = String(this.triggerLabel || '').trim();
    if (!label) { this._setError('Trigger label is required'); return; }

    let payloadTemplate = {};
    try { payloadTemplate = parseJsonObject(this.triggerPayloadTemplate, 'Payload template'); }
    catch (error) { this._setError(error.message); return; }

    const body = {
      label,
      trigger_type: this.triggerType,
      payload_template: payloadTemplate,
      dedupe_window_seconds: Number(this.triggerDedupeWindow || 300),
      is_enabled: true,
    };

    if (this.triggerType === 'event') {
      const eventName = String(this.triggerEventName || '').trim();
      if (!eventName) { this._setError('event_name is required for event triggers'); return; }
      const definitionKey = String(this.triggerDefinitionKey || '').trim();
      if (!definitionKey) { this._setError('Definition key is required for event triggers'); return; }
      body.event_name = eventName;
      body.definition_key = definitionKey;
    } else {
      const cronExpr = String(this.triggerCronExpr || '').trim();
      const timezone = String(this.triggerTimezone || '').trim();
      if (!cronExpr || !timezone) { this._setError('cron_expr and timezone are required for schedule triggers'); return; }
      const workflowKey = String(this.triggerWorkflowKey || '').trim();
      if (!workflowKey) { this._setError('Workflow is required for schedule triggers'); return; }
      body.cron_expr = cronExpr;
      body.timezone = timezone;
      body.workflow_key = workflowKey;
    }

    this.saving = true; this._setError('');
    try {
      await createGlobalJobTrigger(body);
      this._setSuccess('Trigger created');
      this.showAddTrigger = false;
      this.triggerLabel = '';
      this.triggerEventName = '';
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to create trigger');
    } finally { this.saving = false; }
  }

  async _toggleTrigger(trigger, isEnabled) {
    if (!trigger?.id || this.saving) return;
    this.saving = true; this._setError('');
    try {
      await updateGlobalJobTrigger(trigger.id, { is_enabled: !!isEnabled });
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to update trigger');
    } finally { this.saving = false; }
  }

  async _deleteTrigger(trigger) {
    if (!trigger?.id || this.saving) return;
    if (!window.confirm(`Delete trigger "${trigger.label}"?`)) return;
    this.saving = true; this._setError('');
    try {
      await deleteGlobalJobTrigger(trigger.id);
      this._setSuccess('Trigger deleted');
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to delete trigger');
    } finally { this.saving = false; }
  }

  // ── Workflows ──────────────────────────────────────────────────────────────

  async _createWorkflow() {
    const key = String(this.workflowKey || '').trim();
    if (!key) { this._setError('Workflow key is required'); return; }
    let steps;
    try { steps = JSON.parse(String(this.workflowSteps || '[]')); if (!Array.isArray(steps)) throw new Error(); }
    catch (_error) { this._setError('Workflow steps must be valid JSON array'); return; }
    this.saving = true; this._setError('');
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
      this.showAddWorkflow = false;
      this.workflowKey = '';
      this.workflowDescription = '';
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to create workflow');
    } finally { this.saving = false; }
  }

  _syncWorkflowEdits() {
    const next = {};
    for (const w of this.workflows) {
      const id = String(w?.id || '').trim();
      if (!id) continue;
      const cur = this.workflowEdits?.[id] || {};
      next[id] = {
        key: Object.prototype.hasOwnProperty.call(cur, 'key') ? String(cur.key ?? '') : String(w?.key ?? ''),
        description: Object.prototype.hasOwnProperty.call(cur, 'description') ? String(cur.description ?? '') : String(w?.description ?? ''),
        max_parallel_steps: Object.prototype.hasOwnProperty.call(cur, 'max_parallel_steps') ? String(cur.max_parallel_steps ?? '') : String(w?.max_parallel_steps ?? ''),
        failure_policy: Object.prototype.hasOwnProperty.call(cur, 'failure_policy') ? String(cur.failure_policy ?? '') : String(w?.failure_policy ?? 'fail_fast'),
        is_active: Object.prototype.hasOwnProperty.call(cur, 'is_active') ? !!cur.is_active : !!w?.is_active,
        steps: Object.prototype.hasOwnProperty.call(cur, 'steps') ? String(cur.steps ?? '[]') : formatStepsJson(w?.steps),
      };
    }
    this.workflowEdits = next;
  }

  _setWorkflowEdit(id, field, value) {
    id = String(id || '').trim();
    if (!id) return;
    this.workflowEdits = { ...this.workflowEdits, [id]: { ...(this.workflowEdits[id] || {}), [field]: field === 'is_active' ? !!value : String(value ?? '') } };
  }

  _getWorkflowEdit(workflow, field) {
    const id = String(workflow?.id || '').trim();
    const row = id && this.workflowEdits?.[id];
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
    const canonicalCurrent = JSON.stringify(Array.isArray(workflow?.steps) ? workflow.steps : []);
    let canonicalEdited = '';
    try { const parsed = JSON.parse(this._getWorkflowEdit(workflow, 'steps') || '[]'); canonicalEdited = JSON.stringify(Array.isArray(parsed) ? parsed : null); }
    catch (_e) { canonicalEdited = '__invalid__'; }
    return (
      this._getWorkflowEdit(workflow, 'key').trim() !== String(workflow?.key ?? '').trim()
      || this._getWorkflowEdit(workflow, 'description').trim() !== String(workflow?.description ?? '').trim()
      || this._getWorkflowEdit(workflow, 'max_parallel_steps').trim() !== String(workflow?.max_parallel_steps ?? '').trim()
      || this._getWorkflowEdit(workflow, 'failure_policy').trim() !== String(workflow?.failure_policy ?? '').trim()
      || !!this._getWorkflowEdit(workflow, 'is_active') !== !!workflow?.is_active
      || canonicalEdited !== canonicalCurrent
    );
  }

  async _saveWorkflow(workflow) {
    if (!workflow?.id || this.saving) return;
    const key = this._getWorkflowEdit(workflow, 'key').trim();
    if (!key) { this._setError('Workflow key is required'); return; }
    const policy = this._getWorkflowEdit(workflow, 'failure_policy').trim() || 'fail_fast';
    if (policy !== 'fail_fast' && policy !== 'continue') { this._setError('Failure policy must be fail_fast or continue'); return; }
    let maxParallelSteps;
    try { maxParallelSteps = this._parsePositiveInt(this._getWorkflowEdit(workflow, 'max_parallel_steps'), 'Max parallel steps', 64); }
    catch (error) { this._setError(error?.message); return; }
    let steps = [];
    try { const parsed = JSON.parse(this._getWorkflowEdit(workflow, 'steps') || '[]'); if (!Array.isArray(parsed)) throw new Error(); steps = parsed; }
    catch (_e) { this._setError('Workflow steps must be valid JSON array'); return; }
    this.saving = true; this._setError('');
    try {
      const updated = await updateGlobalWorkflowDefinition(workflow.id, {
        key, description: this._getWorkflowEdit(workflow, 'description').trim(),
        steps, max_parallel_steps: maxParallelSteps, failure_policy: policy,
        is_active: !!this._getWorkflowEdit(workflow, 'is_active'),
      });
      this._setSuccess(`Updated workflow ${updated?.key || key}`);
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to update workflow');
    } finally { this.saving = false; }
  }

  async _deleteWorkflow(workflow) {
    if (!workflow?.id || this.saving) return;
    if (!window.confirm(`Delete workflow "${workflow.key}"?`)) return;
    this.saving = true; this._setError('');
    try {
      await deleteGlobalWorkflowDefinition(workflow.id);
      this._setSuccess('Workflow deleted');
      await this._loadConfig();
    } catch (error) {
      this._setError(error?.message || 'Failed to delete workflow');
    } finally { this.saving = false; }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render() {
    return html`
      <div class="panel">
        <h2 class="title">Jobs</h2>
        <p class="subtitle">Global jobs, workflows, and triggers — plus tenant queue inspection.</p>

        ${this.errorMessage ? html`<div class="notice notice-error">${this.errorMessage}</div>` : ''}
        ${this.successMessage ? html`<div class="notice notice-success">${this.successMessage}</div>` : ''}

        <div class="tabs">
          ${['jobs','workflows','triggers','queue'].map((tab) => html`
            <button class="tab ${this.activeTab === tab ? 'active' : ''}" @click=${() => { this.activeTab = tab; if (tab === 'queue') this._loadAllWorkflowRuns(); }}>
              ${tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          `)}
        </div>

        <div class="tab-content">
          ${this.activeTab === 'jobs' ? this._renderDefinitions() : ''}
          ${this.activeTab === 'workflows' ? this._renderWorkflows() : ''}
          ${this.activeTab === 'triggers' ? this._renderTriggers() : ''}
          ${this.activeTab === 'queue' ? this._renderQueue() : ''}
        </div>
      </div>
    `;
  }

  _renderTriggers() {
    return html`
      <div class="section">
        <div class="row" style="margin-bottom:10px;">
          <h3 class="section-title" style="margin:0;flex:1;">Triggers</h3>
          <label class="row muted">
            <input type="checkbox" .checked=${this.includeDisabledTriggers} @change=${async (e) => { this.includeDisabledTriggers = !!e.target.checked; await this._loadConfig(); }} />
            include disabled
          </label>
        </div>
        <div style="margin-bottom:10px;">
          <button class="btn btn-secondary btn-sm" @click=${() => { this.showAddTrigger = !this.showAddTrigger; }}>
            ${this.showAddTrigger ? 'Cancel' : '+ Add'}
          </button>
        </div>
        ${this.showAddTrigger ? html`
          <div class="add-form">
            <div class="row">
              <input class="input field" type="text" placeholder="label" .value=${this.triggerLabel} @input=${(e) => { this.triggerLabel = e.target.value || ''; }} />
              <select class="select field" .value=${this.triggerType} @change=${(e) => { this.triggerType = e.target.value || 'schedule'; }}>
                <option value="schedule">schedule</option>
                <option value="event">event</option>
              </select>
              <input class="input field" type="number" min="0" placeholder="dedupe seconds" .value=${this.triggerDedupeWindow} @input=${(e) => { this.triggerDedupeWindow = e.target.value || ''; }} />
            </div>
            <div class="row" style="margin-top:8px;">
              ${this.triggerType === 'schedule' ? html`
                <input class="input field" type="text" placeholder="cron_expr e.g. 0 2 * * *" .value=${this.triggerCronExpr} @input=${(e) => { this.triggerCronExpr = e.target.value || ''; }} />
                <select class="select field" .value=${this.triggerTimezone} @change=${(e) => { this.triggerTimezone = e.target.value || 'UTC'; }}>
                ${_TIMEZONES.map((tz) => html`<option value=${tz}>${tz}</option>`)}
              </select>
                <select class="select field" .value=${this.triggerWorkflowKey} @change=${(e) => { this.triggerWorkflowKey = e.target.value || ''; }}>
                  <option value="">— workflow —</option>
                  ${this.workflows.map((w) => html`<option value=${w.key}>${w.key}</option>`)}
                </select>
              ` : html`
                <input class="input field" type="text" placeholder="event_name" .value=${this.triggerEventName} @input=${(e) => { this.triggerEventName = e.target.value || ''; }} />
                <select class="select field" .value=${this.triggerDefinitionKey} @change=${(e) => { this.triggerDefinitionKey = e.target.value || ''; }}>
                  <option value="">— definition —</option>
                  ${this.definitions.map((d) => html`<option value=${d.key}>${d.key}</option>`)}
                </select>
              `}
              <button class="btn btn-primary" ?disabled=${this.saving} @click=${this._createTrigger}>Create</button>
            </div>
            <div class="row" style="margin-top:8px;">
              <textarea class="textarea field-wide mono" placeholder="payload_template JSON" .value=${this.triggerPayloadTemplate} @input=${(e) => { this.triggerPayloadTemplate = e.target.value || ''; }}></textarea>
            </div>
          </div>
        ` : ''}
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Enabled</th><th>Type</th><th>Target</th><th>Workflow / Definition</th><th>Dedupe (s)</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${this.triggers.map((trigger) => html`
                <tr>
                  <td><input type="checkbox" .checked=${!!trigger.is_enabled} ?disabled=${this.saving} @change=${(e) => this._toggleTrigger(trigger, !!e.target.checked)} /></td>
                  <td class="muted">${trigger.trigger_type}</td>
                  <td>
                    ${trigger.trigger_type === 'schedule' ? html`
                      <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        <input class="input mono" style="width:130px;" type="text" placeholder="cron"
                          .value=${this._getTriggerEdit(trigger, 'cron_expr')}
                          ?disabled=${this.saving}
                          @input=${(e) => this._setTriggerEdit(trigger.id, 'cron_expr', e.target.value || '')} />
                        <select class="select" style="width:180px;"
                          ?disabled=${this.saving}
                          @change=${(e) => this._setTriggerEdit(trigger.id, 'timezone', e.target.value || 'UTC')}>
                          ${_TIMEZONES.map((tz) => html`<option value=${tz} ?selected=${this._getTriggerEdit(trigger, 'timezone') === tz}>${tz}</option>`)}
                        </select>
                      </div>
                    ` : html`
                      <input class="input mono" style="width:200px;" type="text" placeholder="event_name"
                        .value=${this._getTriggerEdit(trigger, 'event_name')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setTriggerEdit(trigger.id, 'event_name', e.target.value || '')} />
                    `}
                  </td>
                  <td class="mono muted">
                    ${trigger.trigger_type === 'schedule'
                      ? (trigger.workflow_definition_key || trigger.workflow_definition_id || '—')
                      : (trigger.definition_key || trigger.definition_id || '—')}
                  </td>
                  <td>
                    <input class="input row-number-input" type="number" min="0"
                      .value=${this._getTriggerEdit(trigger, 'dedupe_window_seconds')}
                      ?disabled=${this.saving}
                      @input=${(e) => this._setTriggerEdit(trigger.id, 'dedupe_window_seconds', e.target.value || '')} />
                  </td>
                  <td>
                    <div class="row">
                      <button class="btn btn-primary btn-sm" ?disabled=${this.saving || !this._hasTriggerChanged(trigger)} @click=${() => this._saveTrigger(trigger)}>Save</button>
                      <button class="btn btn-danger btn-sm" ?disabled=${this.saving} @click=${() => this._deleteTrigger(trigger)}>Delete</button>
                    </div>
                  </td>
                </tr>
                <tr class="trigger-edit-row">
                  <td colspan="6">
                    <div class="muted" style="margin-bottom:4px;">label</div>
                    <input class="input" style="width:100%;" type="text"
                      .value=${this._getTriggerEdit(trigger, 'label')}
                      ?disabled=${this.saving}
                      @input=${(e) => this._setTriggerEdit(trigger.id, 'label', e.target.value || '')} />
                  </td>
                </tr>
                <tr class="trigger-edit-row">
                  <td colspan="6">
                    <div class="muted" style="margin-bottom:4px;">payload_template</div>
                    <textarea class="textarea mono" style="min-height:60px;"
                      .value=${this._getTriggerEdit(trigger, 'payload_template')}
                      ?disabled=${this.saving}
                      @input=${(e) => this._setTriggerEdit(trigger.id, 'payload_template', e.target.value || '{}')}></textarea>
                  </td>
                </tr>
              `)}
              ${!this.triggers.length ? html`<tr><td colspan="6" class="muted">${this.loading ? 'Loading…' : 'No triggers found.'}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ── Step builder helpers ───────────────────────────────────────────────────

  _parseSteps(stepsJson) {
    try {
      const parsed = JSON.parse(stepsJson || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) { return []; }
  }

  _stepKeys(steps) {
    return steps.map((s) => s.step_key).filter(Boolean);
  }

  _sortStepsByParent(steps) {
    // Topological sort: roots first, then children after their parent, preserving relative order
    const keyMap = {};
    steps.forEach((s) => { if (s.step_key) keyMap[s.step_key] = s; });
    const result = [];
    const visited = new Set();
    const visit = (s) => {
      if (visited.has(s.step_key)) return;
      const parent = (s.depends_on || [])[0];
      if (parent && keyMap[parent] && !visited.has(parent)) visit(keyMap[parent]);
      visited.add(s.step_key);
      result.push(s);
    };
    // roots first
    steps.filter((s) => !(s.depends_on || []).length).forEach(visit);
    // then any remaining (children)
    steps.forEach(visit);
    // include steps with no key (new blank rows) at end
    steps.filter((s) => !s.step_key).forEach((s) => { if (!result.includes(s)) result.push(s); });
    return result;
  }

  _depthOf(step, steps) {
    const parent = (step.depends_on || [])[0];
    if (!parent) return 0;
    const parentStep = steps.find((s) => s.step_key === parent);
    if (!parentStep) return 1;
    return 1 + this._depthOf(parentStep, steps);
  }

  _renderStepBuilder(steps, onStepsChange) {
    const setStep = (key, patch) => {
      const next = steps.map((s) => s === key ? { ...s, ...patch } : s);
      onStepsChange(this._sortStepsByParent(next));
    };
    const removeStep = (step) => {
      const removedKey = step.step_key;
      const next = steps
        .filter((s) => s !== step)
        .map((s) => ({
          ...s,
          depends_on: (s.depends_on || []).filter((d) => d !== removedKey),
        }));
      onStepsChange(next);
    };
    const addStep = () => onStepsChange([...steps, { step_key: '', definition_key: '', depends_on: [], payload: {} }]);
    const setParent = (step, parentKey) => {
      const depends_on = parentKey ? [parentKey] : [];
      const updated = steps.map((s) => s === step ? { ...s, depends_on } : s);
      onStepsChange(this._sortStepsByParent(updated));
    };

    const sorted = this._sortStepsByParent(steps);
    const allKeys = steps.map((s) => s.step_key).filter(Boolean);

    return html`
      <div>
        <table class="step-builder">
          <thead>
            <tr>
              <th style="width:260px;">Step key</th>
              <th style="width:200px;">Definition</th>
              <th style="width:160px;">Parent</th>
              <th>Payload (JSON)</th>
              <th style="width:28px;"></th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((step) => {
              const depth = this._depthOf(step, steps);
              const currentParent = (step.depends_on || [])[0] || '';
              const availableParents = allKeys.filter((k) => k !== step.step_key);
              const payloadStr = step.payload && Object.keys(step.payload).length
                ? JSON.stringify(step.payload)
                : '';
              return html`
                <tr>
                  <td style="padding:4px 6px;position:relative;vertical-align:middle;">
                    <div style="display:flex;align-items:center;padding-left:${depth * 20}px;gap:4px;">
                      ${depth > 0 ? html`<span style="color:#93c5fd;font-size:11px;font-family:monospace;white-space:nowrap;flex-shrink:0;">└─</span>` : ''}
                      <input class="input mono" style="width:170px;font-size:13px;" type="text"
                        placeholder="step-key"
                        .value=${step.step_key || ''}
                        ?disabled=${this.saving}
                        @input=${(e) => setStep(step, { step_key: e.target.value || '' })} />
                    </div>
                  </td>
                  <td>
                    <select class="select" style="width:190px;font-size:13px;"
                      ?disabled=${this.saving}
                      @change=${(e) => {
                        const defKey = e.target.value || '';
                        const patch = { definition_key: defKey };
                        if (!step.step_key) patch.step_key = defKey;
                        setStep(step, patch);
                      }}>
                      <option value="">— select —</option>
                      ${this.definitions.map((d) => html`
                        <option value=${d.key} ?selected=${step.definition_key === d.key}>${d.key}</option>
                      `)}
                    </select>
                  </td>
                  <td>
                    <select class="select" style="width:150px;font-size:13px;"
                      ?disabled=${this.saving}
                      @change=${(e) => setParent(step, e.target.value)}>
                      <option value="" ?selected=${!currentParent}>(initial)</option>
                      ${availableParents.map((k) => html`
                        <option value=${k} ?selected=${currentParent === k}>${k}</option>
                      `)}
                    </select>
                  </td>
                  <td>
                    <input class="input mono" style="width:100%;font-size:13px;" type="text"
                      placeholder="{}"
                      .value=${payloadStr}
                      ?disabled=${this.saving}
                      @blur=${(e) => {
                        const raw = (e.target.value || '').trim();
                        let payload = {};
                        if (raw) { try { payload = JSON.parse(raw); } catch (_ex) { return; } }
                        setStep(step, { payload });
                      }} />
                  </td>
                  <td>
                    <button class="btn btn-danger btn-sm" style="padding:3px 7px;font-size:13px;"
                      ?disabled=${this.saving}
                      @click=${() => removeStep(step)}>×</button>
                  </td>
                </tr>
              `;
            })}
          </tbody>
        </table>
        <button class="btn btn-secondary btn-sm" style="margin-top:8px;"
          ?disabled=${this.saving}
          @click=${addStep}>+ Add Step</button>
      </div>
    `;
  }

  _renderWorkflows() {
    return html`
      <div class="section">
        <div class="row" style="margin-bottom:10px;">
          <h3 class="section-title" style="margin:0;flex:1;">Workflows</h3>
          <label class="row muted">
            <input type="checkbox" .checked=${this.includeInactiveWorkflows}
              @change=${async (e) => { this.includeInactiveWorkflows = !!e.target.checked; await this._loadConfig(); }} />
            include inactive
          </label>
        </div>
        <div style="margin-bottom:10px;">
          <button class="btn btn-secondary btn-sm" @click=${() => {
            this.showAddWorkflow = !this.showAddWorkflow;
            if (this.showAddWorkflow) this.workflowStepsRows = [{ step_key: '', definition_key: '', depends_on: [], payload: {} }];
          }}>
            ${this.showAddWorkflow ? 'Cancel' : '+ Add'}
          </button>
        </div>
        ${this.showAddWorkflow ? html`
          <div class="add-form">
            <div class="row">
              <input class="input field" type="text" placeholder="key e.g. daily"
                .value=${this.workflowKey}
                @input=${(e) => { this.workflowKey = e.target.value || ''; }} />
              <input class="input field" type="number" min="1" max="64" placeholder="max parallel steps"
                .value=${this.workflowMaxParallelSteps}
                @input=${(e) => { this.workflowMaxParallelSteps = e.target.value || ''; }} />
              <select class="select field"
                @change=${(e) => { this.workflowFailurePolicy = e.target.value || 'fail_fast'; }}>
                <option value="fail_fast" ?selected=${this.workflowFailurePolicy === 'fail_fast'}>fail_fast</option>
                <option value="continue" ?selected=${this.workflowFailurePolicy === 'continue'}>continue</option>
              </select>
              <label class="row muted">
                <input type="checkbox" .checked=${this.workflowActive}
                  @change=${(e) => { this.workflowActive = !!e.target.checked; }} /> active
              </label>
              <button class="btn btn-primary" ?disabled=${this.saving} @click=${() => {
                this.workflowSteps = JSON.stringify(this.workflowStepsRows);
                this._createWorkflow();
              }}>Create</button>
            </div>
            <div class="row" style="margin-top:8px;">
              <input class="input field-wide" type="text" placeholder="description"
                .value=${this.workflowDescription}
                @input=${(e) => { this.workflowDescription = e.target.value || ''; }} />
            </div>
            <div style="margin-top:8px;">
              ${this._renderStepBuilder(
                this.workflowStepsRows,
                (rows) => { this.workflowStepsRows = rows; }
              )}
            </div>
          </div>
        ` : ''}
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Key</th><th>Parallel</th><th>Policy</th><th>Active</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${this.workflows.map((workflow) => {
                const steps = this._parseSteps(this._getWorkflowEdit(workflow, 'steps'));
                return html`
                  <tr>
                    <td><input class="input mono row-key-input" type="text"
                      .value=${this._getWorkflowEdit(workflow, 'key')}
                      ?disabled=${this.saving}
                      @input=${(e) => this._setWorkflowEdit(workflow.id, 'key', e.target.value || '')} /></td>
                    <td><input class="input row-number-input" type="number" min="1" max="64"
                      .value=${this._getWorkflowEdit(workflow, 'max_parallel_steps')}
                      ?disabled=${this.saving}
                      @input=${(e) => this._setWorkflowEdit(workflow.id, 'max_parallel_steps', e.target.value || '')} /></td>
                    <td>
                      <select class="select" ?disabled=${this.saving}
                        @change=${(e) => this._setWorkflowEdit(workflow.id, 'failure_policy', e.target.value || 'fail_fast')}>
                        <option value="fail_fast" ?selected=${this._getWorkflowEdit(workflow, 'failure_policy') === 'fail_fast'}>fail_fast</option>
                        <option value="continue" ?selected=${this._getWorkflowEdit(workflow, 'failure_policy') === 'continue'}>continue</option>
                      </select>
                    </td>
                    <td><input type="checkbox"
                      .checked=${!!this._getWorkflowEdit(workflow, 'is_active')}
                      ?disabled=${this.saving}
                      @change=${(e) => this._setWorkflowEdit(workflow.id, 'is_active', !!e.target.checked)} /></td>
                    <td>
                      <div class="row">
                        <button class="btn btn-primary btn-sm"
                          ?disabled=${this.saving || !this._hasWorkflowChanged(workflow)}
                          @click=${() => this._saveWorkflow(workflow)}>Save</button>
                        <button class="btn btn-danger btn-sm" ?disabled=${this.saving}
                          @click=${() => this._deleteWorkflow(workflow)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td colspan="5">
                      <input class="input" style="width:100%;" type="text"
                        placeholder="description"
                        .value=${this._getWorkflowEdit(workflow, 'description')}
                        ?disabled=${this.saving}
                        @input=${(e) => this._setWorkflowEdit(workflow.id, 'description', e.target.value || '')} />
                    </td>
                  </tr>
                  <tr>
                    <td colspan="5">
                      <div class="muted" style="margin-bottom:4px;">steps</div>
                      ${this._renderStepBuilder(
                        steps,
                        (newSteps) => this._setWorkflowEdit(workflow.id, 'steps', JSON.stringify(newSteps))
                      )}
                    </td>
                  </tr>
                `;
              })}
              ${!this.workflows.length ? html`<tr><td colspan="5" class="muted">${this.loading ? 'Loading…' : 'No workflows found.'}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  _renderCliDocs(cli) {
    if (!cli) return html`<div class="cli-docs muted">No CLI command found for this key.</div>`;
    const params = (cli.queue_params || []).filter((p) => p.name !== 'tenant_id');
    return html`
      <div class="cli-docs">
        ${cli.help ? html`<div class="cli-docs-help">${cli.help}</div>` : ''}
        ${cli.usage ? html`<div class="cli-docs-usage">${cli.usage}</div>` : ''}
        ${params.length ? html`
          <table class="cli-params-table">
            <thead>
              <tr><th>Param</th><th>Type</th><th>Default</th><th>Description</th></tr>
            </thead>
            <tbody>
              ${params.map((p) => html`
                <tr>
                  <td>
                    <span class="param-name">${p.name}</span>
                    ${p.required ? html` <span class="param-required">required</span>` : ''}
                  </td>
                  <td class="param-type">
                    ${p.choices ? p.choices.join(' | ') : p.input_type}
                  </td>
                  <td class="param-default">
                    ${p.default !== null && p.default !== undefined ? String(p.default) : '—'}
                  </td>
                  <td class="muted">${p.help || '—'}</td>
                </tr>
              `)}
            </tbody>
          </table>
        ` : html`<div class="muted">No overridable parameters.</div>`}
      </div>
    `;
  }

  _renderDefinitions() {
    return html`
      <div class="section">
        <div class="row" style="margin-bottom:10px;">
          <h3 class="section-title" style="margin:0;flex:1;">Jobs</h3>
          <label class="row muted">
            <input type="checkbox" .checked=${this.includeInactiveDefinitions} @change=${async (e) => { this.includeInactiveDefinitions = !!e.target.checked; await this._loadConfig(); }} />
            include inactive
          </label>
        </div>
        <div style="margin-bottom:10px;">
          <button class="btn btn-secondary btn-sm" @click=${() => { this.showAddDefinition = !this.showAddDefinition; }}>
            ${this.showAddDefinition ? 'Cancel' : '+ Add'}
          </button>
        </div>
        ${this.showAddDefinition ? html`
          <div class="add-form">
            <div class="row">
              <input class="input field" type="text" placeholder="key" .value=${this.definitionKey} @input=${(e) => { this.definitionKey = e.target.value || ''; }} />
              <input class="input field" type="number" min="1" placeholder="timeout seconds" .value=${this.definitionTimeoutSeconds} @input=${(e) => { this.definitionTimeoutSeconds = e.target.value || ''; }} />
              <input class="input field" type="number" min="1" placeholder="max attempts" .value=${this.definitionMaxAttempts} @input=${(e) => { this.definitionMaxAttempts = e.target.value || ''; }} />
              <label class="row muted"><input type="checkbox" .checked=${this.definitionActive} @change=${(e) => { this.definitionActive = !!e.target.checked; }} /> active</label>
              <button class="btn btn-primary" ?disabled=${this.saving} @click=${this._createDefinition}>Create</button>
            </div>
            <div class="row" style="margin-top:8px;">
              <input class="input field-wide" type="text" placeholder="description" .value=${this.definitionDescription} @input=${(e) => { this.definitionDescription = e.target.value || ''; }} />
            </div>
          </div>
        ` : ''}
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Key</th><th>Timeout (s)</th><th>Max attempts</th><th>Active</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${this.definitions.map((definition) => html`
                <tr>
                  <td><input class="input mono row-key-input" type="text" .value=${this._getDefinitionEdit(definition, 'key')} ?disabled=${this.saving} @input=${(e) => this._setDefinitionEdit(definition.id, 'key', e.target.value || '')} /></td>
                  <td><input class="input row-number-input" type="number" min="1" max="86400" .value=${this._getDefinitionEdit(definition, 'timeout_seconds')} ?disabled=${this.saving} @input=${(e) => this._setDefinitionEdit(definition.id, 'timeout_seconds', e.target.value || '')} /></td>
                  <td><input class="input row-number-input" type="number" min="1" max="100" .value=${this._getDefinitionEdit(definition, 'max_attempts')} ?disabled=${this.saving} @input=${(e) => this._setDefinitionEdit(definition.id, 'max_attempts', e.target.value || '')} /></td>
                  <td><input type="checkbox" .checked=${!!definition.is_active} ?disabled=${this.saving} @change=${(e) => this._toggleDefinition(definition, !!e.target.checked)} /></td>
                  <td>
                    <div class="row">
                      <button class="btn btn-primary btn-sm" ?disabled=${this.saving || !this._hasDefinitionChanged(definition)} @click=${() => this._saveDefinition(definition)}>Save</button>
                      <button class="btn btn-danger btn-sm" ?disabled=${this.saving} @click=${() => this._deleteDefinition(definition)}>Delete</button>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td colspan="5">
                    <div style="display:flex;gap:8px;align-items:center;">
                      <input class="input" style="flex:1;min-width:0;" type="text" .value=${this._getDefinitionEdit(definition, 'description')} ?disabled=${this.saving} @input=${(e) => this._setDefinitionEdit(definition.id, 'description', e.target.value || '')} />
                      <button class="btn-docs" @click=${() => this._toggleDefinitionDocs(definition.id)}>${this.definitionDocsOpen[definition.id] ? 'Hide docs' : 'Docs'}</button>
                    </div>
                  </td>
                </tr>
                ${this.definitionDocsOpen[definition.id] ? html`
                  <tr>
                    <td colspan="5">${this._renderCliDocs(definition.cli_command)}</td>
                  </tr>
                ` : ''}
              `)}
              ${!this.definitions.length ? html`<tr><td colspan="5" class="muted">${this.loading ? 'Loading…' : 'No jobs found.'}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  async _loadAllWorkflowRuns() {
    this.allWorkflowRunsLoading = true;
    try {
      const result = await getAllWorkflowRuns({ limit: 100 });
      this.allWorkflowRuns = Array.isArray(result?.runs) ? result.runs : [];
    } catch (error) {
      this._setError(error?.message || 'Failed to load workflow runs');
    } finally {
      this.allWorkflowRunsLoading = false;
    }
  }

  _renderQueue() {
    const statusBadge = (status) => {
      const colors = {
        completed: 'background:#dcfce7;color:#166534',
        failed: 'background:#fee2e2;color:#991b1b',
        running: 'background:#dbeafe;color:#1e40af',
        pending: 'background:#f3f4f6;color:#374151',
        cancelled: 'background:#fef9c3;color:#854d0e',
      };
      const style = colors[status] || colors.pending;
      return html`<span style="display:inline-block;padding:2px 7px;border-radius:9999px;font-size:11px;font-weight:600;${style}">${status}</span>`;
    };

    return html`
      <div class="section">
        <div class="row" style="margin-bottom:10px;">
          <h3 class="section-title" style="margin:0;flex:1;">All Workflow Runs</h3>
          <button class="btn btn-secondary btn-sm" @click=${() => this._loadAllWorkflowRuns()}>
            ${this.allWorkflowRunsLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tenant</th>
                <th>Workflow</th>
                <th>Status</th>
                <th>Queued At</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              ${this.allWorkflowRunsLoading ? html`
                <tr><td colspan="5" class="muted" style="text-align:center;padding:16px;">Loading…</td></tr>
              ` : this.allWorkflowRuns.length === 0 ? html`
                <tr><td colspan="5" class="muted" style="text-align:center;padding:16px;">No workflow runs found.</td></tr>
              ` : this.allWorkflowRuns.map((run) => html`
                <tr>
                  <td class="mono">${run.tenant_name || run.tenant_id}</td>
                  <td class="mono">${run.workflow_key}</td>
                  <td>${statusBadge(run.status)}</td>
                  <td class="muted">${run.queued_at ? new Date(run.queued_at).toLocaleString() : '—'}</td>
                  <td class="muted" style="max-width:260px;word-break:break-word;">${run.error_text || ''}</td>
                </tr>
              `)}
            </tbody>
          </table>
        </div>
      </div>
      <div class="section" style="margin-top:14px;">
        <h3 class="section-title">Drill into Tenant</h3>
        <div class="row">
          <select class="select field" .value=${this.selectedTenantId} @change=${(e) => { this.selectedTenantId = e.target.value || ''; }}>
            <option value="">— select tenant —</option>
            ${this.tenants.map((tenant) => html`<option value=${tenant.id}>${tenant.identifier || tenant.name || tenant.id}</option>`)}
          </select>
        </div>
        ${this.selectedTenantId ? html`
          <div style="margin-top:10px;">
            <library-jobs-admin .tenant=${this.selectedTenantId} .isSuperAdmin=${true}></library-jobs-admin>
          </div>
        ` : ''}
      </div>
    `;
  }
}

customElements.define('admin-jobs', AdminJobs);

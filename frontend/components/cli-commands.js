import { LitElement, html, css } from 'lit';
import { tailwind } from './tailwind-lit.js';

class CliCommands extends LitElement {
  static styles = [tailwind, css`
    :host {
      display: block;
    }
    .command-card {
      border: 1px solid #e5e7eb;
      border-radius: 0.75rem;
      padding: 1rem;
      background: #fff;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    .command-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      justify-content: space-between;
    }
    .command-usage {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 0.5rem;
      padding: 0.75rem;
      font-size: 12px;
      white-space: pre-wrap;
      color: #374151;
    }
    .command-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .meta-chip {
      background: #f3f4f6;
      border: 1px solid #e5e7eb;
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 11px;
      color: #6b7280;
    }
    .option-grid {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .option-row {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 12px;
      padding: 8px 10px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f8fafc;
    }
    .option-name {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      color: #111827;
    }
    .option-desc {
      font-size: 12px;
      color: #4b5563;
      line-height: 1.4;
    }
    .option-badges {
      display: inline-flex;
      gap: 6px;
      margin-left: 8px;
      font-size: 10px;
      color: #6b7280;
    }
    @media (max-width: 640px) {
      .option-row {
        grid-template-columns: 1fr;
      }
    }
  `];

  static properties = {
    commands: { type: Array },
    isLoading: { type: Boolean },
    error: { type: String },
  };

  constructor() {
    super();
    this.commands = [];
    this.isLoading = false;
    this.error = '';
  }

  connectedCallback() {
    super.connectedCallback();
    this._fetchCommands();
  }

  async _fetchCommands() {
    this.isLoading = true;
    this.error = '';
    try {
      const response = await fetch('/api/v1/config/cli-commands');
      if (!response.ok) {
        throw new Error('Failed to load CLI commands');
      }
      const data = await response.json();
      this.commands = data.commands || [];
    } catch (error) {
      console.error('CLI commands error:', error);
      this.error = 'Unable to load CLI commands.';
    } finally {
      this.isLoading = false;
    }
  }

  async _copyUsage(command) {
    const usage = command.usage || `photocat ${command.name}`;
    try {
      await navigator.clipboard.writeText(usage);
    } catch (error) {
      console.warn('Failed to copy CLI usage', error);
    }
  }

  render() {
    return html`
      <div class="max-w-5xl mx-auto">
        <div class="mb-4">
          <h2 class="text-xl font-semibold text-gray-800">CLI Commands</h2>
          <p class="text-sm text-gray-500">Copy and run CLI commands from the latest code.</p>
        </div>

        ${this.error ? html`<div class="text-sm text-red-600 mb-4">${this.error}</div>` : ''}
        ${this.isLoading ? html`<div class="text-sm text-gray-500 mb-4">Loading commands...</div>` : ''}

        <div class="space-y-4">
          ${this.commands.map((command) => {
            const options = command.params || [];
            const optionCount = options.length;
            const requiredCount = options.filter((param) => param.required).length;
            const usage = command.usage || `photocat ${command.name}`;
            return html`
            <div class="command-card">
              <div class="command-header">
                <div>
                  <div class="text-sm text-gray-500 uppercase">Command</div>
                  <div class="text-lg font-semibold text-gray-900">photocat ${command.name}</div>
                </div>
                <button
                  class="text-xs text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50"
                  @click=${() => this._copyUsage(command)}
                >
                  Copy
                </button>
              </div>
              ${command.help ? html`<div class="text-sm text-gray-500 mt-1">${command.help}</div>` : html``}
              <div class="command-usage mt-3">${usage}</div>
              <div class="command-meta">
                <span class="meta-chip">${optionCount} option${optionCount === 1 ? '' : 's'}</span>
                <span class="meta-chip">${requiredCount} required</span>
              </div>
              ${options.length ? html`
                <div class="option-grid">
                  ${options.map((param) => {
                    const label = param.param_type === 'option'
                      ? (param.opts && param.opts.length ? param.opts.join(', ') : param.name)
                      : param.name;
                    const badges = [];
                    badges.push(param.required ? 'required' : 'optional');
                    if (param.default !== null && param.default !== undefined && param.default !== '') {
                      badges.push(`default: ${param.default}`);
                    }
                    if (param.nargs !== null && param.nargs !== undefined && param.nargs !== 1) {
                      badges.push(`nargs: ${param.nargs}`);
                    }
                    return html`
                      <div class="option-row">
                        <div class="option-name">
                          ${label}
                          <span class="option-badges">${badges.join(' · ')}</span>
                        </div>
                        <div class="option-desc">${param.help || 'No description provided.'}</div>
                      </div>
                    `;
                  })}
                </div>
              ` : html`<div class="text-xs text-gray-400 mt-3">No options.</div>`}
            </div>
          `;
          })}
        </div>
      </div>
    `;
  }
}

customElements.define('cli-commands', CliCommands);

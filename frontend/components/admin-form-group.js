import { LitElement, html, css } from 'lit';

/**
 * Admin Form Group Component
 * Reusable form input wrapper with label and helper text
 */
export class AdminFormGroup extends LitElement {
  static properties = {
    label: { type: String },
    type: { type: String },
    value: { type: String },
    placeholder: { type: String },
    required: { type: Boolean },
    disabled: { type: Boolean },
    readonly: { type: Boolean },
    helperText: { type: String },
    isCheckbox: { type: Boolean },
    checked: { type: Boolean }
  };

  static styles = css`
    :host {
      display: block;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-group.checkbox {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 0;
    }

    .form-group.checkbox label {
      margin-bottom: 0;
    }

    .form-group.checkbox input[type='checkbox'] {
      width: auto;
      margin: 0;
    }

    label {
      display: block;
      margin-bottom: 5px;
      font-weight: 500;
      color: #495057;
      font-size: 14px;
    }

    input,
    select,
    textarea {
      width: 100%;
      padding: 10px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
      font-family: inherit;
    }

    input:focus,
    select:focus,
    textarea:focus {
      outline: none;
      border-color: #007bff;
      box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
    }

    input:disabled,
    select:disabled,
    textarea:disabled {
      background: #f8f9fa;
      cursor: not-allowed;
    }

    input[type='checkbox'] {
      width: auto;
    }

    small {
      display: block;
      margin-top: 4px;
      color: #666;
      font-size: 12px;
    }
  `;

  constructor() {
    super();
    this.label = '';
    this.type = 'text';
    this.value = '';
    this.placeholder = '';
    this.required = false;
    this.disabled = false;
    this.readonly = false;
    this.helperText = '';
    this.isCheckbox = false;
    this.checked = false;
  }

  handleInput(e) {
    this.value = e.target.value;
    this.dispatchEvent(
      new CustomEvent('input-changed', {
        detail: { value: this.value },
        bubbles: true,
        composed: true
      })
    );
  }

  handleCheckboxChange(e) {
    this.checked = e.target.checked;
    this.dispatchEvent(
      new CustomEvent('checkbox-changed', {
        detail: { checked: this.checked },
        bubbles: true,
        composed: true
      })
    );
  }

  render() {
    if (this.isCheckbox) {
      return html`
        <div class="form-group checkbox">
          <input
            type="checkbox"
            ?checked="${this.checked}"
            ?disabled="${this.disabled}"
            @change="${this.handleCheckboxChange}"
          />
          <label>${this.label}</label>
        </div>
      `;
    }

    return html`
      <div class="form-group">
        ${this.label
          ? html`<label
              >${this.label}
              ${this.required ? html`<span>*</span>` : ''}</label
            >`
          : ''}
        ${this.type === 'textarea'
          ? html`<textarea
              ?required="${this.required}"
              ?disabled="${this.disabled}"
              ?readonly="${this.readonly}"
              placeholder="${this.placeholder}"
              @input="${this.handleInput}"
            >
${this.value}</textarea
            >`
          : this.type === 'select'
            ? html`<select
                .value="${this.value}"
                ?required="${this.required}"
                ?disabled="${this.disabled}"
                @change="${this.handleInput}"
              >
              <slot></slot>
            </select>`
            : html`<input
                type="${this.type}"
                .value="${this.value}"
                placeholder="${this.placeholder}"
                ?required="${this.required}"
                ?disabled="${this.disabled}"
                ?readonly="${this.readonly}"
                @input="${this.handleInput}"
              />`}
        ${this.helperText
          ? html`<small>${this.helperText}</small>`
          : ''}
      </div>
    `;
  }
}

customElements.define('admin-form-group', AdminFormGroup);

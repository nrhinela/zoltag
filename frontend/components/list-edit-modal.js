import { LitElement, html } from 'lit';

class ListEditModal extends LitElement {
  static properties = {
    list: { type: Object },
    active: { type: Boolean, reflect: true },
  };

  constructor() {
    super();
    this.list = null;
    this.active = false;
  }

  createRenderRoot() {
    return this;
  }

  _handleSave(e) {
    e.preventDefault();
    const titleInput = this.querySelector('#title');
    const descriptionInput = this.querySelector('#description');
    const title = String(titleInput?.value || '').trim();
    const description = String(descriptionInput?.value || '');
    if (!title) {
      return;
    }
    const updatedList = { ...this.list, title, notebox: description };
    this.dispatchEvent(new CustomEvent('save-list', { detail: updatedList }));
  }

  _handleCancel() {
    this.dispatchEvent(new CustomEvent('close-modal'));
  }

  render() {
    if (!this.active || !this.list) {
      return html``;
    }

    return html`
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click=${this._handleCancel}>
        <div class="w-full max-w-[500px] rounded-lg bg-white p-5 shadow-xl" @click=${(e) => e.stopPropagation()}>
          <h3 class="mb-2 text-xl font-bold text-gray-900">Edit List</h3>
          <form @submit=${this._handleSave}>
            <div class="mb-4">
              <label for="title" class="mb-2 block font-bold text-gray-700">Title</label>
              <input
                id="title"
                class="w-full rounded-lg border border-gray-300 p-2"
                .value=${this.list.title || ''}
                required
              >
            </div>
            <div class="mb-4">
              <label for="description" class="mb-2 block font-bold text-gray-700">Notes</label>
              <textarea
                id="description"
                class="w-full rounded-lg border border-gray-300 p-2"
                .value=${this.list.notebox || ''}
              ></textarea>
            </div>
            <div class="flex justify-end">
              <button
                @click=${this._handleCancel}
                type="button"
                class="mr-2 rounded-lg border border-gray-400 px-4 py-2 text-gray-700 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </form>
        </div>
      </div>
    `;
  }
}

customElements.define('list-edit-modal', ListEditModal);

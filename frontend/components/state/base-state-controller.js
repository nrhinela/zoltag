/**
 * Base State Controller
 *
 * Uses Lit's ReactiveController pattern for managing component state.
 * All tab-specific state controllers should extend this class.
 *
 * Benefits:
 * - Automatic lifecycle integration (hostConnected, hostDisconnected)
 * - Built-in requestUpdate() via host.requestUpdate()
 * - Standard Lit pattern developers already know
 * - Less custom code to maintain
 */
export class BaseStateController {
  /**
   * @param {LitElement} host - The host component (zoltag-app)
   */
  constructor(host) {
    this.host = host;
    host.addController(this);
  }

  /**
   * Called when the host component connects to the DOM.
   * Override in subclasses to add initialization logic.
   */
  hostConnected() {
    // Subclasses can override for setup
  }

  /**
   * Called when the host component disconnects from the DOM.
   * Override in subclasses to add cleanup logic.
   */
  hostDisconnected() {
    // Subclasses can override for cleanup
  }

  /**
   * Request a re-render of the host component.
   */
  requestUpdate() {
    this.host.requestUpdate();
  }

  /**
   * Dispatch a custom event from the host component.
   * @param {string} eventName - The name of the event
   * @param {*} detail - The event detail payload
   */
  dispatch(eventName, detail) {
    this.host.dispatchEvent(new CustomEvent(eventName, {
      detail,
      bubbles: true,
      composed: true
    }));
  }

  /**
   * Execute an async function while managing a loading state property.
   * @param {string} loadingProp - The property name to set to true during loading
   * @param {Function} asyncFn - The async function to execute
   * @returns {Promise<*>} The result of the async function
   */
  async withLoading(loadingProp, asyncFn) {
    this.host[loadingProp] = true;
    this.requestUpdate();
    try {
      return await asyncFn();
    } finally {
      this.host[loadingProp] = false;
      this.requestUpdate();
    }
  }

  /**
   * Get a property value from the host component.
   * @param {string} propName - The property name
   * @returns {*} The property value
   */
  getHostProperty(propName) {
    return this.host[propName];
  }

  /**
   * Set a property value on the host component and request update.
   * @param {string} propName - The property name
   * @param {*} value - The new value
   */
  setHostProperty(propName, value) {
    this.host[propName] = value;
    this.requestUpdate();
  }

  /**
   * Set multiple properties on the host component at once.
   * @param {Object} updates - Object with property names and values
   */
  setHostProperties(updates) {
    Object.entries(updates).forEach(([key, value]) => {
      this.host[key] = value;
    });
    this.requestUpdate();
  }
}

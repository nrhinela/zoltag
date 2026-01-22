/**
 * PhotoCat Admin Application Entry Point
 * Loads and mounts the admin application Lit component
 */

import './components/admin-app.js';

// Mount the admin application
const app = document.createElement('admin-app');
document.body.appendChild(app);

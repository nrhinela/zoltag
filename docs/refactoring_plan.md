# Refactoring Plan: Migrating to a Component-Based Architecture with Lit

**Objective:** Refactor the frontend of the PhotoCat application to improve maintainability, scalability, and developer experience by migrating from a single HTML file with inline JavaScript to a modern, component-based architecture using the Lit library.

### 1. Current State Analysis

The current frontend is a single `index.html` file with the following characteristics:

*   **Monolithic Structure:** All HTML, CSS, and JavaScript are in one file.
*   **Inline JavaScript:** Thousands of lines of JavaScript are embedded in `<script>` tags.
*   **Global State:** Application state is managed through global variables, leading to unpredictability.
*   **Manual DOM Manipulation:** UI updates are performed by directly manipulating the DOM and building HTML strings, which is error-prone and inefficient.
*   **Lack of Componentization:** UI elements are not reusable, leading to code duplication.
*   **No Build Process:** The application lacks a modern development workflow for optimization and code quality.

### 2. Proposed Solution: Lit-Based Component Architecture

We will refactor the application using **Lit**, a lightweight library for building fast, lightweight web components. This will allow us to:

*   **Create Reusable Components:** Break down the UI into small, self-contained components (e.g., `<image-card>`, `<search-bar>`, `<modal-dialog>`).
*   **Adopt Declarative Rendering:** Use Lit's `html` template literals to define the UI based on application state, letting the library handle efficient DOM updates.
*   **Isolate Logic and State:** Encapsulate the logic and state within the components that need them.
*   **Introduce a Modern Build Process:** Use a tool like Vite to provide a development server, code bundling, and other modern development features.

### 3. Project Phases

#### Phase 1: Setup and Initial Componentization

1.  **Set up the Development Environment:**
    *   Initialize a new `package.json` file.
    *   Install Vite, Lit, ESLint, and Prettier.
    *   Configure Vite to serve a new `index.html` as the main entry point.
    *   Create a new directory structure (e.g., `src/components`, `src/services`).

2.  **Create the First Component:**
    *   Identify a small, self-contained piece of the UI to start with, such as the `image-card`.
    *   Create a new Lit component (`<image-card>`).
    *   Move the HTML structure and related logic from the original `index.html` into the new component.

3.  **Integrate the Component:**
    *   Modify the existing JavaScript to render the new `<image-card>` component instead of building an HTML string.

#### Phase 2: Incremental Refactoring

1.  **Componentize the Main UI Elements:**
    *   Gradually convert major sections of the UI into Lit components:
        *   Image Gallery (`<image-gallery>`)
        *   Navigation and Header (`<app-header>`)
        *   Modals (`<image-modal>`, `<upload-modal>`)

2.  **Abstract Services:**
    *   Create a dedicated API service (`src/services/api.js`) to handle all `fetch` requests to the backend.
    *   Update components to use the API service instead of making direct `fetch` calls.

3.  **State Management:**
    *   Manage component-local state using Lit's reactive properties.
    *   For shared state (e.g., current tenant, search query), we will start with simple property passing and custom events. If needed, we can introduce a more robust state management solution later.

#### Phase 3: Finalization

1.  **Decommission the Old Structure:**
    *   Once all UI elements have been migrated to Lit components, we can remove the old, monolithic `index.html` and its inline JavaScript.

2.  **Build and Deploy:**
    *   Update the `cloudbuild.yaml` file to include the new frontend build process. The build will now involve running `vite build` to produce optimized assets.

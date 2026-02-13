# Zoltag

This application is a web based utility to assist Dropbox owners in categorizing and organizting  photos, using a combination of automated and manual tagging.

## Features

- **Multi-Tenant**: Isolated configurations and data per client
- **Image Processing**: Efficient handling of various formats (JPEG, PNG, HEIC, RAW)
- **Smart Metadata**: EXIF extraction, visual features, facial recognition
- **Controlled Vocabularies**: Configurable keywords and people per tenant
- **Flexible Search**: Text, visual similarity, date range, location-based
- **Cost-Optimized**: Intelligent caching and selective AI processing
- **Cloud-Native**: Built for Google Cloud Platform

## Architecture

#### Overview
The Zoltag frontend is built using a modern, component-based architecture with Lit, providing a scalable and maintainable foundation for the application.

#### Core Backend Architecture

Backend Architecture Summary
Project Configuration and Dependencies
The Zoltag backend is built using Python 3.11 with a comprehensive dependency management system defined in pyproject.toml. The project leverages modern Python packaging with FastAPI as the primary web framework, providing automatic OpenAPI documentation and type safety through Pydantic. The dependency tree includes essential packages for cloud integration (Google Cloud Storage, Secret Manager, Tasks), database operations (SQLAlchemy, PostgreSQL), and image processing (Pillow, OpenCV, piexif). Additional specialized libraries support machine learning capabilities (sentence-transformers, imagehash), search functionality (Whoosh), and utility operations (PyYAML, HTTPX, Click).

Core Architecture Components
The backend follows a modular structure organized around key functional areas including API endpoints, database models, configuration management, and image processing capabilities. The architecture supports multi-tenant image organization with dedicated services for handling Dropbox integrations, metadata extraction, and search functionality. Key components include authentication systems, image processing pipelines, and data synchronization mechanisms that work together to provide a comprehensive image management solution.

Technology Stack and Features
The backend utilizes a robust technology stack that combines web development (FastAPI), database management (PostgreSQL with SQLAlchemy), and cloud services (Google Cloud Platform). The architecture incorporates modern development practices including containerization support, comprehensive testing frameworks (pytest, coverage), and development tooling (black, ruff, mypy). The system supports advanced features like image recognition, semantic search through sentence transformers, and efficient image processing workflows while maintaining scalability through proper database design and caching mechanisms.







#### Core Frontend Architecture


- Lit-based Web Components: All UI elements are implemented as reusable Lit components using Light DOM (not Shadow DOM)
- Modular Organization: Components are organized in a structured directory with clear separation of concerns
- Declarative Rendering: UI is defined using Lit's html template literals with automatic DOM updates based on component state
- Tailwind CSS: Components use Tailwind utility classes directly via Light DOM rendering
####  Development Workflow
- Modern Build Process: Powered by Vite for development server, code bundling, and optimization
- ESLint & Prettier: Integrated for code quality and consistent formatting
- TypeScript Support: Enhanced type safety and developer experience
#### Data Management
- Component-local State: Each component manages its own reactive state using Lit's property system
- Service Layer: Dedicated API service handles all backend communication
- State Propagation: Shared state is managed through property passing and custom events between components
##### File Structure
```
src/
├── components/          # Reusable Lit components
│   ├── image-card.js
│   ├── image-gallery.js
│   ├── filter-controls.js
│   └── ...
├── services/          # API and utility services
│   └── api.js
├── assets/            # Static assets
└── main.js            # Application entry point

```

Key Architectural Components:
Web Framework: At its core, the backend uses FastAPI, a high-performance web framework for building APIs with Python. It leverages Python's asyncio for asynchronous request handling, enabling high concurrency.

Database: The application uses a relational database, with SQLAlchemy as the Object-Relational Mapper (ORM). Alembic is used to manage database schema migrations, allowing for evolutionary changes to the database structure.

Multi-Tenant Design: The system is designed as a multi-tenant application, where a single instance of the application serves multiple tenants (customers). A X-Tenant-ID header is used to distinguish requests from different tenants, ensuring data isolation.

Cloud Services Integration:

Google Cloud Storage (GCS): Used for storing and serving large binary files, such as image thumbnails.
Google Cloud Secret Manager: All sensitive data, including API keys and database credentials, is securely stored in Secret Manager.
Dropbox API: The application integrates with Dropbox to allow users to connect their accounts and sync their photos.
Image Processing and AI:

A dedicated ImageProcessor module handles image-related tasks like creating thumbnails and extracting metadata.

The application uses machine learning models (e.g., CLIP, SigLIP) for automatic image tagging, implemented in the tagging module.

Deployment: The application is containerized using Docker, and deployment is automated with Google Cloud Build. This setup facilitates continuous integration and deployment to cloud platforms like Google Cloud Run or Kubernetes Engine.

Configuration Management: Application settings are managed through a centralized settings module, which loads configuration from environment variables. This follows the twelve-factor app methodology.


#### Core values
Maintainability: Small, focused components are easy to understand and modify
- Reusability: Components can be composed and reused throughout the application
-  Performance: Efficient DOM updates through Lit's reactive system
- Scalable Architecture: Clear separation of concerns supports future feature additions
- Developer Experience: Modern tooling and component-based development workflow
- This architecture provides a solid foundation for continued development and maintenance of the Zoltag frontend.

#### Component Pattern: Light DOM + Tailwind

**All LitElement components use Light DOM** to maintain access to Tailwind CSS classes:

```javascript
export class MyComponent extends LitElement {
  createRenderRoot() {
    return this; // Render to Light DOM, not Shadow DOM
  }

  render() {
    return html`
      <div class="grid grid-cols-2 gap-4">
        <!-- Tailwind classes work directly -->
      </div>
    `;
  }
}
```

This approach provides:
- ✅ Component encapsulation (logic, props, events)
- ✅ Direct use of Tailwind classes without CSS translation
- ✅ Simplified development (no scoped CSS needed)
- ✅ Consistent styling with parent application

See `frontend/components/curate-home-tab.js` for reference implementation.

## Setup

### Prerequisites
- Python 3.11+
- Google Cloud SDK
- PostgreSQL database (Supabase recommended)
- Dropbox App credentials

### Development Environment

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -e ".[dev]"

# Set DATABASE_URL for your database
export DATABASE_URL=postgresql://...

# Run migrations
DATABASE_URL="$DATABASE_URL" alembic upgrade head

# Run tests
pytest

# Format code
black . && ruff check .
```


## Deployment

The preferred method for deploying the application is using the provided `Makefile`, which simplifies the process and ensures all steps are followed correctly. For a comprehensive guide on deployment, database migrations, and other operational tasks, please see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Supabase Connection

Zoltag expects `DATABASE_URL` to be set for both local and production use.
If your network is IPv4-only, use the Supabase **Session Pooler** connection
string (IPv4-compatible) and append `?sslmode=require`.

Example:

```bash
export DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@YOUR_POOLER_HOST:5432/postgres?sslmode=require"
```


## License

Proprietary

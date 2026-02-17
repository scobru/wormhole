## 2024-05-23 - Shared Environment Variables
**Vulnerability:** Environment variables prefixed with `VITE_` (e.g., `VITE_AUTH_TOKEN`) are shared between the backend CLI and the frontend.
**Learning:** The project uses `VITE_` prefix for secrets that are used in both the CLI (`src/index.js`) and the frontend (`web`). This means these secrets are exposed to the client-side bundle in the frontend, which is a potential security risk if they are intended to be private server-side secrets.
**Prevention:** Ensure that only truly public or client-side safe configuration uses the `VITE_` prefix. Sensitive backend-only secrets should not use this prefix to avoid accidental exposure in the frontend build.

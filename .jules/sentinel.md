## 2025-05-20 - Shared Secrets in Frontend

**Vulnerability:** The `VITE_AUTH_TOKEN` is used in both the CLI (`src/index.js`) and the Frontend (`web/src/main.js`). This exposes the authentication token to any user who can view the frontend source code.
**Learning:** The application relies on client-side secrets for authentication with the relay server.
**Prevention:** Do not expose sensitive secrets in frontend code. Use backend-for-frontend (BFF) pattern or individual user authentication.

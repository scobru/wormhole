## 2025-05-20 - Shared Secrets in Frontend

**Vulnerability:** The `VITE_AUTH_TOKEN` is used in both the CLI (`src/index.js`) and the Frontend (`web/src/main.js`). This exposes the authentication token to any user who can view the frontend source code.
**Learning:** The application relies on client-side secrets for authentication with the relay server.
**Prevention:** Do not expose sensitive secrets in frontend code. Use backend-for-frontend (BFF) pattern or individual user authentication.

## 2025-05-20 - Path Traversal in CLI Downloads

**Vulnerability:** The CLI tool accepted arbitrary filenames from the sender and used them directly in `fs.writeFileSync`. This allowed a malicious sender to overwrite files outside the current directory (Path Traversal).
**Learning:** Input from P2P peers (even metadata like filenames) must be treated as untrusted user input.
**Prevention:** Always sanitize filenames using `path.basename()` before using them in filesystem operations.

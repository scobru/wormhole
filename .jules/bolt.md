## 2024-10-25 - Avoid Double Buffering with Response.blob().arrayBuffer()
**Learning:** Using `await new Response(stream).blob()` followed by `await blob.arrayBuffer()` causes double memory allocation and copying.
**Action:** Use `await new Response(stream).arrayBuffer()` directly when the buffer is needed, skipping the intermediate Blob creation.

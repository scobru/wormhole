## 2024-10-25 - Avoid Double Buffering with Response.blob().arrayBuffer()
**Learning:** Using `await new Response(stream).blob()` followed by `await blob.arrayBuffer()` causes double memory allocation and copying.
**Action:** Use `await new Response(stream).arrayBuffer()` directly when the buffer is needed, skipping the intermediate Blob creation.

## 2024-05-23 - Avoid Blob to Buffer Conversion in Node
**Learning:** Converting a Blob to an ArrayBuffer and then to a Buffer in Node.js (via `Buffer.from(await blob.arrayBuffer())`) involves unnecessary copying when the source data is already available as an ArrayBuffer.
**Action:** In shared code used by both Browser and Node, pass the underlying ArrayBuffer alongside the Blob in the result object. The Node consumer can use the buffer directly, while the Browser consumer can use the Blob.

## 2024-05-27 - Stream Wrapping Overhead
**Learning:** Wrapping a native `ReadableStream` in a custom `ReadableStream` solely for progress tracking adds significant overhead (approx 2x slower) due to frequent JS/Native boundary crossing and object creation.
**Action:** Read from the native stream reader directly in a loop and calculate progress manually, avoiding the wrapper stream entirely.

// Container healthcheck for distroless images (no shell/curl available).
const port = process.env.PORT ?? '8080';
try {
  const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}

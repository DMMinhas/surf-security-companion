try {
  const res = await fetch('http://127.0.0.1:8081/', { signal: AbortSignal.timeout(3000) });
  process.exit(res.ok ? 0 : 1);
} catch {
  process.exit(1);
}

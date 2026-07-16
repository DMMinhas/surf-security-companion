import { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });

/** Renders a Mermaid definition (e.g. case investigation flow) safely. */
export default function MermaidDiagram({ definition }: { definition: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId().replaceAll(':', '-');

  useEffect(() => {
    let cancelled = false;
    mermaid
      .render(`mermaid-${id}`, definition)
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg;
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [definition, id]);

  if (error) {
    return (
      <pre role="alert" className="rounded bg-red-50 p-2 text-xs text-severity-critical">
        Diagram error: {error}
      </pre>
    );
  }
  return <div ref={containerRef} role="img" aria-label="Case investigation flow diagram" />;
}

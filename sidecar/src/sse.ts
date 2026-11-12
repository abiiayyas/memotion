/** The one method of Hono's SSE stream this needs. */
interface Writable {
  write(chunk: string): Promise<unknown>;
}

/** A comment line is ignored by every SSE parser (ours reads only `data:` blocks) but counts as bytes on the wire. */
const COMMENT = ": keepalive\n\n";

/**
 * A coding agent can think for minutes without producing an event, and a stream that carries no bytes for a while
 * is dropped by the WebView's network layer (WebKit reports it as "Load failed"). Writes a comment every `ms`
 * until the returned function is called.
 */
export function keepAlive(stream: Writable, ms = 15_000): () => void {
  const timer = setInterval(() => {
    stream.write(COMMENT).catch(() => clearInterval(timer));
  }, ms);
  return () => clearInterval(timer);
}

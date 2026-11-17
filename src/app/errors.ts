type ErrorListener = (message: string) => void;

const listeners = new Set<ErrorListener>();
let installed = false;

export function onRuntimeError(listener: ErrorListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function reportError(message: string, cause?: unknown): void {
  const detail = cause instanceof Error ? `${message}: ${cause.message}` : message;
  console.error('[browser-drive]', detail, cause ?? '');
  for (const listener of listeners) listener(detail);
}

/** Capture errors that escape normal control flow so they are never silent. */
export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  window.addEventListener('error', (event) => {
    reportError(event.message || 'Unhandled error', event.error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportError('Unhandled promise rejection', event.reason);
  });
}

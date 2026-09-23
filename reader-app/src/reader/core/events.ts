export const eventBus = new EventTarget();

export function emit<T>(type: string, detail?: T): void {
  eventBus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on<T>(type: string, handler: (detail: T) => void): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<T>).detail);
  };
  eventBus.addEventListener(type, listener);
  return () => eventBus.removeEventListener(type, listener);
}

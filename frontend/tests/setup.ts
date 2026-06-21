// Vitest setup: register jest-dom matchers (toBeInTheDocument etc.) and stub
// the bits of the browser React touches that jsdom doesn't implement.
import "@testing-library/jest-dom/vitest";

// jsdom lacks requestAnimationFrame / cancelAnimationFrame.
globalThis.requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(Date.now()), 16) as unknown as number;
globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id);

// React's scheduler may probe for MessageChannel; jsdom lacks it.
if (!globalThis.MessageChannel) {
  globalThis.MessageChannel = class {
    port1 = {} as MessagePort;
    port2 = {} as MessagePort;
  } as unknown as typeof MessageChannel;
}

// A minimal acquireVsCodeApi for the browser harness. The webview bootstrap only calls
// postMessage; everything it posts is collected for the tests to assert on.
globalThis.__hostMessages = [];
globalThis.acquireVsCodeApi = () => ({
  postMessage: (message) => globalThis.__hostMessages.push(message),
});

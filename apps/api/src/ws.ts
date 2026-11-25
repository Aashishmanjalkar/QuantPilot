import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { RunEvents } from "./queue";
import type { RunStore } from "./store";

/**
 * WebSocket endpoint `/ws?runId=<id>`. On connect and on every change event the
 * server sends `{"type":"run","run":RunView}` read from the store, so a client that
 * connects late still gets the current state. The socket closes after a terminal state.
 */
export function attachRunSocket(
  server: Server,
  deps: { store: RunStore; events: RunEvents },
): WebSocketServer {
  // Clients never send data; a small payload cap limits abuse.
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 1024 });
  wss.on("error", (err) => console.error(`websocket server error: ${err.name}`));

  wss.on("connection", (socket: WebSocket, req) => {
    // Without a listener, a malformed frame from a client would crash the process.
    socket.on("error", () => socket.terminate());
    const runId = new URL(req.url ?? "", "http://localhost").searchParams.get("runId");
    if (!runId) {
      socket.close(1008, "runId is required");
      return;
    }

    let closed = false;
    let sending = Promise.resolve();
    const push = () => {
      sending = sending.then(async () => {
        if (closed) return;
        let run;
        try {
          run = await deps.store.getRun(runId);
        } catch {
          // Transient read failure: close so the client falls back to HTTP polling.
          socket.close(1011, "temporarily unavailable");
          return;
        }
        if (closed) return;
        if (!run) {
          socket.close(1008, "run not found");
          return;
        }
        socket.send(JSON.stringify({ type: "run", run }));
        if (run.status === "completed" || run.status === "failed") socket.close(1000, "done");
      });
    };

    const unsubscribe = deps.events.subscribe(runId, push);
    socket.on("close", () => {
      closed = true;
      unsubscribe();
    });
    push();
  });

  return wss;
}

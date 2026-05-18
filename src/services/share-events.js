const clients = new Map();
let clientId = 0;

export function addClient(controller) {
  const id = ++clientId;
  const heartbeat = setInterval(() => {
    try {
      controller.enqueue(new TextEncoder().encode(`: heartbeat\n\n`));
    } catch {
      removeClient(id);
    }
  }, 25000);
  clients.set(id, { controller, heartbeat });
  return id;
}

export function removeClient(id) {
  const client = clients.get(id);
  if (client) {
    clearInterval(client.heartbeat);
    clients.delete(id);
  }
}

export function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [id, { controller }] of clients) {
    try {
      controller.enqueue(new TextEncoder().encode(message));
    } catch {
      removeClient(id);
    }
  }
}

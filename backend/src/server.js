import "dotenv/config";
import { createServer } from "node:http";

import app from "./app.js";
import { connectDatabase } from "./config/db.js";
import { configureSocketServer } from "./socket.js";
import { checkLocalAssistantAvailability } from "./services/localAssistantProvider.js";

const PORT = process.env.PORT || 5000;

await connectDatabase(process.env.MONGODB_URI);

const httpServer = createServer(app);
configureSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  checkLocalAssistantAvailability().then((status) => {
    if (status.available) console.log(`Local AI assistant ready (${status.model}).`);
    else console.warn(`Local AI assistant unavailable (${status.code}): ${status.message}`);
  }).catch(() => console.warn("Local AI assistant availability check failed; chat requests will report setup guidance."));
});

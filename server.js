const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "../roconal/.env") });

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "256kb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"], // Socket.IO fallback
});

const INTERNAL_TOKEN = process.env.REALTIME_INTERNAL_TOKEN || "";

if (!INTERNAL_TOKEN) {
  console.warn(
    "⚠️ REALTIME_INTERNAL_TOKEN is empty. Internal publish endpoint is not protected.",
  );
}

io.on("connection", (socket) => {
  // contoh join room berdasarkan user_id dari token (nanti auth)
  console.log("client connected:", socket.id);

  socket.on("join", (payload = {}) => {
    const room = payload?.room;
    if (!room || typeof room !== "string") return;
    socket.join(room);
    socket.emit("joined", { room });
  });

  socket.on("disconnect", () => {
    console.log("client disconnected:", socket.id);
  });
});

function emitRealtime(payload = {}) {
  const event = payload?.event;
  if (!event || typeof event !== "string") {
    return false;
  }

  if (payload.room && typeof payload.room === "string") {
    io.to(payload.room).emit(event, payload.data || {});
  } else {
    io.emit(event, payload.data || {});
  }

  return true;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "realtime-server" });
});

app.post("/internal/events", (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (INTERNAL_TOKEN && token !== INTERNAL_TOKEN) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  const payload = req.body || {};
  const ok = emitRealtime(payload);

  if (!ok) {
    return res.status(422).json({
      ok: false,
      message: "Invalid payload. Field `event` is required.",
    });
  }

  console.log("[realtime] internal event", {
    event: payload.event,
    room: payload.room || null,
  });

  return res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error("Realtime server error:", err?.message || err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({ ok: false, message: "Internal server error" });
});

server.listen(process.env.PORT || 3001, () => {
  console.log("Socket.IO server running on", process.env.PORT || 3001);
});

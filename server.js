const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const Redis = require("ioredis");

const app = express();
app.use(cors({ origin: true, credentials: true }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: true, credentials: true },
  transports: ["websocket", "polling"], // Socket.IO fallback
});

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const CHANNEL =
  process.env.REALTIME_REDIS_CHANNEL ||
  process.env.REDIS_CHANNEL ||
  "roconal_database_realtime";
const REDIS_PREFIX = process.env.REDIS_PREFIX || "";

// Redis subscriber (ambil pesan dari Laravel)
const redisSub = new Redis(REDIS_URL);

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

redisSub.on("connect", () => console.log("✅ Redis connected"));
redisSub.on("ready", () => console.log("✅ Redis ready"));
redisSub.on("error", (e) => console.log("❌ Redis error:", e.message));
redisSub.on("close", () => console.log("⚠️ Redis connection closed"));

redisSub.on("message", (channel, message) => {
  try {
    const payload = JSON.parse(message);
    if (!payload?.event) return;

    console.log("[realtime] message", {
      channel,
      event: payload.event,
      room: payload.room || null,
    });

    if (payload.room) {
      io.to(payload.room).emit(payload.event, payload.data || {});
    } else {
      io.emit(payload.event, payload.data || {});
    }
  } catch (e) {
    console.error("Invalid message:", message);
  }
});

redisSub.on("pmessage", (pattern, channel, message) => {
  try {
    const payload = JSON.parse(message);
    if (!payload?.event) return;

    console.log("[realtime] pmessage", {
      pattern,
      channel,
      event: payload.event,
      room: payload.room || null,
    });

    if (payload.room) {
      io.to(payload.room).emit(payload.event, payload.data || {});
    } else {
      io.emit(payload.event, payload.data || {});
    }
  } catch (e) {
    console.error("Invalid pmessage:", message);
  }
});

const channels = Array.from(
  new Set(
    [CHANNEL, REDIS_PREFIX ? `${REDIS_PREFIX}${CHANNEL}` : null].filter(
      Boolean,
    ),
  ),
);

redisSub.subscribe(...channels, (err, count) => {
  if (err) {
    console.error("Redis subscribe error:", err);
    return;
  }
  console.log("Subscribed channels:", channels, "count:", count);
});

// Safety-net: tangkap publish dengan prefix channel apapun yang berakhiran nama channel utama.
redisSub.psubscribe(`*${CHANNEL}`, (err, count) => {
  if (err) {
    console.error("Redis psubscribe error:", err);
    return;
  }
  console.log("Pattern subscribed:", `*${CHANNEL}`, "count:", count);
});

server.listen(process.env.PORT || 3001, () => {
  console.log("Socket.IO server running on", process.env.PORT || 3001);
});

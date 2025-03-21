/* eslint-disable */
const express = require('express');
const bodyParser = require('body-parser');
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const port = process.env.PORT || 3000;

// Create HTTP server for WebSockets
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  }
});

// Middlewares
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// API Routes
app.get('/', (req, res) => {
  res.send('Supplyco Backend API is running!');
});

app.use("/api/auth", require("./src/routes/authRoutes"));
app.use('/api/user', require("./src/routes/userRoutes"));
app.use('/api/slot', require("./src/routes/slotRoutes"));
app.use('/api/staff', require("./src/routes/staffRoutes"));
app.use("/api/admin", require("./src/routes/adminRoutes"));
app.use("/api/orders", require("./src/routes/ordersRoutes"));
app.use("/api/products", require("./src/routes/productsRoutes"));

// WebRTC Signaling Logic
let broadcaster;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("broadcaster", () => {
    broadcaster = socket.id;
    socket.broadcast.emit("broadcaster");
  });

  socket.on("watcher", () => {
    if (broadcaster) {
      socket.to(broadcaster).emit("watcher", socket.id);
    }
  });

  socket.on("offer", (offer, watcherId) => {
    socket.to(watcherId).emit("offer", offer);
  });

  socket.on("answer", (answer, broadcasterId) => {
    socket.to(broadcasterId).emit("answer", answer);
  });

  socket.on("candidate", (candidate, targetId) => {
    socket.to(targetId).emit("candidate", candidate);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    socket.broadcast.emit("disconnectPeer", socket.id);
  });
});

socket.on("peopleCount", (data) => {
  console.log("People count received:", data);
  const { supplycoId, count } = data;
  db.ref(`people_count/${supplycoId}`).set({ count, timestamp: Date.now() });
  io.emit("updateCount", { supplycoId, count }); // Broadcast to all clients
});

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Start the server
server.listen(port, () => {
  console.log(`🚀 Server is running on http://192.168.29.67:${port}`);
});

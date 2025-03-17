/* eslint-disable */
const express = require('express');
const bodyParser = require('body-parser');
const cors = require("cors");




const app = express();
const port = process.env.PORT || 3000; // Using environment variable for dynamic port


// Middlewares
app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

// API Routes
app.get('/', (req, res) => {
  res.send('Supplyco Backend API is running!');
});

app.use("/api/auth", require("./src/routes/authRoutes"));
app.use('/api/user',  require("./src/routes/userRoutes"));  // Example of using middleware
app.use('/api/slot', require("./src/routes/slotRoutes"));
app.use('/api/staff', require("./src/routes/staffRoutes"));
app.use("/api/admin", require("./src/routes/adminRoutes"));
app.use("/api/orders", require("./src/routes/ordersRoutes"));
app.use("/api/products", require("./src/routes/productsRoutes"));

// Global Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server is running on http://192.168.29.67:${port}`);
});

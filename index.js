const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS for all origins
app.use(cors());
app.use(express.json());

// Root endpoint
app.get("/", (req, res) => {
  res.json({ 
    message: "Elderly Care Backend API",
    status: "online",
    timestamp: new Date().toISOString(),
    endpoints: ["/", "/health", "/api"]
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// API endpoint
app.get("/api", (req, res) => {
  res.json({ 
    message: "API endpoint ready",
    version: "1.0.0"
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
const express = require("express");
const app = express();

const PORT = 3000;

// тестовий endpoint
app.get("/api/status", (req, res) => {
  res.json({ status: "OK", message: "Server is running" });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
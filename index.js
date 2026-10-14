// Entry point bridge for Hostinger Node.js deployment
try {
  require("./backend/dist/server.js");
} catch (e) {
  console.error("FATAL ERROR launching backend/dist/server.js:", e);
  process.exit(1);
}

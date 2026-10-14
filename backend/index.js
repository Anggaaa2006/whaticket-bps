// Entry point bridge for Hostinger Node.js deployment
try {
  require("./dist/server.js");
} catch (e) {
  // Before build
  console.log("dist/server.js not compiled yet. Run npm run build.");
}


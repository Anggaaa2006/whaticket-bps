"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("./bootstrap");
require("reflect-metadata");
require("express-async-errors");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const Sentry = __importStar(require("@sentry/node"));
require("./database");
const upload_1 = __importDefault(require("./config/upload"));
const AppError_1 = __importDefault(require("./errors/AppError"));
const routes_1 = __importDefault(require("./routes"));
const logger_1 = require("./utils/logger");
Sentry.init({ dsn: process.env.SENTRY_DSN });
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    credentials: true,
    origin: process.env.FRONTEND_URL
}));
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json());
app.use(Sentry.Handlers.requestHandler());
app.use("/public", express_1.default.static(upload_1.default.directory));
const path_1 = __importDefault(require("path"));
const frontendPath = path_1.default.resolve(__dirname, "..", "..", "frontend", "build");
app.use(express_1.default.static(frontendPath));

app.use(routes_1.default);

// SPA fallback: ONLY when the request is NOT an API route and accepts html
app.get("*", (req, res, next) => {
    const isApi = req.headers.authorization ||
                  req.path.startsWith("/auth") ||
                  req.path.startsWith("/api") ||
                  req.path.startsWith("/public") ||
                  req.path === "/tickets" ||
                  req.path.startsWith("/tickets/") ||
                  req.path === "/contacts" ||
                  req.path.startsWith("/contacts/") ||
                  req.path === "/users" ||
                  req.path.startsWith("/users/") ||
                  req.path === "/whatsapp" ||
                  req.path.startsWith("/whatsapp/") ||
                  req.path === "/messages" ||
                  req.path.startsWith("/messages/") ||
                  req.path === "/queue" ||
                  req.path.startsWith("/queue/") ||
                  req.path === "/settings" ||
                  req.path.startsWith("/settings/") ||
                  req.path === "/quickAnswers" ||
                  req.path.startsWith("/quickAnswers/");

    if (!isApi && req.accepts("html")) {
        return res.sendFile(path_1.default.join(frontendPath, "index.html"));
    }
    return next();
});
app.use(Sentry.Handlers.errorHandler());
app.use((err, req, res, _) => __awaiter(void 0, void 0, void 0, function* () {
    if (err instanceof AppError_1.default) {
        logger_1.logger.warn(err);
        return res.status(err.statusCode).json({ error: err.message });
    }
    logger_1.logger.error(err);
    return res.status(500).json({ error: "Internal server error" });
}));
exports.default = app;

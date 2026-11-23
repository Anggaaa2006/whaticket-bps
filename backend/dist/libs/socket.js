"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIO = exports.initIO = void 0;
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = require("jsonwebtoken");
const AppError_1 = __importDefault(require("../errors/AppError"));
const logger_1 = require("../utils/logger");
const auth_1 = __importDefault(require("../config/auth"));
let io;
const initIO = (httpServer) => {
    io = new socket_io_1.Server(httpServer, {
        cors: {
            origin: "*",
            credentials: true
        },
        transports: ["polling", "websocket"]
    });
    io.on("connection", socket => {
        const { token } = socket.handshake.query;
        let tokenData = null;
        try {
            tokenData = (0, jsonwebtoken_1.verify)(token, auth_1.default.secret);
            logger_1.logger.debug(JSON.stringify(tokenData), "io-onConnection: tokenData");
        }
        catch (error) {
            logger_1.logger.error(JSON.stringify(error), "Error decoding token");
            socket.disconnect();
            return io;
        }
        logger_1.logger.info("Client Connected");
        socket.on("joinChatBox", (ticketId) => {
            logger_1.logger.info("A client joined a ticket channel");
            socket.join(ticketId);
        });
        socket.on("joinNotification", () => {
            logger_1.logger.info("A client joined notification channel");
            socket.join("notification");
        });
        socket.on("joinTickets", (status) => {
            logger_1.logger.info(`A client joined to ${status} tickets channel.`);
            socket.join(status);
        });
        socket.on("disconnect", () => {
            logger_1.logger.info("Client disconnected");
        });
        return socket;
    });
    return io;
};
exports.initIO = initIO;
const getIO = () => {
    if (!io) {
        throw new AppError_1.default("Socket IO not initialized");
    }
    return io;
};
exports.getIO = getIO;

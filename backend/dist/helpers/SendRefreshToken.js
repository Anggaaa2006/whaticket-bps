"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SendRefreshToken = void 0;
const SendRefreshToken = (res, token) => {
    res.cookie("jrt", token, {
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
    });
};
exports.SendRefreshToken = SendRefreshToken;

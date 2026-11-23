"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappProvider = void 0;
const wwebjs_1 = require("./Implementations/wwebjs");
const zapo_1 = require("./Implementations/zapo");
const provider = process.env.WHATSAPP_PROVIDER || "wwebjs";
const providersMap = {
    wwebjs: wwebjs_1.WhatsappWebJsProvider,
    zapo: zapo_1.ZapoProvider,
    whaileys: zapo_1.ZapoProvider
};
const whatsappProvider = providersMap[provider];
exports.whatsappProvider = whatsappProvider;

"use strict";
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
const AppError_1 = __importDefault(require("../../errors/AppError"));
const WhatsApp_1 = require("../../providers/WhatsApp");
const Mustache_1 = __importDefault(require("../../helpers/Mustache"));
const SignatureCache_1 = require("../../helpers/SignatureCache");
const SendWhatsAppMessage = (_a) => __awaiter(void 0, [_a], void 0, function* ({ body, ticket, quotedMsg }) {
    if (!ticket.whatsappId) {
        const GetDefaultWhatsApp_1 = require("../../helpers/GetDefaultWhatsApp");
        const defaultWhatsapp = yield (0, GetDefaultWhatsApp_1.default)();
        if (defaultWhatsapp) {
            yield ticket.update({ whatsappId: defaultWhatsapp.id });
            ticket.whatsappId = defaultWhatsapp.id;
        } else {
            throw new AppError_1.default("ERR_TICKET_NO_WHATSAPP");
        }
    }
    const chatId = `${ticket.contact.number}@${ticket.isGroup ? "g" : "c"}.us`;
    const match = body.match(/^(\*.*?\*:\n)([\s\S]*)$/);
    const signature = match ? match[1] : "";
    const cleanBody = match ? match[2] : body;
    if (signature) {
        const key = `${chatId}:${cleanBody.trim()}`;
        (0, SignatureCache_1.addPendingSignature)(key, signature);
    }
    try {
        const sentMessage = yield WhatsApp_1.whatsappProvider.sendMessage(ticket.whatsappId, chatId, (0, Mustache_1.default)(cleanBody, ticket.contact), {
            quotedMessageId: quotedMsg === null || quotedMsg === void 0 ? void 0 : quotedMsg.id,
            quotedMessageFromMe: quotedMsg === null || quotedMsg === void 0 ? void 0 : quotedMsg.fromMe,
            linkPreview: false
        });
        if (signature && (sentMessage === null || sentMessage === void 0 ? void 0 : sentMessage.id)) {
            (0, SignatureCache_1.addPendingSignature)(sentMessage.id, signature);
        }
        yield ticket.update({ lastMessage: cleanBody });
        return sentMessage;
    }
    catch (err) {
        console.error("DEBUG_SEND_WAPP_ERROR:", err);
        throw new AppError_1.default(err?.message || "ERR_SENDING_WAPP_MSG");
    }
});
exports.default = SendWhatsAppMessage;

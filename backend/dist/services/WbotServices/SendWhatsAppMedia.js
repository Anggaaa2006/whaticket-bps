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
const fs_1 = __importDefault(require("fs"));
const AppError_1 = __importDefault(require("../../errors/AppError"));
const WhatsApp_1 = require("../../providers/WhatsApp");
const Mustache_1 = __importDefault(require("../../helpers/Mustache"));
const SignatureCache_1 = require("../../helpers/SignatureCache");
const SendWhatsAppMedia = (_a) => __awaiter(void 0, [_a], void 0, function* ({ media, ticket, body }) {
    try {
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
        const match = body ? body.match(/^(\*.*?\*:\n)([\s\S]*)$/) : null;
        const signature = match ? match[1] : "";
        const cleanBody = match ? match[2] : body;
        if (signature) {
            const key = `${chatId}:${(cleanBody || media.filename).trim()}`;
            (0, SignatureCache_1.addPendingSignature)(key, signature);
        }
        const hasBody = cleanBody
            ? (0, Mustache_1.default)(cleanBody, ticket.contact)
            : undefined;
        const mediaInput = {
            filename: media.filename,
            mimetype: media.mimetype,
            path: media.path
        };
        const mediaOptions = {
            caption: hasBody,
            sendAudioAsVoice: true,
            sendMediaAsDocument: media.mimetype.startsWith("image/") &&
                !/^.*\.(jpe?g|png|gif)?$/i.exec(media.filename)
        };
        const sentMessage = yield WhatsApp_1.whatsappProvider.sendMedia(ticket.whatsappId, chatId, mediaInput, mediaOptions);
        if (signature && (sentMessage === null || sentMessage === void 0 ? void 0 : sentMessage.id)) {
            (0, SignatureCache_1.addPendingSignature)(sentMessage.id, signature);
        }
        yield ticket.update({ lastMessage: cleanBody || media.filename });
        fs_1.default.unlinkSync(media.path);
        return sentMessage;
    }
    catch (err) {
        console.log(err);
        throw new AppError_1.default("ERR_SENDING_WAPP_MSG");
    }
});
exports.default = SendWhatsAppMedia;

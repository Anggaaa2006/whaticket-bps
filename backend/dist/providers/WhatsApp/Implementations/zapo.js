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
exports.ZapoProvider = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const lru_cache_1 = require("lru-cache");
const https_proxy_agent_1 = require("https-proxy-agent");
const store_sqlite_1 = require("@zapo-js/store-sqlite");
const zapo_js_1 = require("zapo-js");
const wa_store_migrate_1 = require("wa-store-migrate");
const database_1 = __importDefault(require("../../../database"));
const Whatsapp_1 = __importDefault(require("../../../models/Whatsapp"));
const socket_1 = require("../../../libs/socket");
const logger_1 = require("../../../utils/logger");
const AppError_1 = __importDefault(require("../../../errors/AppError"));
const sleep_1 = require("../../../utils/sleep");
const handleWhatsappEvents_1 = require("../../../handlers/handleWhatsappEvents");
const MEDIA_MESSAGE_TYPES = [
    "image",
    "video",
    "audio",
    "ptt",
    "document",
    "sticker"
];
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const RECONNECT_MAX_ATTEMPTS = 10;
const FATAL_DISCONNECT_REASONS = [
    "stream_error_replaced",
    "stream_error_device_removed",
    "stream_error_force_logout",
    "failure_not_authorized",
    "failure_banned",
    "failure_locked",
    "failure_client_too_old",
    "failure_bad_user_agent",
    "primary_identity_key_change"
];
const sessions = new Map();
const reconnectAttemptsBySession = new Map();
const contactsBySession = new Map();
const unreadCountByJid = new Map();
const receivedEventsByJid = new lru_cache_1.LRUCache({
    max: 500,
    ttl: 30 * 60 * 1000
});
const groupSubjectByJid = new lru_cache_1.LRUCache({
    max: 500,
    ttl: 60 * 60 * 1000
});
let store;
const getStore = () => {
    if (store)
        return store;
    const databasePath = process.env.ZAPO_AUTH_PATH ||
        path_1.default.resolve(__dirname, "..", "..", "..", "..", ".zapo_auth/state.sqlite");
    (0, fs_1.mkdirSync)(path_1.default.dirname(databasePath), { recursive: true });
    const sqliteDriver = process.env.ZAPO_SQLITE_DRIVER || "node";
    store = (0, zapo_js_1.createStore)({
        backends: { sqlite: (0, store_sqlite_1.createSqliteStore)({ path: databasePath, driver: sqliteDriver }) },
        providers: {
            auth: "sqlite",
            signal: "sqlite",
            preKey: "sqlite",
            session: "sqlite",
            identity: "sqlite",
            senderKey: "sqlite",
            appState: "sqlite",
            privacyToken: "sqlite",
            messages: "sqlite",
            threads: "sqlite",
            contacts: "sqlite"
        }
    });
    return store;
};
const buildZapoLogger = (level, bindings) => {
    const forward = (emit) => (message, context) => emit(Object.assign(Object.assign({ info: message }, bindings), context));
    return {
        level,
        trace: forward(payload => logger_1.logger.trace(payload)),
        debug: forward(payload => logger_1.logger.debug(payload)),
        info: forward(payload => logger_1.logger.info(payload)),
        warn: forward(payload => logger_1.logger.warn(payload)),
        error: forward(payload => logger_1.logger.error(payload)),
        child: (childBindings, options) => buildZapoLogger((options === null || options === void 0 ? void 0 : options.level) || level, Object.assign(Object.assign({}, bindings), childBindings))
    };
};
const extractNumber = (jid) => { var _a; return ((_a = jid === null || jid === void 0 ? void 0 : jid.split("@")[0]) === null || _a === void 0 ? void 0 : _a.split(":")[0]) || ""; };
const toDestinationJid = (chatId) => {
    if (chatId.endsWith("@lid"))
        return chatId;
    if (chatId.endsWith("@s.whatsapp.net"))
        return chatId;
    const number = extractNumber(chatId);
    if (chatId.endsWith("@g.us") || chatId.endsWith("@g")) {
        return `${number}@g.us`;
    }
    return `${number}@s.whatsapp.net`;
};
const splitAddressing = (primaryJid, alternateJid) => {
    const candidates = [primaryJid, alternateJid].filter((jid) => !!jid);
    return {
        phoneJid: candidates.find(jid => jid.endsWith("@s.whatsapp.net")),
        lidJid: candidates.find(jid => jid.endsWith("@lid"))
    };
};
const unwrapContent = (message) => {
    var _a, _b, _c, _d, _e, _f, _g;
    let content = message;
    for (;;) {
        const inner = ((_a = content.ephemeralMessage) === null || _a === void 0 ? void 0 : _a.message) ||
            ((_b = content.viewOnceMessage) === null || _b === void 0 ? void 0 : _b.message) ||
            ((_c = content.viewOnceMessageV2) === null || _c === void 0 ? void 0 : _c.message) ||
            ((_d = content.viewOnceMessageV2Extension) === null || _d === void 0 ? void 0 : _d.message) ||
            ((_e = content.documentWithCaptionMessage) === null || _e === void 0 ? void 0 : _e.message) ||
            ((_f = content.deviceSentMessage) === null || _f === void 0 ? void 0 : _f.message) ||
            ((_g = content.groupMentionedMessage) === null || _g === void 0 ? void 0 : _g.message);
        if (!inner)
            return content;
        content = inner;
    }
};
const resolveMessageType = (content) => {
    if (content.conversation || content.extendedTextMessage)
        return "chat";
    if (content.buttonsResponseMessage || content.listResponseMessage) {
        return "chat";
    }
    if (content.imageMessage)
        return "image";
    if (content.videoMessage || content.ptvMessage)
        return "video";
    if (content.audioMessage) {
        return content.audioMessage.ptt ? "ptt" : "audio";
    }
    if (content.documentMessage)
        return "document";
    if (content.stickerMessage)
        return "sticker";
    if (content.locationMessage)
        return "location";
    if (content.contactMessage || content.contactsArrayMessage)
        return "vcard";
    return undefined;
};
const getMessageBody = (content) => {
    var _a, _b, _c, _d, _e, _f;
    if (content.locationMessage) {
        const { degreesLatitude, degreesLongitude, name } = content.locationMessage;
        const gmapsUrl = `https://maps.google.com/maps?q=${degreesLatitude}%2C${degreesLongitude}&z=17&hl=pt-BR`;
        return `${gmapsUrl}|${name || `${degreesLatitude}, ${degreesLongitude}`}`;
    }
    if (content.contactMessage)
        return content.contactMessage.vcard || "";
    if (content.contactsArrayMessage) {
        return (content.contactsArrayMessage.contacts || [])
            .map(contact => contact.vcard)
            .join("\n");
    }
    return (content.conversation ||
        ((_a = content.extendedTextMessage) === null || _a === void 0 ? void 0 : _a.text) ||
        ((_b = content.buttonsResponseMessage) === null || _b === void 0 ? void 0 : _b.selectedDisplayText) ||
        ((_c = content.listResponseMessage) === null || _c === void 0 ? void 0 : _c.title) ||
        ((_d = content.imageMessage) === null || _d === void 0 ? void 0 : _d.caption) ||
        ((_e = content.videoMessage) === null || _e === void 0 ? void 0 : _e.caption) ||
        ((_f = content.documentMessage) === null || _f === void 0 ? void 0 : _f.caption) ||
        "");
};
const getQuotedMessageId = (content) => {
    var _a, _b, _c, _d, _e, _f;
    const contextInfo = ((_a = content.extendedTextMessage) === null || _a === void 0 ? void 0 : _a.contextInfo) ||
        ((_b = content.imageMessage) === null || _b === void 0 ? void 0 : _b.contextInfo) ||
        ((_c = content.videoMessage) === null || _c === void 0 ? void 0 : _c.contextInfo) ||
        ((_d = content.audioMessage) === null || _d === void 0 ? void 0 : _d.contextInfo) ||
        ((_e = content.documentMessage) === null || _e === void 0 ? void 0 : _e.contextInfo) ||
        ((_f = content.stickerMessage) === null || _f === void 0 ? void 0 : _f.contextInfo);
    return (contextInfo === null || contextInfo === void 0 ? void 0 : contextInfo.stanzaId) || undefined;
};
const extensionFromMimetype = (mimetype, fallback) => { var _a; return ((_a = mimetype.split("/")[1]) === null || _a === void 0 ? void 0 : _a.split(";")[0]) || fallback; };
const resolveMediaMetadata = (content) => {
    if (content.imageMessage) {
        const mimetype = content.imageMessage.mimetype || "image/jpeg";
        const extension = extensionFromMimetype(mimetype, "jpg");
        return { filename: `image-${Date.now()}.${extension}`, mimetype };
    }
    const video = content.videoMessage || content.ptvMessage;
    if (video) {
        const mimetype = video.mimetype || "video/mp4";
        const extension = extensionFromMimetype(mimetype, "mp4");
        return { filename: `video-${Date.now()}.${extension}`, mimetype };
    }
    if (content.audioMessage) {
        return {
            filename: `audio-${Date.now()}.ogg`,
            mimetype: content.audioMessage.mimetype || "audio/ogg; codecs=opus"
        };
    }
    if (content.documentMessage) {
        const mimetype = content.documentMessage.mimetype || "application/octet-stream";
        const extension = extensionFromMimetype(mimetype, "bin");
        return {
            filename: content.documentMessage.fileName ||
                content.documentMessage.title ||
                `document-${Date.now()}.${extension}`,
            mimetype
        };
    }
    if (content.stickerMessage) {
        return {
            filename: `sticker-${Date.now()}.webp`,
            mimetype: content.stickerMessage.mimetype || "image/webp"
        };
    }
    return undefined;
};
const convertToMediaPayload = (source, client, content, messageId) => __awaiter(void 0, void 0, void 0, function* () {
    const metadata = resolveMediaMetadata(content);
    if (!metadata)
        return undefined;
    try {
        const bytes = yield client.message.downloadBytes(source);
        return {
            filename: metadata.filename,
            mimetype: metadata.mimetype,
            data: Buffer.from(bytes).toString("base64")
        };
    }
    catch (err) {
        logger_1.logger.error({ info: "Error downloading media", err, messageId });
        return undefined;
    }
});
const getProfilePicUrlByJid = (client, jid) => __awaiter(void 0, void 0, void 0, function* () {
    const result = yield client.profile.getProfilePicture(jid).catch(() => {
        return undefined;
    });
    return (result === null || result === void 0 ? void 0 : result.url) || undefined;
});
const getGroupSubject = (client, groupJid) => __awaiter(void 0, void 0, void 0, function* () {
    const cached = groupSubjectByJid.get(groupJid);
    if (cached)
        return cached;
    const metadata = yield client.group
        .queryGroupMetadata(groupJid)
        .catch(() => undefined);
    if (metadata === null || metadata === void 0 ? void 0 : metadata.subject)
        groupSubjectByJid.set(groupJid, metadata.subject);
    return metadata === null || metadata === void 0 ? void 0 : metadata.subject;
});
const rememberContact = (sessionId, contact) => {
    if (contact.isGroup || !contact.number)
        return;
    const knownContacts = contactsBySession.get(sessionId) || new Map();
    knownContacts.set(contact.number, {
        id: `${contact.number}@s.whatsapp.net`,
        number: contact.number,
        name: contact.name,
        pushname: contact.name,
        isGroup: false
    });
    contactsBySession.set(sessionId, knownContacts);
};
const rememberReceivedEvent = (event) => {
    const jid = event.key.remoteJid;
    if (!jid || event.key.fromMe)
        return;
    const events = receivedEventsByJid.get(jid) || [];
    receivedEventsByJid.set(jid, [...events, event].slice(-20));
    unreadCountByJid.set(jid, (unreadCountByJid.get(jid) || 0) + 1);
};
const buildContactPayload = (client, primaryJid, alternateJid, pushName) => __awaiter(void 0, void 0, void 0, function* () {
    const { phoneJid, lidJid } = splitAddressing(primaryJid, alternateJid);
    const jid = phoneJid || lidJid || primaryJid;
    const number = extractNumber(jid);
    return {
        name: pushName || number,
        number,
        lid: lidJid ? `${extractNumber(lidJid)}@lid` : undefined,
        profilePicUrl: yield getProfilePicUrlByJid(client, jid),
        isGroup: false
    };
});
const buildGroupContactPayload = (client, groupJid) => __awaiter(void 0, void 0, void 0, function* () {
    const number = extractNumber(groupJid);
    return {
        name: (yield getGroupSubject(client, groupJid)) || number,
        number,
        isGroup: true,
        profilePicUrl: yield getProfilePicUrlByJid(client, groupJid)
    };
});
const buildMessagePayload = (event, content, type) => {
    const { key } = event;
    const remoteJid = key.remoteJid || "";
    const quotedMsgId = getQuotedMessageId(content);
    return {
        id: key.id || "",
        body: getMessageBody(content),
        fromMe: !!key.fromMe,
        hasMedia: MEDIA_MESSAGE_TYPES.includes(type),
        type,
        timestamp: event.timestampSeconds || Math.floor(Date.now() / 1000),
        from: remoteJid,
        to: key.fromMe ? remoteJid : key.participant || remoteJid,
        hasQuotedMsg: !!quotedMsgId,
        quotedMsgId,
        ack: key.fromMe ? 1 : 0
    };
};
const dispatchIncomingMessage = (event, client, sessionId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!event.message || !event.key.id)
        return;
    const content = unwrapContent(event.message);
    const type = resolveMessageType(content);
    if (!type)
        return;
    const { key } = event;
    const remoteJid = key.remoteJid || "";
    const contactPayload = yield buildContactPayload(client, key.isGroup ? key.participant || remoteJid : remoteJid, key.isGroup ? key.participantAlt : key.remoteJidAlt, event.pushName);
    const groupContact = key.isGroup
        ? yield buildGroupContactPayload(client, remoteJid)
        : undefined;
    const messagePayload = buildMessagePayload(event, content, type);
    const mediaPayload = messagePayload.hasMedia
        ? yield convertToMediaPayload(event, client, content, key.id)
        : undefined;
    rememberContact(sessionId, contactPayload);
    rememberReceivedEvent(event);
    const contextPayload = {
        whatsappId: sessionId,
        unreadMessages: key.fromMe ? 0 : unreadCountByJid.get(remoteJid) || 1,
        groupContact
    };
    yield (0, handleWhatsappEvents_1.handleMessage)(messagePayload, contactPayload, contextPayload, mediaPayload);
});
const dispatchOutgoingMessage = (event, client, sessionId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    if (!event.id)
        return;
    const content = unwrapContent(event.message);
    const type = resolveMessageType(content);
    if (!type)
        return;
    const isGroup = event.to.endsWith("@g.us");
    const contactPayload = isGroup
        ? yield buildGroupContactPayload(client, event.to)
        : yield buildContactPayload(client, event.to, undefined, undefined);
    const quotedMsgId = getQuotedMessageId(content);
    const hasMedia = MEDIA_MESSAGE_TYPES.includes(type);
    const messagePayload = {
        id: event.id,
        body: getMessageBody(content),
        fromMe: true,
        hasMedia,
        type,
        timestamp: Math.floor(Date.now() / 1000),
        from: ((_a = client.getCredentials()) === null || _a === void 0 ? void 0 : _a.meJid) || "",
        to: event.to,
        hasQuotedMsg: !!quotedMsgId,
        quotedMsgId,
        ack: 1
    };
    const mediaPayload = hasMedia
        ? yield convertToMediaPayload(content, client, content, event.id)
        : undefined;
    const contextPayload = {
        whatsappId: sessionId,
        unreadMessages: 0,
        groupContact: isGroup ? contactPayload : undefined
    };
    yield (0, handleWhatsappEvents_1.handleMessage)(messagePayload, contactPayload, contextPayload, mediaPayload);
});
const ackByReceiptStatus = {
    delivered: 2,
    read: 3,
    played: 4
};
const dispatchReceipt = (event) => __awaiter(void 0, void 0, void 0, function* () {
    const ack = ackByReceiptStatus[event.status];
    if (ack === undefined || event.fromSelfDevice)
        return;
    yield Promise.all(event.messageIds.map((messageId) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield (0, handleWhatsappEvents_1.handleMessageAck)(messageId, ack);
        }
        catch (err) {
            logger_1.logger.error({ info: "Error handling receipt", err, messageId });
        }
    })));
});
const emitSession = (sessionId) => __awaiter(void 0, void 0, void 0, function* () {
    const updatedWhatsapp = yield Whatsapp_1.default.findByPk(sessionId);
    if (!updatedWhatsapp)
        return;
    const io = (0, socket_1.getIO)();
    io.emit("whatsappSession", {
        action: "update",
        session: updatedWhatsapp
    });
    io.emit("whatsapp", {
        action: "update",
        whatsapp: updatedWhatsapp
    });
});
const getWbot = (sessionId) => {
    const client = sessions.get(sessionId);
    if (!client) {
        throw new AppError_1.default("ERR_WAPP_NOT_INITIALIZED");
    }
    return client;
};
const removeSession = (whatsappId) => __awaiter(void 0, void 0, void 0, function* () {
    const client = sessions.get(whatsappId);
    if (!client)
        return;
    sessions.delete(whatsappId);
    contactsBySession.delete(whatsappId);
    reconnectAttemptsBySession.delete(whatsappId);
    client.removeAllListeners();
    yield client.disconnect().catch(err => {
        logger_1.logger.error({
            info: "Error disconnecting session",
            err,
            sessionId: whatsappId
        });
    });
});
const buildMediaOptions = () => {
    try {
        /* eslint-disable-next-line global-require, import/no-unresolved, import/no-extraneous-dependencies, @typescript-eslint/no-var-requires */
        const { createMediaProcessor } = require("@zapo-js/media-utils");
        return {
            processor: createMediaProcessor(),
            generateThumbnail: true,
            generateWaveform: true,
            normalizeVoiceNote: true
        };
    }
    catch (_a) {
        return undefined;
    }
};
const buildProxyOptions = () => {
    const proxyAddress = process.env.PROXY_ADDRESS;
    if (!proxyAddress)
        return undefined;
    const proxyAuth = process.env.PROXY_AUTH;
    const proxyUrl = proxyAuth
        ? `http://${proxyAuth}@${proxyAddress}`
        : `http://${proxyAddress}`;
    return { ws: new https_proxy_agent_1.HttpsProxyAgent(proxyUrl) };
};
const loadWhaileysAppStateSyncKeys = (connectionId) => __awaiter(void 0, void 0, void 0, function* () {
    const rows = (yield database_1.default.getQueryInterface().select(null, "WppKeys", {
        where: { connectionId, type: "app-state-sync-key" }
    }));
    return rows.reduce((keys, { keyId, value }) => (Object.assign(Object.assign({}, keys), { [keyId]: JSON.parse(value, wa_store_migrate_1.bufferJsonReviver) })), {});
});
const importWhaileysSession = (whatsapp) => __awaiter(void 0, void 0, void 0, function* () {
    if (!whatsapp.session)
        return;
    const storeSession = getStore().session(String(whatsapp.id));
    if (yield storeSession.auth.load())
        return;
    try {
        const creds = JSON.parse(whatsapp.session, wa_store_migrate_1.bufferJsonReviver);
        const appStateSyncKeys = yield loadWhaileysAppStateSyncKeys(whatsapp.id);
        const { credentials, appState } = wa_store_migrate_1.snapshot.to("zapo", wa_store_migrate_1.snapshot.from("baileys", {
            creds,
            keys: { "app-state-sync-key": appStateSyncKeys }
        }));
        yield storeSession.auth.save(credentials);
        if (appState === null || appState === void 0 ? void 0 : appState.keys.length) {
            yield storeSession.appState.upsertSyncKeys(appState.keys);
        }
        logger_1.logger.info({ info: "Imported whaileys session", sessionId: whatsapp.id });
    }
    catch (err) {
        logger_1.logger.error({
            info: "Error importing whaileys session",
            err,
            sessionId: whatsapp.id
        });
    }
});
const init = (whatsapp) => __awaiter(void 0, void 0, void 0, function* () {
    const sessionId = whatsapp.id;
    yield removeSession(sessionId);
    yield importWhaileysSession(whatsapp);
    const proxy = buildProxyOptions();
    const media = buildMediaOptions();
    const client = new zapo_js_1.WaClient(Object.assign(Object.assign({ store: getStore(), sessionId: String(sessionId), connectTimeoutMs: 25000, recoverFromClientTooOld: true, history: { enabled: false, requireFullSync: false } }, (media ? { media } : {})), (proxy ? { proxy } : {})), buildZapoLogger(process.env.ZAPO_LOG_LEVEL || "error", {
        sessionId
    }));
    sessions.set(sessionId, client);
    client.ignoreKey(ctx => {
        const jid = ctx.remoteJid || "";
        return (0, zapo_js_1.isStatusBroadcastJid)(jid) || (0, zapo_js_1.isNewsletterJid)(jid);
    });
    client.on("auth_qr", (_b) => __awaiter(void 0, [_b], void 0, function* ({ qr }) {
        yield whatsapp.update({ qrcode: qr, status: "qrcode" });
        yield emitSession(sessionId);
        logger_1.logger.info({ info: "QR Code generated", sessionId });
    }));
    client.on("connection", (event) => __awaiter(void 0, void 0, void 0, function* () {
        if (event.status === "open") {
            reconnectAttemptsBySession.set(sessionId, 0);
            yield whatsapp.update({ status: "CONNECTED", qrcode: "", retries: 0 });
            yield emitSession(sessionId);
            logger_1.logger.info({ info: "Session connected", sessionId });
            return;
        }
        const isFatal = event.isLogout || FATAL_DISCONNECT_REASONS.includes(event.reason);
        if (isFatal) {
            yield whatsapp.update({
                status: "DISCONNECTED",
                qrcode: "",
                session: "",
                retries: 0
            });
            yield emitSession(sessionId);
            yield removeSession(sessionId);
            logger_1.logger.info({
                info: "Session disconnected, re-pairing required",
                sessionId,
                reason: event.reason,
                code: event.code
            });
            return;
        }
        if (sessions.get(sessionId) !== client)
            return;
        const attempt = (reconnectAttemptsBySession.get(sessionId) || 0) + 1;
        if (attempt > RECONNECT_MAX_ATTEMPTS) {
            yield whatsapp.update({ status: "DISCONNECTED", qrcode: "" });
            yield emitSession(sessionId);
            yield removeSession(sessionId);
            logger_1.logger.error({
                info: "Giving up on reconnecting session",
                sessionId,
                attempts: attempt - 1,
                reason: event.reason
            });
            return;
        }
        reconnectAttemptsBySession.set(sessionId, attempt);
        yield whatsapp.update({ status: "OPENING" });
        yield emitSession(sessionId);
        const delay = Math.min(RECONNECT_BASE_DELAY_MS * Math.pow(2, (attempt - 1)), RECONNECT_MAX_DELAY_MS);
        logger_1.logger.info({
            info: "Connection closed, reconnecting...",
            sessionId,
            reason: event.reason,
            attempt,
            delay
        });
        yield (0, sleep_1.sleep)(delay);
        client.connect().catch(err => {
            logger_1.logger.error({ info: "Error reconnecting session", err, sessionId });
        });
    }));
    client.on("message", event => {
        dispatchIncomingMessage(event, client, sessionId).catch(err => {
            logger_1.logger.error({ info: "Error handling incoming message", err, sessionId });
        });
    });
    client.on("message_send", event => {
        dispatchOutgoingMessage(event, client, sessionId).catch(err => {
            logger_1.logger.error({ info: "Error handling sent message", err, sessionId });
        });
    });
    client.on("receipt", event => {
        dispatchReceipt(event).catch(err => {
            logger_1.logger.error({ info: "Error handling receipt", err, sessionId });
        });
    });
    yield client.connect();
});
const logout = (sessionId) => __awaiter(void 0, void 0, void 0, function* () {
    const client = sessions.get(sessionId);
    if (client) {
        yield client.logout().catch(err => {
            logger_1.logger.error({ info: "Error on logout", err, sessionId });
        });
    }
    yield removeSession(sessionId);
    const whatsapp = yield Whatsapp_1.default.findByPk(sessionId);
    if (!whatsapp)
        return;
    yield whatsapp.update({
        status: "DISCONNECTED",
        qrcode: "",
        session: "",
        retries: 0
    });
    yield emitSession(sessionId);
    logger_1.logger.info({ info: "Session logged out", sessionId });
});
const buildQuote = (client, toJid, options) => {
    var _a;
    if (!(options === null || options === void 0 ? void 0 : options.quotedMessageId))
        return undefined;
    const fromMe = "quotedMessageFromMe" in options ? !!options.quotedMessageFromMe : false;
    return {
        remoteJid: toJid,
        id: options.quotedMessageId,
        fromMe,
        participant: fromMe ? (_a = client.getCredentials()) === null || _a === void 0 ? void 0 : _a.meJid : toJid
    };
};
const sendMessage = (sessionId, to, body, options) => __awaiter(void 0, void 0, void 0, function* () {
    var _c;
    const client = getWbot(sessionId);
    const toJid = toDestinationJid(to);
    
    let meJid = client.getCredentials()?.meJid;
    if (!meJid) {
        try {
            yield client.deps?.connectionManager?.reconnectAsRegisteredAfterPairing();
            meJid = client.getCredentials()?.meJid;
        } catch (e) {
            logger_1.logger.warn({ info: "Pairing reconnect failed", err: e });
        }
    }
    logger_1.logger.info({ info: "Attempting to send message", sessionId, toJid, hasMeJid: !!meJid });

    let result;
    try {
        result = yield client.message.send(toJid, body, {
            quote: buildQuote(client, toJid, options),
            publishOptions: {
                ackTimeoutMs: 60000,
                maxAttempts: 3
            }
        });
    } catch (err) {
        logger_1.logger.error({ info: "Error sending message in zapo.js", err, sessionId, toJid });
        throw new AppError_1.default(err?.message || "ERR_SENDING_WAPP_MSG", 400);
    }
    if (!(result === null || result === void 0 ? void 0 : result.id)) {
        throw new AppError_1.default("ERR_SENDING_WAPP_MSG");
    }
    return {
        id: result.id,
        body,
        fromMe: true,
        hasMedia: false,
        type: "chat",
        timestamp: Math.floor(Date.now() / 1000),
        from: ((_c = client.getCredentials()) === null || _c === void 0 ? void 0 : _c.meJid) || "",
        to,
        ack: 1
    };
});
const mediaTypeByMimetype = (mimetype, sendAsDocument) => {
    if (sendAsDocument)
        return "document";
    if (mimetype.startsWith("image/"))
        return "image";
    if (mimetype.startsWith("video/"))
        return "video";
    if (mimetype.startsWith("audio/"))
        return "audio";
    return "document";
};
const sendMedia = (sessionId, to, media, options) => __awaiter(void 0, void 0, void 0, function* () {
    var _d;
    const client = getWbot(sessionId);
    const toJid = toDestinationJid(to);
    const mediaBuffer = media.path ? (0, fs_1.readFileSync)(media.path) : media.data;
    if (!mediaBuffer)
        throw new AppError_1.default("ERR_NO_MEDIA_DATA");
    const mediaType = mediaTypeByMimetype(media.mimetype, !!(options === null || options === void 0 ? void 0 : options.sendMediaAsDocument));
    const isVoice = mediaType === "audio" && !!(options === null || options === void 0 ? void 0 : options.sendAudioAsVoice);
    const content = Object.assign(Object.assign(Object.assign({ type: mediaType, media: mediaBuffer, mimetype: media.mimetype }, ((options === null || options === void 0 ? void 0 : options.caption) ? { caption: options.caption } : {})), (mediaType === "document" ? { fileName: media.filename } : {})), (isVoice ? { ptt: true } : {}));
    const result = yield client.message.send(toJid, content, {
        quote: buildQuote(client, toJid, options),
        publishOptions: {
            ackTimeoutMs: 60000,
            maxAttempts: 3
        }
    });
    if (!(result === null || result === void 0 ? void 0 : result.id)) {
        throw new AppError_1.default("ERR_SENDING_WAPP_MEDIA_MSG");
    }
    return {
        id: result.id,
        body: (options === null || options === void 0 ? void 0 : options.caption) || media.filename,
        fromMe: true,
        hasMedia: true,
        type: isVoice ? "ptt" : mediaType,
        timestamp: Math.floor(Date.now() / 1000),
        from: ((_d = client.getCredentials()) === null || _d === void 0 ? void 0 : _d.meJid) || "",
        to,
        ack: 1
    };
});
const deleteMessage = (sessionId, chatId, messageId, fromMe) => __awaiter(void 0, void 0, void 0, function* () {
    const client = getWbot(sessionId);
    const remoteJid = toDestinationJid(chatId);
    yield client.message.send(remoteJid, {
        type: "revoke",
        target: { remoteJid, id: messageId, fromMe }
    });
});
const checkNumber = (sessionId, number) => __awaiter(void 0, void 0, void 0, function* () {
    const client = getWbot(sessionId);
    const [result] = yield client.profile.getLidsByPhoneNumbers([
        number.replace(/\D/g, "")
    ]);
    if (!(result === null || result === void 0 ? void 0 : result.exists)) {
        throw new AppError_1.default("ERR_NUMBER_NOT_ON_WHATSAPP", 404);
    }
    return result.phoneJid;
});
const getProfilePicUrl = (sessionId, number) => __awaiter(void 0, void 0, void 0, function* () {
    const client = getWbot(sessionId);
    const url = yield getProfilePicUrlByJid(client, toDestinationJid(number));
    return url || "";
});
const getContacts = (sessionId) => __awaiter(void 0, void 0, void 0, function* () {
    getWbot(sessionId);
    const knownContacts = contactsBySession.get(sessionId);
    return knownContacts ? Array.from(knownContacts.values()) : [];
});
const sendSeen = (sessionId, chatId) => __awaiter(void 0, void 0, void 0, function* () {
    const client = getWbot(sessionId);
    const remoteJid = toDestinationJid(chatId);
    const events = receivedEventsByJid.get(remoteJid);
    unreadCountByJid.set(remoteJid, 0);
    if (!(events === null || events === void 0 ? void 0 : events.length))
        return;
    yield client.message.sendReceipt(events, { type: "read" });
    receivedEventsByJid.delete(remoteJid);
});
const fetchChatMessages = (sessionId_1, chatId_1, ...args_1) => __awaiter(void 0, [sessionId_1, chatId_1, ...args_1], void 0, function* (sessionId, chatId, limit = 100) {
    getWbot(sessionId);
    const remoteJid = toDestinationJid(chatId);
    const events = receivedEventsByJid.get(remoteJid) || [];
    return events.slice(-limit).reduce((messages, event) => {
        if (!event.message)
            return messages;
        const content = unwrapContent(event.message);
        const type = resolveMessageType(content);
        if (!type)
            return messages;
        return [...messages, buildMessagePayload(event, content, type)];
    }, []);
});
exports.ZapoProvider = {
    init,
    removeSession,
    logout,
    sendMessage,
    sendMedia,
    deleteMessage,
    checkNumber,
    getProfilePicUrl,
    getContacts,
    sendSeen,
    fetchChatMessages
};

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumePendingSignature = exports.addPendingSignature = exports.signatureCache = void 0;
exports.signatureCache = new Map();
const addPendingSignature = (key, signature) => {
    exports.signatureCache.set(key, signature);
    setTimeout(() => {
        exports.signatureCache.delete(key);
    }, 60000);
};
exports.addPendingSignature = addPendingSignature;
const consumePendingSignature = (keys) => {
    for (const key of keys) {
        if (exports.signatureCache.has(key)) {
            const sig = exports.signatureCache.get(key);
            exports.signatureCache.delete(key);
            return sig;
        }
    }
    return undefined;
};
exports.consumePendingSignature = consumePendingSignature;

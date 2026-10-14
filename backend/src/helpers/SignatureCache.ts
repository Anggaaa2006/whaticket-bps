export const signatureCache = new Map<string, string>();

export const addPendingSignature = (key: string, signature: string): void => {
  signatureCache.set(key, signature);
  setTimeout(() => {
    signatureCache.delete(key);
  }, 60000);
};

export const consumePendingSignature = (keys: string[]): string | undefined => {
  for (const key of keys) {
    if (signatureCache.has(key)) {
      const sig = signatureCache.get(key);
      signatureCache.delete(key);
      return sig;
    }
  }
  return undefined;
};


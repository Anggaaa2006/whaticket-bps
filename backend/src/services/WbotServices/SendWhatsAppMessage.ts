import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { whatsappProvider, ProviderMessage } from "../../providers/WhatsApp";

import formatBody from "../../helpers/Mustache";
import { addPendingSignature } from "../../helpers/SignatureCache";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
}

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: Request): Promise<ProviderMessage> => {
  if (!ticket.whatsappId) {
    const GetDefaultWhatsApp = (await import("../../helpers/GetDefaultWhatsApp")).default;
    const defaultWhatsapp = await GetDefaultWhatsApp();
    if (defaultWhatsapp) {
      await ticket.update({ whatsappId: defaultWhatsapp.id });
      ticket.whatsappId = defaultWhatsapp.id;
    } else {
      throw new AppError("ERR_TICKET_NO_WHATSAPP");
    }
  }

  const chatId = `${ticket.contact.number}@${ticket.isGroup ? "g" : "c"}.us`;

  const match = body.match(/^(\*.*?\*:\n)([\s\S]*)$/);
  const signature = match ? match[1] : "";
  const cleanBody = match ? match[2] : body;

  if (signature) {
    const key = `${chatId}:${cleanBody.trim()}`;
    addPendingSignature(key, signature);
  }

  try {
    const sentMessage = await whatsappProvider.sendMessage(
      ticket.whatsappId,
      chatId,
      formatBody(cleanBody, ticket.contact),
      {
        quotedMessageId: quotedMsg?.id,
        quotedMessageFromMe: quotedMsg?.fromMe,
        linkPreview: false
      }
    );

    if (signature && sentMessage?.id) {
      addPendingSignature(sentMessage.id, signature);
    }

    await ticket.update({ lastMessage: cleanBody });
    return sentMessage;
  } catch (err) {
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;

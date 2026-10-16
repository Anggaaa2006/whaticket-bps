import fs from "fs";
import AppError from "../../errors/AppError";
import Ticket from "../../models/Ticket";
import { whatsappProvider, ProviderMessage } from "../../providers/WhatsApp";

import formatBody from "../../helpers/Mustache";
import { addPendingSignature } from "../../helpers/SignatureCache";

interface Request {
  media: Express.Multer.File;
  ticket: Ticket;
  body?: string;
}

const SendWhatsAppMedia = async ({
  media,
  ticket,
  body
}: Request): Promise<ProviderMessage> => {
  try {
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

    const match = body ? body.match(/^(\*.*?\*:\n)([\s\S]*)$/) : null;
    const signature = match ? match[1] : "";
    const cleanBody = match ? match[2] : body;

    if (signature) {
      const key = `${chatId}:${(cleanBody || media.filename).trim()}`;
      addPendingSignature(key, signature);
    }

    const hasBody = cleanBody
      ? formatBody(cleanBody as string, ticket.contact)
      : undefined;

    const mediaInput = {
      filename: media.filename,
      mimetype: media.mimetype,
      path: media.path
    };

    const mediaOptions = {
      caption: hasBody,
      sendAudioAsVoice: true,
      sendMediaAsDocument:
        media.mimetype.startsWith("image/") &&
        !/^.*\.(jpe?g|png|gif)?$/i.exec(media.filename)
    };

    const sentMessage = await whatsappProvider.sendMedia(
      ticket.whatsappId,
      chatId,
      mediaInput,
      mediaOptions
    );

    if (signature && sentMessage?.id) {
      addPendingSignature(sentMessage.id, signature);
    }

    await ticket.update({ lastMessage: cleanBody || media.filename });

    fs.unlinkSync(media.path);

    return sentMessage;
  } catch (err) {
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMedia;

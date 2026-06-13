import { Router } from "express";
import { ConversationsService } from "../conversations/conversations.service.js";
import { MessagesService } from "./messages.service.js";

export function createMessagesRouter(
  conversationsService: ConversationsService,
  messagesService: MessagesService,
): Router {
  const router = Router();

  router.post("/:conversationId/messages", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!content) {
      res.status(400).json({ detail: "Content is required" });
      return;
    }

    const messageType =
      req.body?.messageType === "command" ? "command" : "text";
    const mentions = Array.isArray(req.body?.mentions) ? req.body.mentions : null;

    const message = messagesService.createMessage({
      conversationId: req.params.conversationId,
      senderType: "user",
      content,
      messageType,
      mentions,
    });
    res.status(201).json(message);
  });

  router.get("/:conversationId/messages", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    res.json(messagesService.listMessagesByConversation(req.params.conversationId));
  });

  router.get("/:conversationId/timeline", (req, res) => {
    const conversation = conversationsService.getById(req.params.conversationId);
    if (!conversation) {
      res.status(404).json({ detail: "Conversation not found" });
      return;
    }

    res.json(messagesService.getConversationTimeline(req.params.conversationId));
  });

  return router;
}

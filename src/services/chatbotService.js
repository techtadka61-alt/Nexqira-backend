const aiService = require('./aiService');
const ChatLead = require('../models/ChatLead');
const VisitorSession = require('../models/VisitorSession');

const BUSINESS_CONTEXT = `
Business name: Nexqira
Founder / owner: Satya Jaiswal
Public email: techtadka61@gmail.com
Public phone: +91 93697 79898
Location: Robertsganj, Sonbhadra, Uttar Pradesh, India
Availability: Monday to Saturday, 10:00 AM to 7:00 PM IST
Services: website development, mobile applications, AI chatbots, live dashboards, admin panels, custom software, school/coaching websites, restaurant systems, gym websites, healthcare/clinic solutions, college projects, and business automation.
Working style: custom-built solutions, direct developer communication, support after launch, SEO-aware websites, responsive UI, backend/API development, MongoDB/Node/React stacks when suitable.
`.trim();

const CONTACT_FOOTER =
  'If you need more details, you can contact the admin directly at techtadka61@gmail.com or call +91 93697 79898. You can also send your name, phone number, and email here, and we will contact you soon.';

function cleanMessage(value) {
  return String(value ?? '').trim().slice(0, 1000);
}

function buildConversation(messages) {
  if (!Array.isArray(messages)) return [];

  return messages
    .slice(-8)
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: cleanMessage(item?.content)
    }))
    .filter((item) => item.content);
}

function extractLeadDetails(message) {
  const text = cleanMessage(message);
  const email = text.match(/[^\s@]+@[^\s@]+\.[^\s@]{2,}/i)?.[0] || '';
  const phone = text.match(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/)?.[0] || '';
  const nameMatch = text.match(/\b(?:my name is|name is|i am|i'm)\s+([a-zA-Z ]{2,60})/i);
  const name = nameMatch?.[1]?.trim().replace(/\s{2,}/g, ' ') || '';

  return { name, email, phone };
}

async function saveChatLeadIfPresent({ message, history, meta, sessionId }) {
  const details = extractLeadDetails(message);
  if (!details.email && !details.phone) return null;

  const lead = await ChatLead.create({
    ...details,
    message: cleanMessage(message),
    conversation: buildConversation(history),
    source: 'chatbot',
    sessionId: sessionId || '',
    meta
  });

  if (sessionId) {
    VisitorSession.updateOne(
      { sessionId, 'convertedLead.leadId': null },
      { $set: { 'convertedLead.leadType': 'chat', 'convertedLead.leadId': lead._id, 'convertedLead.convertedAt': new Date() } }
    ).catch(() => {});
  }

  return lead;
}

async function getChatbotReply({ message, history = [], meta = {}, sessionId = '' }) {
  const userMessage = cleanMessage(message);
  if (!userMessage) {
    const error = new Error('Message is required');
    error.statusCode = 400;
    throw error;
  }

  const conversation = buildConversation(history)
    .map((item) => `${item.role === 'assistant' ? 'Assistant' : 'Visitor'}: ${item.content}`)
    .join('\n');

  const prompt = `
You are Nexqira AI, a confident and helpful assistant on the Nexqira website.
Your job is to help visitors understand services, benefits, contact options, and next steps.
Answer like a real business assistant, not like a scripted bot.
Use the business facts below when relevant. These are public details, so you may share them.
Do not say you cannot share owner contact details; share the public phone/email politely.
When a visitor seems interested, asks for pricing, asks for a callback, or wants next steps, ask them to share their name, phone number, and email.
If the visitor already shares phone/email, acknowledge it naturally and say the team will contact them soon.
For service questions, explain value clearly with practical examples and ask one useful follow-up.
For pricing/timeline, give a helpful range-style answer only when enough details are present; otherwise ask for project type, pages/features, and deadline.
If the AI provider is unsure about something not in the facts, say that briefly and guide the visitor to call, email, or use the contact form.
Keep most replies between 4 and 8 short sentences. Use line breaks for readability when useful.

Business facts:
${BUSINESS_CONTEXT}

Recent conversation:
${conversation || 'No previous messages.'}

Visitor: ${userMessage}
Assistant:
  `.trim();

  const savedLead = await saveChatLeadIfPresent({ message: userMessage, history, meta, sessionId });
  const reply = String(await aiService.callAI(prompt, 700) || '').trim();
  const leadNote = savedLead ? 'Thanks, I have saved your contact details. The Nexqira team will contact you soon.' : '';
  const body = [leadNote, reply || 'Thanks for your message.'].filter(Boolean).join('\n\n');
  if (body.includes('You can also send your name, phone number, and email here')) return body;
  return `${body}\n\n${CONTACT_FOOTER}`;
}

module.exports = { getChatbotReply };

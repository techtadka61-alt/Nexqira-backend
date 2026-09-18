const { getChatbotReply } = require('../services/chatbotService');

const sendMessage = async (req, res) => {
  try {
    const reply = await getChatbotReply({
      message: req.body?.message,
      history: req.body?.history,
      sessionId: String(req.body?.sessionId || '').trim().slice(0, 100),
      meta: {
        ip: String(req.headers['x-forwarded-for'] || req.ip || '').trim(),
        userAgent: String(req.get('user-agent') || '').trim(),
        referer: String(req.get('referer') || '').trim()
      }
    });

    return res.json({ success: true, reply });
  } catch (error) {
    const status = error.statusCode || 500;
    const message = status === 500 ? 'Unable to answer right now. Please try again.' : error.message;
    return res.status(status).json({ success: false, message });
  }
};

module.exports = { sendMessage };

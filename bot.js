require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const express = require("express");
const bodyParser = require("body-parser");
const { extractDataFromImage, extractDataFromVehicleDoc } = require("./mindeeHelper");

const token = process.env.TELEGRAM_BOT_TOKEN;
const openRouterApiKey = process.env.OPENROUTER_API_KEY;
const webhookUrl = `${process.env.RENDER_EXTERNAL_URL}/bot${token}`;

if (!token || !openRouterApiKey || !process.env.RENDER_EXTERNAL_URL) {
  console.error("❗ Missing environment variables.");
  process.exit(1);
}

// === Telegram Bot Setup ===
const bot = new TelegramBot(token);
bot.setWebHook(webhookUrl);

// === Express Web Server ===
const app = express();
app.use(bodyParser.json());

app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// === Bot Logic ===
const userStates = {}; // user data store

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { stage: "awaiting_passport" };
  const welcomeMessage = `👋 Welcome! I'm your insurance assistant bot.

Please send a clear photo of your passport to begin.`;
  bot.sendMessage(chatId, welcomeMessage);
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  if (!state) return bot.sendMessage(chatId, "❗ Please type /start to begin.");

  const photo = msg.photo[msg.photo.length - 1];
  const file = await bot.getFile(photo.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

  if (state.stage === "awaiting_passport") {
    if (state.passportPhotoUrl === fileUrl) return bot.sendMessage(chatId, "❗ This passport image has already been sent.");
    const passportData = await extractDataFromImage(fileUrl);
    state.passportData = passportData;
    state.passportPhotoUrl = fileUrl;
    state.stage = "awaiting_vid";
    return bot.sendMessage(chatId, "✅ Passport processed. Please send your vehicle document.");
  }

  if (state.stage === "awaiting_vid") {
    if (state.vehiclePhotoUrl === fileUrl) return bot.sendMessage(chatId, "❗ This vehicle document has already been sent.");
    const vehicleData = await extractDataFromVehicleDoc(fileUrl);
    state.vidData = vehicleData;
    state.vehiclePhotoUrl = fileUrl;
    state.stage = "awaiting_price_confirmation";

    const fullName = `${(state.passportData.given_names || []).map(n => n.value).join(" ")} ${state.passportData.surname?.value || ""}`.trim();
    const birthDate = state.passportData.birth_date?.value || "Unknown";
    const vehicleId = state.vidData.vehicle_number?.value || "Unknown";

    return bot.sendMessage(chatId, `✅ Extracted:\n👤 Name: ${fullName}\n🎂 DOB: ${birthDate}\n🚗 Vehicle ID: ${vehicleId}\n\nType /confirm or /retry.`);
  }
});

bot.onText(/\/retry/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { stage: "awaiting_passport" };
  bot.sendMessage(chatId, "🔄 Let's try again. Please send your passport photo.");
});

bot.onText(/\/confirm/, (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  if (!state || state.stage !== "awaiting_price_confirmation") return;
  state.stage = "awaiting_price_agreement";
  bot.sendMessage(chatId, "💰 The fixed insurance price is 100 USD. Do you agree? (yes/no)");
});

bot.onText(/^(yes|no)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  if (!state || state.stage !== "awaiting_price_agreement") return;

  if (match[1].toLowerCase() === "yes") {
    await generateInsurancePolicy(state, chatId);
  } else {
    bot.sendMessage(chatId, "❌ The price is fixed. Unfortunately, we cannot offer a discount.");
    delete userStates[chatId];
  }
});

async function generateInsurancePolicy(state, chatId) {
  const fullName = `${(state.passportData.given_names || []).map(n => n.value).join(" ")} ${state.passportData.surname?.value || ""}`.trim();
  const birthDate = state.passportData.birth_date?.value || "Unknown";
  const vehicleId = state.vidData.vehicle_number?.value || "Unknown";

  const prompt = `Generate a professional car insurance policy:
- Name: ${fullName}
- DOB: ${birthDate}
- Vehicle ID: ${vehicleId}
Coverage: Full
Premium: $100
Duration: 1 year from today.`;

  try {
    const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
      model: "openai/gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are an insurance agent bot generating formal policy documents." },
        { role: "user", content: prompt }
      ]
    }, {
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://yourdomain.com", // optional
        "X-Title": "InsuranceBot"
      }
    });

    const policy = response.data.choices?.[0]?.message?.content || "Policy unavailable.";
    bot.sendMessage(chatId, `📄 Here is your insurance policy:\n\n${policy}`);
    bot.sendMessage(chatId, "✅ Policy issued. Type /start to begin again.");
    delete userStates[chatId];
  } catch (err) {
    console.error("Policy error:", err.response?.data || err.message);
    bot.sendMessage(chatId, "❌ Could not generate policy.");
  }
}

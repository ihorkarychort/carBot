require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const { extractDataFromImage, extractDataFromVehicleDoc } = require("./mindeeHelper");

const token = process.env.TELEGRAM_BOT_TOKEN;
const openRouterApiKey = process.env.OPENROUTER_API_KEY;

if (!token || !openRouterApiKey) {
  console.error("Missing TELEGRAM_BOT_TOKEN or OPENROUTER_API_KEY");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const userStates = {}; // { chatId: { stage, passportData, vidData, passportPhotoUrl, vehiclePhotoUrl } }

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { stage: "awaiting_passport" };
  const welcomeMessage = `👋 Welcome! I'm your insurance assistant bot.

I help you with the process of purchasing car insurance. Please follow the instructions to upload your passport and vehicle documents.`;
  bot.sendMessage(chatId, welcomeMessage).catch(console.error);
});

bot.onText(/\/retry/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { stage: "awaiting_passport" };
  bot.sendMessage(chatId, "🔄 Let's try again. Please send your passport photo.");
});

bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  if (!state) return bot.sendMessage(chatId, "❗ Please type /start to begin.");

  const photo = msg.photo[msg.photo.length - 1];
  try {
    const file = await bot.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    if (fileUrl === state.passportPhotoUrl || fileUrl === state.vehiclePhotoUrl) {
      return bot.sendMessage(chatId, "⚠️ This photo has already been uploaded. Please upload a different photo.");
    }

    if (state.stage === "awaiting_passport") {
      const passportPrediction = await extractDataFromImage(fileUrl);
      state.passportData = passportPrediction;
      state.passportPhotoUrl = fileUrl;
      state.stage = "awaiting_vid";
      bot.sendMessage(chatId, "✅ Passport processed. Please send your vehicle document.");
    } else if (state.stage === "awaiting_vid") {
      const vidPrediction = await extractDataFromVehicleDoc(fileUrl);
      state.vidData = vidPrediction;
      state.vehiclePhotoUrl = fileUrl;
      state.stage = "awaiting_price_confirmation";

      const givenNames = (state.passportData.given_names || []).map((n) => n.value).join(" ");
      const surname = state.passportData.surname?.value || "";
      const fullName = `${givenNames} ${surname}`.trim();
      const birthDate = state.passportData.birth_date?.value || "Unknown";
      const vehicleId = state.vidData.vehicle_number?.value || "Unknown";

      const summary = `✅ Extracted Information:\n👤 Name: ${fullName}\n🎂 DOB: ${birthDate}\n🚗 Vehicle ID: ${vehicleId}\nType /confirm if this is correct or /retry.`;
      bot.sendMessage(chatId, summary);
    }
  } catch (err) {
    console.error("Photo error:", err.message);
    bot.sendMessage(chatId, "❌ Sorry, error processing photo, please try again.");
  }
});

bot.onText(/\/confirm/, (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  if (!state || state.stage !== "awaiting_price_confirmation") return;

  bot.sendMessage(chatId, "💰 The fixed price for the insurance is 100 USD.\nDo you agree? (yes/no)");
  state.stage = "awaiting_price_agreement";
});

bot.onText(/^(yes|no)$/i, async (msg, match) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];
  if (!state || state.stage !== "awaiting_price_agreement") return;

  if (match[1].toLowerCase() === "yes") {
    await generateInsurancePolicy(state, chatId);
  } else {
    bot.sendMessage(chatId, "❌ We apologize, but the price is fixed at 100 USD. Unfortunately, we cannot offer a different price.");
    delete userStates[chatId];
  }
});

async function generateInsurancePolicy(state, chatId) {
  const givenNames = (state.passportData.given_names || []).map((n) => n.value).join(" ");
  const surname = state.passportData.surname?.value || "";
  const fullName = `${givenNames} ${surname}`.trim();
  const birthDate = state.passportData.birth_date?.value || "Unknown";
  const vehicleId = state.vidData.vehicle_number?.value || "Unknown";

  const prompt = `Generate a professional car insurance policy:\n- Name: ${fullName}\n- DOB: ${birthDate}\n- Vehicle ID: ${vehicleId}\nCoverage: Full\nPremium: $100\nDuration: 1 year from today.`;

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
        "HTTP-Referer": "http://localhost",
        "X-Title": "InsuranceBot"
      }
    });

    const policy = response.data.choices?.[0]?.message?.content || "Policy unavailable.";
    bot.sendMessage(chatId, `📄 Here is your insurance policy:\n\n${policy}`);
    bot.sendMessage(chatId, "✅ Your policy has been issued. Type /start to begin again.");
    delete userStates[chatId];
  } catch (err) {
    console.error("OpenRouter error:", err.response?.data || err.message);
    bot.sendMessage(chatId, "❌ Sorry, we could not generate policy.");
  }
}

// Chat handling via OpenRouter for general questions
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return; // Skip commands

  try {
    const res = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
      model: "openai/gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant for car insurance inquiries." },
        { role: "user", content: text }
      ]
    }, {
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost",
        "X-Title": "InsuranceBot"
      }
    });

    const reply = res.data.choices?.[0]?.message?.content || "❗ I couldn't generate a response.";
    bot.sendMessage(chatId, reply);
  } catch (err) {
    console.error("OpenRouter general chat error:", err.response?.data || err.message);
  }
});

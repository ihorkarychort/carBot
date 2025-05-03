require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { extractDataFromImage, extractDataFromVehicleDoc } = require("./mindeeHelper");
const express = require("express");
const bodyParser = require("body-parser");

// Load credentials
const token = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL; // Add your webhook URL here
if (!token || !webhookUrl) {
  console.error("Missing TELEGRAM_BOT_TOKEN or WEBHOOK_URL");
  process.exit(1);
}

const bot = new TelegramBot(token);
const app = express();
const port = process.env.PORT || 3000;

// Use bodyParser to handle incoming requests
app.use(bodyParser.json());

// Set the webhook
bot.setWebHook(`${webhookUrl}/bot${token}`);

// Handle incoming updates (Webhook)
app.post(`/bot${token}`, (req, res) => {
  const update = req.body;
  bot.processUpdate(update);
  res.sendStatus(200); // Respond with HTTP status 200 to acknowledge receipt
});

// User state tracking
const userStates = {}; // { chatId: { stage, passportData, vidData, passportPhotoUrl, vehiclePhotoUrl } }

// /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userStates[chatId] = { stage: "awaiting_passport" };

  const welcomeMessage = `👋 Welcome! I'm your insurance assistant bot.
  
I help you with the process of purchasing car insurance. Please follow the instructions to upload your passport and vehicle documents.

Here are the available commands:

1. **/start** - Start the process of purchasing insurance.
2. **/help** - Get a list of commands and their descriptions.
3. **/retry** - Retry the process by sending a new passport or vehicle document photo.
4. **/confirm** - Confirm the extracted details after uploading your documents.

Please send a photo of your **passport** to begin.`;

  bot.sendMessage(chatId, welcomeMessage).catch(error => handleBotError(chatId, error));
});

// /help command to explain the available commands
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const helpMessage = `
Here are the commands you can use:

1. **/start** - Start the process of purchasing car insurance. You will be guided through the steps to upload your passport and vehicle identification document.
2. **/help** - Get this list of available commands and their descriptions.
3. **/retry** - If you made a mistake or wish to restart the process, you can use this to retry uploading a new passport or vehicle document.
4. **/confirm** - After uploading the required documents, use this command to confirm the details extracted from your photos.
  `;

  bot.sendMessage(chatId, helpMessage).catch(error => handleBotError(chatId, error));
});

// Handle photo uploads
bot.on("photo", async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (!state) {
    bot.sendMessage(chatId, "❗ Please type /start to begin.").catch(error => handleBotError(chatId, error));
    return;
  }

  const photo = msg.photo[msg.photo.length - 1];

  try {
    const file = await bot.getFile(photo.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    if (state.stage === "awaiting_passport") {
      // Check if the photo is already uploaded as vehicle photo
      if (state.vehiclePhotoUrl && state.vehiclePhotoUrl === fileUrl) {
        bot.sendMessage(chatId, "❌ The photo you sent for the passport is the same as the one you sent for the vehicle. Please send a different photo for your **passport**.").catch(error => handleBotError(chatId, error));
        return;
      }

      const passportPrediction = await extractDataFromImage(fileUrl);
      state.passportData = passportPrediction;
      state.passportPhotoUrl = fileUrl; // Store the passport photo URL
      state.stage = "awaiting_vid";

      bot.sendMessage(
        chatId,
        "✅ Passport processed. Now, please send a photo of your **Vehicle Identification Document (VID)**."
      ).catch(error => handleBotError(chatId, error));
    } else if (state.stage === "awaiting_vid") {
      // Check if the photo is already uploaded as passport photo
      if (state.passportPhotoUrl && state.passportPhotoUrl === fileUrl) {
        bot.sendMessage(chatId, "❌ The photo you sent for the vehicle is the same as the one you sent for the passport. Please send a different photo for your **vehicle identification document (VID)**.").catch(error => handleBotError(chatId, error));
        return;
      }

      const vidPrediction = await extractDataFromVehicleDoc(fileUrl);
      state.vidData = vidPrediction;
      state.vehiclePhotoUrl = fileUrl; // Store the vehicle photo URL
      state.stage = "awaiting_price_confirmation"; // New stage for price confirmation

      const givenNames = (state.passportData.given_names || [])
        .map((name) => name.value)
        .join(" "); // Join all given names

      const surname = state.passportData.surname?.value || "";
      const fullName = ` ${givenNames} ${surname}`.trim();

      const birthDate = state.passportData.birth_date?.value || "Unknown";
      const vehicleId = state.vidData.vehicle_number?.value || "Unknown";

      const summary = `✅ Here is the extracted information:\n\n👤 Name: ${fullName}\n🎂 Date of Birth: ${birthDate}\n🚗 Vehicle ID: ${vehicleId}\n\nPlease confirm if this is correct.`;

      bot.sendMessage(chatId, summary).catch(error => handleBotError(chatId, error));
    }
  } catch (error) {
    console.error("Error processing the photo:", error.message);
    bot.sendMessage(chatId, "❌ There was an error processing the photo. Please try again.").catch(error => handleBotError(chatId, error));
  }
});

// Handle user confirmation
bot.onText(/\/confirm/, (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (!state || state.stage !== "awaiting_price_confirmation") {
    bot.sendMessage(chatId, "❗ Please type /start to begin.").catch(error => handleBotError(chatId, error));
    return;
  }

  // Send the price quotation and ask for agreement
  bot.sendMessage(
    chatId,
    "💰 The fixed price for the insurance is 100 USD.\n\nDo you agree with the price? (Reply with 'yes' or 'no')"
  ).catch(error => handleBotError(chatId, error));
  state.stage = "awaiting_price_agreement"; // New stage for price agreement
});

// Handle user response on price agreement
bot.onText(/^(yes|no)$/i, (msg, match) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (!state || state.stage !== "awaiting_price_agreement") {
    bot.sendMessage(chatId, "❗ Please type /start to begin.").catch(error => handleBotError(chatId, error));
    return;
  }

  if (match[0].toLowerCase() === "yes") {
    // Proceed to the final step after agreement
    generateInsurancePolicy(state, chatId);
  } else {
    // Apologize and explain the price is fixed
    bot.sendMessage(chatId, "❌ We apologize, but the price is fixed at 100 USD. Unfortunately, we cannot offer a different price.").catch(error => handleBotError(chatId, error));
    bot.sendMessage(chatId, "Type /start to try again.").catch(error => handleBotError(chatId, error));
    delete userStates[chatId]; // Reset state for this user
  }
});

// Function to generate a dummy insurance policy manually
function generateInsurancePolicy(state, chatId) {
  // Extract full name properly
  const givenNames = (state.passportData.given_names || [])
    .map((nameObj) => nameObj.value) // Extract 'value' from each name object
    .join(" "); // Join names with a space
  const surname = state.passportData.surname?.value || ""; // Ensure we handle undefined or missing surname
  const fullName = `${givenNames} ${surname}`.trim(); // Construct full name

  const vehicleId = state.vidData.vehicle_number?.value || "Unknown";
  const birthDate = state.passportData.birth_date?.value || "Unknown";

  // Creating a static policy template
  const policyText = `
  📝 Insurance Policy

  Policyholder: ${fullName}
  Date of Birth: ${birthDate}
  Vehicle ID: ${vehicleId}
  
  Insurance Coverage: Full Coverage
  Coverage Period: 1 Year
  Premium: 100 USD
  
  Policy Effective Date: ${new Date().toLocaleDateString()}
  Policy Expiry Date: ${(new Date(new Date().setFullYear(new Date().getFullYear() + 1))).toLocaleDateString()}

  Thank you for choosing our service! This is a confirmation of your insurance purchase.
  `;

  // Send the generated policy as confirmation
  bot.sendMessage(chatId, "📄 Here is your insurance policy:\n\n" + policyText).catch(error => handleBotError(chatId, error));
  bot.sendMessage(chatId, "✅ Your insurance policy has been successfully issued! Type /start to begin again.").catch(error => handleBotError(chatId, error));
  delete userStates[chatId]; // Reset state for this user
}

// Handle user retry
bot.onText(/\/retry/, (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (!state) {
    bot.sendMessage(chatId, "❗ Please type /start to begin.").catch(error => handleBotError(chatId, error));
    return;
  }

  // Reset state to start over for this user
  userStates[chatId] = { stage: "awaiting_passport" };

  // Ask for the passport again
  bot.sendMessage(chatId, "❌ Let's try again. Please send a new photo of your passport.").catch(error => handleBotError(chatId, error));
});

// Function to handle errors
function handleBotError(chatId, error) {
  console.error("Error: ", error);
  bot.sendMessage(chatId, "❌ Something went wrong. Please try again later.").catch(error => console.error("Error sending error message: ", error));
}

// Start the Express server to handle webhooks
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

1. SETUP INSTRUCTIONS & DEPENDENCIES
This bot is built using Node.js and relies on the following packages:

node-telegram-bot-api for interacting with Telegram's Bot API.

dotenv to manage environment variables securely.

form-data: A module for constructing and sending multipart/form-data HTTP requests, typically used for file uploads.

mindee: An API client for extracting data from images and documents using Mindee's AI-powered document processing.

To run the bot, install dependencies, configure your environment variables (specifically TELEGRAM_BOT_TOKEN and MINDEE_API_KEY), and execute the main script.

The bot also depends on a module called mindeeHelper.js, which uses AI to extract information from passport and vehicle document images.

2. BOT WORKFLOW
The bot uses a state-based interaction flow to guide the user through purchasing insurance. Each user has a session state that determines the next expected input.

Workflow stages:

Start: The user sends the /start command. The bot explains the process and asks for a passport photo.

Passport Upload: The user sends a passport photo. The bot processes it using AI to extract name and date of birth.

Vehicle Document Upload: The bot asks for a vehicle identification document (VID). It extracts the vehicle number.

Confirmation: The bot presents the extracted information and asks the user to confirm using /confirm.

Pricing Agreement: The bot shows a fixed insurance price and waits for a response ("yes" or "no").

Policy Generation: If confirmed, the bot generates and sends an insurance policy with user-specific details.

Retry Option: At any point, the user can restart the process using /retry.

3. AVAILABLE COMMANDS

/start – Begins the insurance purchasing process.

/help – Lists available commands and their descriptions.

/retry – Restarts the process, allowing the user to reupload documents.

/confirm – Confirms the extracted data and proceeds to pricing.

4. ERROR HANDLING
The bot includes built-in error handling for:

Missing or invalid environment variables (e.g. bot token).

Actions attempted out of sequence (e.g. sending /confirm before completing previous steps).

Duplicate image uploads (passport and vehicle images must be different).

Failures during AI-based document parsing.

General system or API errors, which trigger friendly user-facing error messages.

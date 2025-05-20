// discord_bot.js
// This script runs the Discord bot using discord.js
// It handles messages, commands, and communicates with Ollama for AI responses and image processing.
// It also integrates with Google Custom Search and uses SQLite for persistent storage of conversation history and filters.

const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const fs = require('fs');
const axios = require('axios'); // For making HTTP requests to Ollama and Google CSE
const { Buffer } = require('buffer'); // Import Buffer for handling image data
const sqlite3 = require('sqlite3').verbose(); // Import sqlite3 for database operations

// --- Voice Functionality Imports (if you plan to use it) ---
// Ensure these are installed: npm install @discordjs/voice opusscript
const { joinVoiceChannel, createAudioPlayer, createAudioResource, NoSubscriberBehavior, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { EndBehaviorType, getVoiceConnection } = require('@discordjs/voice');
const { Readable } = require('stream');
// --- End Voice Functionality Imports ---


// Load configuration from config.json
let config;
try {
    config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
} catch (error) {
    console.error('Error loading config.json:', error);
    console.error('Please ensure config.json exists and is valid JSON.');
    process.exit(1);
}

// --- Configuration Variables (from config.json) ---
const TOKEN = config.token; // Your Discord bot token
const CLIENT_ID = config.client_id; // Your bot's client ID for slash commands
const GUILD_ID = config.guild_id; // The guild ID for registering commands (for testing) - optional for global
const OLLAMA_API_URL = config.ollama_api_url; // e.g., 'http://localhost:11434'
const OLLAMA_MODEL = config.ollama_model; // e.g., 'llama3.2'
const GOOGLE_CSE_API_KEY = config.google_cse_api_key;
const GOOGLE_CSE_ID = config.google_cse_id;
const PYTHON_BACKEND_URL = config.python_backend_url || 'http://localhost:5000'; // Base URL for the Python backend (for Whisper)
const WHISPER_TRANSCRIBE_ENDPOINT = `${PYTHON_BACKEND_URL}/transcribe`; // Endpoint for Whisper
const OLLAMA_VISION_MODEL = config.ollama_vision_model || 'llava'; // Vision model name from config (e.g., 'llava', 'llama3.2-vision')

const CHANNELS_TO_MESSAGE = config.channels_to_message || []; // Array of channel IDs for random messages
const SEND_RANDOM_MESSAGES_INTERVAL = config.send_random_messages_interval || 3600 * 1000; // Default to 1 hour in milliseconds
const AI_RANDOM_MESSAGE_PROMPT = config.ai_random_message_prompt || "Generate a random message.";
const AI_TRIGGERED_MESSAGE_PROMPT = config.ai_triggered_MESSAGE_PROMPT || "Respond to the user message based on the conversation history.";
const AI_IMAGE_PROMPT = config.ai_image_prompt || "Describe this image.";
const OWNER_BYPASS_ID = config.owner_bypass_id; // Optional: User ID for filter bypass (e.g., your Discord user ID)

// --- Memory and Database Configuration ---
const DB_FILE = config.database_file || 'miku_history.db'; // SQLite database file
const RAM_CACHE_SIZE = config.ram_cache_size || 50; // Number of recent messages to keep in RAM cache
const conversationHistory = new Map(); // Map to store message history in RAM cache (conversationId -> [messages])
let db; // Variable to hold the database connection

// --- Filter Configuration ---
const filteredWordsCache = new Map(); // Map to store filtered words in RAM cache (guildId -> Set<words>)


// --- Basic configuration checks ---
if (!TOKEN || TOKEN === "YOUR_BOT_TOKEN") {
    console.error("Error: Please replace 'YOUR_BOT_TOKEN' with your actual bot token in config.json.");
    process.exit(1);
}
if (!CLIENT_ID || CLIENT_ID === "YOUR_CLIENT_ID") {
     console.warn("Warning: CLIENT_ID is not configured in config.json for slash commands. Slash commands will not work.");
}
if (!GUILD_ID || GUILD_ID === "YOUR_GUILD_ID") {
    console.warn("Warning: GUILD_ID is not configured in config.json. Slash commands will be registered globally (takes up to an hour) instead of to a specific guild (instant for testing).");
}
if (!OLLAMA_API_URL || !OLLAMA_MODEL) {
    console.warn("Warning: Ollama API URL or Model is missing in config.json. AI functionality may not work.");
}
if (!GOOGLE_CSE_API_KEY || !GOOGLE_CSE_ID) {
    console.warn("Warning: Google CSE API Key or ID is missing in config.json. Search functionality may not work.");
}
if (!PYTHON_BACKEND_URL) {
     console.warn("Warning: Python backend URL is not configured. Voice processing may not work.");
}


// Initialize Discord Client with necessary intents
// NOTE: For a bot account, you need to enable the required intents in the Discord Developer Portal.
// GUILD_MESSAGES and DIRECT_MESSAGES are typically needed for message handling.
// MESSAGE_CONTENT is crucial for accessing message.content.
// GUILD_VOICE_STATES is needed for voice functionality.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent, // REQUIRED for accessing message.content
        GatewayIntentBits.GuildVoiceStates, // Required for voice functionality
    ]
});

// Map to store voice receivers for each guild (for voice functionality)
const voiceReceivers = new Map();

// --- Bot Ready Event ---
client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    // Initialize the database
    await initDatabase();

    // Load initial filters into cache from database
    await loadAllFilters();

    // Register slash commands (e.g., /filter)
    await registerSlashCommands();

    // Start the random AI messages task if configured
    if (CHANNELS_TO_MESSAGE.length > 0 && SEND_RANDOM_MESSAGES_INTERVAL > 0) {
        setInterval(sendRandomAIMessage, SEND_RANDOM_MESSAGES_INTERVAL);
    }
});

// --- Slash Command Definitions ---
const commands = [
    {
        name: 'filter',
        description: 'Manage AI response filters for this server.',
        options: [
            {
                name: 'add',
                description: 'Add a word to the filter list.',
                type: 1, // SUB_COMMAND
                options: [
                    {
                        name: 'word',
                        description: 'The word to add to the filter.',
                        type: 3, // STRING
                        required: true,
                    },
                ],
            },
            {
                name: 'remove',
                description: 'Remove a word from the filter list.',
                type: 1, // SUB_COMMAND
                options: [
                    {
                        name: 'word',
                        description: 'The word to remove from the filter.',
                        type: 3, // STRING
                        required: true,
                    },
                ],
            },
            {
                name: 'list',
                description: 'List current filtered words.',
                type: 1, // SUB_COMMAND
            },
        ],
    },
];

// --- Function to Register Slash Commands ---
async function registerSlashCommands() {
    if (!CLIENT_ID) {
        console.warn("Skipping slash command registration: CLIENT_ID is not configured.");
        return;
    }

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        let data;
        if (GUILD_ID) {
            // Register commands to a specific guild (faster for testing)
            data = await rest.put(
                Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
                { body: commands },
            );
            console.log(`Successfully reloaded ${data.length} application (/) commands for guild ${GUILD_ID}.`);
        } else {
            // Register commands globally (takes up to an hour to propagate)
             data = await rest.put(
                Routes.applicationCommands(CLIENT_ID),
                { body: commands },
            );
             console.log(`Successfully reloaded ${data.length} global application (/) commands.`);
        }
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
}

// --- Interaction (Slash Command) Handler ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'filter') {
        // --- Permission Check ---
        const userId = interaction.user.id;
        const guild = interaction.guild;

        // Only allow bot owner or guild owner to manage filters
        if (userId !== OWNER_BYPASS_ID && (guild && userId !== guild.ownerId)) {
            await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
            return;
        }

        // If command used in DM, only bot owner can use it (guild is null)
        if (!guild && userId !== OWNER_BYPASS_ID) {
             await interaction.reply({ content: 'This command can only be used by the bot owner in DMs, or by the bot owner/server owner in a server.', ephemeral: true });
             return;
        }
        // --- End Permission Check ---

        const subCommand = options.getSubcommand();
        const guildId = interaction.guildId; // Guild ID is needed for per-server filters

        if (subCommand === 'add') {
            const word = options.getString('word').toLowerCase();
            try {
                const added = await addFilteredWord(guildId, word);
                if (added) {
                    await interaction.reply({ content: `Added "${word}" to the filter list for this server.`, ephemeral: true });
                } else {
                    await interaction.reply({ content: `"${word}" is already in the filter list for this server.`, ephemeral: true });
                }
            } catch (error) {
                 console.error(`Error adding filtered word "${word}" for guild ${guildId}:`, error);
                 await interaction.reply({ content: `Failed to add "${word}" to the filter list.`, ephemeral: true });
            }
        } else if (subCommand === 'remove') {
             const word = options.getString('word').toLowerCase();
            try {
                const removed = await removeFilteredWord(guildId, word);
                if (removed) {
                    await interaction.reply({ content: `Removed "${word}" from the filter list for this server.`, ephemeral: true });
                } else {
                     await interaction.reply({ content: `"${word}" was not found in the filter list for this server.`, ephemeral: true });
                }
            } catch (error) {
                 console.error(`Error removing filtered word "${word}" for guild ${guildId}:`, error);
                 await interaction.reply({ content: `Failed to remove "${word}" from the filter list.`, ephemeral: true });
            }
        } else if (subCommand === 'list') {
            try {
                const words = await getFilteredWords(guildId);
                if (words.length > 0) {
                    await interaction.reply({ content: `Filtered words for this server: ${words.join(', ')}`, ephemeral: true });
                } else {
                    await interaction.reply({ content: 'There are no filtered words for this server.', ephemeral: true });
                }
            } catch (error) {
                 console.error(`Error listing filtered words for guild ${guildId}:`, error);
                 await interaction.reply({ content: 'Failed to retrieve filtered words.', ephemeral: true });
            }
        }
    }
});


// --- Message Create Event (Main Logic) ---
client.on('messageCreate', async message => {
    // Ignore messages from bots (including self)
    if (message.author.bot) return;

    // Determine the conversation ID (channel ID for guilds, user ID for DMs)
    const conversationId = message.channel.type === 1 ? message.author.id : message.channel.id;

    // Save the user's message to the database for history
    saveMessageToDatabase(conversationId, message);

    // Get or create history for this conversation in RAM cache
    if (!conversationHistory.has(conversationId)) {
        await loadRecentHistory(conversationId);
    }
    const history = conversationHistory.get(conversationId);

    // Add the current user message to RAM history
    history.push({
        author: message.author.username,
        content: message.content,
        type: 'user' // Mark as user message
    });

    // Trim RAM history if it exceeds the cache size
    if (history.length > RAM_CACHE_SIZE) {
        history.shift(); // Remove the oldest message from RAM cache
    }

    // --- Handle Direct Messages (DMs) ---
    if (message.channel.type === 1) { // DM channel type is 1
        console.log(`Received DM from ${message.author.tag}: ${message.content}`);
        if (OLLAMA_API_URL && OLLAMA_MODEL) {
            try {
                const formattedHistory = formatHistory(history);
                const initialPrompt = `${AI_TRIGGERED_MESSAGE_PROMPT}\n${formattedHistory}User: ${message.content}\nAI:`;
                let aiResponse = await generateAIResponse(initialPrompt);

                // Clean AI Response (remove potential thought process tags)
                aiResponse = cleanAiResponse(aiResponse);

                // --- Check for Search Syntax ---
                const searchMatch = aiResponse.match(/\[SEARCH:(.*?)\]/i); // Case-insensitive match
                let finalAiResponse = aiResponse; // Start with the initial response

                if (searchMatch && searchMatch[1]) {
                    const searchQuery = searchMatch[1].trim();
                    console.log(`[Search Process] Detected search query: "${searchQuery}"`);

                    // Perform the search
                    console.log(`[Search Process] Performing Google search for: "${searchQuery}"`);
                    const searchResult = await googleSearch(searchQuery);
                    console.log(`[Search Process] Google search complete. Results: ${searchResult ? searchResult.substring(0, 100) + '...' : 'No results'}`);

                    // Format search results for the AI, making them prominent
                    const formattedSearchResult = `\n\n--- SEARCH RESULTS FOR "${searchQuery}" ---\n${searchResult}\n--- END SEARCH RESULTS ---\n\n`;

                    // Construct a new prompt including the original response and search results
                    console.log(`[Search Process] Constructing follow-up prompt.`);
                    const followUpPrompt = `${AI_TRIGGERED_MESSAGE_PROMPT}\n${formattedHistory}User: ${message.content}\nAI (Initial Response): ${aiResponse}\n${formattedSearchResult}AI (Final Response):`;

                    // Send the follow-up prompt to the AI
                    console.log(`[Search Process] Sending follow-up prompt to AI.`);
                    finalAiResponse = await generateAIResponse(followUpPrompt);
                    console.log(`[Search Process] Second AI response received.`);

                    // Clean Final AI Response (remove potential thought process tags)
                    finalAiResponse = cleanAiResponse(finalAiResponse);
                    console.log(`[Search Process] Final AI response cleaned.`);
                }
                // --- End Check for Search Syntax ---

                // --- Apply Filter to Final AI Response ---
                // No guildId for DMs, so filters won't apply unless you implement global filters
                if (containsFilteredWord(finalAiResponse, null)) {
                     await message.channel.send("My response contained filtered words and could not be sent.");
                     console.log(`[Search Process] Final response filtered.`);
                } else {
                    console.log(`[Search Process] Sending final response to Discord.`);
                    const sentMessage = await message.channel.send(finalAiResponse);
                    console.log(`[Search Process] Final response sent and saved.`);
                    saveBotResponseToDatabase(conversationId, sentMessage);
                    history.push({
                        author: client.user.username,
                        content: sentMessage.content,
                        type: 'bot'
                    });
                }
            } catch (error) {
                console.error('Error processing DM with AI:', error);
                await message.channel.send('Sorry, I had trouble processing that with AI.');
                console.log(`[Search Process] Caught error: ${error.message}`);
            }
        } else {
             await message.channel.send("AI functionality is not configured for DMs.");
        }
        return; // Stop processing DMs further
    }

    // --- Handle Guild Messages ---
    console.log(`Message from ${message.author.tag} in ${message.guild.name}: ${message.content}`);

    // --- Image Processing Logic ---
    if (message.attachments.size > 0) {
        const imageAttachment = message.attachments.find(attachment =>
            attachment.contentType && attachment.contentType.startsWith('image/')
        );

        // Trigger image processing if bot is mentioned or !analyze command is used
        const isTriggeredForImage = message.mentions.users.has(client.user.id) || message.content.toLowerCase().startsWith('!analyze');

        if (imageAttachment && isTriggeredForImage) {
            console.log(`Image attachment found and triggered: ${imageAttachment.name}`);

            let imagePrompt = AI_IMAGE_PROMPT; // Default prompt for image analysis
            const commandPrefix = '!analyze';
            if (message.content.toLowerCase().startsWith(commandPrefix)) {
                imagePrompt = message.content.substring(commandPrefix.length).trim();
                if (!imagePrompt) {
                     imagePrompt = AI_IMAGE_PROMPT;
                     message.channel.send("No specific prompt provided after !analyze, using default prompt: '" + AI_IMAGE_PROMPT + "'");
                 }
            } else if (message.mentions.users.has(client.user.id)) {
                 imagePrompt = message.content.replace(`<@${client.user.id}>`, '').trim();
                 if (!imagePrompt) {
                     imagePrompt = AI_IMAGE_PROMPT;
                     message.channel.send("No specific prompt provided with mention, using default prompt: '" + AI_IMAGE_PROMPT + "'");
                 }
            }

            try {
                // Download the image
                const response = await axios.get(imageAttachment.url, { responseType: 'arraybuffer' });
                const imageBuffer = Buffer.from(response.data);

                await message.channel.send(`Analyzing image with prompt: "${imagePrompt}"...`);
                const analysisResult = await processImageWithOllamaVision(imageBuffer, imagePrompt);

                 // Integrate Analysis into Main AI Prompt
                 const formattedAnalysis = `AI analyzed image: ${analysisResult}`;
                 const historyWithAnalysis = [...history, { author: client.user.username, content: formattedAnalysis, type: 'bot_analysis' }];
                 const formattedCombinedHistory = formatHistory(historyWithAnalysis);

                 const finalPrompt = `${AI_TRIGGERED_MESSAGE_PROMPT}\n${formattedCombinedHistory}User: ${message.content}\nAI:`;
                 let finalAiResponse = await generateAIResponse(finalPrompt);

                 // Clean Final AI Response (remove potential thought process tags)
                 finalAiResponse = cleanAiResponse(finalAiResponse);

                 // Check for Search Syntax in the final response (after image analysis)
                 const searchMatch = finalAiResponse.match(/\[SEARCH:(.*?)\]/i);
                 let responseToSend = finalAiResponse;

                 if (searchMatch && searchMatch[1]) {
                    const searchQuery = searchMatch[1].trim();
                    console.log(`[Search Process - Image] AI requested search for: "${searchQuery}" after image analysis.`);
                    const searchResult = await googleSearch(searchQuery);
                    console.log(`[Search Process - Image] Google search complete. Results: ${searchResult ? searchResult.substring(0, 100) + '...' : 'No results'}`);

                    const formattedSearchResult = `\n\n--- SEARCH RESULTS FOR "${searchQuery}" ---\n${searchResult}\n--- END SEARCH RESULTS ---\n\n`;

                    // For simplicity after image analysis, we'll directly replace the search tag
                    // in the current response with the result, rather than a third AI call.
                    console.warn("[Search Process - Image] Note: Performing direct replacement of SEARCH tag in final response after image analysis. No second AI call is made here to avoid complexity and potential loops.");
                    responseToSend = finalAiResponse.replace(searchMatch[0], `(Search Result: ${searchResult})`);
                 }

                 // Apply Filter to Final AI Response
                 if (containsFilteredWord(responseToSend, message.guildId)) {
                     await message.channel.send("My response contained filtered words and could not be sent.");
                     console.log(`[Search Process - Image] Final response filtered.`);
                 } else {
                    console.log(`[Search Process - Image] Sending final response to Discord.`);
                    const sentMessage = await message.channel.send(responseToSend);
                    console.log(`[Search Process - Image] Final response sent and saved.`);
                    saveBotResponseToDatabase(conversationId, sentMessage);
                    history.push({
                        author: client.user.username,
                        content: sentMessage.content,
                        type: 'bot'
                    });
                 }
            } catch (error) {
                console.error('Error processing image and generating response:', error);
                message.channel.send('Sorry, I had trouble processing that image or generating a response.');
                console.log(`[Search Process - Image] Caught error: ${error.message}`);
            }
            return; // Stop processing if an image was handled
        }
    }

    // --- AI Triggered Message Logic (for guild messages) ---
    // Respond ONLY if mentioned and no image was processed
    if (OLLAMA_API_URL && OLLAMA_MODEL && message.mentions.users.has(client.user.id)) {
        try {
            const formattedHistory = formatHistory(history);
            const initialPrompt = `${AI_TRIGGERED_MESSAGE_PROMPT}\n${formattedHistory}User: ${message.content}\nAI:`;
            let aiResponse = await generateAIResponse(initialPrompt);

            // Clean AI Response (remove potential thought process tags)
            aiResponse = cleanAiResponse(aiResponse);

            // --- Check for Search Syntax ---
            const searchMatch = aiResponse.match(/\[SEARCH:(.*?)\]/i);
            let finalAiResponse = aiResponse;

            if (searchMatch && searchMatch[1]) {
                const searchQuery = searchMatch[1].trim();
                console.log(`[Search Process] Detected search query: "${searchQuery}"`);

                // Perform the search
                console.log(`[Search Process] Performing Google search for: "${searchQuery}"`);
                const searchResult = await googleSearch(searchQuery);
                console.log(`[Search Process] Google search complete. Results: ${searchResult ? searchResult.substring(0, 100) + '...' : 'No results'}`);

                // Format search results for the AI, making them prominent
                const formattedSearchResult = `\n\n--- SEARCH RESULTS FOR "${searchQuery}" ---\n${searchResult}\n--- END SEARCH RESULTS ---\n\n`;

                // Construct a new prompt including the original response and search results
                console.log(`[Search Process] Constructing follow-up prompt.`);
                const followUpPrompt = `${AI_TRIGGERED_MESSAGE_PROMPT}\n${formattedHistory}User: ${message.content}\nAI (Initial Response): ${aiResponse}\n${formattedSearchResult}AI (Final Response):`;

                // Send the follow-up prompt to the AI
                console.log(`[Search Process] Sending follow-up prompt to AI.`);
                finalAiResponse = await generateAIResponse(followUpPrompt);
                console.log(`[Search Process] Second AI response received.`);

                // Clean Final AI Response (remove potential thought process tags)
                finalAiResponse = cleanAiResponse(finalAiResponse);
                console.log(`[Search Process] Final AI response cleaned.`);
            }
            // --- End Check for Search Syntax ---

            // --- Apply Filter to Final AI Response ---
            if (containsFilteredWord(finalAiResponse, message.guildId)) {
                 await message.channel.send("My response contained filtered words and could not be sent.");
                 console.log(`[Search Process] Final response filtered.`);
            } else {
                console.log(`[Search Process] Sending final response to Discord.`);
                const sentMessage = await message.channel.send(finalAiResponse);
                console.log(`[Search Process] Final response sent and saved.`);
                saveBotResponseToDatabase(conversationId, sentMessage);
                history.push({
                    author: client.user.username,
                    content: sentMessage.content,
                    type: 'bot'
                });
            }
        } catch (error) {
            console.error('Error generating/sending triggered AI message:', error);
            await message.channel.send('Sorry, I had trouble generating a response.');
            console.log(`[Search Process] Caught error: ${error.message}`);
        }
    } else {
        // console.warn("AI functionality is not configured or bot not mentioned. Skipping triggered messages.");
    }

    // --- Handle Simple Commands (e.g., !join, !leave, !search) ---
    // Note: Slash commands are preferred for /filter. These are for basic text commands.
    if (message.content.toLowerCase().startsWith('!join')) {
        handleJoinCommand(message);
    } else if (message.content.toLowerCase().startsWith('!leave')) {
        handleLeaveCommand(message);
    } else if (message.content.toLowerCase().startsWith('!search ')) {
        handleSearchCommand(message); // This is a direct search command, separate from AI-triggered search
    }
});

// --- Database Functions (SQLite) ---

// Initialize the SQLite database and create tables if they don't exist
function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(DB_FILE, (err) => {
            if (err) {
                console.error('Error opening database:', err.message);
                reject(err);
            } else {
                console.log('Connected to the SQLite database.');
                db.serialize(() => { // Use serialize to ensure table creation order
                    // Table for storing conversation messages
                    db.run(`CREATE TABLE IF NOT EXISTS messages (
                        conversation_id TEXT,
                        author TEXT,
                        content TEXT,
                        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                        type TEXT -- 'user', 'bot', 'bot_analysis'
                    )`, (err) => {
                        if (err) {
                            console.error('Error creating messages table:', err.message);
                            reject(err);
                        } else {
                            console.log('Messages table ready.');
                            // Table for storing filtered words per guild
                            db.run(`CREATE TABLE IF NOT EXISTS filters (
                                guild_id TEXT,
                                word TEXT UNIQUE,
                                PRIMARY KEY (guild_id, word)
                            )`, (err) => {
                                if (err) {
                                    console.error('Error creating filters table:', err.message);
                                    reject(err);
                                } else {
                                    console.log('Filters table ready.');
                                    resolve(); // Resolve the promise after both tables are ready
                                }
                            });
                        }
                    });
                });
            }
        });
    });
}

// Save a user's message to the database
function saveMessageToDatabase(conversationId, message) {
    if (!db) {
        console.error("Database not initialized. Cannot save message.");
        return;
    }
    const sql = `INSERT INTO messages (conversation_id, author, content, type) VALUES (?, ?, ?, ?)`;
    db.run(sql, [conversationId, message.author.username, message.content, 'user'], function(err) {
        if (err) {
            console.error('Error saving user message to database:', err.message);
        }
    });
}

// Save the bot's response to the database
function saveBotResponseToDatabase(conversationId, message) {
     if (!db) {
        console.error("Database not initialized. Cannot save bot response.");
        return;
    }
    const sql = `INSERT INTO messages (conversation_id, author, content, type) VALUES (?, ?, ?, ?)`;
    db.run(sql, [conversationId, client.user.username, message.content, 'bot'], function(err) {
        if (err) {
            console.error('Error saving bot response to database:', err.message);
        }
    });
}

// Load recent conversation history from the database into RAM cache
async function loadRecentHistory(conversationId) {
     if (!db) {
        console.error("Database not initialized. Cannot load history.");
        return [];
    }
    return new Promise((resolve, reject) => {
        const sql = `SELECT author, content, type FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT ?`;
        db.all(sql, [conversationId, RAM_CACHE_SIZE], (err, rows) => {
            if (err) {
                console.error('Error loading recent history:', err.message);
                conversationHistory.set(conversationId, []); // Initialize with empty array on error
                reject(err);
            } else {
                const history = rows.reverse(); // Oldest messages first for prompt
                conversationHistory.set(conversationId, history);
                console.log(`Loaded ${history.length} recent messages for conversation ${conversationId}.`);
                resolve(history);
            }
        });
    });
}

// --- Filter Database Functions ---

// Load all filtered words from the database into the in-memory cache
async function loadAllFilters() {
     if (!db) {
        console.error("Database not initialized. Cannot load filters.");
        return;
    }
    return new Promise((resolve, reject) => {
        const sql = `SELECT guild_id, word FROM filters`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('Error loading all filters:', err.message);
                reject(err);
            } else {
                filteredWordsCache.clear(); // Clear existing cache before loading
                for (const row of rows) {
                    if (!filteredWordsCache.has(row.guild_id)) {
                        filteredWordsCache.set(row.guild_id, new Set()); // Use Set for efficient lookup
                    }
                    filteredWordsCache.get(row.guild_id).add(row.word);
                }
                console.log(`Loaded filters into cache. Cache size: ${filteredWordsCache.size} guilds.`);
                resolve();
            }
        });
    });
}

// Add a word to the filtered list for a specific guild
async function addFilteredWord(guildId, word) {
    if (!db) {
        throw new Error("Database not initialized. Cannot add filter.");
    }
    return new Promise((resolve, reject) => {
        const sql = `INSERT OR IGNORE INTO filters (guild_id, word) VALUES (?, ?)`; // IGNORE prevents duplicates
        db.run(sql, [guildId, word], function(err) {
            if (err) {
                console.error('Error adding filtered word to database:', err.message);
                reject(err);
            } else {
                if (this.changes > 0) { // Check if a new row was inserted
                    if (!filteredWordsCache.has(guildId)) {
                        filteredWordsCache.set(guildId, new Set());
                    }
                    filteredWordsCache.get(guildId).add(word);
                    console.log(`Added filtered word "${word}" for guild ${guildId}.`);
                    resolve(true); // Word was added
                } else {
                    console.log(`Filtered word "${word}" already exists for guild ${guildId}.`);
                    resolve(false); // Word already existed
                }
            }
        });
    });
}

// Remove a word from the filtered list for a specific guild
async function removeFilteredWord(guildId, word) {
    if (!db) {
        throw new Error("Database not initialized. Cannot remove filter.");
    }
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM filters WHERE guild_id = ? AND word = ?`;
        db.run(sql, [guildId, word], function(err) {
            if (err) {
                console.error('Error removing filtered word from database:', err.message);
                reject(err);
            } else {
                if (this.changes > 0) { // Check if a row was deleted
                    if (filteredWordsCache.has(guildId)) {
                        filteredWordsCache.get(guildId).delete(word);
                        if (filteredWordsCache.get(guildId).size === 0) {
                            filteredWordsCache.delete(guildId); // Remove guild entry if no words left
                        }
                    }
                    console.log(`Removed filtered word "${word}" for guild ${guildId}.`);
                    resolve(true); // Word was removed
                } else {
                    console.log(`Filtered word "${word}" not found for guild ${guildId}.`);
                    resolve(false); // Word not found
                }
            }
        });
    });
}

// Get all filtered words for a specific guild
async function getFilteredWords(guildId) {
    // Prioritize cache lookup for performance
    if (filteredWordsCache.has(guildId)) {
        return Array.from(filteredWordsCache.get(guildId));
    }
    if (!db) {
        console.error("Database not initialized. Cannot get filters.");
        return [];
    }
    return new Promise((resolve, reject) => {
        const sql = `SELECT word FROM filters WHERE guild_id = ?`;
        db.all(sql, [guildId], (err, rows) => {
            if (err) {
                console.error('Error getting filtered words from database:', err.message);
                reject(err);
            } else {
                const words = rows.map(row => row.word);
                // Populate cache for future lookups
                if (!filteredWordsCache.has(guildId)) {
                     filteredWordsCache.set(guildId, new Set(words));
                } else {
                     words.forEach(word => filteredWordsCache.get(guildId).add(word));
                }
                resolve(words);
            }
        });
    });
}

// Check if a given text contains any filtered words for a guild
function containsFilteredWord(text, guildId) {
    if (!text || typeof text !== 'string') {
        return false;
    }
    const guildFilters = filteredWordsCache.get(guildId) || new Set();
    const lowerText = text.toLowerCase();
    for (const word of guildFilters) {
        // Use word boundaries (\b) for more accurate matching (e.g., "bad" won't match "badger")
        const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i'); // 'i' for case-insensitive
        if (regex.test(lowerText)) {
            console.log(`Filtered word found: "${word}" in text: "${text}"`);
            return true;
        }
    }
    return false;
}

// Helper function to escape special characters for regex
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// --- Helper function to format conversation history for the AI prompt ---
function formatHistory(history) {
    if (!history || history.length === 0) {
        return "";
    }
    // Format history based on message type for the AI
    return history.map(msg => {
        if (msg.type === 'user') {
            return `User: ${msg.content}`;
        } else if (msg.type === 'bot') {
            return `AI: ${msg.content}`;
        } else if (msg.type === 'bot_analysis') {
             return `AI analyzed image: ${msg.content}`; // Special formatting for image analysis results
        }
        return `${msg.author}: ${msg.content}`; // Fallback, should ideally be covered by types
    }).join('\n') + '\n';
}

// --- Function to clean AI response from DeepSeek's <think> tags ---
function cleanAiResponse(responseText) {
    if (!responseText || typeof responseText !== 'string') {
        return responseText;
    }

    let cleanedText = responseText;

    // Regex to specifically target content between <think> and </think> tags, including the tags themselves.
    // The 's' flag makes '.' match newline characters as well, allowing it to span multiple lines.
    // The 'g' flag ensures all occurrences are replaced.
    const deepseekThoughtRegex = /<think>[\s\S]*?<\/think>/gs;

    cleanedText = cleanedText.replace(deepseekThoughtRegex, '').trim();

    // After removing potential thought blocks, trim leading/trailing whitespace and newlines
    cleanedText = cleanedText.trim();

    // Optional: If cleaning resulted in an empty string, return a default response
    if (cleanedText === "") {
        return "Hmm, I processed something but it didn't make sense! Can you try again? ✨";
    }

    return cleanedText;
}


// --- Command Handlers (for !join, !leave, !search) ---

// Handles the !join command to make the bot join a voice channel
async function handleJoinCommand(message) {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
        return message.reply('You need to be in a voice channel to make me join!');
    }

    const existingConnection = getVoiceConnection(message.guild.id);
    if (existingConnection) {
        return message.reply(`I'm already in voice channel: ${existingConnection.channel.name}`);
    }

    try {
        const connection = joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: voiceChannel.guild.id,
            adapterCreator: voiceChannel.guild.voiceAdapterCreator,
            selfDeaf: false, // Set to true if you don't want the bot to receive audio
        });

        connection.on(VoiceConnectionStatus.Ready, () => {
            console.log('The connection has entered the Ready state!');
            message.channel.send(`Joined voice channel: ${voiceChannel.name}`);
            // Start listening for audio after joining
            startListening(connection, message.channel);
        });

        connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
                // Seems to be reconnecting, ignore disconnect
            } catch (error) {
                // Seems like a real disconnect
                console.log('Voice connection disconnected.');
                voiceReceivers.delete(message.guild.id); // Clean up receiver map
                message.channel.send('Disconnected from voice channel.');
            }
        });
    } catch (error) {
        console.error('Error joining voice channel:', error);
        message.reply('Failed to join the voice channel.');
    }
}

// Handles the !leave command to make the bot leave a voice channel
async function handleLeaveCommand(message) {
    const connection = getVoiceConnection(message.guild.id);
    if (!connection) {
        return message.reply('I am not in a voice channel in this server.');
    }
    try {
        connection.destroy();
        voiceReceivers.delete(message.guild.id); // Clean up receiver map
        message.reply('Left the voice channel.');
    } catch (error) {
        console.error('Error leaving voice channel:', error);
        message.reply('Failed to leave the voice channel.');
    }
}

// Handles the !search command for direct Google searches (separate from AI-triggered search)
async function handleSearchCommand(message) {
    const query = message.content.substring('!search '.length).trim();
    if (!query) {
        return message.reply('Please provide a search query after !search.');
    }
    try {
        const searchResult = await googleSearch(query);
        message.channel.send(`Search result for "${query}": ${searchResult}`);
    } catch (error) {
        console.error('Error performing search:', error);
        message.channel.send('Sorry, I had trouble performing that search.');
    }
}

// --- Voice Listening and Processing (requires Python backend with Whisper) ---

// Starts listening for audio in the joined voice channel
function startListening(connection, textChannel) {
    const receiver = connection.receiver;
    if (!receiver) {
        console.error("Voice receiver is not available from the connection.");
        textChannel.send("Error setting up voice receiver.");
        return;
    }
    voiceReceivers.set(textChannel.guild.id, receiver);
    console.log('Started listening for audio.');
    textChannel.send('Started listening for audio...');

    receiver.speaking.on('start', userId => {
        console.log(`User ${userId} started speaking.`);
        if (typeof receiver.createAudioStream !== 'function') {
            console.error("receiver.createAudioStream is not a function. Voice recording may not be supported.");
            textChannel.send("Voice recording is not supported in this environment or there was an issue initializing voice.");
            return;
        }

        const audioStream = receiver.createAudioStream(userId, {
            mode: 'pcm', // Use PCM mode for raw audio
            end: 'silence', // End the stream after a period of silence
            endThreshold: 1000, // Silence threshold in milliseconds
            decode: true, // Decode the audio
        });

        const chunks = [];
        audioStream.on('data', chunk => {
            chunks.push(chunk);
        });

        audioStream.on('end', async () => {
            console.log(`User ${userId} stopped speaking. Processing audio...`);
            const audioBuffer = Buffer.concat(chunks);

            if (audioBuffer.length > 0) {
                try {
                    const transcription = await transcribeAudioWithPython(audioBuffer);
                    const user = client.users.cache.get(userId);
                    const username = user ? user.username : `User ID ${userId}`;
                    textChannel.send(`${username}: ${transcription}`);
                } catch (error) {
                    console.error('Error transcribing audio:', error);
                    textChannel.send(`Error processing audio from User ID ${userId}.`);
                }
            } else {
                console.log(`No audio data recorded for user ${userId}.`);
            }
        });

        audioStream.on('error', error => {
            console.error(`Error in audio stream for user ${userId}:`, error);
        });
    });
}

// Sends audio data to a Python backend for Whisper transcription
async function transcribeAudioWithPython(audioBuffer) {
    if (!WHISPER_TRANSCRIBE_ENDPOINT) {
        throw new Error("Python backend Whisper endpoint is not configured.");
    }
    try {
        const response = await axios.post(WHISPER_TRANSCRIBE_ENDPOINT, audioBuffer, {
            headers: { 'Content-Type': 'application/octet-stream' }
        });
        return response.data.transcription || "Could not transcribe audio.";
    } catch (error) {
        console.error('Error communicating with Python backend for transcription:', error);
        if (error.response) {
            throw new Error(`Python backend transcription error: Status ${error.response.status} - ${error.response.data}`);
        } else if (error.request) {
            throw new Error("No response received from Python backend for transcription.");
        } else {
            throw new Error(`Error setting up transcription request to Python backend: ${error.message}`);
        }
    }
}

// --- AI and Search Functionality ---

// Sends image data and prompt to Ollama Vision Model for analysis
async function processImageWithOllamaVision(imageBuffer, prompt) {
     if (!OLLAMA_API_URL || !OLLAMA_VISION_MODEL) {
        throw new Error("Ollama API URL or Vision Model is not configured for image processing.");
    }
    try {
        const response = await axios.post(`${OLLAMA_API_URL}/api/generate`, {
            model: OLLAMA_VISION_MODEL,
            prompt: prompt,
            images: [imageBuffer.toString('base64')], // Send image as base64
            stream: false // Get the full response at once
        });
        return response.data.response || "Could not process image.";
    } catch (error) {
        console.error('Error communicating with Ollama for image processing:', error);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
            throw new Error(`Ollama image processing error: Status ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            throw new Error("No response received from Ollama for image processing.");
        } else {
            throw new Error(`Error setting up image processing request to Ollama: ${error.message}`);
        }
    }
}


// Generates a text response from the main Ollama AI model
async function generateAIResponse(prompt) {
    if (!OLLAMA_API_URL || !OLLAMA_MODEL) {
        throw new Error("Ollama API URL or Model is not configured.");
    }
    try {
        const response = await axios.post(`${OLLAMA_API_URL}/api/generate`, {
            model: OLLAMA_MODEL,
            prompt: prompt,
            stream: false // Set to false to get the full response at once
        });
        return response.data.response.trim() || "I'm confused!";
    } catch (error) {
        console.error('Error generating AI response:', error);
        if (error.response) {
            throw new Error(`Ollama AI response error: Status ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
             throw new Error("No response received from Ollama for AI response.");
        } else {
            throw new Error(`Error setting up AI request to Ollama: ${error.message}`);
        }
    }
}

// Performs a Google Custom Search
async function googleSearch(query) {
    if (!GOOGLE_CSE_API_KEY || !GOOGLE_CSE_ID) {
        return "[search_error: Google CSE API Key or ID is not configured.]";
    }
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${GOOGLE_CSE_API_KEY}&cx=${GOOGLE_CSE_ID}`;
    try {
        const response = await axios.get(url);
        const data = response.data;
        const items = data.items || [];

        if (items.length > 0) {
            let searchResultsString = "";
            items.forEach((item, index) => {
                const snippet = item.snippet || 'No snippet available.';
                const truncatedSnippet = snippet.length > 200 ? snippet.substring(0, 197) + '...' : snippet;
                searchResultsString += `${index + 1}. ${item.title || 'No Title'}: ${item.link || 'No Link'} - ${truncatedSnippet}\n`;
            });
            return searchResultsString.trim();
        } else {
            return "No search results found.";
        }
    } catch (error) {
        console.error('Error performing Google search:', error);
        if (error.response) {
            return `[search_error: Received status ${error.response.status} - ${JSON.stringify(error.response.data)}]`;
        } else if (error.request) {
             return `[search_error: No response received from Google Search API.]`;
        } else {
            return `[search_error: Error setting up search request: ${error.message}]`;
        }
    }
}

// Sends a random AI message to a configured channel (if enabled)
async function sendRandomAIMessage() {
    if (CHANNELS_TO_MESSAGE.length === 0 || !OLLAMA_API_URL || !OLLAMA_MODEL) {
        return;
    }
    const randomChannelId = CHANNELS_TO_MESSAGE[Math.floor(Math.random() * CHANNELS_TO_MESSAGE.length)];
    const channel = client.channels.cache.get(randomChannelId);

    if (channel) {
        try {
            const prompt = AI_RANDOM_MESSAGE_PROMPT;
            let aiResponse = await generateAIResponse(prompt);
            aiResponse = cleanAiResponse(aiResponse); // Clean response before sending
            const sentMessage = await channel.send(aiResponse);
            saveBotResponseToDatabase(sentMessage.channel.id, sentMessage);
        } catch (error) {
            console.error(`Error sending random AI message to channel ${randomChannelId}:`, error);
        }
    } else {
        console.warn(`Configured channel ID ${randomChannelId} not found.`);
    }
}


// --- Bot Login and Error Handling ---
client.login(TOKEN);

client.on('error', console.error);
client.on('warn', console.warn);

// Handle unhandled promise rejections to prevent crashes
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Close the database connection gracefully when the bot stops
process.on('SIGINT', () => {
    if (db) {
        db.close((err) => {
            if (err) {
                console.error('Error closing database:', err.message);
            }
            console.log('Database connection closed.');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
});

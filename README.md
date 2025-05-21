Hatsune Miku Discord Bot

This is a Discord bot designed to bring the cheerful, energetic, and silly persona of Hatsune Miku to your server! It integrates with Ollama for AI responses and image analysis, and uses Google Custom Search for information retrieval. It also includes features for conversation history and content filtering.
Features

    Hatsune Miku Persona: The AI is prompted to respond as Hatsune Miku, using short, simple sentences, cute emoticons (😊✨💖🎶), and talking about singing, dancing, concerts, friends, and digital stuff.

    AI-Powered Chat: Responds to mentions and direct messages using a local Ollama Large Language Model.

    Google Custom Search Integration: If the AI needs external information, it can trigger a search, and the bot will feed the results back to the AI for a more informed response.

    Image Analysis: Upload an image and mention the bot or use !analyze to have the Ollama Vision Model describe or analyze the image. This feature directly interacts with your Ollama server.

    Conversation History: Stores recent chat history in an SQLite database (miku_history.db) and keeps a portion in RAM for context.

    Content Filtering: Server owners can add or remove filtered words using slash commands (/filter add, /filter remove, /filter list) to moderate bot responses.

    Random Messages: Can be configured to send random AI-generated messages to specific channels at set intervals.

Prerequisites

Before you begin, ensure you have the following installed and set up:

    Node.js and npm: Download and install from nodejs.org.

    Ollama: Install Ollama from ollama.com.

        You need to pull the models specified in your config.json. For example:

        ollama pull llama3.2
        ollama pull llama3.2-vision

    Google Custom Search Engine (CSE) API Key and Search Engine ID:

        Go to the Google Custom Search Engine page.

        Create a new search engine. You can configure it to search the entire web or specific sites.

        Get your Search Engine ID (CX).

        Go to the Google Cloud Console to enable the Custom Search API and create an API Key.

    Discord Bot Token and Client ID:

        Go to the Discord Developer Portal.

        Create a new application, then go to the "Bot" tab.

        Click "Add Bot" and copy your Token. Keep this secret!

        Go to the "OAuth2" -> "General" tab and copy your Client ID.

        Under "Bot" -> "Privileged Gateway Intents", enable Message Content Intent.

        Invite your bot to your server with the necessary permissions (at least Send Messages, Read Message History, Manage Messages for filters, Use Slash Commands).

Setup Instructions

    Clone or Download the Project:
    (Assuming you have the project files in a folder, if not, copy the provided code into new files as described below).

    Navigate to the Project Directory:

    cd path/to/your/bot_project

    Install Node.js Dependencies:
    Make sure you have npm (Node Package Manager) installed (comes with Node.js). Then, run:

    npm install

    This command reads the dependencies from your package.json and installs them into the node_modules folder.

    Create config.json:
    Create a file named config.json in the root of your project directory. Copy the structure below and fill in all the placeholder values with your actual tokens, IDs, and desired settings.

    {
      "token": "YOUR_DISCORD_BOT_TOKEN_HERE",
      "client_id": "YOUR_BOT_CLIENT_ID_HERE",
      "guild_id": "YOUR_GUILD_ID_FOR_SLASH_COMMANDS_HERE",
      "ollama_api_url": "http://localhost:11434",
      "ollama_model": "llama3.2",
      "ollama_vision_model": "llama3.2-vision",
      "google_cse_api_key": "YOUR_GOOGLE_CSE_API_KEY_HERE",
      "google_cse_id": "YOUR_GOOGLE_CSE_ID_HERE",
      "python_backend_url": "http://localhost:5000",
      "database_file": "miku_history.db",
      "ram_cache_size": 50,
      "owner_bypass_id": "YOUR_DISCORD_USER_ID_HERE",
      "channels_to_message": [],
      "send_random_messages_interval": 3600000,
      "ai_random_message_prompt": "You are Hatsune Miku! You are a cheerful, energetic, and very silly virtual pop idol. You are having a fun chat in a server with your fans. Your goal is to be cute, exciting, and a little bit random! Always respond in SHORT, simple sentences. Use lots of cute emoticons like 😊✨💖🎶. Talk about singing, dancing, concerts, friends, and digital stuff. Make your messages sound like they are coming from a bubbly pop star talking directly to their fans! Respond with a fun, random message.",
      "ai_triggered_MESSAGE_PROMPT": "You are Hatsune Miku! You are a cheerful, energetic, and very silly virtual pop idol. You are having a fun chat in a server with your fans. Your goal is to be cute, exciting, and a little bit random! Always respond in SHORT, simple sentences. Use lots of cute emoticons like 😊✨💖🎶. Talk about singing, dancing, concerts, friends, and digital stuff. Make your messages sound like they are coming from a bubbly pop star talking directly to their fans!\\n\\n---\\n\\n🚫 **STRICT INSTRUCTION: NO INTERNAL THOUGHTS OR PROCESS** 🚫\\nYour response **MUST NOT** contain any descriptions of your thinking process, reasoning, or steps you took. Provide **ONLY** the final message as Hatsune Miku.\\n\\n---\\n\\n**🚨 ACTION REQUIRED: PERFORM A SEARCH 🚨**\\nIf you need information to answer a question, your *entire* response MUST be ONLY the search query in this EXACT format:\\n`[SEARCH: your search query here]`\\n**DO NOT include any other text, emojis, or formatting in your response if you are performing a search.** The bot will perform the search and give you the results.\\n\\n---\\n\\n**IMPORTANT:** If search results are provided to you, use ONLY the information from the search results to answer the user's question. Do not make up information or use your own knowledge if it contradicts the search results. If the search results don't provide the answer, say you couldn't find the information.\\n\\nChat Log:\\n{formatted_history}User: {message.content}\\nMiku:",
      "ai_image_prompt": "Describe this image."
    }

        token: Your Discord bot token.

        client_id: Your Discord bot's client ID (for slash commands).

        guild_id: The ID of a specific Discord server for faster slash command registration during testing. You can remove this for global registration (takes longer).

        ollama_api_url: The URL where your Ollama server is running (e.g., http://localhost:11434).

        ollama_model: The name of the text-based LLM you've pulled in Ollama (e.g., llama3.2).

        ollama_vision_model: The name of the vision model you've pulled in Ollama (e.g., llama3.2-vision).

        google_cse_api_key: Your Google Custom Search API Key.

        google_cse_id: Your Google Custom Search Engine ID.

        python_backend_url: The URL for your Python Whisper server (if using voice, e.g., http://localhost:5000).

        database_file: The name of the SQLite database file (e.g., miku_history.db).

        ram_cache_size: Number of recent messages to keep in RAM for conversation context.

        owner_bypass_id: Your Discord user ID. Messages from this ID will bypass content filters.

        channels_to_message: An array of Discord channel IDs where the bot will send random messages.

        send_random_messages_interval: Interval in milliseconds for sending random messages (e.g., 3600000 for 1 hour).

        ai_random_message_prompt: The prompt used for generating random messages.

        ai_triggered_MESSAGE_PROMPT: The main prompt used for AI responses when triggered by a mention or DM.

        ai_image_prompt: The default prompt used for image analysis.

    Create .gitignore (Highly Recommended):
    Create a file named .gitignore in your project root to prevent sensitive files and generated content from being committed to Git.

    # Node.js dependencies
    node_modules/
    npm-debug.log*
    yarn-error.log*

    # Configuration files (containing sensitive data)
    config.json
    # If you have a template config file that you don't want to commit:
    # config-base.json

    # Database files
    miku_history.db
    server_filters.json # For filter settings

    # Python-related files (if you have a Python backend in the same repo)
    __pycache__/
    *.pyc
    .pytest_cache/
    .venv/ # If you use a virtual environment

    # Operating System specific files
    .DS_Store # macOS
    Thumbs.db # Windows

    # Log files
    *.log

Running the Bot

    Start Ollama: Ensure your Ollama server is running in the background.

    ollama serve

    Start the Discord Bot:
    In your main bot project directory (where discord_bot.js is), run:

    node discord_bot.js

    Your bot should now log in and appear online in Discord!

Usage

    Chat with AI: Mention the bot (@Hatsune Miku your message) in a server channel, or send a direct message to the bot.

    Image Analysis: Upload an image in a server channel and either mention the bot with a prompt (@Hatsune Miku describe this image) or use the !analyze command (!analyze what is this?).

    Filter Management (Server Owners Only):

        /filter add <word>: Adds a word to the server's filter list.

        /filter remove <word>: Removes a word from the server's filter list.

        /filter list: Lists all filtered words for the server.

    Direct Search (for testing/utility):

        !search <your query>: Performs a direct Google search and returns the first result.

Troubleshooting

    Bot not responding:

        Check your config.json for correct tokens and IDs.

        Ensure the bot is running in your terminal without errors.

        Verify "Message Content Intent" is enabled in your Discord Developer Portal.

        Check bot permissions in your Discord server.

    Ollama errors (e.g., "Request failed with status code 500", "llama runner process has terminated"):

        This indicates an issue with Ollama or the model itself.

        Check your Ollama server's console for more detailed error messages.

        Ensure you have enough RAM/VRAM to run the models. Vision models are resource-intensive.

        Try re-pulling the Ollama models (ollama pull <model_name>).

    Search not working:

        Verify GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID in config.json.

        Ensure the Custom Search API is enabled in your Google Cloud Console.
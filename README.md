# My AI Discord Bot!
## Overview
This Discord bot was designed for the Japanese pop idol [Hatsune Miku](https://en.wikipedia.org/wiki/Hatsune_Miku) (as my friends wanted it), however, you can use it for other purposes.
## Setup
### Install [Git](https://git-scm.com/downloads)

This is crucial for the next steps.

### Install [node.js](https://nodejs.org)

This is also crucial.

### Clone the Repository

Navigate to the folder you want to store the bot in and run the following command: `git clone https://github.com/HackerDude19/discord-ai-bot/`

### Download Dependancies

Navigate to the bot's folder and run `npm install`, this will automatically begin downloading everything you need.

### Create a Bot

1. Navigate to [Discord's Developer Portal](https://www.discord.com/developers/applications)
2. Create a new application
3. Navigate to "Bot" (on the sidebar)
4. Reset the token

### Update Config

1. Locate the "base-config.json" file and rename it to "config.json".
2. Open your "config.json" file with a text editor.
3. Remove the first line (the one that begins in //)
4. Fill in the information. (client_id is application id in general info)

### Run the Bot

Open a terminal in the folder your bot is stored in and run: `node bot.js`.
If it started correctly, congratulations, you set up the bot!

## Future Plans

1. Make the code less janky.
2. Fix voice functionality.
3. Find a better LLM to use.
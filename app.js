const axios = require('axios');
require('dotenv').config();
const redis = require('redis');

// Redis setup
const redisUrl = process.env.REDIS_URL;
const redisClient = redis.createClient({
    url: redisUrl,
    tls: {
        rejectUnauthorized: false
    }
});

redisClient.on('error', (err) => console.error('Redis client error:', err));

// Connect to Redis
redisClient.connect();

const discordWebhookURL = process.env.DISCORD_URL;
const warGearApiKey = process.env.WAR_GEAR_API_KEY;

// Track which time notifications have been sent
const notifiedTimeLimits = new Set();

// Map players to their Discord IDs
let players = JSON.parse(process.env.PLAYERS);

// Function to check the game's status and send turn notifications
const checkTurn = async () => {
    try {
        // Get the game data from the Wargear API
        const response = await axios.get(`https://www.wargear.net/rest/GetGameList/my?api_key=${warGearApiKey}`, {
            headers: {
                'Authorization': `Bearer ${warGearApiKey}`
            }
        });
        const gameData = response.data[0];
        const currentTurnPlayer = gameData.current_turn[0];

        // Get lastTurnPlayer from Redis
        const lastTurnPlayer = await redisClient.get('lastTurnPlayer');

        // If the current player is different from the last notified player, send a message and reset notified limits
        if (currentTurnPlayer !== lastTurnPlayer) {
            const gameLink = `https://www.wargear.net/games/view/${gameData.gameid}`;
            const discordHandle = players[currentTurnPlayer] ? `<@${players[currentTurnPlayer]}>` : currentTurnPlayer;
            const message = `It's ${discordHandle}'s turn in game [${gameData.name}](${gameLink})!`;
            await sendDiscordMessage(message);

            // Update lastTurnPlayer in Redis
            await redisClient.set('lastTurnPlayer', currentTurnPlayer);

            notifiedTimeLimits.clear(); // Reset the notified time limits for the new player
        }

        // Check for time remaining notifications
        await notifyTimeRemaining(gameData);
    } catch (error) {
        console.error('Error checking game status:', error);
    }
};

// Function to notify players of time remaining
const notifyTimeRemaining = async (gameData) => {
    const timeRemainingHours = Math.floor(gameData.time_remaining / 3600);
    const gameLink = `https://www.wargear.net/games/view/${gameData.gameid}`;

    // Only send notifications for 24, 12, and 1 hour if not already notified
    if (timeRemainingHours === 24 && !notifiedTimeLimits.has(24)) {
        await sendDiscordMessage(`Warning: 24 hours left in game [${gameData.name}](${gameLink})!`);
        notifiedTimeLimits.add(24);
    } else if (timeRemainingHours === 12 && !notifiedTimeLimits.has(12)) {
        await sendDiscordMessage(`Warning: 12 hours left in game [${gameData.name}](${gameLink})!`);
        notifiedTimeLimits.add(12);
    } else if (timeRemainingHours === 1 && !notifiedTimeLimits.has(1)) {
        await sendDiscordMessage(`Warning: Only 1 hour left in game [${gameData.name}](${gameLink})!`);
        notifiedTimeLimits.add(1);
    }
};

// Function to send a message to Discord
async function sendDiscordMessage(message) {
    try {
        await axios.post(discordWebhookURL, {
            content: message
        });
    } catch (error) {
        console.error('Error sending Discord message:', error);
    }
}

// Poll the Wargear API every 15 minutes to check for turn changes and time notifications
setInterval(checkTurn, 900000); // Check every 15 minutes
checkTurn(); // Initial check on startup

const WebSocket = require('ws');
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

// Configuration
const config = {
  joystick: {
    clientId: process.env.JOYSTICK_CLIENT_ID,
    clientSecret: process.env.JOYSTICK_CLIENT_SECRET,
    redirectUri: process.env.JOYSTICK_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
    apiHost: process.env.JOYSTICK_API_HOST || 'https://joystick.tv',
    wsUrl: process.env.JOYSTICK_WS_URL || 'wss://joystick.tv/cable'
  },
  streamerbot: {
    host: process.env.STREAMERBOT_HOST || 'localhost',
    port: process.env.STREAMERBOT_PORT || '8080'
  },
  server: {
    port: process.env.SERVER_PORT || 3000
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  tokenFile: '/data/joystick_tokens.json'
};

// Token management
class TokenManager {
  constructor() {
    this.tokens = this.loadTokens();
  }

  loadTokens() {
    try {
      if (fs.existsSync(config.tokenFile)) {
        const data = fs.readFileSync(config.tokenFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.error(`Failed to load tokens: ${error.message}`);
    }
    return {};
  }

  saveTokens() {
    try {
      fs.writeFileSync(config.tokenFile, JSON.stringify(this.tokens, null, 2));
      logger.debug('Tokens saved successfully');
    } catch (error) {
      logger.error(`Failed to save tokens: ${error.message}`);
    }
  }

  setToken(channelId, accessToken, refreshToken, expiresIn) {
    this.tokens[channelId] = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + (expiresIn * 1000)
    };
    this.saveTokens();
  }

  getToken(channelId) {
    return this.tokens[channelId];
  }

  hasToken(channelId) {
    return !!this.tokens[channelId];
  }

  isTokenExpired(channelId) {
    const token = this.tokens[channelId];
    if (!token) return true;
    return Date.now() >= token.expiresAt;
  }

  async refreshToken(channelId) {
    const token = this.tokens[channelId];
    if (!token || !token.refreshToken) {
      logger.error('No refresh token available');
      return false;
    }

    try {
      logger.info('Refreshing access token...');
      
      const basicAuth = Buffer.from(`${config.joystick.clientId}:${config.joystick.clientSecret}`).toString('base64');
      
      const response = await axios.post(
        `${config.joystick.apiHost}/api/oauth/token?grant_type=refresh_token&refresh_token=${token.refreshToken}`,
        {},
        {
          headers: {
            'Authorization': `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          }
        }
      );

      this.setToken(channelId, response.data.access_token, response.data.refresh_token, response.data.expires_in);
      logger.info('Access token refreshed successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to refresh token: ${error.message}`);
      if (error.response) {
        logger.error(`Server response: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      return false;
    }
  }
}

const tokenManager = new TokenManager();

// Logger
const logger = {
  debug: (msg) => config.logLevel === 'debug' && console.log(`[DEBUG] ${msg}`),
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`)
};

// Joystick.TV WebSocket Client
class JoystickClient {
  constructor() {
    this.ws = null;
    this.reconnectDelay = 5000;
    this.maxReconnectDelay = 60000;
    this.currentReconnectDelay = this.reconnectDelay;
    this.shouldReconnect = true;
    this.connectedChannels = new Map();
  }

  async connect() {
    // Validate configuration
    if (!config.joystick.clientId || !config.joystick.clientSecret) {
      logger.warn('Joystick.TV credentials not configured');
      logger.warn('Visit http://localhost:3000/setup to complete OAuth setup');
      return;
    }

    // Build WebSocket URL with Basic Auth
    const basicAuth = Buffer.from(`${config.joystick.clientId}:${config.joystick.clientSecret}`).toString('base64');
    const url = `${config.joystick.wsUrl}?token=${basicAuth}`;
    
    logger.info('Connecting to Joystick.TV...');
    logger.debug(`WebSocket URL: ${config.joystick.wsUrl}`);
    
    try {
      this.ws = new WebSocket(url, ['actioncable-v1-json']);
    } catch (error) {
      logger.error(`Failed to create WebSocket: ${error.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      logger.info('WebSocket connected to Joystick.TV');
      this.currentReconnectDelay = this.reconnectDelay;
      
      // Subscribe to GatewayChannel
      const subscribeMessage = {
        command: 'subscribe',
        identifier: JSON.stringify({
          channel: 'GatewayChannel'
        })
      };
      
      this.ws.send(JSON.stringify(subscribeMessage));
      logger.info('Sent subscription request for GatewayChannel');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        logger.debug(`Received: ${JSON.stringify(message)}`);
        this.handleMessage(message);
      } catch (error) {
        logger.error(`Failed to parse message: ${error.message}`);
      }
    });

    this.ws.on('error', (error) => {
      logger.error(`WebSocket error: ${error.message}`);
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(`Disconnected from Joystick.TV (Code: ${code})`);
      if (reason) {
        logger.warn(`Reason: ${reason.toString()}`);
      }
      if (this.shouldReconnect) {
        this.scheduleReconnect();
      }
    });
  }

  scheduleReconnect() {
    logger.info(`Reconnecting in ${this.currentReconnectDelay / 1000}s...`);
    setTimeout(() => this.connect(), this.currentReconnectDelay);
    this.currentReconnectDelay = Math.min(
      this.currentReconnectDelay * 2,
      this.maxReconnectDelay
    );
  }

  handleMessage(message) {
    // Action Cable protocol messages
    if (message.type === 'welcome') {
      logger.info('✓ Received welcome from Joystick.TV');
      return;
    }

    if (message.type === 'ping') {
      // Connection keepalive - no action needed
      return;
    }

    if (message.type === 'confirm_subscription') {
      logger.info('✓ Successfully subscribed to GatewayChannel');
      return;
    }

    if (message.type === 'reject_subscription') {
      logger.error('✗ Subscription rejected by Joystick.TV');
      logger.error('This means authentication failed. Check your Client ID and Client Secret.');
      return;
    }

    // Handle actual message data
    if (message.message) {
      const data = message.message;
      const channelId = data.channelId;
      
      // Track which channels we're receiving events from
      if (channelId && !this.connectedChannels.has(channelId)) {
        this.connectedChannels.set(channelId, true);
        logger.info(`Now receiving events from channel: ${channelId}`);
      }

      const event = data.event;
      const type = data.type;

      // Route based on event type
      if (event === 'ChatMessage') {
        this.handleChatMessage(data);
      } else if (event === 'StreamEvent') {
        this.handleStreamEvent(data);
      } else if (event === 'UserPresence') {
        this.handleUserPresence(data);
      } else {
        logger.debug(`Unknown event: ${event}`);
      }
    }
  }

  handleChatMessage(data) {
    const args = {
      user: data.author?.username || 'Unknown',
      message: data.text || '',
      userId: data.author?.slug || '',
      messageId: data.messageId,
      channelId: data.channelId,
      platform: 'joystick'
    };
    
    logger.info(`Chat from ${args.user}: ${args.message}`);
    streamerBotClient.triggerEvent('JoystickTV_ChatMessage', args);
  }

  handleStreamEvent(data) {
    const type = data.type;
    
    try {
      const metadata = data.metadata ? JSON.parse(data.metadata) : {};
      
      switch (type) {
        case 'Tipped':
          const tipArgs = {
            user: metadata.who || 'Unknown',
            amount: metadata.how_much || 0,
            menuItem: metadata.tip_menu_item || '',
            channelId: data.channelId,
            platform: 'joystick'
          };
          logger.info(`Tip from ${tipArgs.user}: ${tipArgs.amount} tokens - ${tipArgs.menuItem}`);
          streamerBotClient.triggerEvent('JoystickTV_Tip', tipArgs);
          break;

        case 'WheelSpinClaimed':
          const wheelArgs = {
            user: metadata.who || 'Unknown',
            amount: metadata.how_much || 0,
            prize: metadata.prize || '',
            channelId: data.channelId,
            platform: 'joystick'
          };
          logger.info(`Wheel spin by ${wheelArgs.user}: won ${wheelArgs.prize}`);
          streamerBotClient.triggerEvent('JoystickTV_WheelSpin', wheelArgs);
          break;

        case 'Followed':
          const followArgs = {
            user: metadata.who || 'Unknown',
            channelId: data.channelId,
            platform: 'joystick'
          };
          logger.info(`New follower: ${followArgs.user}`);
          streamerBotClient.triggerEvent('JoystickTV_Follow', followArgs);
          break;

        case 'Started':
          const startArgs = {
            timestamp: data.createdAt,
            channelId: data.channelId,
            platform: 'joystick'
          };
          logger.info('Stream started');
          streamerBotClient.triggerEvent('JoystickTV_StreamStarted', startArgs);
          break;

        case 'Ended':
        case 'StreamEnding':
          const endArgs = {
            timestamp: data.createdAt,
            channelId: data.channelId,
            platform: 'joystick'
          };
          logger.info('Stream ended');
          streamerBotClient.triggerEvent('JoystickTV_StreamEnded', endArgs);
          break;

        case 'Subscribed':
        case 'GiftedSubscriptions':
          const subArgs = {
            user: metadata.who || 'Unknown',
            tier: metadata.tier || '',
            channelId: data.channelId,
            platform: 'joystick'
          };
          logger.info(`New subscriber: ${subArgs.user}`);
          streamerBotClient.triggerEvent('JoystickTV_Subscribe', subArgs);
          break;

        default:
          logger.debug(`Unhandled stream event type: ${type}`);
          logger.debug(`Data: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      logger.error(`Error handling stream event: ${error.message}`);
    }
  }

  handleUserPresence(data) {
    const type = data.type;
    logger.debug(`User ${type}: ${data.text}`);
    // Could add triggers for user enter/leave if needed
  }

  sendChatMessage(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error('Cannot send message: Not connected');
      return false;
    }

    const payload = {
      type: 'chat',
      data: { message }
    };

    this.ws.send(JSON.stringify(payload));
    logger.debug(`Sent chat message: ${message}`);
    return true;
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
    }
  }
}

// Streamer.bot WebSocket Client
class StreamerBotClient {
  constructor() {
    this.ws = null;
    this.reconnectDelay = 5000;
    this.shouldReconnect = true;
    this.isConnected = false;
    this.actions = [];
    this.lastActionCheck = null;
  }

  connect() {
    const url = `ws://${config.streamerbot.host}:${config.streamerbot.port}/`;
    
    logger.info('Connecting to Streamer.bot...');
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      logger.info('Connected to Streamer.bot');
      this.isConnected = true;
      
      // Subscribe to Streamer.bot events if needed
      this.subscribe();
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        logger.error(`Failed to parse Streamer.bot message: ${error.message}`);
      }
    });

    this.ws.on('error', (error) => {
      logger.error(`Streamer.bot WebSocket error: ${error.message}`);
    });

    this.ws.on('close', () => {
      logger.warn('Disconnected from Streamer.bot');
      this.isConnected = false;
      if (this.shouldReconnect) {
        logger.info(`Reconnecting to Streamer.bot in ${this.reconnectDelay / 1000}s...`);
        setTimeout(() => this.connect(), this.reconnectDelay);
      }
    });
  }

  subscribe() {
    // Subscribe to events from Streamer.bot if needed
    const subscribeMessage = {
      request: 'Subscribe',
      id: 'joystick-integration',
      events: {
        General: ['Custom']
      }
    };
    
    this.send(subscribeMessage);
    
    // Request list of actions
    this.getActions();
  }

  getActions() {
    const message = {
      request: 'GetActions',
      id: 'get-actions-' + Date.now()
    };
    
    this.send(message);
    logger.debug('Requested action list from Streamer.bot');
  }

  checkRequiredActions() {
    const requiredActions = [
      'JoystickTV_ChatMessage',
      'JoystickTV_Tip',
      'JoystickTV_WheelSpin',
      'JoystickTV_Follow',
      'JoystickTV_StreamStarted',
      'JoystickTV_StreamEnded',
      'JoystickTV_Subscribe'
    ];

    const missingActions = requiredActions.filter(
      actionName => !this.actions.some(a => a.name === actionName)
    );

    const existingActions = requiredActions.filter(
      actionName => this.actions.some(a => a.name === actionName)
    );

    return {
      required: requiredActions,
      existing: existingActions,
      missing: missingActions,
      total: requiredActions.length,
      found: existingActions.length
    };
  }

  handleMessage(message) {
    logger.debug(`Received from Streamer.bot: ${JSON.stringify(message)}`);
    
    // Handle action list response
    if (message.id && message.id.startsWith('get-actions-') && message.actions) {
      this.actions = message.actions;
      this.lastActionCheck = new Date();
      logger.info(`Loaded ${this.actions.length} actions from Streamer.bot`);
      
      const check = this.checkRequiredActions();
      if (check.missing.length > 0) {
        logger.warn(`Missing ${check.missing.length} required actions: ${check.missing.join(', ')}`);
      } else {
        logger.info('All required actions are configured in Streamer.bot');
      }
    }
    
    // Handle responses from Streamer.bot
    if (message.event?.type === 'Custom' && message.data?.name === 'JoystickTV_SendMessage') {
      const chatMessage = message.data.message;
      if (chatMessage) {
        joystickClient.sendChatMessage(chatMessage);
      }
    }
  }

  triggerEvent(eventName, args) {
    if (!this.isConnected) {
      logger.warn(`Cannot trigger event ${eventName}: Not connected to Streamer.bot`);
      return;
    }

    const message = {
      request: 'DoAction',
      action: {
        name: eventName
      },
      args: args
    };

    this.send(message);
    logger.debug(`Triggered event: ${eventName}`);
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
    }
  }
}

// HTTP API Server
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    joystick: joystickClient.ws?.readyState === WebSocket.OPEN,
    streamerbot: streamerBotClient.isConnected,
    uptime: process.uptime()
  });
});

// OAuth setup page
app.get('/setup', (req, res) => {
  const authUrl = `${config.joystick.apiHost}/api/oauth/authorize?response_type=code&client_id=${config.joystick.clientId}&scope=bot&state=${Date.now()}`;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Joystick.TV OAuth Setup</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .btn { display: inline-block; padding: 15px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; font-size: 18px; }
        .btn:hover { background: #5568d3; }
        pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
        .success { background: #d1fae5; border: 1px solid #6ee7b7; padding: 15px; border-radius: 5px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <h1>🎮 Joystick.TV OAuth Setup</h1>
      <p>To connect this bridge to Joystick.TV, you need to authorize it as a bot application.</p>
      
      <h2>Current Configuration:</h2>
      <pre>Client ID: ${config.joystick.clientId}
Redirect URI: ${config.joystick.redirectUri}</pre>

      <h2>Setup Steps:</h2>
      <ol>
        <li>Click the button below to authorize this bot</li>
        <li>Log into Joystick.TV if you haven't already</li>
        <li>Grant the requested permissions</li>
        <li>You'll be redirected back here automatically</li>
      </ol>

      <a href="${authUrl}" class="btn">🔗 Authorize Bot on Joystick.TV</a>

      <h2>Connected Channels:</h2>
      <p>Channels that have authorized this bot:</p>
      <ul>
        ${Object.keys(tokenManager.tokens).map(ch => `<li>${ch}</li>`).join('') || '<li>None yet</li>'}
      </ul>
    </body>
    </html>
  `);
});

// OAuth callback endpoint
app.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    // Exchange authorization code for access token
    const basicAuth = Buffer.from(`${config.joystick.clientId}:${config.joystick.clientSecret}`).toString('base64');
    
    const response = await axios.post(
      `${config.joystick.apiHost}/api/oauth/token?redirect_uri=${encodeURIComponent(config.joystick.redirectUri)}&code=${code}&grant_type=authorization_code`,
      {},
      {
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;
    
    // Get channel info from the token
    // For now we'll use a placeholder - in production you'd decode the JWT or make an API call
    const channelId = `channel_${Date.now()}`;
    
    tokenManager.setToken(channelId, access_token, refresh_token, expires_in);
    
    logger.info(`✓ OAuth complete! Received token for channel: ${channelId}`);
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorization Successful</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; text-align: center; }
          .success { background: #d1fae5; border: 1px solid #6ee7b7; padding: 30px; border-radius: 10px; margin: 20px 0; }
          h1 { color: #065f46; }
        </style>
      </head>
      <body>
        <div class="success">
          <h1>✓ Authorization Successful!</h1>
          <p>Your Joystick.TV account has been connected.</p>
          <p>Channel ID: ${channelId}</p>
          <p>You can now close this window and return to the main interface.</p>
        </div>
        <a href="/">← Back to Control Panel</a>
      </body>
      </html>
    `);

    // Reconnect to pick up the new token
    if (!joystickClient.ws || joystickClient.ws.readyState !== WebSocket.OPEN) {
      setTimeout(() => joystickClient.connect(), 1000);
    }

  } catch (error) {
    logger.error(`OAuth error: ${error.message}`);
    if (error.response) {
      logger.error(`Server response: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    res.status(500).send(`Authorization failed: ${error.message}`);
  }
});

// Send chat message endpoint
app.post('/chat/send', (req, res) => {
  const { message, channelId } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // If no channelId provided, try to use the first connected channel
  let targetChannel = channelId;
  if (!targetChannel) {
    const channels = joystickClient.getConnectedChannels();
    if (channels.length > 0) {
      targetChannel = channels[0];
    } else {
      return res.status(400).json({ error: 'No connected channels. Specify channelId or complete OAuth setup.' });
    }
  }

  const success = joystickClient.sendChatMessage(message, targetChannel);
  res.json({ success, channelId: targetChannel });
});

// Get status
app.get('/status', (req, res) => {
  res.json({
    joystick: {
      connected: joystickClient.ws?.readyState === WebSocket.OPEN,
      connectedChannels: joystickClient.getConnectedChannels(),
      hasCredentials: !!(config.joystick.clientId && config.joystick.clientSecret)
    },
    streamerbot: {
      connected: streamerBotClient.isConnected,
      host: config.streamerbot.host,
      port: config.streamerbot.port,
      actionsLoaded: streamerBotClient.actions.length,
      lastActionCheck: streamerBotClient.lastActionCheck
    }
  });
});

// Get action check status
app.get('/api/actions/check', (req, res) => {
  if (!streamerBotClient.isConnected) {
    return res.status(503).json({ error: 'Not connected to Streamer.bot' });
  }

  const check = streamerBotClient.checkRequiredActions();
  res.json(check);
});

// Refresh action list
app.post('/api/actions/refresh', (req, res) => {
  if (!streamerBotClient.isConnected) {
    return res.status(503).json({ error: 'Not connected to Streamer.bot' });
  }

  streamerBotClient.getActions();
  res.json({ success: true, message: 'Action refresh requested' });
});

// Test trigger endpoints
app.post('/api/test/chat', (req, res) => {
  const { user, message } = req.body;
  
  const args = {
    user: user || 'TestUser',
    message: message || 'This is a test message',
    userId: 'test_123',
    platform: 'joystick_test'
  };
  
  streamerBotClient.triggerEvent('JoystickTV_ChatMessage', args);
  logger.info(`Test trigger: ChatMessage from ${args.user}`);
  res.json({ success: true, event: 'JoystickTV_ChatMessage', args });
});

app.post('/api/test/tip', (req, res) => {
  const { user, amount, menuItem } = req.body;
  
  const args = {
    user: user || 'TestUser',
    amount: amount || 100,
    menuItem: menuItem || 'Test Reward',
    userId: 'test_123',
    platform: 'joystick_test'
  };
  
  streamerBotClient.triggerEvent('JoystickTV_Tip', args);
  logger.info(`Test trigger: Tip from ${args.user} - ${args.amount} tokens`);
  res.json({ success: true, event: 'JoystickTV_Tip', args });
});

app.post('/api/test/wheel', (req, res) => {
  const { user, amount, prize } = req.body;
  
  const args = {
    user: user || 'TestUser',
    amount: amount || 50,
    prize: prize || 'Test Prize',
    userId: 'test_123',
    platform: 'joystick_test'
  };
  
  streamerBotClient.triggerEvent('JoystickTV_WheelSpin', args);
  logger.info(`Test trigger: WheelSpin by ${args.user} - won ${args.prize}`);
  res.json({ success: true, event: 'JoystickTV_WheelSpin', args });
});

app.post('/api/test/follow', (req, res) => {
  const { user } = req.body;
  
  const args = {
    user: user || 'TestUser',
    userId: 'test_123',
    platform: 'joystick_test'
  };
  
  streamerBotClient.triggerEvent('JoystickTV_Follow', args);
  logger.info(`Test trigger: Follow from ${args.user}`);
  res.json({ success: true, event: 'JoystickTV_Follow', args });
});

app.post('/api/test/stream-started', (req, res) => {
  const args = {
    timestamp: new Date().toISOString(),
    platform: 'joystick_test'
  };
  
  streamerBotClient.triggerEvent('JoystickTV_StreamStarted', args);
  logger.info('Test trigger: StreamStarted');
  res.json({ success: true, event: 'JoystickTV_StreamStarted', args });
});

app.post('/api/test/stream-ended', (req, res) => {
  const args = {
    timestamp: new Date().toISOString(),
    duration: '3600',
    platform: 'joystick_test'
  };
  
  streamerBotClient.triggerEvent('JoystickTV_StreamEnded', args);
  logger.info('Test trigger: StreamEnded');
  res.json({ success: true, event: 'JoystickTV_StreamEnded', args });
});

app.post('/api/test/subscribe', (req, res) => {
  const { user, tier } = req.body;
  
  const args = {
    user: user || 'TestUser',
    userId: 'test_123',
    tier: tier || 'Tier 1',
    platform: 'joystick_test'
  };
  
  streamerBotClient.triggerEvent('JoystickTV_Subscribe', args);
  logger.info(`Test trigger: Subscribe from ${args.user}`);
  res.json({ success: true, event: 'JoystickTV_Subscribe', args });
});

// Initialize clients
const joystickClient = new JoystickClient();
const streamerBotClient = new StreamerBotClient();

// Start everything
function start() {
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('  Joystick.TV to Streamer.bot Bridge');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('');

  // Validate Joystick.TV configuration
  if (!config.joystick.clientId || !config.joystick.clientSecret) {
    logger.warn('⚠️  Joystick.TV credentials not configured');
    logger.warn('   Set JOYSTICK_CLIENT_ID and JOYSTICK_CLIENT_SECRET');
    logger.warn('   Then visit http://localhost:3000/setup to complete OAuth');
    logger.info('');
  } else {
    logger.info('✓ Joystick.TV credentials configured');
    logger.info('  Client ID: ' + config.joystick.clientId);
    logger.info('  Authorized channels: ' + Object.keys(tokenManager.tokens).length);
  }

  logger.info('✓ Streamer.bot target: ' + config.streamerbot.host + ':' + config.streamerbot.port);
  logger.info('✓ Web UI will be available on port ' + config.server.port);
  logger.info('');
  logger.info('═══════════════════════════════════════════════════════════');
  logger.info('');

  // Connect to services
  joystickClient.connect();
  streamerBotClient.connect();

  // Start HTTP server
  app.listen(config.server.port, () => {
    logger.info(`HTTP API server listening on port ${config.server.port}`);
    logger.info(`Web UI: http://localhost:${config.server.port}`);
    logger.info(`OAuth Setup: http://localhost:${config.server.port}/setup`);
    logger.info('');
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  joystickClient.disconnect();
  streamerBotClient.disconnect();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  joystickClient.disconnect();
  streamerBotClient.disconnect();
  process.exit(0);
});

// Start the application
start();

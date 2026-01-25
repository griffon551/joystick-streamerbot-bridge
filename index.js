const WebSocket = require('ws');
const express = require('express');
const axios = require('axios');
const path = require('path');

// Configuration
const config = {
  joystick: {
    clientId: process.env.JOYSTICK_CLIENT_ID,
    clientSecret: process.env.JOYSTICK_CLIENT_SECRET,
    channelId: process.env.JOYSTICK_CHANNEL_ID,
    apiHost: process.env.JOYSTICK_API_HOST || 'https://joystick.tv',
    // Updated WebSocket URL - may need adjustment based on actual Joystick.TV API
    wsUrl: process.env.JOYSTICK_WS_URL || 'wss://chat.joystick.tv/ws'
  },
  streamerbot: {
    host: process.env.STREAMERBOT_HOST || 'localhost',
    port: process.env.STREAMERBOT_PORT || '8080'
  },
  server: {
    port: process.env.SERVER_PORT || 3000
  },
  logLevel: process.env.LOG_LEVEL || 'info'
};

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
    this.accessToken = null;
  }

  async authenticate() {
    try {
      logger.info('Authenticating with Joystick.TV...');
      
      // OAuth2 client credentials flow
      const response = await axios.post(`${config.joystick.apiHost}/oauth/token`, {
        grant_type: 'client_credentials',
        client_id: config.joystick.clientId,
        client_secret: config.joystick.clientSecret
      });

      this.accessToken = response.data.access_token;
      logger.info('Successfully authenticated with Joystick.TV');
      return true;
    } catch (error) {
      logger.error(`Authentication failed: ${error.message}`);
      if (error.response) {
        logger.error(`Server response: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      return false;
    }
  }

  async connect() {
    // Validate configuration
    if (!config.joystick.clientId || !config.joystick.clientSecret || !config.joystick.channelId) {
      logger.error('Joystick.TV client ID, client secret, and channel ID are required');
      logger.warn('Skipping Joystick.TV connection. Web UI will still work for testing.');
      return;
    }

    // Authenticate first
    if (!this.accessToken) {
      const authenticated = await this.authenticate();
      if (!authenticated) {
        logger.error('Cannot connect without authentication');
        this.scheduleReconnect();
        return;
      }
    }

    // Build WebSocket URL with authentication
    const url = `${config.joystick.wsUrl}?channel=${config.joystick.channelId}&token=${this.accessToken}`;
    
    logger.info('Connecting to Joystick.TV...');
    logger.debug(`WebSocket URL: ${config.joystick.wsUrl}`);
    
    try {
      this.ws = new WebSocket(url);
    } catch (error) {
      logger.error(`Failed to create WebSocket: ${error.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      logger.info('Connected to Joystick.TV');
      this.currentReconnectDelay = this.reconnectDelay;
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        logger.error(`Failed to parse message: ${error.message}`);
      }
    });

    this.ws.on('error', (error) => {
      logger.error(`WebSocket error: ${error.message}`);
      
      // Provide helpful debugging info
      if (error.message.includes('Unexpected server response: 200')) {
        logger.error('');
        logger.error('═══════════════════════════════════════════════════════════');
        logger.error('ERROR: WebSocket endpoint is responding with HTTP instead of WebSocket');
        logger.error('');
        logger.error('This usually means:');
        logger.error('1. The WebSocket URL is incorrect');
        logger.error('2. The API endpoint has changed');
        logger.error('3. Authentication token is invalid or expired');
        logger.error('');
        logger.error('Current WebSocket URL: ' + config.joystick.wsUrl);
        logger.error('Current API Host: ' + config.joystick.apiHost);
        logger.error('');
        logger.error('SOLUTIONS:');
        logger.error('- Contact Joystick.TV support to get the correct WebSocket endpoint');
        logger.error('- Check their Discord: https://discord.gg/zKvCf8hrGP');
        logger.error('- Set JOYSTICK_WS_URL environment variable with the correct endpoint');
        logger.error('- Verify your client ID and client secret are correct');
        logger.error('- You can still use the web UI for testing triggers offline');
        logger.error('═══════════════════════════════════════════════════════════');
        logger.error('');
        
        // Invalidate token and retry
        this.accessToken = null;
        this.shouldReconnect = true;
      }
    });

    this.ws.on('close', () => {
      logger.warn('Disconnected from Joystick.TV');
      // Invalidate token on disconnect
      this.accessToken = null;
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
    logger.debug(`Received: ${JSON.stringify(message)}`);
    
    const eventType = message.type;
    const data = message.data || {};

    switch (eventType) {
      case 'chat':
        this.handleChatMessage(data);
        break;
      case 'tip':
        this.handleTip(data);
        break;
      case 'wheel_spin':
        this.handleWheelSpin(data);
        break;
      case 'follow':
        this.handleFollow(data);
        break;
      case 'stream_started':
        this.handleStreamStarted(data);
        break;
      case 'stream_ended':
        this.handleStreamEnded(data);
        break;
      case 'subscribe':
        this.handleSubscribe(data);
        break;
      default:
        logger.debug(`Unknown event type: ${eventType}`);
    }
  }

  handleChatMessage(data) {
    const args = {
      user: data.username || 'Unknown',
      message: data.message || '',
      userId: data.user_id || '',
      platform: 'joystick'
    };
    
    logger.info(`Chat from ${args.user}: ${args.message}`);
    streamerBotClient.triggerEvent('JoystickTV_ChatMessage', args);
  }

  handleTip(data) {
    const args = {
      user: data.username || 'Unknown',
      amount: data.amount || 0,
      menuItem: data.menu_item || '',
      userId: data.user_id || '',
      platform: 'joystick'
    };
    
    logger.info(`Tip from ${args.user}: ${args.amount} tokens - ${args.menuItem}`);
    streamerBotClient.triggerEvent('JoystickTV_Tip', args);
  }

  handleWheelSpin(data) {
    const args = {
      user: data.username || 'Unknown',
      amount: data.amount || 0,
      prize: data.prize || '',
      userId: data.user_id || '',
      platform: 'joystick'
    };
    
    logger.info(`Wheel spin by ${args.user}: ${args.amount} tokens - won ${args.prize}`);
    streamerBotClient.triggerEvent('JoystickTV_WheelSpin', args);
  }

  handleFollow(data) {
    const args = {
      user: data.username || 'Unknown',
      userId: data.user_id || '',
      platform: 'joystick'
    };
    
    logger.info(`New follower: ${args.user}`);
    streamerBotClient.triggerEvent('JoystickTV_Follow', args);
  }

  handleStreamStarted(data) {
    const args = {
      timestamp: data.timestamp || new Date().toISOString(),
      platform: 'joystick'
    };
    
    logger.info('Stream started');
    streamerBotClient.triggerEvent('JoystickTV_StreamStarted', args);
  }

  handleStreamEnded(data) {
    const args = {
      timestamp: data.timestamp || new Date().toISOString(),
      duration: data.duration || '0',
      platform: 'joystick'
    };
    
    logger.info('Stream ended');
    streamerBotClient.triggerEvent('JoystickTV_StreamEnded', args);
  }

  handleSubscribe(data) {
    const args = {
      user: data.username || 'Unknown',
      userId: data.user_id || '',
      tier: data.tier || '',
      platform: 'joystick'
    };
    
    logger.info(`New subscriber: ${args.user} (Tier: ${args.tier})`);
    streamerBotClient.triggerEvent('JoystickTV_Subscribe', args);
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

// Send chat message endpoint
app.post('/chat/send', (req, res) => {
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const success = joystickClient.sendChatMessage(message);
  res.json({ success });
});

// Get status
app.get('/status', (req, res) => {
  res.json({
    joystick: {
      connected: joystickClient.ws?.readyState === WebSocket.OPEN,
      channelId: config.joystick.channelId
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
  if (!config.joystick.clientId || !config.joystick.clientSecret || !config.joystick.channelId) {
    logger.warn('⚠️  Joystick.TV credentials not configured');
    logger.warn('   Set JOYSTICK_CLIENT_ID, JOYSTICK_CLIENT_SECRET, and JOYSTICK_CHANNEL_ID');
    logger.warn('   to enable live connection. The web UI will still work for offline testing');
    logger.info('');
  } else {
    logger.info('✓ Joystick.TV credentials configured');
    logger.info('  Client ID: ' + config.joystick.clientId);
    logger.info('  Channel ID: ' + config.joystick.channelId);
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

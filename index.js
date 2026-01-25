const WebSocket = require('ws');
const express = require('express');
const axios = require('axios');
const path = require('path');

// Configuration
const config = {
  joystick: {
    authToken: process.env.JOYSTICK_AUTH_TOKEN,
    channelId: process.env.JOYSTICK_CHANNEL_ID,
    wsUrl: 'wss://api.joystick.tv/ws'
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
  }

  connect() {
    const url = `${config.joystick.wsUrl}?channel=${config.joystick.channelId}&token=${config.joystick.authToken}`;
    
    logger.info('Connecting to Joystick.TV...');
    this.ws = new WebSocket(url);

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
    });

    this.ws.on('close', () => {
      logger.warn('Disconnected from Joystick.TV');
      if (this.shouldReconnect) {
        logger.info(`Reconnecting in ${this.currentReconnectDelay / 1000}s...`);
        setTimeout(() => this.connect(), this.currentReconnectDelay);
        this.currentReconnectDelay = Math.min(
          this.currentReconnectDelay * 2,
          this.maxReconnectDelay
        );
      }
    });
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
  // Validate configuration
  if (!config.joystick.authToken || !config.joystick.channelId) {
    logger.error('JOYSTICK_AUTH_TOKEN and JOYSTICK_CHANNEL_ID must be set');
    process.exit(1);
  }

  // Connect to services
  joystickClient.connect();
  streamerBotClient.connect();

  // Start HTTP server
  app.listen(config.server.port, () => {
    logger.info(`HTTP API server listening on port ${config.server.port}`);
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

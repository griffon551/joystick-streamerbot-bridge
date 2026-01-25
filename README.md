# Joystick.TV to Streamer.bot Bridge

Docker-based integration that connects Joystick.TV to Streamer.bot, allowing you to respond to Joystick.TV events in your streaming setup.

## Features

✅ Chat message monitoring with sender and message variables  
✅ Tip/token donations with user, amount, and menu item  
✅ Wheel spin events with user, amount, and prize  
✅ Follow notifications with username  
✅ Stream start/end events  
✅ Subscription events with username and tier  
✅ Send chat messages to Joystick.TV  
✅ Automatically pulls from GitHub - no manual file management!

## Prerequisites

- Docker and Docker Compose installed
- Dockge (for easy management)
- Streamer.bot running with WebSocket server enabled
- Joystick.TV account with API access

## Quick Start with Dockge

### Step 1: Get Your Joystick.TV Credentials

1. Log into your Joystick.TV account
2. Go to Settings → Developer/API section
3. Generate an API token
4. Note your Channel ID

### Step 2: Enable Streamer.bot WebSocket Server

1. Open Streamer.bot
2. Go to `Servers/Clients` → `WebSocket Server`
3. Enable the WebSocket server (default port: 8080)
4. Note the port number

### Step 3: Setup in Dockge

1. In Dockge, click "**+ Compose**"
2. Name your stack: `joystick-streamerbot`
3. Copy the `compose.yaml` content into the editor
4. **Important**: Update the GitHub URL in the compose file:
   - Change `YOUR_USERNAME` to the actual GitHub username/organization
   - Example: `https://github.com/streamer-tools/joystick-streamerbot-bridge.git#main`
5. Click "**Save**"

### Step 4: Configure Environment Variables

1. In Dockge, go to your stack's environment variables section
2. Add the following variables:

```env
JOYSTICK_AUTH_TOKEN=your_actual_token_here
JOYSTICK_CHANNEL_ID=your_channel_id_here
STREAMERBOT_HOST=host.docker.internal
STREAMERBOT_PORT=8080
```

**Important**: If Streamer.bot is running on:
- **Same machine as Docker**: Use `host.docker.internal`
- **Different machine**: Use that machine's IP address (e.g., `192.168.1.100`)

Or create a `.env` file in the stack directory with the same variables.

### Step 5: Start the Stack

1. In Dockge, click "**Start**" or "**Build & Start**" on your stack
2. Dockge will automatically:
   - Clone the repository from GitHub
   - Build the Docker image
   - Start the container
3. Monitor the logs to ensure connection is successful
4. You should see:
   - "Connected to Joystick.TV"
   - "Connected to Streamer.bot"

### Updating to Latest Version

When updates are pushed to GitHub:

1. In Dockge, click "**Stop**" on your stack
2. Click "**Build & Start**" (or use the rebuild option)
3. Dockge will pull the latest code and rebuild

No need to manually update files!

## Streamer.bot Configuration

### Create Actions for Each Event

In Streamer.bot, create actions to respond to these events:

1. **JoystickTV_ChatMessage**
   - Variables: `user`, `message`, `userId`, `platform`

2. **JoystickTV_Tip**
   - Variables: `user`, `amount`, `menuItem`, `userId`, `platform`

3. **JoystickTV_WheelSpin**
   - Variables: `user`, `amount`, `prize`, `userId`, `platform`

4. **JoystickTV_Follow**
   - Variables: `user`, `userId`, `platform`

5. **JoystickTV_StreamStarted**
   - Variables: `timestamp`, `platform`

6. **JoystickTV_StreamEnded**
   - Variables: `timestamp`, `duration`, `platform`

7. **JoystickTV_Subscribe**
   - Variables: `user`, `userId`, `tier`, `platform`

### Example Action Setup

1. In Streamer.bot, go to **Actions**
2. Create a new action: "Joystick Tip Alert"
3. Set the action name to exactly: `JoystickTV_Tip`
4. Add sub-actions (e.g., Play Sound, Show OBS Source, Send TTS)
5. Use variables like `%user%`, `%amount%`, `%menuItem%` in your sub-actions

### Sending Chat Messages

To send a message to Joystick.TV from Streamer.bot:

**Method 1: HTTP API** (Recommended)
Use the "HTTP Request" sub-action in Streamer.bot:
- URL: `http://localhost:3000/chat/send`
- Method: POST
- Body: `{"message": "Your message here"}`
- Headers: `Content-Type: application/json`

**Method 2: Custom Event**
Trigger a custom event named `JoystickTV_SendMessage` with a `message` argument.

## API Endpoints

The bridge provides these HTTP endpoints:

- `GET /health` - Health check and connection status
- `GET /status` - Detailed status of connections
- `POST /chat/send` - Send a chat message
  ```json
  {
    "message": "Hello from Streamer.bot!"
  }
  ```

## Troubleshooting

### Bridge won't connect to Joystick.TV
- Verify your `JOYSTICK_AUTH_TOKEN` is correct
- Check your `JOYSTICK_CHANNEL_ID` is correct
- Review logs in Dockge for error messages

### Bridge won't connect to Streamer.bot
- Ensure Streamer.bot WebSocket server is enabled
- Verify the port matches (default: 8080)
- Check `STREAMERBOT_HOST`:
  - Local: Should be `host.docker.internal`
  - Remote: Should be the machine's IP address
- Make sure no firewall is blocking the connection

### Events not triggering in Streamer.bot
- Ensure action names match exactly (case-sensitive)
- Check that the action names are: `JoystickTV_ChatMessage`, `JoystickTV_Tip`, etc.
- Verify WebSocket connection in Streamer.bot logs

### Viewing Logs
In Dockge, click on your stack and view the **Logs** tab to see real-time connection status and events.

## Upgrading

To update to the latest version from GitHub:

1. In Dockge, stop the stack
2. Click "**Rebuild**" or "**Build & Start**"
3. Dockge will pull the latest code from GitHub and rebuild

Your environment variables and data will be preserved!

## Support

For issues related to:
- **Joystick.TV API**: Check Joystick.TV documentation
- **Streamer.bot**: Check Streamer.bot documentation/Discord
- **This bridge**: Check container logs and verify configuration

## License

MIT License - Feel free to modify and distribute as needed.

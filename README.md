# Joystick.TV to Streamer.bot Bridge

Docker-based integration that connects Joystick.TV to Streamer.bot, allowing you to respond to Joystick.TV events in your streaming setup.

## Features

✅ Chat message monitoring with sender and message variables  
✅ Tip/token donations with user, amount, and menu item  
✅ Wheel spin events with user, amount, and prize  
✅ Follow notifications with username  
✅ Stream start/end events  
✅ Subscription and gifted subscription events  
✅ Stream drop-in events  
✅ Send chat messages to Joystick.TV  
✅ Automatically pulls from GitHub - no manual file management!

## Prerequisites

- Docker and Docker Compose installed
- Dockge (for easy management)
- Streamer.bot running with WebSocket server enabled
- Joystick.TV account with API/Developer access (Client ID and Client Secret)

## Quick Start with Dockge

### Step 1: Get Your Joystick.TV OAuth Credentials

1. Log into your Joystick.TV account
2. Go to **Settings → Developer / API** section
3. Create an OAuth application (or find your existing one)
4. Note your **Client ID** and **Client Secret**

### Step 2: Enable Streamer.bot WebSocket Server

1. Open Streamer.bot
2. Go to `Servers/Clients` → `WebSocket Server`
3. Enable the WebSocket server (default port: 8080)
4. Note the port number

### Step 3: Setup in Dockge

1. In Dockge, click "**+ Compose**"
2. Name your stack: `joystick-streamerbot`
3. Copy the contents of `dockge example yaml` into the editor
4. Click "**Save**"

### Step 4: Configure Environment Variables

Update the following variables in the compose file:

```env
JOYSTICK_CLIENT_ID=your_client_id_here
JOYSTICK_CLIENT_SECRET=your_client_secret_here
JOYSTICK_REDIRECT_URI=http://[lan ip of this machine]:3000/oauth/callback
STREAMERBOT_HOST=your_streamerbot_machine_ip
STREAMERBOT_PORT=8080
```

**STREAMERBOT_HOST notes:**
- **Same machine as Docker**: Use `host.docker.internal`
- **Different machine on LAN**: Use that machine's IP address (e.g., `192.168.1.100`)

### Step 5: Start the Stack & Complete OAuth

1. In Dockge, click "**Build & Start**"
2. Once running, open `http://[your machine ip]:3000/setup` in your browser
3. Click **Authorize Bot on Joystick.TV** and log in
4. After approving, you'll be redirected back and the bridge will connect automatically
5. Monitor the Dockge logs — you should see:
   - `Connected to Joystick.TV`
   - `Successfully subscribed to GatewayChannel`
   - `Connected to Streamer.bot`

### Updating to Latest Version

When updates are pushed to GitHub:

1. In Dockge, click "**Stop**" on your stack
2. Click "**Build & Start**" (or use the rebuild option)
3. Dockge will pull the latest code and rebuild

No need to manually update files!

## Streamer.bot Configuration

### Create Actions for Each Event

In Streamer.bot, create actions with these **exact** names:

1. **JoystickTV_ChatMessage**
   - Variables: `user`, `message`, `userId`, `messageId`, `channelId`, `platform`

2. **JoystickTV_Tip**
   - Variables: `user`, `amount`, `menuItem`, `channelId`, `platform`

3. **JoystickTV_WheelSpin**
   - Variables: `user`, `amount`, `prize`, `channelId`, `platform`

4. **JoystickTV_Follow**
   - Variables: `user`, `channelId`, `platform`

5. **JoystickTV_StreamStarted**
   - Variables: `timestamp`, `channelId`, `platform`

6. **JoystickTV_StreamEnded**
   - Variables: `timestamp`, `channelId`, `platform`

7. **JoystickTV_Subscribe**
   - Variables: `user`, `tier`, `giftCount`, `channelId`, `platform`

8. **JoystickTV_GiftedSubs**
   - Variables: `user`, `tier`, `giftCount`, `channelId`, `platform`

9. **JoystickTV_DropIn**
   - Variables: `streamer`, `viewers`, `channelId`, `platform`

10. **JoystickTV_StreamResuming**
    - Variables: `timestamp`, `channelId`, `platform`

11. **JoystickTV_DeviceConnected**
    - Variables: `timestamp`, `channelId`, `platform`

12. **JoystickTV_TipGoalMet**
    - Variables: `user`, `amount`, `goalName`, `channelId`, `platform`
    - Note: Field mapping may be refined once a live event is observed — raw metadata is logged at INFO level

13. **JoystickTV_SubscriberOnlyStarted**
    - Variables: `timestamp`, `channelId`, `platform`
    - Note: Raw metadata is logged at INFO level for future refinement

14. **JoystickTV_UserEntered**
    - Variables: `user`, `channelId`, `platform`

15. **JoystickTV_UserLeft**
    - Variables: `user`, `channelId`, `platform`

### Example Action Setup

1. In Streamer.bot, go to **Actions**
2. Create a new action named exactly `JoystickTV_Tip`
3. Add sub-actions (e.g., Play Sound, Show OBS Source, Send TTS)
4. Use variables like `%user%`, `%amount%`, `%menuItem%` in your sub-actions

### Sending Chat Messages from Streamer.bot

**Method 1: HTTP API** (Recommended)  
Use the "HTTP Request" sub-action in Streamer.bot:
- URL: `http://localhost:3000/chat/send`
- Method: `POST`
- Body: `{"message": "Your message here"}`
- Headers: `Content-Type: application/json`

**Method 2: Custom Event**  
Trigger a custom event named `JoystickTV_SendMessage` with a `message` argument.

### Sending Whispers from Streamer.bot

> **Requires the `SendWhisper` permission** on your Joystick.TV bot application. This permission cannot be added after the bot is created — if it's missing, you'll need to recreate the bot application with it enabled and redo the OAuth setup.

**Method 1: HTTP API** (Recommended)  
Use the "HTTP Request" sub-action in Streamer.bot:
- URL: `http://localhost:3000/chat/whisper`
- Method: `POST`
- Body: `{"username": "someuser", "message": "Your private message"}`
- Headers: `Content-Type: application/json`

**Method 2: Custom Event**  
Trigger a custom event named `JoystickTV_SendWhisper` with `username` and `message` arguments.

## API Endpoints

- `GET /health` — Health check and uptime
- `GET /status` — Detailed connection status
- `GET /setup` — OAuth authorization page
- `GET /oauth/callback` — OAuth redirect handler (set this as your redirect URI)
- `POST /chat/send` — Send a chat message to Joystick.TV
  ```json
  { "message": "Hello from Streamer.bot!" }
  ```
- `POST /chat/whisper` — Send a private whisper to a specific user (requires `SendWhisper` permission)
  ```json
  { "username": "someuser", "message": "this is a secret" }
  ```
- `GET /api/stream-settings` — Fetch current stream settings (title, welcome message, etc.)
- `POST /api/stream-settings` — Update stream settings (any combination of fields)
  ```json
  { "stream_title": "My new title" }
  { "stream_title": "New title", "chat_welcome_message": "Welcome!" }
  { "banned_chat_words": ["word1", "word2"] }
  ```

Both stream settings endpoints require the `ManageStreamerSettings` permission on your Joystick.TV bot application. The bridge uses the stored OAuth token and refreshes it automatically if expired.

## Troubleshooting

### Bridge won't connect to Joystick.TV
- Make sure you've completed the OAuth flow at `/setup`
- Verify `JOYSTICK_CLIENT_ID` and `JOYSTICK_CLIENT_SECRET` are correct
- Check that `JOYSTICK_REDIRECT_URI` matches exactly what's registered in your Joystick.TV developer settings
- Review logs in Dockge for error messages

### Bridge won't connect to Streamer.bot
- Ensure the Streamer.bot WebSocket server is enabled
- Verify the port matches (default: 8080)
- Check `STREAMERBOT_HOST` — use `host.docker.internal` if on the same machine, or the LAN IP if remote
- Make sure no firewall is blocking the connection

### Events not triggering in Streamer.bot
- Action names are **case-sensitive** — they must match exactly
- Use the control panel at `http://[your machine ip]:3000` to test triggers without a live stream
- Check the **Required Actions Status** panel to see which actions Streamer.bot has detected

### Viewing Logs
In Dockge, click on your stack and view the **Logs** tab for real-time connection status and event activity. Set `LOG_LEVEL=debug` in your environment variables for verbose output.

## License

MIT License - Feel free to modify and distribute as needed.

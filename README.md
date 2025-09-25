# UTMN-Modeus Bot

A modern, scalable Telegram bot that synchronizes UTMN Modeus schedule with Google Calendar. This application provides seamless integration between university scheduling system and personal calendar management.

## 🚀 Features

- **Modeus Integration**: Secure authentication and schedule fetching from UTMN Modeus
- **Google Calendar Sync**: Automatic calendar creation and event synchronization
- **Batch Processing**: Efficient parallel processing for better performance
- **Error Recovery**: Robust error handling with automatic retries
- **Clean Architecture**: Modular design with proper separation of concerns
- **Real-time Updates**: Periodic synchronization with configurable intervals
- **Admin Controls**: Administrative commands for system management

## 📋 Prerequisites

- Node.js 16.0.0 or higher
- MySQL 5.7 or higher
- Google Cloud Platform account (for Calendar API)
- Telegram Bot Token
- UTMN credentials

## 🛠️ Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/utmn-modeus.git
   cd utmn-modeus
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Setup environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your actual configuration values
   ```

4. **Setup database**
   - Create MySQL database
   - Run database migration scripts (if available)
   - Ensure proper permissions are set

5. **Configure Google Cloud**
   - Create a project in Google Cloud Console
   - Enable Google Calendar API
   - Create OAuth 2.0 credentials
   - Configure redirect URLs

## ⚙️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `TELEGRAM_TOKEN` | Telegram Bot Token | - | Yes |
| `UTMN_LOGIN` | UTMN username | - | Yes |
| `UTMN_PASSWORD` | UTMN password | - | Yes |
| `DB_HOSTNAME` | Database hostname | localhost | Yes |
| `DB_PORT` | Database port | 3306 | No |
| `DB_LOGIN` | Database username | - | Yes |
| `DB_PASSWORD` | Database password | - | Yes |
| `DB_NAME` | Database name | - | Yes |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | - | Yes |
| `GOOGLE_SECRET_ID` | Google OAuth Client Secret | - | Yes |
| `GOOGLE_REDIRECT` | OAuth redirect URL | - | Yes |
| `ADMIN_ID` | Telegram admin user ID | - | Yes |
| `SYNC_INTERVAL` | Sync interval in ms | 900000 (15min) | No |
| `BATCH_SIZE` | Processing batch size | 10 | No |
| `LOG_LEVEL` | Logging level | info | No |

### Database Schema

The application requires the following tables:
- `students` - User information and credentials
- `events` - Modeus event data
- `student_events` - User-event relationships
- `calendar_events` - Google Calendar mapping
- `google_auth` - OAuth state management
- `config` - Application configuration

## 🚀 Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run prod
# or
npm start
```

### Health Check
```bash
npm run health
```

### Application Statistics
```bash
npm run stats
```

## 🤖 Bot Commands

### User Commands
- `/start` - Show welcome message and setup instructions
- `/help` - Display help information
- `/info` - Show account status and sync information
- `/link_modeus` - Connect Modeus account
- `/link_google` - Connect Google Calendar
- `/reset_calendar` - Reset and recreate calendar

### Admin Commands (text messages)
- `reset_calendars` - Delete all user calendars
- `redo_checks` - Trigger manual synchronization

## 🏗️ Architecture

The application follows a clean, modular architecture:

```
src/
├── services/
│   ├── DatabaseService.js      # Database operations
│   ├── ModeusService.js        # Modeus API integration
│   ├── GoogleCalendarService.js # Google Calendar sync
│   ├── TelegramBotService.js   # Bot handlers
│   └── SyncService.js          # Orchestration
└── utils/
    ├── Logger.js               # Enhanced logging
    └── ConfigManager.js        # Configuration management
```

### Key Components

- **DatabaseService**: Manages database connections with connection pooling and retry logic
- **ModeusService**: Handles Modeus authentication and API calls with parallel processing
- **GoogleCalendarService**: Manages Google Calendar integration with batch operations
- **TelegramBotService**: Processes bot commands and user interactions
- **SyncService**: Orchestrates the synchronization process
- **Logger**: Provides structured logging with different levels
- **ConfigManager**: Validates and manages application configuration

## 🔧 Performance Features

- **Connection Pooling**: Efficient database connection management
- **Batch Processing**: Groups API calls for better performance
- **Parallel Execution**: Concurrent processing of independent operations
- **Caching**: Token and data caching to reduce API calls
- **Rate Limiting**: Respects API rate limits with delays
- **Error Recovery**: Automatic retry mechanisms with exponential backoff

## 📊 Monitoring & Logging

The application provides comprehensive logging and monitoring:

- **Structured Logs**: JSON-formatted logs with context
- **Health Checks**: Built-in health status endpoints
- **Performance Metrics**: Timing and statistics tracking
- **Error Tracking**: Detailed error reporting with stack traces

## 🔒 Security

- **Credential Management**: Secure storage of sensitive data
- **Token Refresh**: Automatic OAuth token renewal
- **Input Validation**: Proper sanitization of user inputs
- **Error Handling**: No sensitive data leakage in error messages

## 🚀 Deployment

### Using PM2
```bash
npm install -g pm2
pm2 start app.js --name "utmn-modeus"
pm2 save
pm2 startup
```

### Using Docker
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting: `npm run lint:fix`
6. Submit a pull request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Check database credentials in .env
   - Ensure MySQL server is running
   - Verify network connectivity

2. **Modeus Authentication Failures**
   - Verify UTMN credentials
   - Check if account is locked
   - Review network proxy settings

3. **Google Calendar API Errors**
   - Check OAuth credentials
   - Verify API is enabled in Google Cloud
   - Review quota limits

4. **Bot Not Responding**
   - Verify Telegram token
   - Check bot permissions
   - Review webhook configuration

### Debug Mode

Set `LOG_LEVEL=debug` in your .env file for detailed logging.

### Support

For support, please create an issue in the GitHub repository or contact the maintainers.

---

Made with ❤️ for UTMN students
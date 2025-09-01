# Backend Deployment Guide

## Deployment Platform: Render.com (Free Tier)

### Live URL
Once deployed, your backend will be available at:
```
https://elderly-care-backend.onrender.com
```

## Step-by-Step Deployment Instructions

### 1. Push Code to GitHub

First, commit and push all changes:

```bash
git add .
git commit -m "Configure backend for Render deployment"
git push origin main
```

### 2. Create Render Account

1. Go to [https://render.com](https://render.com)
2. Sign up with GitHub (recommended) or create an account
3. Verify your email

### 3. Deploy Backend to Render

1. **Connect GitHub Repository**
   - Click "New +" → "Web Service"
   - Connect your GitHub account if not already connected
   - Select repository: `puigjoaco/elderly-care-admin` or your fork
   - Click "Connect"

2. **Configure Service Settings**
   - **Name**: `elderly-care-backend`
   - **Region**: Oregon (US West) - Free tier
   - **Branch**: `main`
   - **Root Directory**: `backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

3. **Set Environment Variables**
   Click "Advanced" and add these environment variables:

   ```
   NODE_ENV = production
   PORT = 4000
   
   # Supabase (REQUIRED - Get from your .env file)
   SUPABASE_URL = https://jqmoiucwqefkcectmafh.supabase.co
   SUPABASE_ANON_KEY = [Your Supabase Anon Key]
   SUPABASE_SERVICE_KEY = [Your Supabase Service Key]
   DATABASE_PASSWORD = [Your Database Password]
   
   # Security
   JWT_SECRET = [Generate a random string]
   
   # Google AI (for analysis features)
   GOOGLE_API_KEY = [Your Google API Key]
   
   # Optional Services (add if you have them)
   SENDGRID_API_KEY = [Your SendGrid Key if using email]
   ```

4. **Deploy**
   - Click "Create Web Service"
   - Wait for the build and deployment (5-10 minutes)
   - Check the logs for any errors

### 4. Verify Deployment

Once deployed, test these endpoints:

```bash
# Health check
curl https://elderly-care-backend.onrender.com/health

# API info
curl https://elderly-care-backend.onrender.com/

# API endpoint
curl https://elderly-care-backend.onrender.com/api
```

### 5. Update Admin Panel

Update the admin panel to use the deployed backend URL:

1. Edit `admin-panel/js/config.js` or wherever the API URL is configured
2. Change from `http://localhost:4000` to `https://elderly-care-backend.onrender.com`
3. Commit and push changes

### 6. Set Up Auto-Deploy

Render automatically deploys when you push to GitHub. To ensure this:

1. In Render Dashboard → Your Service → Settings
2. Enable "Auto-Deploy" (should be on by default)
3. Every push to `main` branch will trigger a new deployment

## Alternative Free Deployment Options

### Railway.app
```yaml
# railway.json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Fly.io
```toml
# fly.toml
app = "elderly-care-backend"
primary_region = "sea"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[env]
  NODE_ENV = "production"
  PORT = "4000"
```

### Vercel (Serverless)
```json
// vercel.json
{
  "version": 2,
  "builds": [
    {
      "src": "backend/server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/backend/(.*)",
      "dest": "backend/server.js"
    }
  ]
}
```

## Monitoring & Maintenance

### Free Monitoring Services

1. **UptimeRobot** (https://uptimerobot.com)
   - Create free account
   - Add monitor for: `https://elderly-care-backend.onrender.com/health`
   - Set check interval: 5 minutes
   - Enable email alerts

2. **Better Uptime** (https://betteruptime.com)
   - Free tier includes 10 monitors
   - Add status page for public visibility

### Keep Service Awake

Render free tier services sleep after 15 minutes of inactivity. To prevent this:

1. Set up UptimeRobot to ping every 5 minutes
2. Or use a cron job service like cron-job.org to ping the health endpoint

### Logs & Debugging

View logs in Render Dashboard:
- Go to your service → "Logs" tab
- Use filters to find specific errors
- Download logs for offline analysis

## Troubleshooting

### Common Issues

1. **Service Won't Start**
   - Check package.json has all dependencies
   - Verify environment variables are set
   - Check logs for specific errors

2. **CORS Errors**
   - Update allowed origins in server.js
   - Ensure credentials are included in requests

3. **Database Connection Failed**
   - Verify Supabase credentials
   - Check if Supabase project is active
   - Ensure service key has proper permissions

4. **Service Sleeping**
   - Normal for free tier
   - First request after sleep takes 30-60 seconds
   - Use monitoring to keep awake

## Security Checklist

- [ ] All sensitive data in environment variables
- [ ] CORS configured for production domains only
- [ ] Rate limiting implemented (optional)
- [ ] Input validation on all endpoints
- [ ] HTTPS enforced (automatic on Render)
- [ ] JWT secret is strong and unique
- [ ] API keys are not exposed in code

## Support & Resources

- Render Documentation: https://render.com/docs
- Render Status: https://status.render.com
- Community Forum: https://community.render.com
- GitHub Issues: https://github.com/puigjoaco/elderly-care-admin/issues
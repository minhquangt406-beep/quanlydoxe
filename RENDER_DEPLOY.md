# Parking AI Pro – Render deployment

## 1. GitHub
Extract this ZIP and upload the CONTENTS of this folder to the ROOT of a GitHub repository.
The repository root must contain:
- Dockerfile
- requirements.txt
- render.yaml
- app/
- .gitignore

Do NOT upload .env. It was intentionally removed from this deployment package.

## 2. Render
Create a Web Service from the GitHub repository.
Runtime: Docker
Root Directory: leave blank
Dockerfile: ./Dockerfile
Health Check Path: /api/health

The Dockerfile automatically uses Render's PORT variable.

## 3. Environment variables
In Render -> Environment, add the variables from your private .env:
- SECRET_KEY
- DEEPSEEK_API_KEY (optional if AI is not used)
- DEEPSEEK_MODEL
- DEEPSEEK_BASE_URL
- DATABASE_URL

For the current SQLite setup, DATABASE_URL can be:
sqlite:///./data/parking.db

## 4. Test
After Deploy becomes Live, open:
https://YOUR-RENDER-SUBDOMAIN.onrender.com/api/health

It should return JSON containing:
{"status":"ok","database":"connected",...}

Then open the Render subdomain itself.

## 5. Custom domain
Once the Render service works, keep your existing DNS:
CNAME www -> your Render subdomain
A @ -> 216.24.57.1
Then use the verified custom domain.

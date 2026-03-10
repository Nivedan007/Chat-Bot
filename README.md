# Chat-Bot

Flask chat app using Gemini API.

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open: `http://127.0.0.1:5001`

## Deploy (Render)

1. Push this repo to GitHub.
2. In Render, create a **New Web Service** from this repo.
3. Set:
- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app`
4. Add environment variable:
- `GEMINI_API_KEY=your_new_key`
5. Deploy.

## Deploy (Railway)

1. Create a new Railway project from this GitHub repo.
2. Add variable:
- `GEMINI_API_KEY=your_new_key`
3. Railway detects `Procfile` and runs `gunicorn app:app`.
4. Deploy.

## Deploy (Vercel)

1. Import this GitHub repository in Vercel.
2. Keep framework as `Other`.
3. Add environment variables in Vercel project settings:
- `GEMINI_API_KEY=your_key`
- Optional fallback names also supported: `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
4. Redeploy the latest commit from `main`.
5. Open your app and hard refresh once (`Cmd+Shift+R`) to load newest static assets.

## Notes

- Never commit `.env` with real keys.
- Rotate your Gemini key if it was ever exposed.

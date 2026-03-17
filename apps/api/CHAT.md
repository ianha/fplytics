# FPL AI Chat — LLM Provider Configuration

The AI Chat feature lets you query the FPL database using natural language by connecting it to a cloud LLM. The LLM receives tool definitions for querying the local SQLite database and answers your questions by executing SQL on your behalf.

---

## Overview

All LLM provider configuration lives in a single file:

```
apps/api/data/llm-providers.json
```

This file is **gitignored** — it will never be committed. You must create it yourself (see examples below). The API server reads it on startup; multiple providers can coexist and the chat UI lets you pick one per conversation.

Two authentication methods are supported:

| Method | Works with | How it works |
|--------|-----------|--------------|
| **API Key** | Anthropic, OpenAI, Google (AI Studio) | Paste your key into the config file |
| **Google OAuth** | Google Gemini only | Sign in with your Google account in the browser |

---

## API Key Authentication

Use this when you have an API key from the provider's dashboard.

### Config shape

```json
{
  "id": "my-provider",
  "name": "Display Name",
  "provider": "anthropic",
  "model": "claude-3-7-sonnet-20250219",
  "apiKey": "sk-ant-..."
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier used internally (e.g. `"claude"`, `"gpt4o"`) |
| `name` | string | Display name shown in the chat provider dropdown |
| `provider` | `"anthropic"` \| `"openai"` \| `"google"` | Which LLM SDK to use |
| `model` | string | Exact model ID passed to the API |
| `apiKey` | string | Your secret API key |

### Where to get API keys

| Provider | URL |
|----------|-----|
| **Anthropic (Claude)** | https://console.anthropic.com → Settings → API Keys |
| **OpenAI (GPT)** | https://platform.openai.com → API Keys |
| **Google Gemini (key-based)** | https://aistudio.google.com → Get API Key |

### Supported models (examples)

| Provider | Model ID |
|----------|---------|
| Anthropic | `claude-3-7-sonnet-20250219` |
| Anthropic | `claude-3-5-haiku-20241022` |
| OpenAI | `gpt-4o` |
| OpenAI | `gpt-4o-mini` |
| Google | `gemini-2.0-flash` |
| Google | `gemini-1.5-pro` |

Any model ID accepted by the respective API will work — check the provider's documentation for the latest options.

---

## Google OAuth Authentication

Use this to sign in with your Google account instead of managing an API key. This is useful when you want to use your existing Google account quota or prefer not to create a separate API key.

### Prerequisites

You need a Google Cloud project with OAuth credentials set up. Follow these steps once:

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a project (or select an existing one).
2. Navigate to **APIs & Services → Library** and enable the **Generative Language API**.
3. Navigate to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**.
4. Select **Web application** as the application type.
5. Under **Authorised redirect URIs**, add:
   ```
   http://localhost:4000/api/chat/auth/google/callback
   ```
6. Click **Create** and copy the **Client ID** and **Client Secret**.

### Config shape

```json
{
  "id": "gemini-oauth",
  "name": "Gemini 2.0 Flash",
  "provider": "google",
  "model": "gemini-2.0-flash",
  "auth": "oauth",
  "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "clientSecret": "YOUR_CLIENT_SECRET"
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Display name |
| `provider` | `"google"` | Must be `"google"` for OAuth |
| `model` | string | Gemini model ID |
| `auth` | `"oauth"` | Enables the OAuth flow instead of API key |
| `clientId` | string | OAuth 2.0 Client ID from Google Cloud Console |
| `clientSecret` | string | OAuth 2.0 Client Secret |

### Signing in

1. Start the API server (`npm run dev:api` or `npm start`).
2. Open the web app and navigate to **AI Chat**.
3. Select the OAuth provider from the dropdown — it will show a **"Sign in with Google"** button.
4. Click the button — a new browser tab opens with the Google sign-in screen.
5. Sign in and grant access.
6. Google redirects back to the app, and the provider status updates to **Connected**.

### Token storage

After signing in, a refresh token is saved to:
```
apps/api/data/llm-tokens.json
```
This file is **gitignored**. The access token is refreshed automatically on each request.

To revoke access, either:
- Delete `apps/api/data/llm-tokens.json`, or
- Visit https://myaccount.google.com/permissions and remove the app.

---

## OpenRouter (access any model via one API key)

[OpenRouter](https://openrouter.ai) is an OpenAI-compatible API gateway that routes requests to many models — Claude, GPT, Gemini, Mistral, Llama, and more — using a single API key. It is useful when you want to try multiple models without managing separate keys for each provider.

Because OpenRouter is API-compatible with OpenAI, set `"provider": "openai"` and add a `"baseURL"` field pointing to OpenRouter's endpoint.

### Config shape

```json
{
  "id": "openrouter-claude",
  "name": "Claude 3.7 Sonnet (OpenRouter)",
  "provider": "openai",
  "model": "anthropic/claude-3.7-sonnet",
  "apiKey": "sk-or-...",
  "baseURL": "https://openrouter.ai/api/v1"
}
```

### Fields

| Field | Value |
|-------|-------|
| `provider` | `"openai"` — OpenRouter is OpenAI-compatible |
| `model` | OpenRouter model slug, e.g. `anthropic/claude-3.7-sonnet`, `openai/gpt-4o`, `google/gemini-2.0-flash-001`, `meta-llama/llama-3.3-70b-instruct` |
| `apiKey` | Your OpenRouter API key (starts with `sk-or-`) |
| `baseURL` | Must be `"https://openrouter.ai/api/v1"` |

### Getting an OpenRouter key

1. Sign up at https://openrouter.ai
2. Go to **Keys** and create a new API key
3. Add credits at **Credits** (pay-as-you-go, no subscription required)
4. Browse available models and their slugs at https://openrouter.ai/models

### Popular model slugs

| Model | Slug |
|-------|------|
| Claude 3.7 Sonnet | `anthropic/claude-3.7-sonnet` |
| Claude 3.5 Haiku | `anthropic/claude-3.5-haiku` |
| GPT-4o | `openai/gpt-4o` |
| GPT-4o mini | `openai/gpt-4o-mini` |
| Gemini 2.0 Flash | `google/gemini-2.0-flash-001` |
| Gemini 1.5 Pro | `google/gemini-pro-1.5` |
| Llama 3.3 70B | `meta-llama/llama-3.3-70b-instruct` |
| Mistral Large | `mistralai/mistral-large` |
| DeepSeek R1 | `deepseek/deepseek-r1` |

---

## Complete Example `llm-providers.json`

```json
[
  {
    "id": "claude",
    "name": "Claude 3.7 Sonnet",
    "provider": "anthropic",
    "model": "claude-3-7-sonnet-20250219",
    "apiKey": "sk-ant-..."
  },
  {
    "id": "gpt4o",
    "name": "GPT-4o",
    "provider": "openai",
    "model": "gpt-4o",
    "apiKey": "sk-..."
  },
  {
    "id": "gemini-key",
    "name": "Gemini 2.0 Flash (API Key)",
    "provider": "google",
    "model": "gemini-2.0-flash",
    "apiKey": "AIza..."
  },
  {
    "id": "gemini-oauth",
    "name": "Gemini 2.0 Flash (Google Sign-In)",
    "provider": "google",
    "model": "gemini-2.0-flash",
    "auth": "oauth",
    "clientId": "1234567890.apps.googleusercontent.com",
    "clientSecret": "GOCSPX-..."
  },
  {
    "id": "openrouter-claude",
    "name": "Claude 3.7 Sonnet (OpenRouter)",
    "provider": "openai",
    "model": "anthropic/claude-3.7-sonnet",
    "apiKey": "sk-or-...",
    "baseURL": "https://openrouter.ai/api/v1"
  }
]
```

---

## How It Works

The chat backend acts as a bridge between the web frontend and the cloud LLM:

1. The frontend sends a message + provider ID to `POST /api/chat/stream`.
2. The backend loads the provider config, resolves authentication (API key or OAuth token), and calls the LLM with two tool definitions:
   - **`query`** — execute a `SELECT` SQL statement against the FPL SQLite database
   - **`get_schema`** — retrieve all table and column definitions
3. The LLM streams a response. If it calls a tool, the backend executes it locally and sends the result back to the LLM.
4. Each step is streamed to the frontend in real time as Server-Sent Events (SSE).

The LLM never has direct database access — all queries run locally on your machine.

---

## Troubleshooting

### "Provider not found"
The `id` in your request doesn't match any entry in `llm-providers.json`. Check for typos.

### "Only SELECT or WITH queries are permitted"
The LLM attempted to run a mutating SQL statement. This is blocked by the backend for safety.

### Anthropic / OpenAI: "Invalid API key"
Double-check the `apiKey` value. Keys are case-sensitive and include the prefix (`sk-ant-...` or `sk-...`).

### Google OAuth: `redirect_uri_mismatch`
The redirect URI registered in Google Cloud Console doesn't exactly match `http://localhost:4000/api/chat/auth/google/callback`. Check for trailing slashes or different port numbers.

### Google OAuth: "Token expired" / "No OAuth tokens found"
Delete `apps/api/data/llm-tokens.json` and sign in again via the AI Chat page.

### Google OAuth: "Access blocked: This app's request is invalid"
Your Google Cloud OAuth app may be in testing mode and your Google account isn't listed as a test user. Go to **APIs & Services → OAuth consent screen → Test users** and add your account.

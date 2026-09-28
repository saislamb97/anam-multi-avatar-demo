# Anam Group Discussion: Two Avatars and a Human

A FastAPI and browser demo where **you, Avatar A, and Avatar B share one conversation**. Both avatars see the same labeled discussion history, know who said each line, and can respond to one another. You can ask one avatar or choose **Both avatars** to get two sequential replies. The two live Anam videos appear together in one styled stage.

## What “one session” means

The app creates **one group conversation ID on the FastAPI side** and stores one ordered transcript with speaker labels: `human`, `a`, and `b`. That is the shared memory passed to OpenAI for every answer. There are still **two independent Anam WebRTC sessions**, one per live avatar. Anam does not render two avatars in a single avatar session. The browser routes each generated reply to the appropriate Anam SDK client using `talk()`.

In **Both avatars** mode, FastAPI generates A's response, adds it to the transcript, then generates B's response with A's new line in context. The browser plays A and B sequentially. The transcript is shared even when you address only one avatar.

## Features

- Shared speaker-labeled memory for the human and both avatars.
- One-avatar or two-avatar response selection.
- FastAPI owns OpenAI calls, Anam token creation, and conversation memory.
- Browser displays two live videos and one unified transcript.
- Typed input only: the Anam clients have microphone input disabled.
- New conversation button. A browser refresh restores the conversation ID and transcript while the server remains running.

## Requirements

- Python 3.10+ and a modern browser (Chrome or Edge recommended).
- Anam API key, two avatar IDs, and voice IDs.
- Anam account with at least **two concurrent sessions**.
- OpenAI API key and access to the configured chat model.
- Browser access to Anam WebRTC and `esm.sh` (used for the Anam JavaScript SDK).

## Project files

```text
anam-two-avatars/
├── app.py                 # FastAPI, shared conversation, OpenAI, Anam tokens
├── requirements.txt
├── .env.example
├── templates/index.html   # Shared stage and group chat
└── static/
    ├── app.js             # Two Anam clients and turn playback
    └── style.css
```

## Quick start on Windows PowerShell

From the project directory:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env` with your own API keys and IDs, then run:

```powershell
uvicorn app:app --reload
```

Open **http://127.0.0.1:8000**. If PowerShell blocks virtual environment activation, use ` .\.venv\Scripts\python.exe -m pip install -r requirements.txt` and ` .\.venv\Scripts\python.exe -m uvicorn app:app --reload` directly.

On macOS/Linux, use `python3 -m venv .venv`, `source .venv/bin/activate`, `pip install -r requirements.txt`, `cp .env.example .env`, and `uvicorn app:app --reload`.

## Configuration

```dotenv
ANAM_API_KEY=your_anam_api_key
OPENAI_API_KEY=your_openai_api_key
ANAM_AVATAR_A_ID=first_avatar_id
ANAM_VOICE_A_ID=first_voice_id
ANAM_AVATAR_B_ID=second_avatar_id
ANAM_VOICE_B_ID=second_voice_id
AVATAR_A_NAME=Avatar A
AVATAR_B_NAME=Avatar B
OPENAI_MODEL=gpt-4.1-mini
# ANAM_AVATAR_MODEL=cara-4
```

`AVATAR_A_NAME` and `AVATAR_B_NAME` are names you choose; they appear on screen and in the OpenAI speaker context. `ANAM_AVATAR_MODEL` is optional; leave it commented out unless your chosen avatar requires an override. Keep `.env` private.

### Find your Anam IDs

In PowerShell:

```powershell
$env:ANAM_API_KEY = "your_actual_anam_key"
Invoke-RestMethod -Uri "https://api.anam.ai/v1/avatars" `
  -Headers @{ Authorization = "Bearer $env:ANAM_API_KEY" } |
  ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "https://api.anam.ai/v1/voices" `
  -Headers @{ Authorization = "Bearer $env:ANAM_API_KEY" } |
  ConvertTo-Json -Depth 10
```

Use each selected item's `id` from the response `data` array. Use **avatar IDs**, not saved persona IDs, and use voice `id`, not `providerVoiceId`. Lists can be paginated (`page` and `perPage`).

## Use the group discussion

1. Click **Start both avatars**. Wait for both to show **Connected**.
2. Choose **Avatar A**, **Avatar B**, or **Both avatars** in the dropdown.
3. Type a message and click **Send**. All turns appear in one transcript with speaker names.
4. With **Both avatars**, A answers first and B receives A's answer as context before answering. The page plays their speech in order.
5. Click **New conversation** to clear the group memory. Click **Stop both** to end the Anam streams; stopping streams alone keeps the server conversation memory.

The app creates the group conversation automatically on page load. A refresh restores it from `sessionStorage` if the FastAPI process still has it. Restarting the server clears memory and creates a new conversation on the next load.

## Architecture

```text
                         One FastAPI conversation ID
Human message ──────────> Shared transcript: Human / Avatar A / Avatar B
                                  │
                                  └──> OpenAI: selected speaker + full labeled history
                                            │
                        reply for A ────────┴──────── reply for B
                            │                           │
                     Anam SDK client A            Anam SDK client B
                            │                           │
                       video A + audio             video B + audio
```

| Endpoint | Purpose |
| --- | --- |
| `POST /api/conversations` | Create one server-side group discussion. |
| `GET /api/conversations/{id}` | Restore its labeled transcript. |
| `POST /api/conversations/messages` | Add the human's turn and generate one or two speaker-aware replies. |
| `POST /api/session-token/a` and `/b` | Issue separate Anam session tokens for the two video streams. |
| `GET /api/config` | Send non-secret display names to the browser. |

The server serializes requests for a conversation with a lock. It commits the human turn and all replies together after OpenAI succeeds. It uses the latest 60 turns as model context and stops the demo conversation before that limit. The browser waits for Anam's completed persona history event between two spoken replies, with a 45-second fallback if that event does not arrive. The text responses are generated before either avatar speaks.

## Shared stage

CSS places two video streams in one panel, fades their meeting edges, and applies common lighting and nameplates. This creates the **impression** of one scene. Each video still has its original Anam background; CSS cannot remove baked-in backgrounds. Choose avatars with similar framing and lighting for the best appearance.

## Troubleshooting

| Problem | Check |
| --- | --- |
| Missing API key or IDs | Fill `.env`, then restart Uvicorn. |
| Anam token error | Confirm your avatar IDs, voice IDs, key, and plan. Do not use persona IDs. |
| Second avatar fails to connect | Your plan may allow only one concurrent session or another session may still be active. |
| Both avatars speak over each other | Check browser console and Anam completion events; the app has a timeout fallback if completion cannot be observed. |
| No OpenAI reply | Verify the OpenAI key and model access; inspect the `/api/conversations/messages` response in Developer Tools. |
| Page loads but no controls respond | Check Developer Tools → Console and reachability of `esm.sh`. |
| Conversation disappeared | The backend keeps memory in this process only. A restart or a second worker does not preserve it. |

## Prototype limits and deployment

The conversation store is an in-process Python dictionary. Run **one worker** for this demo. It is capped at 100 conversations and 60 turns per conversation, with no automatic expiry. For production, use a database or shared cache, associate conversation IDs with authenticated users, add expiry and deletion, rate limits, and access control. Anyone who knows a conversation ID can retrieve its transcript in the demo. Do not expose this app publicly as-is.

Two active Anam sessions consume Anam minutes even when silent. A **Both avatars** turn makes two OpenAI requests. No microphone input is sent to either avatar; Anam provides speech synthesis and video while OpenAI supplies the conversation text. Stop the streams when done.

## References

- [Anam client-side custom LLM integration](https://anam.ai/docs/javascript-sdk/examples/custom-llm)
- [Anam JavaScript events](https://anam.ai/docs/javascript-sdk/reference/events)
- [Anam avatar API](https://anam.ai/docs/api-reference/avatars/list-avatars)
- [Anam voice API](https://anam.ai/docs/api-reference/voices/list-voices)

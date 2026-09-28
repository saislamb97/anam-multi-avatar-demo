import asyncio
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / '.env')
app = FastAPI(title='Anam Group Discussion')
app.mount('/static', StaticFiles(directory=ROOT / 'static'), name='static')

AVATARS = {
    'a': {'name': os.getenv('AVATAR_A_NAME', 'Avatar A'), 'avatarId': os.getenv('ANAM_AVATAR_A_ID', ''), 'voiceId': os.getenv('ANAM_VOICE_A_ID', '')},
    'b': {'name': os.getenv('AVATAR_B_NAME', 'Avatar B'), 'avatarId': os.getenv('ANAM_AVATAR_B_ID', ''), 'voiceId': os.getenv('ANAM_VOICE_B_ID', '')},
}

@dataclass
class Conversation:
    turns: list[dict] = field(default_factory=list)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

# Local demo storage. One FastAPI worker/process only; lost on restart.
conversations: dict[str, Conversation] = {}
MAX_CONVERSATIONS = 100
MAX_TURNS = 60

class GroupMessage(BaseModel):
    conversation_id: str
    target: str
    content: str = Field(min_length=1, max_length=2000)

@app.get('/', response_class=HTMLResponse)
async def index():
    return (ROOT / 'templates' / 'index.html').read_text(encoding='utf-8')

@app.get('/api/config')
async def config():
    return {'avatars': {key: {'name': item['name']} for key, item in AVATARS.items()}}

@app.post('/api/conversations')
async def create_conversation():
    if len(conversations) >= MAX_CONVERSATIONS:
        raise HTTPException(503, 'Demo conversation limit reached; restart the server or remove old sessions')
    conversation_id = str(uuid.uuid4())
    conversations[conversation_id] = Conversation()
    return {'conversation_id': conversation_id, 'turns': []}

@app.get('/api/conversations/{conversation_id}')
async def get_conversation(conversation_id: str):
    conversation = conversations.get(conversation_id)
    if conversation is None:
        raise HTTPException(404, 'Conversation not found')
    return {'conversation_id': conversation_id, 'turns': conversation.turns}

@app.post('/api/session-token/{avatar}')
async def session_token(avatar: str):
    selected = AVATARS.get(avatar)
    if not selected:
        raise HTTPException(404, 'Unknown avatar')
    if not os.getenv('ANAM_API_KEY') or not selected['avatarId'] or not selected['voiceId']:
        raise HTTPException(400, f'Missing ANAM_API_KEY or avatar/voice IDs for {avatar}. Check .env.')
    payload = {'personaConfig': {
        'name': selected['name'], 'avatarId': selected['avatarId'],
        'voiceId': selected['voiceId'], 'llmId': 'CUSTOMER_CLIENT_V1',
    }}
    if os.getenv('ANAM_AVATAR_MODEL'):
        payload['personaConfig']['avatarModel'] = os.getenv('ANAM_AVATAR_MODEL')
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post('https://api.anam.ai/v1/auth/session-token',
                headers={'Authorization': f"Bearer {os.environ['ANAM_API_KEY']}"}, json=payload)
        if response.is_error:
            raise HTTPException(response.status_code, f'Anam token request failed: {response.text[:400]}')
        token = response.json().get('sessionToken')
        if not token:
            raise HTTPException(502, 'Anam returned no session token')
        return {'sessionToken': token}
    except httpx.RequestError as exc:
        raise HTTPException(502, f'Anam connection failed: {exc}') from exc

async def generate_reply(speaker: str, turns: list[dict]) -> str:
    own = AVATARS[speaker]['name']
    other = AVATARS['b' if speaker == 'a' else 'a']['name']
    transcript = '\n'.join(
        f"{('Human' if turn['speaker'] == 'human' else AVATARS[turn['speaker']]['name'])}: {turn['content']}"
        for turn in turns[-MAX_TURNS:]
    )
    instructions = (
        f'You are {own} in a group conversation with a human and {other}, another AI avatar. '
        f'You are speaking as {own} only. Read the labeled transcript carefully; know who said each line. '
        f'Address the human and {other} naturally when relevant. Never claim you said something another participant said. '
        'Give one concise, conversational spoken response (usually 1-3 sentences). '
        'Do not prefix your answer with a name or stage directions. Plain text only.'
    )
    result = await AsyncOpenAI(api_key=os.environ['OPENAI_API_KEY']).chat.completions.create(
        model=os.getenv('OPENAI_MODEL', 'gpt-4.1-mini'),
        messages=[{'role': 'system', 'content': instructions},
                  {'role': 'user', 'content': f'Group discussion so far:\n{transcript}\n\nRespond now as {own}.'}],
        max_tokens=220,
    )
    reply = result.choices[0].message.content
    if not reply:
        raise HTTPException(502, 'OpenAI returned an empty reply')
    return reply.strip()

@app.post('/api/conversations/messages')
async def post_message(message: GroupMessage):
    conversation = conversations.get(message.conversation_id)
    if conversation is None:
        raise HTTPException(404, 'Conversation not found; create a new one')
    if message.target not in ('a', 'b', 'both'):
        raise HTTPException(400, 'Target must be a, b, or both')
    if not message.content.strip():
        raise HTTPException(400, 'Message cannot be blank')
    if not os.getenv('OPENAI_API_KEY'):
        raise HTTPException(400, 'Missing OPENAI_API_KEY in .env')
    async with conversation.lock:
        if len(conversation.turns) >= MAX_TURNS - 3:
            raise HTTPException(400, 'Conversation is full; start a new one')
        staged = [*conversation.turns, {'speaker': 'human', 'content': message.content.strip()}]
        speakers = ['a', 'b'] if message.target == 'both' else [message.target]
        replies = []
        try:
            for speaker in speakers:
                reply = await generate_reply(speaker, staged)
                turn = {'speaker': speaker, 'content': reply}
                staged.append(turn)  # The next avatar sees this reply.
                replies.append(turn)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, f'OpenAI request failed: {exc}') from exc
        conversation.turns = staged  # Commit only after all replies succeed.
        return {'turns': staged, 'replies': replies}

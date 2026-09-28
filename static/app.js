import { createClient } from 'https://esm.sh/@anam-ai/js-sdk@4.25.0';
import { AnamEvent } from 'https://esm.sh/@anam-ai/js-sdk@4.25.0/dist/module/types';

const state = { a: { client: null, ready: false }, b: { client: null, ready: false } };
const $ = id => document.getElementById(id);
const names = { a: 'Avatar A', b: 'Avatar B' };
let conversationId = null;
let turns = [];
let starting = false;
let busy = false;

async function jsonResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`);
  return body;
}
function status(key, value) {
  $(`status-${key}`).textContent = value;
  $(`light-${key}`).classList.toggle('on', value === 'Connected');
}
function refresh() {
  $('start').disabled = starting || Object.values(state).some(s => s.client !== null);
  $('stop').disabled = !Object.values(state).some(s => s.client !== null);
  const target = $('avatar').value;
  $('send').disabled = busy || !conversationId || (target === 'both'
    ? !state.a.ready || !state.b.ready : !state[target].ready);
  $('new-conversation').disabled = busy;
  renderHistory();
}
function renderHistory() {
  const history = $('history');
  history.replaceChildren();
  for (const turn of turns) {
    const line = document.createElement('p');
    const who = document.createElement('strong');
    who.textContent = `${turn.speaker === 'human' ? 'You' : names[turn.speaker]}: `;
    line.append(who, document.createTextNode(turn.content));
    history.append(line);
  }
  history.scrollTop = history.scrollHeight;
}
async function newConversation() {
  const result = await jsonResponse(await fetch('/api/conversations', { method: 'POST' }));
  conversationId = result.conversation_id;
  sessionStorage.setItem('groupConversationId', conversationId);
  turns = [];
  $('global-status').textContent = 'New shared conversation ready';
  refresh();
}
function stopOne(key) {
  const old = state[key].client;
  state[key].client = null;
  state[key].ready = false;
  if (old) { try { old.stopStreaming(); } catch (error) { console.error(error); } }
  $(`video-${key}`).srcObject = null;
  status(key, 'Disconnected');
  refresh();
}
async function startOne(key) {
  status(key, 'Connecting...');
  const { sessionToken } = await jsonResponse(await fetch(`/api/session-token/${key}`, { method: 'POST' }));
  const client = createClient(sessionToken, { disableInputAudio: true });
  state[key].client = client;
  client.addListener(AnamEvent.SESSION_READY, () => {
    if (state[key].client !== client) return;
    state[key].ready = true;
    status(key, 'Connected');
    refresh();
  });
  client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
    if (state[key].client === client) stopOne(key);
  });
  await client.streamToVideoElement(`video-${key}`);
}

// Anam emits completed persona history after speaking. Resolve on the expected text;
// a timeout lets the group continue if a completion event is unavailable.
function speak(key, reply) {
  return new Promise((resolve, reject) => {
    const client = state[key].client;
    if (!client || !state[key].ready) { reject(new Error(`${names[key]} disconnected`)); return; }
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      try { client.removeListener(AnamEvent.MESSAGE_HISTORY_UPDATED, onHistory); } catch (_) {}
    };
    const onHistory = messages => {
      const last = messages[messages.length - 1];
      if (last?.role === 'persona' && last.content?.trim() === reply.trim() && !finished) {
        finished = true; cleanup(); resolve();
      }
    };
    const timer = setTimeout(() => {
      if (!finished) { finished = true; cleanup(); resolve(); }
    }, 45000);
    client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, onHistory);
    Promise.resolve(client.talk(reply)).catch(error => {
      if (!finished) { finished = true; cleanup(); reject(error); }
    });
  });
}

$('start').addEventListener('click', async () => {
  starting = true; refresh();
  const results = await Promise.allSettled(['a', 'b'].map(startOne));
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const key = ['a', 'b'][i];
      stopOne(key);
      status(key, `Error: ${result.reason.message}`);
    }
  });
  $('global-status').textContent = results.every(r => r.status === 'fulfilled')
    ? 'Both avatars connected to the shared discussion' : 'One or more avatar sessions failed';
  starting = false; refresh();
});
$('stop').addEventListener('click', () => {
  stopOne('a'); stopOne('b'); $('global-status').textContent = 'Streams stopped; conversation memory remains on the server';
});
$('avatar').addEventListener('change', refresh);
$('new-conversation').addEventListener('click', () => {
  newConversation().catch(error => { $('global-status').textContent = `Error: ${error.message}`; });
});
$('chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const target = $('avatar').value;
  if (busy || !conversationId || (target === 'both' ? !state.a.ready || !state.b.ready : !state[target].ready)) return;
  const input = $('message');
  const content = input.value.trim();
  if (!content) return;
  busy = true; input.value = '';
  $('global-status').textContent = 'Thinking...'; refresh();
  try {
    const result = await jsonResponse(await fetch('/api/conversations/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, target, content }),
    }));
    turns = result.turns;
    renderHistory();
    for (const reply of result.replies) {
      $('global-status').textContent = `${names[reply.speaker]} is speaking...`;
      await speak(reply.speaker, reply.content);
    }
    $('global-status').textContent = 'Your turn';
  } catch (error) {
    input.value = content;
    $('global-status').textContent = `Error: ${error.message}`;
  } finally { busy = false; refresh(); }
});
fetch('/api/config').then(jsonResponse).then(({ avatars }) => {
  for (const key of ['a', 'b']) {
    names[key] = avatars[key].name;
    $(`name-${key}`).textContent = names[key];
    $('avatar').querySelector(`[value="${key}"]`).textContent = names[key];
  }
}).catch(error => { $('global-status').textContent = error.message; });
async function restoreConversation() {
  const stored = sessionStorage.getItem('groupConversationId');
  if (stored) {
    try {
      const result = await jsonResponse(await fetch(`/api/conversations/${encodeURIComponent(stored)}`));
      conversationId = stored; turns = result.turns;
      $('global-status').textContent = 'Shared conversation restored';
      refresh(); return;
    } catch (_) { sessionStorage.removeItem('groupConversationId'); }
  }
  await newConversation();
}
restoreConversation().catch(error => { $('global-status').textContent = `Error: ${error.message}`; });
window.addEventListener('pagehide', () => { stopOne('a'); stopOne('b'); });

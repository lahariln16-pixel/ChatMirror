const loginScreen =
  document.getElementById('loginScreen');

const appScreen =
  document.getElementById('appScreen');

const loginForm =
  document.getElementById('loginForm');

const passwordInput =
  document.getElementById('passwordInput');

const loginButton =
  document.getElementById('loginButton');

const loginError =
  document.getElementById('loginError');

const togglePassword =
  document.getElementById('togglePassword');

const logoutButton =
  document.getElementById('logoutButton');

const spacesList =
  document.getElementById('spacesList');

const spaceSearch =
  document.getElementById('spaceSearch');

const refreshButton =
  document.getElementById('refreshButton');

const chatTitle =
  document.getElementById('chatTitle');

const chatStatus =
  document.getElementById('chatStatus');

const messages =
  document.getElementById('messages');

const messageInput =
  document.getElementById('messageInput');

const sendButton =
  document.getElementById('sendButton');

const mobileMenuButton =
  document.getElementById('mobileMenuButton');

let spaces = [];
let selectedSpace = null;
let socket = null;


/* =====================================================
   AUTH
===================================================== */

async function checkAuth() {
  try {
    const response = await fetch(
      '/api/auth/status',
      {
        credentials: 'same-origin',
        cache: 'no-store'
      }
    );

    const data = await response.json();

    if (data.authenticated) {
      showApp();
    } else {
      showLogin();
    }

  } catch (error) {
    console.error('Auth check failed:', error);
    showLogin();
  }
}


function showLogin() {
  loginScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');

  setTimeout(() => {
    passwordInput.focus();
  }, 50);
}


function showApp() {
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');

  connectWebSocket();
  loadSpaces();
}


loginForm.addEventListener(
  'submit',
  async event => {

    event.preventDefault();

    const password =
      passwordInput.value;

    if (!password) {
      loginError.textContent =
        'Enter your password.';
      return;
    }

    loginButton.disabled = true;

    const buttonText =
      loginButton.querySelector('span');

    if (buttonText) {
      buttonText.textContent =
        'CHECKING...';
    }

    loginError.textContent = '';

    try {

      const response =
        await fetch(
          '/api/auth/login',
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type':
                'application/json'
            },
            body:
              JSON.stringify({
                password
              })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {

        loginError.textContent =
          data.error ||
          'Login failed.';

        passwordInput.select();
        return;
      }

      passwordInput.value = '';

      showApp();

    } catch (error) {

      console.error(error);

      loginError.textContent =
        'Unable to connect to server.';

    } finally {

      loginButton.disabled = false;

      if (buttonText) {
        buttonText.textContent =
          'UNLOCK';
      }
    }
  }
);


togglePassword.addEventListener(
  'click',
  () => {

    const visible =
      passwordInput.type === 'text';

    passwordInput.type =
      visible
        ? 'password'
        : 'text';

    togglePassword.textContent =
      visible
        ? '👁'
        : '🙈';
  }
);


logoutButton.addEventListener(
  'click',
  async () => {

    try {

      await fetch(
        '/api/auth/logout',
        {
          method: 'POST',
          credentials: 'same-origin'
        }
      );

    } catch (error) {
      console.error(error);
    }

    if (socket) {
      socket.close();
      socket = null;
    }

    selectedSpace = null;
    spaces = [];

    showLogin();
  }
);


/* =====================================================
   WEBSOCKET
===================================================== */

function connectWebSocket() {

  if (socket) {
    try {
      socket.close();
    } catch {}
  }

  const protocol =
    location.protocol === 'https:'
      ? 'wss:'
      : 'ws:';

  socket =
    new WebSocket(
      `${protocol}//${location.host}/ws`
    );

  socket.addEventListener(
    'open',
    () => {

      chatStatus.innerHTML =
        '<span class="status-dot"></span> LIVE';

      console.log(
        '🟢 WebSocket connected'
      );
    }
  );

  socket.addEventListener(
    'close',
    () => {

      chatStatus.innerHTML =
        '<span class="status-dot" style="background:#666;box-shadow:none"></span> DISCONNECTED';

      console.log(
        '🔴 WebSocket disconnected'
      );

      setTimeout(
        () => {

          if (
            !appScreen.classList.contains(
              'hidden'
            )
          ) {
            connectWebSocket();
          }

        },
        3000
      );
    }
  );

  socket.addEventListener(
    'message',
    event => {

      try {

        const payload =
          JSON.parse(
            event.data
          );

        /*
          New backend format:

          {
            type: "message_created",
            eventType: "...",
            message: {...}
          }

          Old backend format:

          {
            type: "chat_event",
            data: {...}
          }
        */

        if (
          payload.type === 'connected'
        ) {
          console.log(
            '⚡ ChatMirror live connection ready'
          );
          return;
        }

        if (
          payload.type === 'chat_event'
        ) {
          handleLiveEvent(
            payload.data
          );
          return;
        }

        if (
          payload.type === 'message_created' ||
          payload.type === 'message_updated' ||
          payload.type === 'message_deleted'
        ) {
          handleLiveEvent(payload);
          return;
        }

      } catch (error) {

        console.error(
          'WebSocket event error:',
          error
        );
      }
    }
  );
}


/* =====================================================
   SPACES
===================================================== */

async function loadSpaces() {

  spacesList.innerHTML =
    '<div class="loading">Loading chats...</div>';

  try {

    const response =
      await fetch(
        '/api/spaces',
        {
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    if (
      response.status === 401
    ) {
      showLogin();
      return;
    }

    const data =
      await response.json();

    spaces =
      data.spaces || [];

    renderSpaces();

  } catch (error) {

    console.error(error);

    spacesList.innerHTML =
      '<div class="loading">Failed to load chats.</div>';
  }
}


function getSpaceTitle(space) {

  if (space.displayName) {
    return space.displayName;
  }

  if (space.name) {
    return space.name
      .split('/')
      .pop();
  }

  return 'Conversation';
}


function renderSpaces() {

  const query =
    spaceSearch.value
      .trim()
      .toLowerCase();

  const filtered =
    spaces.filter(
      space =>
        getSpaceTitle(space)
          .toLowerCase()
          .includes(query)
    );

  if (!filtered.length) {

    spacesList.innerHTML =
      '<div class="loading">No conversations found.</div>';

    return;
  }

  spacesList.innerHTML = '';

  for (
    const space of filtered
  ) {

    const item =
      document.createElement('div');

    item.className =
      'space-item';

    if (
      selectedSpace &&
      selectedSpace.name === space.name
    ) {
      item.classList.add('active');
    }

    const avatar =
      document.createElement('div');

    avatar.className =
      'space-avatar';

    avatar.textContent =
      getSpaceInitial(space);

    const info =
      document.createElement('div');

    info.className =
      'space-info';

    const title =
      document.createElement('div');

    title.className =
      'space-name';

    title.textContent =
      getSpaceTitle(space);

    const type =
      document.createElement('div');

    type.className =
      'space-type';

    type.textContent =
      space.spaceType ||
      'CHAT';

    info.appendChild(title);
    info.appendChild(type);

    item.appendChild(avatar);
    item.appendChild(info);

    item.addEventListener(
      'click',
      () => {

        selectSpace(space);

        document
          .querySelector('.sidebar')
          ?.classList.remove('open');
      }
    );

    spacesList.appendChild(item);
  }
}


function getSpaceInitial(space) {

  const title =
    getSpaceTitle(space).trim();

  if (!title) {
    return 'C';
  }

  return title
    .charAt(0)
    .toUpperCase();
}


/* =====================================================
   SELECT SPACE
===================================================== */

async function selectSpace(space) {

  selectedSpace =
    space;

  renderSpaces();

  chatTitle.textContent =
    getSpaceTitle(space);

  messageInput.disabled =
    false;

  sendButton.disabled =
    false;

  messages.innerHTML =
    '<div class="loading">Loading messages...</div>';

  try {

    const encoded =
      encodeURIComponent(
        space.name
      );

    const response =
      await fetch(
        `/api/spaces/${encoded}/messages`,
        {
          credentials: 'same-origin',
          cache: 'no-store'
        }
      );

    if (
      response.status === 401
    ) {
      showLogin();
      return;
    }

    const data =
      await response.json();

    renderMessages(
      data.messages || []
    );

  } catch (error) {

    console.error(error);

    messages.innerHTML =
      '<div class="loading">Failed to load messages.</div>';
  }
}


/* =====================================================
   MESSAGE HELPERS
===================================================== */

function senderName(message) {

  if (
    message.sender?.displayName
  ) {
    return message.sender.displayName;
  }

  if (
    message.sender?.name
  ) {

    const id =
      message.sender.name
        .split('/')
        .pop();

    if (id) {
      return `User ${id.slice(-6)}`;
    }
  }

  return 'Unknown';
}


function senderInitial(message) {

  const name =
    senderName(message);

  if (!name) {
    return '?';
  }

  const clean =
    name
      .replace(/^User\s+/i, '')
      .trim();

  return clean
    .charAt(0)
    .toUpperCase() || '?';
}


function formatTime(timestamp) {

  if (!timestamp) {
    return '';
  }

  const date =
    new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now =
    new Date();

  const sameDay =
    date.toDateString() ===
    now.toDateString();

  if (sameDay) {

    return date.toLocaleTimeString(
      undefined,
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    );
  }

  return date.toLocaleString(
    undefined,
    {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }
  );
}


function getMessageText(message) {

  if (message.text) {
    return message.text;
  }

  if (message.formattedText) {
    return message.formattedText;
  }

  if (
    message.attachment
  ) {
    return '📎 Attachment';
  }

  return '(message)';
}


/* =====================================================
   MESSAGE RENDERING
===================================================== */

function renderMessages(messageList) {

  messages.innerHTML = '';

  if (!messageList.length) {

    messages.innerHTML =
      `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <h2>No messages yet</h2>
        <p>Start the conversation.</p>
      </div>
      `;

    return;
  }

  const sorted =
    [...messageList]
      .sort(
        (a, b) =>
          new Date(a.createTime || 0) -
          new Date(b.createTime || 0)
      );

  for (
    const message of sorted
  ) {

    appendMessage(
      message,
      false
    );
  }

  scrollToBottom();
}


function findMessageElement(
  messageName
) {

  if (!messageName) {
    return null;
  }

  return document.querySelector(
    `[data-message-id="${CSS.escape(messageName)}"]`
  );
}


function appendMessage(
  message,
  live = true
) {

  if (
    !message ||
    !message.name
  ) {
    return;
  }

  const existing =
    findMessageElement(
      message.name
    );

  /*
    If it already exists, refresh it
    instead of creating a duplicate.
  */

  if (existing) {

    updateMessageElement(
      existing,
      message
    );

    return;
  }

  const empty =
    messages.querySelector(
      '.empty-state'
    );

  if (empty) {
    empty.remove();
  }

  const wrapper =
    document.createElement('div');

  wrapper.className =
    'message';

  wrapper.dataset.messageId =
    message.name;

  const avatar =
    document.createElement('div');

  avatar.className =
    'message-avatar';

  /*
    Google Chat may provide avatarUrl.
  */

  if (
    message.sender?.avatarUrl
  ) {

    const image =
      document.createElement('img');

    image.src =
      message.sender.avatarUrl;

    image.alt =
      senderName(message);

    image.onerror =
      () => {

        image.remove();

        avatar.textContent =
          senderInitial(message);
      };

    avatar.appendChild(image);

  } else {

    avatar.textContent =
      senderInitial(message);
  }

  const content =
    document.createElement('div');

  content.className =
    'message-content';

  const header =
    document.createElement('div');

  header.className =
    'message-header';

  const sender =
    document.createElement('div');

  sender.className =
    'message-sender';

  sender.textContent =
    senderName(message);

  const time =
    document.createElement('div');

  time.className =
    'message-time';

  time.textContent =
    formatTime(
      message.createTime
    );

  header.appendChild(sender);
  header.appendChild(time);

  const bubble =
    document.createElement('div');

  bubble.className =
    'message-bubble';

  bubble.textContent =
    getMessageText(message);

  content.appendChild(header);
  content.appendChild(bubble);

  if (
    message.updateTime &&
    message.updateTime !== message.createTime
  ) {

    const edited =
      document.createElement('span');

    edited.className =
      'message-edited';

    edited.textContent =
      'edited';

    content.appendChild(edited);
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(content);

  messages.appendChild(wrapper);

  if (live) {
    wrapper.classList.add('message-live');

    setTimeout(
      () => wrapper.classList.remove('message-live'),
      700
    );

    scrollToBottom();
  }
}


function updateMessageElement(
  element,
  message
) {

  const bubble =
    element.querySelector(
      '.message-bubble'
    );

  if (bubble) {
    bubble.textContent =
      getMessageText(message);
  }

  const sender =
    element.querySelector(
      '.message-sender'
    );

  if (sender) {
    sender.textContent =
      senderName(message);
  }

  const time =
    element.querySelector(
      '.message-time'
    );

  if (time) {
    time.textContent =
      formatTime(
        message.updateTime ||
        message.createTime
      );
  }

  if (
    message.updateTime &&
    message.updateTime !== message.createTime
  ) {

    if (
      !element.querySelector(
        '.message-edited'
      )
    ) {

      const edited =
        document.createElement('span');

      edited.className =
        'message-edited';

      edited.textContent =
        'edited';

      const content =
        element.querySelector(
          '.message-content'
        );

      if (content) {
        content.appendChild(edited);
      }
    }
  }

  element.classList.add(
    'message-updated'
  );

  setTimeout(
    () => {
      element.classList.remove(
        'message-updated'
      );
    },
    700
  );
}


function deleteMessage(
  messageName
) {

  const element =
    findMessageElement(
      messageName
    );

  if (!element) {
    return;
  }

  const bubble =
    element.querySelector(
      '.message-bubble'
    );

  if (bubble) {

    bubble.textContent =
      'This message was deleted';

    bubble.classList.add(
      'message-deleted'
    );
  }

  const edited =
    element.querySelector(
      '.message-edited'
    );

  if (edited) {
    edited.remove();
  }

  element.classList.add(
    'deleted'
  );
}


function scrollToBottom() {

  messages.scrollTop =
    messages.scrollHeight;
}


/* =====================================================
   LIVE EVENTS
===================================================== */

function handleLiveEvent(payload) {

  /*
    Support both:

    payload = {
      type: "message_created",
      message: {...}
    }

    and the older:

    payload = {
      eventType: "...",
      message: {...}
    }
  */

  if (!payload) {
    return;
  }

  const message =
    payload.message ||
    payload.data?.message;

  if (!message) {
    return;
  }

  const eventType =
    payload.type ||
    payload.eventType ||
    '';

  /*
    Ignore events from other spaces.
  */

  if (
    selectedSpace &&
    message.space?.name &&
    message.space.name !==
      selectedSpace.name
  ) {
    return;
  }

  /*
    CREATED
  */

  if (
    eventType.includes('created')
  ) {

    if (!selectedSpace) {
      return;
    }

    appendMessage(
      message,
      true
    );

    return;
  }

  /*
    UPDATED
  */

  if (
    eventType.includes('updated')
  ) {

    if (!selectedSpace) {
      return;
    }

    if (
      message.space?.name &&
      message.space.name !==
        selectedSpace.name
    ) {
      return;
    }

    appendMessage(
      message,
      true
    );

    return;
  }

  /*
    DELETED
  */

  if (
    eventType.includes('deleted')
  ) {

    deleteMessage(
      message.name
    );
  }
}


/* =====================================================
   SEND
===================================================== */

async function sendMessage() {

  if (!selectedSpace) {
    return;
  }

  const text =
    messageInput.value.trim();

  if (!text) {
    return;
  }

  sendButton.disabled =
    true;

  try {

    const encoded =
      encodeURIComponent(
        selectedSpace.name
      );

    const response =
      await fetch(
        `/api/spaces/${encoded}/messages`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type':
              'application/json'
          },
          body:
            JSON.stringify({
              text
            })
        }
      );

    if (
      response.status === 401
    ) {
      showLogin();
      return;
    }

    if (!response.ok) {

      const data =
        await response.json();

      throw new Error(
        data.error ||
        'Failed to send message'
      );
    }

    messageInput.value = '';

    autoResize();

  } catch (error) {

    console.error(
      'Send failed:',
      error
    );

    alert(
      'Failed to send message.'
    );

  } finally {

    sendButton.disabled =
      false;

    messageInput.focus();
  }
}


sendButton.addEventListener(
  'click',
  sendMessage
);


messageInput.addEventListener(
  'keydown',
  event => {

    if (
      event.key === 'Enter' &&
      !event.shiftKey
    ) {

      event.preventDefault();

      sendMessage();
    }
  }
);


messageInput.addEventListener(
  'input',
  autoResize
);


function autoResize() {

  messageInput.style.height =
    'auto';

  messageInput.style.height =
    Math.min(
      messageInput.scrollHeight,
      140
    ) + 'px';
}


/* =====================================================
   SEARCH / REFRESH / MOBILE
===================================================== */

spaceSearch.addEventListener(
  'input',
  renderSpaces
);


refreshButton.addEventListener(
  'click',
  loadSpaces
);


mobileMenuButton.addEventListener(
  'click',
  () => {

    document
      .querySelector('.sidebar')
      ?.classList.toggle('open');
  }
);


/* =====================================================
   START
===================================================== */

checkAuth();

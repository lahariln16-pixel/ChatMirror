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

const fileInput =
  document.getElementById('fileInput');

const attachButton =
  document.getElementById('attachButton');

const attachmentLabel =
  document.getElementById('attachmentLabel');

const mobileMenuButton =
  document.getElementById('mobileMenuButton');


/* =====================================================
   REPLY UI
===================================================== */

let replyingTo = null;
let replyBar = null;
let replyBarName = null;
let replyBarText = null;

function createReplyBar() {

  if (replyBar) {
    return;
  }

  const composer =
    document.querySelector('.composer');

  if (!composer) {
    return;
  }

  replyBar =
    document.createElement('div');

  replyBar.className =
    'reply-bar hidden';

  const info =
    document.createElement('div');

  info.className =
    'reply-bar-info';

  const label =
    document.createElement('div');

  label.className =
    'reply-bar-label';

  label.textContent =
    '↩ Replying to';

  replyBarName =
    document.createElement('div');

  replyBarName.className =
    'reply-bar-name';

  replyBarText =
    document.createElement('div');

  replyBarText.className =
    'reply-bar-text';

  info.appendChild(label);
  info.appendChild(replyBarName);
  info.appendChild(replyBarText);

  const cancel =
    document.createElement('button');

  cancel.type = 'button';
  cancel.className = 'reply-bar-cancel';
  cancel.title = 'Cancel reply';
  cancel.textContent = '×';

  cancel.addEventListener(
    'click',
    clearReply
  );

  replyBar.appendChild(info);
  replyBar.appendChild(cancel);

  composer.parentNode.insertBefore(
    replyBar,
    composer
  );
}


function setReplyTarget(message) {

  if (
    !message ||
    !message.name
  ) {
    return;
  }

  const threadName =
    message.thread?.name;

  if (!threadName) {
    console.warn(
      'Cannot reply: message has no thread name',
      message
    );

    return;
  }

  replyingTo = {
    message,
    threadName
  };

  createReplyBar();

  if (!replyBar) {
    return;
  }

  replyBarName.textContent =
    senderName(message);

  const originalText =
    getMessageText(message);

  if (originalText) {
    replyBarText.textContent =
      originalText.length > 120
        ? `${originalText.slice(0, 120)}…`
        : originalText;
  } else if (
    Array.isArray(message.attachment) &&
    message.attachment.length
  ) {
    replyBarText.textContent =
      message.attachment.length === 1
        ? 'Attachment'
        : `${message.attachment.length} attachments`;
  } else {
    replyBarText.textContent =
      'Message';
  }

  replyBar.classList.remove('hidden');

  messageInput.focus();
}


function clearReply() {

  replyingTo = null;

  if (replyBar) {
    replyBar.classList.add('hidden');
  }

  messageInput.focus();
}


function createReplyButton(message) {

  const actions =
    document.createElement('div');

  actions.className =
    'message-actions';

  const button =
    document.createElement('button');

  button.type = 'button';
  button.className = 'reply-button';
  button.textContent = '↩ Reply';
  button.title = 'Reply to this message';

  if (!message.thread?.name) {
    button.disabled = true;
    button.title =
      'This message cannot be replied to';
  } else {
    button.addEventListener(
      'click',
      event => {
        event.preventDefault();
        event.stopPropagation();

        setReplyTarget(message);
      }
    );
  }

  actions.appendChild(button);

  return actions;
}


createReplyBar();

let spaces = [];

// Chat list pagination
let spacesNextPageToken = null;
let loadingMoreSpaces = false;
let hasMoreSpaces = false;


/* =====================================================
   UNREAD MESSAGE STATE
===================================================== */

const UNREAD_STORAGE_KEY =
  'chatmirror_unread_counts';

let unreadCounts = {};

try {

  const saved =
    localStorage.getItem(
      UNREAD_STORAGE_KEY
    );

  if (saved) {
    const parsed =
      JSON.parse(saved);

    if (
      parsed &&
      typeof parsed === 'object'
    ) {
      unreadCounts = parsed;
    }
  }

} catch (error) {

  console.warn(
    '⚠️ Could not load unread counts:',
    error
  );
}


function saveUnreadCounts() {

  try {

    localStorage.setItem(
      UNREAD_STORAGE_KEY,
      JSON.stringify(unreadCounts)
    );

  } catch (error) {

    console.warn(
      '⚠️ Could not save unread counts:',
      error
    );
  }
}


function getUnreadCount(spaceName) {

  if (!spaceName) {
    return 0;
  }

  return Number(
    unreadCounts[spaceName] || 0
  );
}


function setUnreadCount(
  spaceName,
  count
) {

  if (!spaceName) {
    return;
  }

  const safeCount =
    Math.max(
      0,
      Number(count) || 0
    );

  if (safeCount === 0) {
    delete unreadCounts[spaceName];
  } else {
    unreadCounts[spaceName] =
      safeCount;
  }

  saveUnreadCounts();
}


function incrementUnread(
  spaceName
) {

  if (!spaceName) {
    return;
  }

  const current =
    getUnreadCount(spaceName);

  setUnreadCount(
    spaceName,
    current + 1
  );

  renderSpaces();
  updateLoadMoreSpacesButton();
}


function clearUnread(
  spaceName
) {

  if (!spaceName) {
    return;
  }

  if (
    getUnreadCount(spaceName) === 0
  ) {
    return;
  }

  setUnreadCount(
    spaceName,
    0
  );

  renderSpaces();
  updateLoadMoreSpacesButton();
}

/* =====================================================
   REPLY STATE
===================================================== */





/* =====================================================
   AUTH
===================================================== */

let currentUserId = null;

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

    currentUserId =
      data.userId || null;

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

  spacesNextPageToken =
    null;

  loadingMoreSpaces =
    false;

  hasMoreSpaces =
    false;

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

    spacesNextPageToken =
      data.nextPageToken || null;

    hasMoreSpaces =
      Boolean(spacesNextPageToken);

    renderSpaces();
    updateLoadMoreSpacesButton();

  } catch (error) {

    console.error(error);

    spacesList.innerHTML =
      '<div class="loading">Failed to load chats.</div>';
  }
}

async function loadMoreSpaces() {

  if (
    loadingMoreSpaces ||
    !spacesNextPageToken
  ) {
    return;
  }

  loadingMoreSpaces =
    true;

  updateLoadMoreSpacesButton();

  try {

    const pageToken =
      encodeURIComponent(
        spacesNextPageToken
      );

    const response =
      await fetch(
        `/api/spaces?pageToken=${pageToken}`,
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

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    const newSpaces =
      data.spaces || [];

    /*
     * Avoid duplicates in case an already-loaded
     * space appears again between API pages.
     */
    const existingNames =
      new Set(
        spaces.map(
          space => space.name
        )
      );

    for (
      const space of newSpaces
    ) {
      if (
        !existingNames.has(
          space.name
        )
      ) {
        spaces.push(space);
        existingNames.add(space.name);
      }
    }

    spacesNextPageToken =
      data.nextPageToken || null;

    hasMoreSpaces =
      Boolean(
        spacesNextPageToken
      );

    renderSpaces();
    updateLoadMoreSpacesButton();

  } catch (error) {

    console.error(
      'Failed to load more chats:',
      error
    );

  } finally {

    loadingMoreSpaces =
      false;

    updateLoadMoreSpacesButton();
  }
}


function updateLoadMoreSpacesButton() {

  let button =
    document.querySelector(
      '.load-more-spaces-button'
    );

  if (!hasMoreSpaces) {

    if (button) {
      button.remove();
    }

    return;
  }

  if (!button) {

    button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'load-more-spaces-button';

    button.addEventListener(
      'click',
      loadMoreSpaces
    );

    spacesList.appendChild(
      button
    );
  }

  button.textContent =
    loadingMoreSpaces
      ? 'Loading more chats...'
      : '↓ Load more chats';

  button.disabled =
    loadingMoreSpaces;
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

    const unreadCount =
      getUnreadCount(space.name);

    let badge = null;

    if (unreadCount > 0) {

      item.classList.add(
        'has-unread'
      );

      badge =
        document.createElement('div');

      badge.className =
        'space-unread-badge';

      badge.textContent =
        unreadCount > 99
          ? '99+'
          : String(unreadCount);
    }

    /*
      Keep the conversation layout in the
      natural order:

      avatar → conversation info → unread badge
    */

    item.appendChild(avatar);
    item.appendChild(info);

    if (badge) {
      item.appendChild(badge);
    }

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

  /*
    Opening a conversation marks its
    unread messages as read.
  */

  clearUnread(
    space.name
  );

  renderSpaces();

  chatTitle.textContent =
    getSpaceTitle(space);

  messageInput.disabled =
    false;

  sendButton.disabled =
    false;

  messageNextPageToken =
    null;

  loadingOlderMessages =
    false;

  hasOlderMessages =
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

    messageNextPageToken =
      data.nextPageToken || null;

    hasOlderMessages =
      Boolean(messageNextPageToken);

    renderMessages(
      data.messages || []
    );

    updateOlderMessagesButton();

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

  if (Array.isArray(message.attachment) &&
      message.attachment.length) {
    return '';
  }

  return '(message)';
}


function attachmentDownloadUrl(attachment) {

  const resourceName =
    attachment?.attachmentDataRef?.resourceName;

  if (!resourceName) {
    return null;
  }

  const params =
    new URLSearchParams({
      resourceName,
      filename:
        attachment.contentName ||
        'attachment',
      contentType:
        attachment.contentType ||
        'application/octet-stream'
    });

  return `/api/attachments/download?${params.toString()}`;
}


function renderAttachments(container, message) {

  if (
    !Array.isArray(message.attachment) ||
    !message.attachment.length
  ) {
    return;
  }

  const attachments =
    document.createElement('div');

  attachments.className =
    'message-attachments';

  for (const attachment of message.attachment) {

    const name =
      attachment.contentName ||
      'Attachment';

    const contentType =
      attachment.contentType ||
      'application/octet-stream';

    const resourceName =
      attachment
        .attachmentDataRef
        ?.resourceName;

    const downloadUrl =
      attachmentDownloadUrl(
        attachment
      );

    const card =
      document.createElement('div');

    card.className =
      'attachment-card';

    if (
      contentType.startsWith('image/') &&
      downloadUrl
    ) {

      const image =
        document.createElement('img');

      image.className =
        'attachment-image';

      image.src =
        downloadUrl;

      image.alt =
        name;

      image.loading =
        'lazy';

      image.onerror =
        () => {
          image.remove();
          card.classList.add(
            'attachment-image-failed'
          );
        };

      card.appendChild(image);
    }

    const info =
      document.createElement('div');

    info.className =
      'attachment-info';

    const icon =
      document.createElement('span');

    icon.className =
      'attachment-icon';

    if (contentType.startsWith('image/')) {
      icon.textContent = '🖼️';
    } else if (contentType.startsWith('video/')) {
      icon.textContent = '🎬';
    } else if (contentType.startsWith('audio/')) {
      icon.textContent = '🎵';
    } else if (
      contentType.includes('pdf')
    ) {
      icon.textContent = '📕';
    } else if (
      contentType.includes('zip') ||
      contentType.includes('compressed')
    ) {
      icon.textContent = '🗜️';
    } else {
      icon.textContent = '📎';
    }

    const details =
      document.createElement('div');

    details.className =
      'attachment-details';

    const title =
      document.createElement('div');

    title.className =
      'attachment-name';

    title.textContent =
      name;

    details.appendChild(title);

    const type =
      document.createElement('div');

    type.className =
      'attachment-type';

    type.textContent =
      contentType;

    details.appendChild(type);

    info.appendChild(icon);
    info.appendChild(details);

    if (downloadUrl) {

      const download =
        document.createElement('a');

      download.className =
        'attachment-download';

      download.href =
        downloadUrl;

      download.target =
        '_blank';

      download.rel =
        'noopener';

      download.textContent =
        'Open';

      info.appendChild(download);

    } else if (attachment.downloadUri) {

      const download =
        document.createElement('a');

      download.className =
        'attachment-download';

      download.href =
        attachment.downloadUri;

      download.target =
        '_blank';

      download.rel =
        'noopener';

      download.textContent =
        'Open';

      info.appendChild(download);
    }

    card.appendChild(info);

    attachments.appendChild(card);
  }

  container.appendChild(
    attachments
  );
}


/* =====================================================
   MESSAGE RENDERING
===================================================== */

async function loadOlderMessages() {

  if (
    loadingOlderMessages ||
    !messageNextPageToken ||
    !selectedSpace
  ) {
    return;
  }

  loadingOlderMessages =
    true;

  const button =
    document.querySelector(
      '.load-older-button'
    );

  if (button) {
    button.disabled =
      true;

    button.textContent =
      'Loading older messages...';
  }

  try {

    const encoded =
      encodeURIComponent(
        selectedSpace.name
      );

    const pageToken =
      encodeURIComponent(
        messageNextPageToken
      );

    const response =
      await fetch(
        `/api/spaces/${encoded}/messages?pageToken=${pageToken}`,
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

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
      );
    }

    const data =
      await response.json();

    const olderMessages =
      data.messages || [];

    const previousHeight =
      messages.scrollHeight;

    const previousTop =
      messages.scrollTop;

    prependMessages(
      olderMessages
    );

    messageNextPageToken =
      data.nextPageToken || null;

    hasOlderMessages =
      Boolean(messageNextPageToken);

    updateOlderMessagesButton();

    /*
     * Keep the user's viewport anchored.
     * Adding older messages above should not
     * visually jump the conversation.
     */
    const newHeight =
      messages.scrollHeight;

    messages.scrollTop =
      previousTop +
      (newHeight - previousHeight);

  } catch (error) {

    console.error(
      'Failed to load older messages:',
      error
    );

    if (button) {
      button.textContent =
        '↑ Load older messages';
    }

  } finally {

    loadingOlderMessages =
      false;

    updateOlderMessagesButton();
  }
}


function prependMessages(messageList) {

  if (!messageList.length) {
    return;
  }

  const fragment =
    document.createDocumentFragment();

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

    if (
      !message ||
      !message.name
    ) {
      continue;
    }

    if (
      findMessageElement(
        message.name
      )
    ) {
      continue;
    }

    const empty =
      messages.querySelector(
        '.empty-state'
      );

    if (empty) {
      empty.remove();
    }

    /*
     * appendMessage() normally appends to
     * the conversation. Temporarily create
     * the message in a detached container,
     * then move it into the real container.
     */
    const holder =
      document.createElement(
        'div'
      );

    const originalMessages =
      messages;

    /*
     * We need the existing appendMessage()
     * logic without duplicating its large
     * renderer, so use a temporary live
     * container.
     */
    holder.className =
      'messages-temp-holder';

    document.body.appendChild(
      holder
    );

    /*
     * Swap the global message container
     * reference temporarily.
     */
    messages =
      holder;

    appendMessage(
      message,
      false
    );

    messages =
      originalMessages;

    const rendered =
      holder.firstElementChild;

    if (rendered) {
      fragment.appendChild(
        rendered
      );
    }

    holder.remove();
  }

  messages.prepend(
    fragment
  );
}


function updateOlderMessagesButton() {

  let button =
    document.querySelector(
      '.load-older-button'
    );

  if (!hasOlderMessages) {

    if (button) {
      button.remove();
    }

    return;
  }

  if (!button) {

    button =
      document.createElement(
        'button'
      );

    button.type =
      'button';

    button.className =
      'load-older-button';

    button.addEventListener(
      'click',
      loadOlderMessages
    );

    /*
     * Put the button at the very top
     * of the message container.
     */
    messages.prepend(
      button
    );
  }

  button.textContent =
    loadingOlderMessages
      ? 'Loading older messages...'
      : '↑ Load older messages';

  button.disabled =
    loadingOlderMessages;
}


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

  const text =
    getMessageText(message);

  if (text) {

    const textNode =
      document.createElement('div');

    textNode.className =
      'message-text';

    textNode.textContent =
      text;

    bubble.appendChild(
      textNode
    );
  }

  renderAttachments(
    bubble,
    message
  );

  content.appendChild(header);
  content.appendChild(bubble);

  const actions =
    createReplyButton(message);

  content.appendChild(actions);

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

    wrapper.classList.add(
      'message-live'
    );

    setTimeout(
      () =>
        wrapper.classList.remove(
          'message-live'
        ),
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

    bubble.innerHTML = '';

    const text =
      getMessageText(message);

    if (text) {

      const textNode =
        document.createElement('div');

      textNode.className =
        'message-text';

      textNode.textContent =
        text;

      bubble.appendChild(
        textNode
      );
    }

    renderAttachments(
      bubble,
      message
    );
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

  const oldActions =
    element.querySelector(
      '.message-actions'
    );

  if (oldActions) {
    oldActions.remove();
  }

  const updatedContent =
    element.querySelector(
      '.message-content'
    );

  if (updatedContent) {
    updatedContent.appendChild(
      createReplyButton(message)
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
        content.appendChild(
          edited
        );
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

    and:

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
    Determine which space this message
    belongs to.
  */

  const spaceName =
    message.space?.name ||
    (
      message.name &&
      message.name.includes('/messages/')
        ? message.name.split('/messages/')[0]
        : null
    );

  if (!spaceName) {
    console.warn(
      '⚠️ Live message has no space:',
      message
    );
    return;
  }

  /*
    Determine whether this message was
    sent by the currently authenticated
    Google Chat user.
  */

  const senderName =
    message.sender?.name || '';

  const ownUserName =
    currentUserId
      ? `users/${currentUserId}`
      : '';

  const isOwnMessage =
    Boolean(
      ownUserName &&
      senderName === ownUserName
    );

  /*
    CREATED
  */

  if (
    eventType.includes('created')
  ) {

    /*
      Never create an unread notification
      for our own messages.
    */

    if (isOwnMessage) {

      if (
        selectedSpace &&
        spaceName === selectedSpace.name
      ) {
        appendMessage(
          message,
          true
        );
      }

      return;
    }

    /*
      Current conversation:
      show the message normally,
      but don't increase unread.
    */

    if (
      selectedSpace &&
      spaceName === selectedSpace.name
    ) {

      appendMessage(
        message,
        true
      );

      return;
    }

    /*
      Another conversation:
      increase its unread count.
    */

    incrementUnread(
      spaceName
    );

    console.log(
      '🔴 Unread message:',
      spaceName,
      'count:',
      getUnreadCount(spaceName)
    );

    return;
  }

  /*
    UPDATED

    Editing a message should not create
    a new unread notification.
  */

  if (
    eventType.includes('updated')
  ) {

    if (
      selectedSpace &&
      spaceName === selectedSpace.name
    ) {

      appendMessage(
        message,
        true
      );
    }

    return;
  }

  /*
    DELETED
  */

  if (
    eventType.includes('deleted')
  ) {

    if (
      selectedSpace &&
      spaceName === selectedSpace.name
    ) {

      deleteMessage(
        message.name
      );
    }

    return;
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

  const file =
    typeof fileInput !== 'undefined'
      ? fileInput.files[0]
      : null;

  if (!text && !file) {
    return;
  }

  sendButton.disabled =
    true;

  try {

    const encoded =
      encodeURIComponent(
        selectedSpace.name
      );

    const replyThreadName =
      replyingTo?.threadName || '';

    let response;

    if (file) {

      const formData =
        new FormData();

      formData.append(
        'text',
        text
      );

      formData.append(
        'file',
        file,
        file.name
      );

      if (replyThreadName) {
        formData.append(
          'replyThreadName',
          replyThreadName
        );
      }

      response =
        await fetch(
          `/api/spaces/${encoded}/attachments`,
          {
            method: 'POST',
            credentials: 'same-origin',
            body: formData
          }
        );

    } else {

      response =
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
                text,
                replyThreadName
              })
          }
        );
    }

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
        'Failed to send'
      );
    }

    messageInput.value = '';

    if (file) {
      fileInput.value = '';
      updateAttachmentLabel();
    }

    clearReply();

    autoResize();

  } catch (error) {

    console.error(
      'Send failed:',
      error
    );

    alert(
      error.message ||
      'Failed to send message.'
    );

  } finally {

    sendButton.disabled =
      false;

    messageInput.focus();
  }
}


function updateAttachmentLabel() {

  if (
    typeof attachmentLabel === 'undefined'
  ) {
    return;
  }

  if (
    fileInput.files &&
    fileInput.files.length
  ) {

    const file =
      fileInput.files[0];

    const sizeMB =
      file.size /
      (1024 * 1024);

    attachmentLabel.textContent =
      `${file.name} · ${sizeMB.toFixed(1)} MB`;

    attachmentLabel.classList.add(
      'has-file'
    );

  } else {

    attachmentLabel.textContent =
      'Attach a file';

    attachmentLabel.classList.remove(
      'has-file'
    );
  }
}


if (
  typeof attachButton !== 'undefined'
) {

  attachButton.addEventListener(
    'click',
    () => fileInput.click()
  );
}


if (
  typeof fileInput !== 'undefined'
) {

  fileInput.addEventListener(
    'change',
    updateAttachmentLabel
  );
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

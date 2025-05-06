// main.js
const messagesDiv = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

function typeWriter(text, className) {
  let i = 0;
  const messageElem = document.createElement('div');
  messageElem.className = 'message ' + className;
  messagesDiv.appendChild(messageElem);
  const interval = setInterval(() => {
    if (i < text.length) {
      messageElem.textContent += text.charAt(i);
      i++;
    } else {
      clearInterval(interval);
    }
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }, 30);
}

// 送信処理を関数化（ボタンとEnterキーで共有）
function sendMessage() {
  const userText = userInput.value.trim();
  if (!userText) return;
  typeWriter(userText, 'user');
  userInput.value = '';
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: userText })
  })
  .then(res => res.json())
  .then(data => {
    typeWriter(data.reply, 'bot');
  })
  .catch(err => {
    console.error(err);
    typeWriter("エラーが発生しました。", 'bot');
  });
}

// 送信ボタンのクリックイベント
sendBtn.addEventListener('click', sendMessage);

// Enterキーでの送信対応
userInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});
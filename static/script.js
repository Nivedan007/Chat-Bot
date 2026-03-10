const form = document.getElementById("chatForm");
const input = document.getElementById("message");
const chatbox = document.getElementById("chatbox");
const sendBtn = document.getElementById("sendBtn");
const historyList = document.getElementById("historyList");
const newChatBtn = document.getElementById("newChatBtn");
const currentChatTitle = document.getElementById("currentChatTitle");

const STORAGE_KEY = "chatbot_conversations_v1";

let conversations = [];
let currentConversationId = null;

function escapeHtml(text) {
	return String(text)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function scrollToBottom() {
	chatbox.scrollTop = chatbox.scrollHeight;
}

function uid() {
	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toTitle(text) {
	const clean = text.replaceAll("\n", " ").trim();
	return clean.length > 42 ? `${clean.slice(0, 42)}...` : clean;
}

function saveConversations() {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

function loadConversations() {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
		if (Array.isArray(parsed)) {
			conversations = parsed;
		}
	} catch {
		conversations = [];
	}
}

function createConversation() {
	const now = Date.now();
	const conversation = {
		id: uid(),
		title: "New conversation",
		createdAt: now,
		updatedAt: now,
		messages: []
	};
	conversations.unshift(conversation);
	currentConversationId = conversation.id;
	saveConversations();
	renderHistoryList();
	renderCurrentConversation();
}

function getCurrentConversation() {
	return conversations.find((item) => item.id === currentConversationId) || null;
}

function ensureConversationSelected() {
	if (!conversations.length) {
		createConversation();
		return;
	}

	if (!currentConversationId || !getCurrentConversation()) {
		currentConversationId = conversations[0].id;
	}
}

function formatTime(ts) {
	return new Date(ts).toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit"
	});
}

function renderHistoryList() {
	historyList.innerHTML = "";

	conversations
		.slice()
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.forEach((conversation) => {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "history-item";
			if (conversation.id === currentConversationId) {
				button.classList.add("active");
			}

			button.innerHTML = `
				<div class="history-title">${escapeHtml(conversation.title || "New conversation")}</div>
				<div class="history-time">${formatTime(conversation.updatedAt)}</div>
			`;

			button.addEventListener("click", () => {
				currentConversationId = conversation.id;
				renderHistoryList();
				renderCurrentConversation();
			});

			historyList.appendChild(button);
		});
}

function appendMessage(role, content, extraClass = "") {
	const msg = document.createElement("div");
	msg.className = `message ${role} ${extraClass}`.trim();
	msg.innerHTML = escapeHtml(content);
	chatbox.appendChild(msg);
	return msg;
}

function renderCurrentConversation() {
	const conversation = getCurrentConversation();
	chatbox.innerHTML = "";

	if (!conversation || !conversation.messages.length) {
		chatbox.innerHTML = `
			<section class="empty" id="emptyState">
				<h2>What can I help with?</h2>
				<p>Ask anything to start your chat.</p>
			</section>
		`;
		currentChatTitle.textContent = "New conversation";
		return;
	}

	for (const item of conversation.messages) {
		appendMessage(item.role, item.content, item.error ? "error" : "");
	}

	currentChatTitle.textContent = conversation.title || "Conversation";
	scrollToBottom();
}

function addMessageToCurrent(role, content, error = false) {
	const conversation = getCurrentConversation();
	if (!conversation) {
		return;
	}

	conversation.messages.push({ role, content, error });
	conversation.updatedAt = Date.now();

	if (role === "user" && conversation.title === "New conversation") {
		conversation.title = toTitle(content) || "Conversation";
	}

	conversations.sort((a, b) => b.updatedAt - a.updatedAt);
	saveConversations();
	renderHistoryList();
	currentChatTitle.textContent = conversation.title || "Conversation";
}

async function sendMessage() {
	const message = input.value.trim();
	if (!message) {
		return;
	}

	ensureConversationSelected();

	appendMessage("user", message);
	addMessageToCurrent("user", message);
	input.value = "";
	sendBtn.disabled = true;
	scrollToBottom();

	const typing = appendMessage("assistant", "Thinking...");

	try {
		const conversation = getCurrentConversation();
		const history = conversation ? conversation.messages.slice(0, -1) : [];

		const response = await fetch("/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				message,
				history
			})
		});

		let data = {};
		try {
			data = await response.json();
		} catch {
			data = {};
		}

		if (!response.ok) {
			throw new Error(data.reply || "Request failed. Check server logs.");
		}

		const replyText = data.reply || "No response received.";
		typing.textContent = replyText;
		addMessageToCurrent("assistant", replyText);
	} catch (error) {
		const errorText = error.message || "Something went wrong.";
		typing.textContent = errorText;
		typing.classList.add("error");
		addMessageToCurrent("assistant", errorText, true);
	} finally {
		sendBtn.disabled = false;
		input.focus();
		scrollToBottom();
	}
}

form.addEventListener("submit", async (event) => {
	event.preventDefault();
	await sendMessage();
});

newChatBtn.addEventListener("click", () => {
	createConversation();
	input.focus();
});

loadConversations();
ensureConversationSelected();
renderHistoryList();
renderCurrentConversation();
input.focus();
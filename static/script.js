const form = document.getElementById("chatForm");
const input = document.getElementById("message");
const chatbox = document.getElementById("chatbox");
const sendBtn = document.getElementById("sendBtn");
const historyList = document.getElementById("historyList");
const newChatBtn = document.getElementById("newChatBtn");
const currentChatTitle = document.getElementById("currentChatTitle");
const plusBtn = document.getElementById("plusBtn");
const actionsMenu = document.getElementById("actionsMenu");
const attachmentInput = document.getElementById("attachmentInput");
const modeBadge = document.getElementById("modeBadge");
const contextHint = document.getElementById("contextHint");

const STORAGE_KEY = "chatbot_conversations_v1";
const MODE_LABELS = {
	chat: "Chat",
	"create-image": "Create image",
	thinking: "Thinking",
	"deep-research": "Deep research",
	"shopping-research": "Shopping research"
};
const MAX_ATTACHMENT_BYTES = 400000;
const MAX_ATTACHMENTS = 3;

let conversations = [];
let currentConversationId = null;
let selectedMode = "chat";
let pendingAttachments = [];

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

function setMode(mode) {
	selectedMode = MODE_LABELS[mode] ? mode : "chat";
	modeBadge.textContent = `Mode: ${MODE_LABELS[selectedMode]}`;
	renderContextHint();
}

function closeActionsMenu() {
	actionsMenu.classList.remove("open");
	actionsMenu.setAttribute("aria-hidden", "true");
}

function toggleActionsMenu() {
	const isOpen = actionsMenu.classList.contains("open");
	if (isOpen) {
		closeActionsMenu();
		return;
	}
	actionsMenu.classList.add("open");
	actionsMenu.setAttribute("aria-hidden", "false");
}

function formatAttachmentSize(bytes) {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	if (bytes >= 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}
	return `${bytes} B`;
}

function isTextLikeFile(file) {
	if (file.type.startsWith("text/")) {
		return true;
	}
	const lower = file.name.toLowerCase();
	return lower.endsWith(".json") || lower.endsWith(".csv") || lower.endsWith(".md") || lower.endsWith(".txt");
}

async function parseAttachment(file) {
	const parsed = {
		name: file.name,
		type: file.type || "application/octet-stream",
		size: file.size,
		content: ""
	};

	if (isTextLikeFile(file) && file.size <= MAX_ATTACHMENT_BYTES) {
		try {
			parsed.content = (await file.text()).slice(0, 12000);
		} catch {
			parsed.content = "";
		}
	}

	return parsed;
}

function renderContextHint() {
	const modeText = `Mode: ${MODE_LABELS[selectedMode]}`;
	if (!pendingAttachments.length) {
		contextHint.textContent = modeText;
		return;
	}

	const fileText = pendingAttachments
		.map((file) => `${file.name} (${formatAttachmentSize(file.size)})`)
		.join(", ");
	contextHint.textContent = `${modeText} | Files: ${fileText}`;
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

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeReply(element, fullText) {
	const text = String(fullText || "");
	const tokens = text.match(/\S+\s*/g) || text.split("");
	element.textContent = "";

	for (const token of tokens) {
		element.textContent += token;
		scrollToBottom();
		// Slightly faster cadence for a smooth ChatGPT-like reveal.
		await sleep(26);
	}
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
	closeActionsMenu();
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
				history,
				mode: selectedMode,
				attachments: pendingAttachments
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
		await typeReply(typing, replyText);
		addMessageToCurrent("assistant", replyText);
		pendingAttachments = [];
		renderContextHint();
	} catch (error) {
		const errorText = error.message || "Something went wrong.";
		await typeReply(typing, errorText);
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

plusBtn.addEventListener("click", () => {
	toggleActionsMenu();
});

document.addEventListener("click", (event) => {
	if (!actionsMenu.contains(event.target) && !plusBtn.contains(event.target)) {
		closeActionsMenu();
	}
});

actionsMenu.addEventListener("click", (event) => {
	const actionButton = event.target.closest("[data-action]");
	if (!actionButton) {
		return;
	}

	const action = actionButton.getAttribute("data-action") || "chat";
	if (action === "add-files") {
		attachmentInput.click();
		closeActionsMenu();
		return;
	}

	setMode(action);
	closeActionsMenu();
	input.focus();
});

attachmentInput.addEventListener("change", async () => {
	const files = Array.from(attachmentInput.files || []).slice(0, MAX_ATTACHMENTS);
	const parsed = [];

	for (const file of files) {
		parsed.push(await parseAttachment(file));
	}

	pendingAttachments = parsed;
	renderContextHint();
	attachmentInput.value = "";
});

loadConversations();
ensureConversationSelected();
renderHistoryList();
renderCurrentConversation();
setMode("chat");
renderContextHint();
input.focus();
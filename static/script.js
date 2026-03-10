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
const aspectRatioSelect = document.getElementById("aspectRatioSelect");
const styleSelect = document.getElementById("styleSelect");

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
let imageOptions = {
	aspectRatio: "1:1",
	style: "realistic"
};

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
	const imageText =
		selectedMode === "create-image"
			? ` | Image: ${imageOptions.aspectRatio}, ${imageOptions.style}`
			: "";

	if (!pendingAttachments.length) {
		contextHint.textContent = `${modeText}${imageText}`;
		return;
	}

	const fileText = pendingAttachments
		.map((file) => `${file.name} (${formatAttachmentSize(file.size)})`)
		.join(", ");
	contextHint.textContent = `${modeText}${imageText} | Files: ${fileText}`;
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

function appendMessage(role, content, extraClass = "", metadata = {}) {
	const msg = document.createElement("div");
	msg.className = `message ${role} ${extraClass}`.trim();
	if (typeof metadata.messageIndex === "number") {
		msg.dataset.messageIndex = String(metadata.messageIndex);
	}
	msg.innerHTML = escapeHtml(content);
	chatbox.appendChild(msg);
	return msg;
}

function appendImageToMessage(messageElement, imageBase64, imageMime = "image/png") {
	if (!messageElement || !imageBase64) {
		return;
	}

	if (!String(imageMime).startsWith("image/")) {
		return;
	}

	const image = document.createElement("img");
	image.className = "message-image";
	image.alt = "Generated image";
	image.loading = "lazy";
	image.src = `data:${imageMime};base64,${imageBase64}`;
	messageElement.appendChild(document.createElement("br"));
	messageElement.appendChild(image);
	scrollToBottom();
}

function appendImageTools(messageElement, imageMeta = {}) {
	const tools = document.createElement("div");
	tools.className = "message-image-tools";

	const downloadBtn = document.createElement("button");
	downloadBtn.type = "button";
	downloadBtn.className = "image-tool-btn";
	downloadBtn.textContent = "Download";
	downloadBtn.dataset.tool = "download-image";

	const regenBtn = document.createElement("button");
	regenBtn.type = "button";
	regenBtn.className = "image-tool-btn";
	regenBtn.textContent = "Regenerate";
	regenBtn.dataset.tool = "regenerate-image";

	if (!imageMeta?.imageRequest?.prompt) {
		regenBtn.disabled = true;
	}

	tools.appendChild(downloadBtn);
	tools.appendChild(regenBtn);
	messageElement.appendChild(tools);
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

	for (let idx = 0; idx < conversation.messages.length; idx += 1) {
		const item = conversation.messages[idx];
		const messageElement = appendMessage(item.role, item.content, item.error ? "error" : "", {
			messageIndex: idx
		});
		if (item.imageBase64 && item.role === "assistant") {
			appendImageToMessage(messageElement, item.imageBase64, item.imageMime || "image/png");
			appendImageTools(messageElement, item);
		}
	}

	currentChatTitle.textContent = conversation.title || "Conversation";
	scrollToBottom();
}

function addMessageToCurrent(role, content, error = false, metadata = {}) {
	const conversation = getCurrentConversation();
	if (!conversation) {
		return;
	}

	conversation.messages.push({ role, content, error, ...metadata });
	conversation.updatedAt = Date.now();

	if (role === "user" && conversation.title === "New conversation") {
		conversation.title = toTitle(content) || "Conversation";
	}

	conversations.sort((a, b) => b.updatedAt - a.updatedAt);
	saveConversations();
	renderHistoryList();
	currentChatTitle.textContent = conversation.title || "Conversation";
}

async function sendMessage(options = {}) {
	const {
		messageOverride = null,
		modeOverride = null,
		attachmentsOverride = null,
		imageOptionsOverride = null
	} = options;

	const message = messageOverride !== null ? String(messageOverride).trim() : input.value.trim();
	if (!message) {
		return;
	}

	const modeToUse = modeOverride || selectedMode;
	const attachmentsToUse = attachmentsOverride || pendingAttachments;
	const imageOptionsToUse = imageOptionsOverride || imageOptions;

	ensureConversationSelected();

	appendMessage("user", message);
	addMessageToCurrent("user", message);
	if (messageOverride === null) {
		input.value = "";
	}
	sendBtn.disabled = true;
	closeActionsMenu();
	scrollToBottom();

	const typing = appendMessage("assistant", "Thinking...");

	try {
		const conversation = getCurrentConversation();
		const history = conversation
			? conversation.messages.slice(0, -1).map((item) => ({
				role: item.role,
				content: item.content,
				error: item.error
			}))
			: [];

		const response = await fetch("/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				message,
				history,
				mode: modeToUse,
				attachments: attachmentsToUse,
				image_options: imageOptionsToUse
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
		const imageRequest =
			modeToUse === "create-image"
				? {
					prompt: message,
					aspectRatio: imageOptionsToUse.aspectRatio,
					style: imageOptionsToUse.style
				}
				: null;
		if (data.image_base64) {
			appendImageToMessage(typing, data.image_base64, data.image_mime || "image/png");
			appendImageTools(typing, { imageRequest });
		}
		addMessageToCurrent("assistant", replyText, false, {
			imageBase64: data.image_base64 || null,
			imageMime: data.image_mime || null,
			imageRequest
		});
		if (attachmentsOverride === null) {
			pendingAttachments = [];
		}
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

chatbox.addEventListener("click", async (event) => {
	const toolButton = event.target.closest("[data-tool]");
	if (!toolButton) {
		return;
	}

	const messageElement = toolButton.closest(".message");
	const messageIndex = Number(messageElement?.dataset?.messageIndex);
	if (!Number.isInteger(messageIndex)) {
		return;
	}

	const conversation = getCurrentConversation();
	const targetMessage = conversation?.messages?.[messageIndex];
	if (!targetMessage) {
		return;
	}

	if (toolButton.dataset.tool === "download-image") {
		if (!targetMessage.imageBase64 || !targetMessage.imageMime) {
			return;
		}

		const extMap = {
			"image/png": "png",
			"image/jpeg": "jpg",
			"image/webp": "webp"
		};
		const extension = extMap[targetMessage.imageMime] || "png";

		const link = document.createElement("a");
		link.href = `data:${targetMessage.imageMime};base64,${targetMessage.imageBase64}`;
		link.download = `generated-${Date.now()}.${extension}`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		return;
	}

	if (toolButton.dataset.tool === "regenerate-image") {
		const req = targetMessage.imageRequest;
		if (!req || !req.prompt) {
			return;
		}

		setMode("create-image");
		imageOptions = {
			aspectRatio: req.aspectRatio || "1:1",
			style: req.style || "realistic"
		};
		aspectRatioSelect.value = imageOptions.aspectRatio;
		styleSelect.value = imageOptions.style;
		renderContextHint();

		await sendMessage({
			messageOverride: req.prompt,
			modeOverride: "create-image",
			attachmentsOverride: [],
			imageOptionsOverride: imageOptions
		});
	}
});

aspectRatioSelect.addEventListener("change", () => {
	imageOptions.aspectRatio = aspectRatioSelect.value || "1:1";
	renderContextHint();
});

styleSelect.addEventListener("change", () => {
	imageOptions.style = styleSelect.value || "realistic";
	renderContextHint();
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
const form = document.getElementById("chatForm");
const input = document.getElementById("message");
const chatbox = document.getElementById("chatbox");
const emptyState = document.getElementById("emptyState");
const sendBtn = document.getElementById("sendBtn");

function escapeHtml(text) {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function scrollToBottom() {
	chatbox.scrollTop = chatbox.scrollHeight;
}

function appendMessage(role, content, extraClass = "") {
	if (emptyState) {
		emptyState.remove();
	}

	const msg = document.createElement("div");
	msg.className = `message ${role} ${extraClass}`.trim();
	msg.innerHTML = escapeHtml(content);
	chatbox.appendChild(msg);
	scrollToBottom();
	return msg;
}

async function sendMessage() {
	const message = input.value.trim();
	if (!message) {
		return;
	}

	appendMessage("user", message);
	input.value = "";
	sendBtn.disabled = true;

	const typing = appendMessage("assistant", "Thinking...");

	try {
		const response = await fetch("/chat", {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({ message })
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

		typing.textContent = data.reply || "No response received.";
	} catch (error) {
		typing.textContent = error.message || "Something went wrong.";
		typing.classList.add("error");
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

input.focus();
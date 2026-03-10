import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from google import genai

app = Flask(__name__)

SYSTEM_PROMPT = (
    "You are a precise assistant. Answer the user's exact question directly and completely. "
    "Do not give vague replies. If the user asks for steps, provide clear numbered steps. "
    "If the user asks for an explanation, include key details and examples when useful. "
    "Keep the response focused on what was asked."
)

MODE_INSTRUCTIONS = {
    "chat": "Respond normally in concise helpful style.",
    "thinking": (
        "Think through the problem carefully and provide a step-by-step answer with clear reasoning, "
        "but keep it readable and not overly verbose."
    ),
    "deep-research": (
        "Provide a detailed, research-style answer. Structure with short sections and practical evidence-based guidance."
    ),
    "shopping-research": (
        "Provide product-comparison style guidance with trade-offs, budget options, key specs, and a short recommendation."
    ),
    "create-image": (
        "You cannot return a real image file. Instead, provide a high-quality image generation prompt, "
        "a negative prompt, and a short style note based on the user's request."
    ),
}


def _load_local_env() -> None:
    # Minimal .env parser for simple KEY=VALUE lines.
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ[key] = value


_load_local_env()


def _build_quota_message(raw_error: str) -> str:
    if "API_KEY_INVALID" in raw_error or "INVALID_ARGUMENT" in raw_error:
        return "Gemini API key is invalid. Update GEMINI_API_KEY in .env and restart the app."
    if "RESOURCE_EXHAUSTED" in raw_error or "429" in raw_error:
        return (
            "Gemini quota exceeded. Please wait a bit and try again, "
            "or switch to a key/project with available quota."
        )
    return f"Gemini request failed: {raw_error}"


def _local_fallback_reply(user_message: str) -> str:
    # Keep the app usable when external quota/key issues occur.
    return (
        "Gemini is temporarily unavailable, so this is a local fallback response. "
        f"You said: {user_message}"
    )

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/chat", methods=["POST"])
def chat():
    payload = request.get_json(silent=True) or {}
    user_message = payload.get("message", "")
    history = payload.get("history", [])
    raw_mode = str(payload.get("mode", "chat")).strip().lower()
    mode = raw_mode if raw_mode in MODE_INSTRUCTIONS else "chat"
    attachments = payload.get("attachments", [])

    if not user_message.strip():
        return jsonify({"reply": "Message cannot be empty."}), 400

    conversation_lines = []
    if isinstance(history, list):
        # Keep context bounded to recent turns for speed and token control.
        for item in history[-20:]:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role", "")).strip().lower()
            content = str(item.get("content", "")).strip()
            if role not in {"user", "assistant"} or not content:
                continue
            conversation_lines.append(f"{role.title()}: {content}")

    attachment_lines = []
    if isinstance(attachments, list):
        # Keep attachment context bounded to avoid oversized prompts.
        for entry in attachments[:5]:
            if not isinstance(entry, dict):
                continue

            name = str(entry.get("name", "unknown")).strip()[:120]
            file_type = str(entry.get("type", "unknown")).strip()[:100]
            size = entry.get("size", 0)
            content = str(entry.get("content", "")).strip()[:2000]

            attachment_lines.append(f"File: {name} | Type: {file_type} | Size: {size} bytes")
            if content:
                attachment_lines.append(f"Extracted text: {content}")

    mode_instruction = MODE_INSTRUCTIONS.get(mode, MODE_INSTRUCTIONS["chat"])

    if conversation_lines:
        user_prompt = (
            "Use this conversation context to answer the latest user question clearly and completely.\n\n"
            + "\n".join(conversation_lines)
            + (
                "\n\nAttachments available:\n" + "\n".join(attachment_lines)
                if attachment_lines
                else ""
            )
            + f"\n\nSelected mode: {mode}\nMode instruction: {mode_instruction}"
            + f"\n\nLatest user question: {user_message.strip()}"
        )
    else:
        user_prompt = (
            f"Selected mode: {mode}\n"
            f"Mode instruction: {mode_instruction}\n"
            + (
                "Attachments available:\n" + "\n".join(attachment_lines) + "\n"
                if attachment_lines
                else ""
            )
            + f"User question: {user_message.strip()}"
        )

    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        # Keep the app functional in deployment even if env vars are not configured yet.
        return jsonify({"reply": _local_fallback_reply(user_message)})

    client = genai.Client(api_key=api_key)
    # Try currently available models first to minimize quota/model-version failures.
    models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"]
    errors = []

    for model_name in models:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    SYSTEM_PROMPT,
                    user_prompt,
                ],
                config={
                    "temperature": 0.3,
                    "max_output_tokens": 2048,
                },
            )
            reply = response.text if response and response.text else "No response generated."
            return jsonify({"reply": reply})
        except Exception as exc:
            errors.append(str(exc))
            continue

    message = _build_quota_message(" | ".join(errors))

    # If quota is exhausted, return a local fallback response instead of failing.
    if "quota exceeded" in message.lower():
        return jsonify({"reply": _local_fallback_reply(user_message)})

    return jsonify({"reply": message}), 429


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    app.run(host="0.0.0.0", port=port, debug=False)
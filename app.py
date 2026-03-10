import os
import base64
import html
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from google import genai
from google.genai import types

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
        "Generate an image that matches the user request. Also include one short caption for the generated image."
    ),
}

ALLOWED_ASPECT_RATIOS = {"1:1", "9:16", "16:9", "4:5"}
ALLOWED_STYLES = {"realistic", "anime", "cinematic", "watercolor", "digital-art"}


def _extract_text_and_image(response) -> tuple[str, str | None, str | None]:
    text_parts = []
    image_b64 = None
    image_mime = None

    candidates = getattr(response, "candidates", None) or []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            text = getattr(part, "text", None)
            if text:
                text_parts.append(str(text))

            inline_data = getattr(part, "inline_data", None)
            data = getattr(inline_data, "data", None) if inline_data else None
            if data and image_b64 is None:
                if isinstance(data, bytes):
                    image_b64 = base64.b64encode(data).decode("ascii")
                else:
                    image_b64 = str(data)
                image_mime = getattr(inline_data, "mime_type", None) or "image/png"

    text = "\n".join(part for part in text_parts if part).strip()
    return text, image_b64, image_mime


def _build_image_prompt(user_message: str, aspect_ratio: str, style: str) -> str:
    return (
        "Create a high-quality image based on the user request below. "
        f"Use aspect ratio {aspect_ratio}. "
        f"Art style: {style}. "
        "Return one short caption describing the final image.\n\n"
        f"User request: {user_message.strip()}"
    )


def _try_generate_image(client: genai.Client, prompt: str) -> tuple[str, str | None, str | None, list[str]]:
    image_models = [
        "gemini-2.0-flash-preview-image-generation",
        "gemini-2.5-flash-image-preview",
    ]
    errors = []

    for model_name in image_models:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_modalities=["TEXT", "IMAGE"],
                    temperature=0.4,
                ),
            )
            text, image_b64, image_mime = _extract_text_and_image(response)
            if image_b64:
                caption = text or "Generated image"
                return caption, image_b64, image_mime, errors
            errors.append(f"{model_name}: No image returned")
        except Exception as exc:
            errors.append(f"{model_name}: {exc}")

    return "", None, None, errors


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


def _looks_like_image_request(user_message: str) -> bool:
    text = user_message.strip().lower()
    image_phrases = [
        "generate image",
        "create image",
        "make image",
        "draw",
        "illustration",
        "image of",
        "picture of",
        "photo of",
        "logo",
    ]
    return any(phrase in text for phrase in image_phrases)


def _build_placeholder_image_svg(user_message: str) -> str:
    safe_text = html.escape(user_message.strip()[:80] or "Generated image")
    svg = f"""<svg xmlns='http://www.w3.org/2000/svg' width='1024' height='1024' viewBox='0 0 1024 1024'>
<defs>
<linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
<stop offset='0%' stop-color='#dcebd1'/>
<stop offset='100%' stop-color='#c7dbbf'/>
</linearGradient>
</defs>
<rect width='1024' height='1024' fill='url(#g)'/>
<rect x='92' y='92' width='840' height='840' rx='40' fill='white' opacity='0.72'/>
<text x='512' y='470' text-anchor='middle' fill='#1f2a1e' font-size='46' font-family='Arial, sans-serif'>Image Preview</text>
<text x='512' y='540' text-anchor='middle' fill='#35573a' font-size='30' font-family='Arial, sans-serif'>{safe_text}</text>
<text x='512' y='604' text-anchor='middle' fill='#5a6857' font-size='24' font-family='Arial, sans-serif'>Set GEMINI_API_KEY for real generated images</text>
</svg>"""
    return base64.b64encode(svg.encode("utf-8")).decode("ascii")


def _local_fallback_reply(user_message: str) -> str:
    # Keep the app usable when external quota/key issues occur.
    return (
        "Gemini is temporarily unavailable, so this is a local fallback response. "
        f"You said: {user_message}"
    )

@app.route("/")
def home():
    asset_version = os.environ.get("VERCEL_GIT_COMMIT_SHA", "dev")[:8]
    return render_template("index.html", asset_version=asset_version)


@app.route("/chat", methods=["POST"])
def chat():
    payload = request.get_json(silent=True) or {}
    user_message = payload.get("message", "")
    history = payload.get("history", [])
    raw_mode = str(payload.get("mode", "chat")).strip().lower()
    mode = raw_mode if raw_mode in MODE_INSTRUCTIONS else "chat"
    attachments = payload.get("attachments", [])
    image_options = payload.get("image_options", {})

    if not user_message.strip():
        return jsonify({"reply": "Message cannot be empty."}), 400

    # Handle common user behavior: asking for images while still in Chat mode.
    if mode == "chat" and _looks_like_image_request(user_message):
        mode = "create-image"

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

    aspect_ratio = "1:1"
    style = "realistic"
    if isinstance(image_options, dict):
        candidate_ratio = str(image_options.get("aspectRatio", "1:1")).strip()
        candidate_style = str(image_options.get("style", "realistic")).strip().lower()
        if candidate_ratio in ALLOWED_ASPECT_RATIOS:
            aspect_ratio = candidate_ratio
        if candidate_style in ALLOWED_STYLES:
            style = candidate_style

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

    api_key = (
        os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
        or os.environ.get("GOOGLE_GENERATIVE_AI_API_KEY")
    )
    if not api_key:
        if mode == "create-image":
            # Return a local placeholder image so the UI flow remains functional.
            return jsonify(
                {
                    "reply": (
                        "Generated a local placeholder image. "
                        "Add GEMINI_API_KEY in deployment settings for real AI image generation."
                    ),
                    "image_base64": _build_placeholder_image_svg(user_message),
                    "image_mime": "image/svg+xml",
                }
            )

        # Keep chat usable and include actionable deployment guidance.
        return jsonify(
            {
                "reply": (
                    _local_fallback_reply(user_message)
                    + "\n\nTo enable real AI responses in production, set GEMINI_API_KEY in your deployment environment variables and redeploy."
                )
            }
        )

    client = genai.Client(api_key=api_key)

    if mode == "create-image":
        image_prompt = _build_image_prompt(user_message, aspect_ratio, style)
        image_caption, image_b64, image_mime, image_errors = _try_generate_image(client, image_prompt)
        if image_b64:
            return jsonify(
                {
                    "reply": image_caption,
                    "image_base64": image_b64,
                    "image_mime": image_mime or "image/png",
                    "image_options": {
                        "aspectRatio": aspect_ratio,
                        "style": style,
                    },
                }
            )

        # Fall through to text response if image generation is unavailable.

    # Try currently available models first to minimize quota/model-version failures.
    models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"]
    errors = image_errors if mode == "create-image" else []

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